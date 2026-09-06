// Claim Verification Agent — "Truth Agent" (Person 2 workstream extension).
//
// Purpose (track checklist this serves):
//   - Claim Extraction: input URL / tweet / text snippet → normalized claim(s)
//   - Decentralized Verification: Gonka multi-model inference + live data pass
//   - Truth Score & Reasoning: 0–100 score + per-model reasoning trace
//   - Transparency UI: every inference carries its Gonka request id
//
// Contract with the frontend AgentThinkingPage:
//   POST /claims                 { input: string, sourceType?: auto|url|tweet|text }
//                                 → 202 { claimId }
//   POST /claims (structured)    { claims: string[] (≤4), evidence?: [{source, excerpt}],
//                                  meta?: {incidentId, nonce} } — caller-supplied claims skip
//                                  LLM extraction; caller-supplied evidence skips the live
//                                  web pass. The {input, sourceType} path is unchanged.
//   GET  /claims/:id             → full record (steps, verdict, scores)
//   GET  /claims/:id/events      → SSE stream of thinking steps
//   GET  /health
//
// Gonka calls follow the same pattern as gonkaRanker.js: every configured
// model in GONKA_MODELS answers independently; we keep each raw answer, its
// request id (x-request-id response header, falling back to the response
// body id field) and per-model verdict. Consensus = mean of model scores;
// disagreement widens the reported confidence band. Any model failure is
// honest in the trace, never hidden.
//
// Live data pass: GONKA_VERIFY_WEB=true enables a best-effort Bing-free
// snapshot fetch of the claim's URL (if any) plus DuckDuckGo HTML search for
// supporting/contradicting snippets; results are quoted verbatim into the
// model prompt so scores are grounded in fetched text, not model memory.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";

const VERIFY_BUDGET_MS = Number(process.env.GONKA_VERIFY_BUDGET_MS ?? 75_000);

function nowMs() {
  return Date.now();
}

export function parseConfig(overrides = {}) {
  const env = overrides.env ?? process.env;
  const apiKey = overrides.apiKey ?? env.GONKA_API_KEY ?? "";
  const baseUrl = overrides.baseUrl ?? env.GONKA_BASE_URL ?? "";
  const budgetMs = overrides.budgetMs ?? Number(env.GONKA_VERIFY_BUDGET_MS ?? 75_000);
  const maxTokens = overrides.maxTokens ?? Number(env.GONKA_VERIFY_MAX_TOKENS ?? 600);
  const rawModels = overrides.models ?? env.TRUTH_AGENT_MODELS ?? env.GONKA_MODELS ?? "";
  const models = (Array.isArray(rawModels) ? rawModels : rawModels.split(","))
    .map((model) => model.trim())
    .filter(Boolean);
  const webVerify = overrides.webVerify ?? env.GONKA_VERIFY_WEB === "true";

  return { apiKey, baseUrl, budgetMs, maxTokens, models, webVerify };
}

// -- Claim extraction (step 1) ----------------------------------------------

function detectSourceType(input) {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (/^https?:\/\//i.test(trimmed)) {
    return "url";
  }

  if (/(twitter\.com|x\.com)\/\w+\/status\/\d+/i.test(trimmed)) {
    return "tweet";
  }

  return "text";
}

const EXTRACT_SYSTEM_PROMPT =
  "You extract verifiable claims for a fact-checking pipeline. " +
  'Answer ONLY with JSON: {"claims": ["<claim 1>", ...], "topic": "<short topic>"} — ' +
  "each claim a single self-contained factual sentence, max 2 claims, no prose.";

async function extractClaims(input, sourceType, config, fetchImpl, signal) {
  // URLs and tweets without extra text: the claim IS the linked content, so
  // the verification pass fetches it directly instead of an extraction call.
  if (sourceType === "text") {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.models[0],
        messages: [
          { role: "system", content: EXTRACT_SYSTEM_PROMPT },
          { role: "user", content: input.slice(0, 4000) }
        ],
        temperature: 0,
        max_tokens: 300
      }),
      signal
    });

    if (response.ok) {
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const start = typeof content === "string" ? content.indexOf("{") : -1;
      const end = typeof content === "string" ? content.lastIndexOf("}") : -1;

      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(content.slice(start, end + 1));

          if (Array.isArray(parsed.claims) && parsed.claims.length > 0) {
            return { claims: parsed.claims.slice(0, 2).map(String), topic: String(parsed.topic ?? "") };
          }
        } catch {
          // fall through to the whole-input claim
        }
      }
    }
  }

  return { claims: [input.trim().slice(0, 500)], topic: "" };
}

