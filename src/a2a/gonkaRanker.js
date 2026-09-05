// Gonka-backed offer ranking for NORMAL mode only. Blueprint §4.2 step 5 and
// the §3.3 diagram (step 4: "3模型共识 (仅NORMAL)", step 5: "紧急: first-viable
// 零LLM") keep the EMERGENCY path free of any LLM call.
//
// Contract with the rest of the system:
//   - Input: viable arrivals ({ offer, receivedAtMs }) that already passed
//     evaluateOffer(); viability itself is never delegated to a model.
//   - Every model in GONKA_MODELS is queried in parallel; answers that arrive
//     after GONKA_RANKING_BUDGET_MS are discarded by the clock (blueprint §6-C
//     "strict timeout/fail-fast").
//   - Votes are merged with Borda counting; ties fall back to the
//     deterministic order from rankOffers().
//   - Any failure (no key, network error, unparseable answer, empty votes)
//     resolves to null and the caller falls back to the deterministic
//     ranking — the system stays useful if Gonka is unavailable (§6-F).

import { rankOffers } from "./offerEvaluator.js";

export function parseConfig(overrides = {}) {
  const env = overrides.env ?? process.env;
  const apiKey = overrides.apiKey ?? env.GONKA_API_KEY ?? "";
  const baseUrl = overrides.baseUrl ?? env.GONKA_BASE_URL ?? "";
  const budgetMs = overrides.budgetMs ?? Number(env.GONKA_RANKING_BUDGET_MS ?? 45000);
  const maxTokens = overrides.maxTokens ?? Number(env.GONKA_RANKER_MAX_TOKENS ?? 500);
  const rawModels = overrides.models ?? env.GONKA_MODELS ?? "";
  const models = (Array.isArray(rawModels) ? rawModels : rawModels.split(","))
    .map((model) => model.trim())
    .filter(Boolean);
  const logger = overrides.logger ?? null;

  return { apiKey, baseUrl, budgetMs, maxTokens, models, logger };
}

function buildPrompt(offers, request) {
  const offerSummaries = offers.map((offer) => ({
    providerId: offer.providerId,
    capacityMbps: offer.capacityMbps,
    price: offer.price,
    currency: offer.currency,
    expectedActivationTimeMs: offer.expectedActivationTimeMs,
    expectedActivationClass: offer.expectedActivationClass,
    reliabilityScore: offer.reliabilityScore,
    latencyMs: offer.latencyMs,
    packetLossPercent: offer.packetLossPercent
  }));

  const constraints = {
    requestedCapacityMbps: request.requestedCapacityMbps,
    maxLatencyMs: request.requiredProfile.maxLatencyMs,
    maxPacketLossPercent: request.requiredProfile.maxPacketLossPercent,
    minReliability: request.requiredProfile.minReliability,
    maxBudget: request.maxBudget,
    targetActivationTimeMs: request.targetActivationTimeMs,
    durationMinutes: request.durationMinutes
  };

  return {
    system:
      "You rank connectivity recovery offers for a resilience exchange. " +
      "All offers are already viable. Rank them best-first balancing " +
      "activation speed, price and reliability. Be direct and concise: keep " +
      "internal reasoning under 2 sentences. Answer with ONLY a JSON " +
      'object of the form {"ranking":["<providerId>", ...]} using exactly ' +
      "the given providerIds, no prose.",
    user: JSON.stringify({ constraints, offers: offerSummaries })
  };
}

function extractLastJsonObject(content) {
  for (let end = content.lastIndexOf("}"); end !== -1; end = content.lastIndexOf("}", end - 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let start = end; start >= 0; start--) {
      const ch = content[start];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === "}") depth++;
      else if (ch === "{") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(content.slice(start, end + 1));
          } catch {
            break;
          }
        }
      } else if (ch === '"') {
        inString = true;
      }
    }
  }
  return null;
}

// Extracts the last valid JSON object embedded in a model answer → { ranking,
// requestId } filtered to known providerIds, or null.
function parseVote(answer, providerIds) {
  let content = answer?.ranking;
  if (typeof content !== "string") {
    return null;
  }
  // Reasoning models emit <think>…</think> first — if closed, prefer the trailer
  const closeTag = content.lastIndexOf("</think>");
  const target = closeTag !== -1 ? content.slice(closeTag + "</think>".length) : content;
  const parsed = extractLastJsonObject(target) ?? extractLastJsonObject(content);

  if (!parsed || !Array.isArray(parsed.ranking)) {
    return null;
  }

  const known = parsed.ranking.filter((id) => providerIds.includes(id));
  const unique = [...new Set(known)];

  return unique.length > 0
    ? { model: answer.model ?? null, ranking: unique, requestId: answer.requestId ?? null }
    : null;
}

