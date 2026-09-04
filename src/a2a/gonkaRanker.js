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

function parseConfig(overrides = {}) {
  const env = overrides.env ?? process.env;
  const apiKey = overrides.apiKey ?? env.GONKA_API_KEY ?? "";
  const baseUrl = overrides.baseUrl ?? env.GONKA_BASE_URL ?? "";
  const budgetMs = overrides.budgetMs ?? Number(env.GONKA_RANKING_BUDGET_MS ?? 8000);
  const rawModels = overrides.models ?? env.GONKA_MODELS ?? "";
  const models = (Array.isArray(rawModels) ? rawModels : rawModels.split(","))
    .map((model) => model.trim())
    .filter(Boolean);

  return { apiKey, baseUrl, budgetMs, models };
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
      "activation speed, price and reliability. Answer with ONLY a JSON " +
      'object of the form {"ranking":["<providerId>", ...]} using exactly ' +
      "the given providerIds, no prose.",
    user: JSON.stringify({ constraints, offers: offerSummaries })
  };
}

// Extracts the first JSON object embedded in a model answer → { ranking,
// requestId } filtered to known providerIds, or null.
function parseVote(answer, providerIds) {
  let content = answer?.ranking;
  if (typeof content !== "string") {
    return null;
  }
  // Reasoning models emit <think>…</think> first — take whatever follows.
  const closeTag = content.lastIndexOf("</think>");
  if (closeTag !== -1) {
    content = content.slice(closeTag + "</think>".length);
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    const ranking = Array.isArray(parsed.ranking) ? parsed.ranking : null;

    if (!ranking) {
      return null;
    }

    const known = ranking.filter((id) => providerIds.includes(id));
    const unique = [...new Set(known)];

    return unique.length > 0 ? { ranking: unique, requestId: answer.requestId ?? null } : null;
  } catch {
    return null;
  }
}

async function queryModel(model, prompt, config, signal, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
      // appears — a small cap hit the "length" cutoff with no answer at all.
      // The trailing </think> is stripped from the content before parsing.
      max_tokens: 1_000_000
    }),
    signal
  });

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

  return { ranking: content, requestId };
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
    const modelVotes = votes.map((v, i) => ({
      model: config.models[i] ?? `model-${i + 1}`,
      requestId: v.requestId,
      ranking: v.ranking
    }));

    return { ranking, votes: modelVotes };
  } catch {
    return null;
  } finally {
    clearTimeout(budgetTimer);
  }
}