// -- Live data pass (step 2) -------------------------------------------------

async function fetchReadable(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { "user-agent": "NetChainTruthAgent/0.1" } });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

async function searchWeb(query, fetchImpl, signal) {
  // Best-effort DuckDuckGo HTML endpoint: no key, CORS-irrelevant server-side.
  const response = await fetchImpl(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { signal, headers: { "user-agent": "NetChainTruthAgent/0.1" } }
  );

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const results = [];

  const re = /<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = re.exec(html)) !== null && results.length < 5) {
    const strip = (raw) =>
      raw
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

    results.push({ title: strip(match[1]), snippet: strip(match[2]).slice(0, 300) });
  }

  return results;
}

// -- Gonka multi-model verification (step 3) ---------------------------------

const VERIFY_SYSTEM_PROMPT =
  "You are a rigorous fact-checker. Judge the claim strictly against the " +
  "evidence provided. Be direct and concise: keep internal reasoning under 2 sentences. " +
  "Answer ONLY with JSON: " +
  '{"verdict": "TRUE" | "FALSE" | "PARTLY_TRUE" | "UNVERIFIABLE", ' +
  '"score": <0-100 confidence in the claim>, "reasoning": "<=180 chars", ' +
  '"evidenceUsed": ["<short quote or hint>"]}. No prose.';
async function queryModel(model, claim, evidencePack, config, fetchImpl, signal) {
  const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: VERIFY_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ claim, evidence: evidencePack })
        }
      ],
      temperature: 0,
      max_tokens: config.maxTokens ?? 500
    }),
    signal
  });

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }

  // Gonka propagates the upstream request id — surface it verbatim for the
  // Transparency UI (checklist: "Display Gonka Request IDs for each inference").
  const requestId = response.headers.get("x-request-id") ?? null;
  const payload = await response.json();
  const bodyId = typeof payload?.id === "string" ? payload.id : null;
  // Reasoning models (MiniMax M2, DeepSeek V4) emit a <think>…</think> block
  // whose braces defeat a naive first-{…last-} slice — scan for the LAST
  // BALANCED top-level JSON object in the content instead.
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = typeof content === "string" ? extractLastJsonObject(content) : null;

  if (!parsed) {
    return { ok: false, error: "unparseable answer", requestId: requestId ?? bodyId };
  }
  const verdicts = ["TRUE", "FALSE", "PARTLY_TRUE", "UNVERIFIABLE"];
  const verdict = verdicts.includes(parsed.verdict) ? parsed.verdict : "UNVERIFIABLE";
  const score = Math.max(0, Math.min(100, Number(parsed.score ?? 50)));

  return {
    ok: true,
    requestId: requestId ?? bodyId,
    model,
    verdict,
    score,
    reasoning: String(parsed.reasoning ?? "").slice(0, 300),
    evidenceUsed: Array.isArray(parsed.evidenceUsed) ? parsed.evidenceUsed.map(String).slice(0, 3) : []
  };
}

/**
 * Scan content for the last balanced `{…}` object and return it parsed.
 * Handles <think> blocks and prose around the answer. Returns null when no
 * parseable object exists.
 */
function extractLastJsonObject(content) {
  for (let end = content.lastIndexOf("}"); end !== -1; end = content.lastIndexOf("}", end - 1)) {
    // Walk backwards to the matching open brace (string-aware, depth count).
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
            break; // not a valid object here — try an earlier close brace
          }
        }
      } else if (ch === '"') {
        // opening quote of a string while scanning backwards — flip in/out
        inString = true;
      }
    }
  }
  return null;
}

// -- Consensus (step 4) -------------------------------------------------------

function mergeVerdicts(modelAnswers) {
  const ok = modelAnswers.filter((answer) => answer.ok);

  if (ok.length === 0) {
    return { verdict: "UNVERIFIABLE", score: null, confidenceBand: null, agree: 0 };
  }

  const scores = ok.map((answer) => answer.score);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const spread = Math.max(...scores) - Math.min(...scores);

  const verdictWeights = new Map();
  for (const answer of ok) {
    verdictWeights.set(answer.verdict, (verdictWeights.get(answer.verdict) ?? 0) + 1);
  }
  const [verdict, votes] = [...verdictWeights.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    verdict,
    score: Math.round(mean),
    // Wide model disagreement → honest, wide band.
    confidenceBand: [Math.round(Math.max(0, mean - spread / 2)), Math.round(Math.min(100, mean + spread / 2))],
    agree: `${votes}/${ok.length}`
  };
}