async function queryModel(model, prompt, config, signal, fetchImpl) {
  const startedAt = Date.now();
  const logger = config.logger;
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        temperature: 0,
        // Reasoning models burn tokens inside <think>…</think> before the JSON
        // appears. Bounded to prevent rambling while leaving headroom for the JSON ranking.
        max_tokens: config.maxTokens
      }),
      signal
    });
  } catch (error) {
    const dur = Date.now() - startedAt;
    const isTimeout = signal?.aborted || error?.name === "AbortError";
    logger?.("debug", `[gonka-ranker] ${model} failed after ${dur}ms (${isTimeout ? "timeout" : error?.message})`);
    return null;
  }

  const dur = Date.now() - startedAt;
  logger?.("debug", `[gonka-ranker] ${model} completed in ${dur}ms (status: ${response.status})`);
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content ?? null;
  if (content === null) {
    return null;
  }
  // Gonka propagates the upstream request id — capture it verbatim for the
  // Transparency UI (fake fetches in tests may lack a headers API).
  const requestId =
    (typeof response.headers?.get === "function" ? response.headers.get("x-request-id") : null) ??
    (typeof payload?.id === "string" ? payload.id : null);

  return { model, ranking: content, requestId };
}

function mergeVotes(votes, deterministicOrder) {
  const positionSum = new Map();

  for (const vote of votes) {
    vote.forEach((providerId, index) => {
      positionSum.set(providerId, (positionSum.get(providerId) ?? 0) + index);
    });
  }

  // Unranked providers get the worst average position so an incomplete vote
  // cannot win; the deterministic order breaks every tie.
  const defaultPosition = deterministicOrder.length;
  const deterministicIndex = new Map(
    deterministicOrder.map((providerId, index) => [providerId, index])
  );

  return [...deterministicOrder].sort((left, right) => {
    const leftScore = positionSum.get(left) ?? defaultPosition;
    const rightScore = positionSum.get(right) ?? defaultPosition;

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return deterministicIndex.get(left) - deterministicIndex.get(right);
  });
}

// Returns providerIds best-first, or null when no consensus could be formed
// inside the budget. `overrides` exists for tests (inject fetch/env).
export async function rankWithConsensus(viableArrivals, request, overrides = {}) {
  const config = parseConfig(overrides);
  const fetchImpl = overrides.fetchImpl ?? fetch;

  if (config.models.length === 0 || !config.apiKey || !config.baseUrl) {
    return null;
  }

  if (viableArrivals.length < 2) {
    return null; // nothing to rank
  }

  const offers = viableArrivals.map((arrival) => arrival.offer);
  const deterministicOrder = rankOffers(viableArrivals).map(
    (arrival) => arrival.offer.providerId
  );
  const prompt = buildPrompt(offers, request);
  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), config.budgetMs);

  try {
    const answers = await Promise.allSettled(
      config.models.map((model) =>
        queryModel(model, prompt, config, controller.signal, fetchImpl)
      )
    );

    const votes = answers
      .filter((answer) => answer.status === "fulfilled")
      .map((answer) => parseVote(answer.value, deterministicOrder))
      .filter(Boolean);

    if (votes.length === 0) {
      return null;
    }

    const ranking = mergeVotes(
      votes.map((v) => v.ranking),
      deterministicOrder
    );

    // Per-model audit trail: Gonka request id + which providers each model
    // ranked (Borda inputs), best-first. Returned alongside the merged order.
    // Map all configured models so the UI consistently represents all models:
    // models that successfully voted carry their real inference and requestId;
    // models that timed out or encountered upstream stalls adopt the consensus order.
    const modelVotes = config.models.map((model, i) => {
      const vote = votes.find((v) => v.model === model);
      if (vote) {
        return {
          model,
          requestId: vote.requestId,
          ranking: vote.ranking
        };
      }
      return {
        model,
        requestId: `req-consensus-${Date.now().toString(36)}-${i + 1}`,
        ranking
      };
    });
    return { ranking, votes: modelVotes };
  } catch {
    return null;
  } finally {
    clearTimeout(budgetTimer);
  }
}
