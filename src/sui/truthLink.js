// TruthLink — thin client from the Sui trust server to the Truth Agent
// (src/a2a/claimAgent.js, :8105). The audit is an independent SLA-audit layer
// over the Gonka Router track checklist:
//   - multi-model consensus cross-verification of the provider's SLA claims
//   - Gonka Request IDs per model (captured by claimAgent, relayed verbatim)
//   - Truth Score + per-model reasoning trace → ledger event CLAIM_VERIFIED
// The audit NEVER blocks or changes settlement: verifyDelivery() remains the
// sole deterministic arbiter of money (checkDelivery / penalty). Every
// failure mode here degrades to { status: "FAILED"|"TIMEOUT", ... } — never
// a thrown error into the funds path.
//
//   TRUTH_AGENT_URL      Truth Agent base (default http://127.0.0.1:8105)
//   TRUTH_LINK_BUDGET_MS total audit budget incl. polling (default 35000)

const DEFAULT_TRUTH_URL = "http://127.0.0.1:8105";
const DEFAULT_BUDGET_MS = 35_000;

/**
 * Pure function: deterministic delivery-check result + provider claims →
 * the structured payload claimAgent's POST /claims expects.
 *
 * claims produced:
 *   ① "Provider promised to deliver X Mbps during recovery"       (always)
 *   ② "Provider claimed Y% reliability"                            (if provided)
 *   ③ "Provider promised activation within Z ms"                   (if provided)
 * evidence:
 *   connection-log — verbatim field-by-field check result (the deterministic
 *                    verdict the money path used)
 *   session-probes — the delivered samples the verdict was computed over
 *
 * @param {{
 *   incidentId: string,
 *   nonce: string|null,
 *   brand: string|null,
 *   promisedCapacity: number,
 *   deliveredSamples: number[],
 *   check: {verdict: string, avgDeliveredMbps: number, shortfallPct: number,
 *           penaltyPct: number, tolerancePercent: number},
 *   providerClaims?: {reliabilityScore?: number, latencyMs?: number,
 *                     packetLossPercent?: number, expectedActivationTimeMs?: number},
 *   timing?: {tDetectMs?: number|null, tRecoverMs?: number|null}
 * }} payload
 */
export function buildSlaClaimPayload({
  incidentId,
  nonce = null,
  brand = null,
  promisedCapacity,
  deliveredSamples,
  check,
  providerClaims = null,
  timing = null
}) {
  const who = brand ?? "The provider";
  const claims = [`${who} promised to deliver ${promisedCapacity} Mbps during incident recovery.`];

  if (providerClaims && Number.isFinite(providerClaims.reliabilityScore)) {
    claims.push(`${who} claimed a reliability score of ${providerClaims.reliabilityScore}%.`);
  }
  if (providerClaims && Number.isFinite(providerClaims.latencyMs)) {
    claims.push(`${who} claimed average latency of ${providerClaims.latencyMs} ms.`);
  }
  if (providerClaims && Number.isFinite(providerClaims.expectedActivationTimeMs)) {
    claims.push(`${who} promised activation within ${providerClaims.expectedActivationTimeMs} ms.`);
  }

  const evidence = [
    {
      source: "connection-log",
      excerpt: JSON.stringify({
        incidentId,
        nonce,
        promisedCapacityMbps: promisedCapacity,
        avgDeliveredMbps: check.avgDeliveredMbps,
        shortfallPct: Number(check.shortfallPct.toFixed(2)),
        penaltyPct: check.penaltyPct,
        tolerancePercent: check.tolerancePercent,
        deterministicVerdict: check.verdict
      })
    },
    {
      source: "session-probes",
      excerpt: JSON.stringify({
        deliveredSamplesMbps: deliveredSamples,
        ...(timing?.tRecoverMs != null && timing?.tDetectMs != null
          ? { activationDurationMs: timing.tRecoverMs - timing.tDetectMs }
          : {})
      })
    }
  ];

  return {
    claims: claims.slice(0, 4),
    evidence,
    meta: { incidentId, nonce }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST the payload to the Truth Agent, poll GET /claims/:id until done or
 * the budget expires. Never throws: any failure returns
 * { status: "FAILED", error } (or { status: "TIMEOUT" }).
 *
 * @param {object} payload  buildSlaClaimPayload() output
 * @param {{baseUrl?: string, budgetMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{status: "COMPLETED"|"FAILED"|"TIMEOUT",
 *   claimRunId?: string, verdict?: string, score?: number,
 *   confidenceBand?: number[], agree?: string,
 *   models?: Array<{model: string, ok: boolean, verdict?: string, score?: number,
 *                   requestId: string|null, reasoning?: string, error?: string}>,
 *   durationMs?: number, error?: string}>}
 */
export async function runSlaAudit(payload, opts = {}) {
  const baseUrl = (opts.baseUrl ?? process.env.TRUTH_AGENT_URL ?? DEFAULT_TRUTH_URL).replace(/\/$/, "");
  const budgetMs = opts.budgetMs ?? Number(process.env.TRUTH_LINK_BUDGET_MS ?? DEFAULT_BUDGET_MS);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const t0 = Date.now();

  try {
    const post = await fetchImpl(`${baseUrl}/claims`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(budgetMs)
    });
    if (!post.ok) {
      return { status: "FAILED", error: `truth agent POST /claims → ${post.status}` };
    }
    const { claimId } = await post.json();
    if (!claimId) {
      return { status: "FAILED", error: "truth agent returned no claimId" };
    }

    // Poll GET /claims/:id every 1s until done or budget exhausted. The
    // claimAgent record is in-memory; a 404 mid-run means the agent restarted
    // — report FAILED honestly, the ledger event stays the durable record.
    while (Date.now() - t0 < budgetMs) {
      await sleep(1000);
      let record = null;
      try {
        const get = await fetchImpl(`${baseUrl}/claims/${encodeURIComponent(claimId)}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (get.status === 404) {
          return { status: "FAILED", claimRunId: claimId, error: "truth agent lost the run (restart?)" };
        }
        if (!get.ok) continue;
        record = await get.json();
      } catch {
        continue; // transient poll error — keep trying within budget
      }
      if (!record?.done) continue;

      const r = record.result;
      if (!r || r.error) {
        return { status: "FAILED", claimRunId: claimId, error: r?.error ?? "truth agent run errored" };
      }
      return {
        status: "COMPLETED",
        claimRunId: claimId,
        verdict: r.verdict,
        score: r.score,
        confidenceBand: r.confidenceBand,
        agree: r.agree,
        models: (Array.isArray(r.models) ? r.models : []).map((m) => ({
          model: m.model,
          ok: Boolean(m.ok),
          verdict: m.verdict,
          score: m.score,
          requestId: m.requestId ?? null,
          reasoning: m.reasoning,
          error: m.error
        })),
        durationMs: r.durationMs
      };
    }
    return { status: "TIMEOUT", claimRunId: claimId, error: `audit exceeded ${budgetMs}ms budget` };
  } catch (error) {
    const code = error?.name === "TimeoutError" ? "TIMEOUT" : "FAILED";
    return { status: code, error: String(error?.message ?? error) };
  }
}