// -- Orchestrator: runs the whole verification for one claim ------------------

export async function verifyClaim(
  { input = "", sourceType, claims = null, evidencePack = null, evidence = null, meta = null },
  config,
  fetchImpl,
  emit
) {
  const t0 = nowMs();
  const rawInput = typeof input === "string" ? input : "";
  const resolvedType = sourceType && sourceType !== "auto" ? sourceType : detectSourceType(rawInput);

  emit({ step: "received", status: "done", detail: `source type: ${resolvedType}`, atMs: nowMs() - t0 });

  // Step 1 — extraction. Caller-supplied claims (structured SLA audit path)
  // skip the extraction LLM call entirely; the {input, sourceType} path is
  // byte-identical to the pre-structured behavior.
  let extraction;

  if (Array.isArray(claims) && claims.length > 0) {
    const normalized = claims.map(String).map((c) => c.trim()).filter(Boolean).slice(0, 4);
    extraction = { claims: normalized, topic: meta?.incidentId ?? "structured input" };
    emit({
      step: "extract",
      status: "done",
      detail: "claims provided by caller",
      claims: normalized,
      topic: extraction.topic,
      atMs: nowMs() - t0
    });
  } else {
    emit({ step: "extract", status: "running", detail: "extracting verifiable claims…", atMs: nowMs() - t0 });
    const extractionController = new AbortController();
    const extractionTimer = setTimeout(() => extractionController.abort(), 10_000);

    try {
      extraction = await extractClaims(input, resolvedType, config, fetchImpl, extractionController.signal);
    } finally {
      clearTimeout(extractionTimer);
    }
    emit({
      step: "extract",
      status: "done",
      detail: extraction.claims.join(" · "),
      claims: extraction.claims,
      topic: extraction.topic,
      atMs: nowMs() - t0
    });
  }

  // Multiple caller claims are verified as ONE composite claim — the join is
  // the injection point into queryModel's {claim, evidence} prompt envelope.
  const claim = extraction.claims.join("\n- ");

  // Step 2 — live data (best-effort, never load-bearing). Caller-supplied
  // evidence (signed SLA probes) replaces the web pass entirely — no fetches.
  const evidenceNotes = [];
  let liveEvidence = Array.isArray(evidencePack) ? evidencePack : (Array.isArray(evidence) ? evidence : null);

  if (Array.isArray(liveEvidence) && liveEvidence.length > 0) {
    evidenceNotes.push(`evidence provided by caller (${liveEvidence.length} items)`);
  } else {
    liveEvidence = [];
    emit({ step: "live_data", status: "running", detail: "fetching live evidence…", atMs: nowMs() - t0 });

    if (config.webVerify) {
      const liveController = new AbortController();
      const liveTimer = setTimeout(() => liveController.abort(), 12_000);

      try {
        if (resolvedType === "url") {
          const page = await fetchReadable(input, fetchImpl, liveController.signal);

          if (page) {
            liveEvidence.push({ source: input, excerpt: page });
            evidenceNotes.push(`fetched ${input} (${page.length} chars)`);
          }
        }

        const results = await searchWeb(claim, fetchImpl, liveController.signal);

        if (results.length > 0) {
          evidenceNotes.push(`${results.length} web results via DuckDuckGo`);
          for (const result of results.slice(0, 4)) {
            liveEvidence.push({ source: result.title, excerpt: result.snippet });
          }
        }
      } catch {
        evidenceNotes.push("live fetch unavailable — models judge on internal knowledge");
      } finally {
        clearTimeout(liveTimer);
      }
    } else {
      evidenceNotes.push("live data pass disabled (GONKA_VERIFY_WEB!=true)");
    }
  }

  emit({
    step: "live_data",
    status: "done",
    detail: evidenceNotes.join(" · ") || "no evidence pack",
    evidenceCount: liveEvidence.length,
    atMs: nowMs() - t0
  });

  // Step 3 — parallel multi-model verification with per-model request ids
  emit({
    step: "verify",
    status: "running",
    detail: `querying ${config.models.length} Gonka models in parallel…`,
    models: config.models,
    atMs: nowMs() - t0
  });

  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), config.budgetMs);

  const modelAnswers = await Promise.all(
    config.models.map(async (model) => {
      try {
        const answer = await queryModel(model, claim, liveEvidence, config, fetchImpl, controller.signal);

        if (answer.ok) {
          emit({
            step: "model_answer",
            status: "done",
            model,
            requestId: answer.requestId,
            verdict: answer.verdict,
            score: answer.score,
            reasoning: answer.reasoning,
            atMs: nowMs() - t0
          });
        } else {
          emit({
            step: "model_answer",
            status: "failed",
            model,
            requestId: answer.requestId ?? null,
            detail: answer.error,
            atMs: nowMs() - t0
          });
        }

        return answer;
      } catch (error) {
        emit({
          step: "model_answer",
          status: "failed",
          model,
          detail: error.name === "AbortError" ? "budget timeout" : String(error.message ?? error),
          atMs: nowMs() - t0
        });
        return { ok: false, error: "aborted" };
      }
    })
  );

  clearTimeout(budgetTimer);

  // Step 4 — consensus
  const consensus = mergeVerdicts(modelAnswers);

  emit({
    step: "consensus",
    status: "done",
    ...consensus,
    evidencePackUsed: liveEvidence.length,
    atMs: nowMs() - t0
  });

  return {
    input: input.slice(0, 500),
    sourceType: resolvedType,
    topic: extraction.topic,
    claims: extraction.claims,
    evidenceNotes,
    models: modelAnswers,
    ...consensus,
    durationMs: nowMs() - t0,
    finishedAt: new Date().toISOString()
  };
}

// -- HTTP face ----------------------------------------------------------------
// One process, standalone deployable (mirrors the other agent services):
//   node --env-file-if-exists=.env src/a2a/claimAgentServer.js  (default :8105)

const claims = new Map(); // claimId -> record (steps, result, subscribers)
let lastRealRun = null; // { claimId, finishedAt, steps, result } — the most recent completed verification
const runHistory = []; // newest-first summaries of every completed real run

function pushStep(record, event) {
  record.steps.push(event);

  for (const subscriber of record.subscribers) {
    subscriber.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

export function createClaimAgentServer({ port } = {}) {
  const config = parseConfig();
  const fetchImpl = fetch;

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    const json = (statusCode, payload) => {
      response.statusCode = statusCode;
      response.setHeader("content-type", "application/json");
      response.setHeader("access-control-allow-origin", "*");
      response.end(JSON.stringify(payload));
    };

    const readBody = () =>
      new Promise((resolve, reject) => {
        let raw = "";
        request.on("data", (chunk) => {
          raw += chunk;
        });
        request.on("end", () => resolve(raw));
        request.on("error", reject);
      });

    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, {
        healthy: true,
        gonka: Boolean(config.apiKey && config.baseUrl),
        models: config.models,
        webVerify: config.webVerify,
        hasRealRun: Boolean(lastRealRun)
      });
    }

    // Replay source for the UI's offline mode: the last REAL verification
    // (or 404 when none exists yet — the UI then asks for a live run).
    if (request.method === "GET" && (url.pathname === "/claims/demo" || url.pathname === "/v1/claims/demo")) {
      if (!lastRealRun) {
        return json(404, { error: "no real verification run yet — start the agent and verify one claim first" });
      }
      return json(200, { ...lastRealRun, replay: true });
    }

    // Agent-log feed: summaries of recent completed runs (newest first).
    if (request.method === "GET" && (url.pathname === "/claims/history" || url.pathname === "/v1/claims/history")) {
      return json(200, { runs: runHistory, hasRealRun: Boolean(lastRealRun) });
    }

    if (request.method === "POST" && (url.pathname === "/claims" || url.pathname === "/v1/claims")) {
      return readBody().then((raw) => {
        let body;

        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return json(400, { error: "invalid JSON" });
        }

        const input = typeof body.input === "string" ? body.input.trim() : "";
        // Structured path: caller-supplied claims (≤4) instead of free text.
        const callerClaims = Array.isArray(body.claims)
          ? body.claims.map(String).map((c) => c.trim()).filter(Boolean).slice(0, 4)
          : null;

        if (input.length < 3 && (callerClaims === null || callerClaims.length === 0)) {
          return json(400, { error: "input must be a URL, tweet link or text snippet (or pass claims[])" });
        }

        if (!config.apiKey || !config.baseUrl || config.models.length === 0) {
          return json(503, { error: "Gonka not configured (GONKA_API_KEY / GONKA_BASE_URL / GONKA_MODELS)" });
        }

        const claimId = `CLAIM-${randomUUID().slice(0, 8)}`;
        const meta = body.meta && typeof body.meta === "object" ? body.meta : null;
        const record = {
          id: claimId,
          createdAt: new Date().toISOString(),
          input: input.slice(0, 500),
          meta,
          steps: [],
          result: null,
          done: false,
          subscribers: new Set()
        };
        claims.set(claimId, record);

        // Fire-and-forget run; the UI follows progress over SSE.
        verifyClaim(
          { input, sourceType: body.sourceType, claims: callerClaims, evidencePack: Array.isArray(body.evidence) ? body.evidence : null, meta },
          config,
          fetchImpl,
          (event) => pushStep(record, event)
        )
          .then((result) => {
            record.result = result;
            record.done = true;
            // Snapshot for the UI's REPLAY mode: the offline demo shows the
            // LAST REAL verification, never fabricated numbers.
            lastRealRun = {
              claimId,
              finishedAt: new Date().toISOString(),
              steps: [...record.steps],
              result,
            };
            // Agent-log feed: every completed run joins the history.
            runHistory.unshift({
              id: claimId,
              finishedAt: lastRealRun.finishedAt,
              input: record.input,
              verdict: result.verdict,
              score: result.score,
            });
            if (runHistory.length > 20) runHistory.length = 20;
            // Subscribers need the terminal event too (they only see steps).
            pushStep(record, { step: "done", result });
            for (const subscriber of record.subscribers) {
              subscriber.end?.();
            }
          })
          .catch((error) => {
            const failed = { step: "error", status: "failed", detail: String(error.message ?? error) };
            pushStep(record, failed);
            record.result = { error: String(error.message ?? error) };
            record.done = true;
            for (const subscriber of record.subscribers) {
              subscriber.end?.();
            }
          });

        return json(202, { claimId, poll: `/claims/${claimId}`, events: `/claims/${claimId}/events` });
      });
    }

    const claimMatch = url.pathname.match(/^\/(?:v1\/)?claims\/([^/]+)(\/events)?$/);

    if (request.method === "GET" && claimMatch) {
      const [, claimId, events] = claimMatch;
      const record = claims.get(claimId);

      if (!record) {
        return json(404, { error: "unknown claim id" });
      }

      if (events) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*"
        });
        // Replay history first so a late subscriber sees the full trace.
        for (const step of record.steps) {
          response.write(`data: ${JSON.stringify(step)}\n\n`);
        }

        if (record.done) {
          response.write(`data: ${JSON.stringify({ step: "done", result: record.result })}\n\n`);
          return response.end();
        }

        const subscriber = {
          write: (chunk) => response.write(chunk)
        };
        record.subscribers.add(subscriber);
        const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          record.subscribers.delete(subscriber);
        });
        return;
      }

      return json(200, {
        id: record.id,
        createdAt: record.createdAt,
        input: record.input,
        meta: record.meta ?? null,
        steps: record.steps,
        result: record.result,
        done: record.done
      });
    }

    json(404, { error: "not found" });
  });

  return {
    server,
    listen(explicitPort) {
      return new Promise((resolve) => {
        // 127.0.0.1 by default (local dev); containers set CLAIM_BIND=0.0.0.0
        // so the trust container can reach the audit endpoint.
        server.listen(explicitPort ?? port ?? 8105, process.env.CLAIM_BIND ?? "127.0.0.1", () => {
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

// Standalone entrypoint.
if (process.argv[1] && process.argv[1].endsWith("claimAgent.js")) {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env"));
  } catch {
    // run with whatever env is present
  }
  const agent = createClaimAgentServer({ port: Number(process.env.CLAIM_PORT ?? 8105) });
  const bound = await agent.listen();
  console.log(`[claim-agent] Truth Agent listening on http://127.0.0.1:${bound}`);
  console.log("[claim-agent] POST /claims {\"input\":\"...\"} → GET /claims/:id/events (SSE thinking trace)");
  process.on("SIGINT", async () => {
    await agent.close();
    process.exit(0);
  });
}
