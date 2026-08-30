// Verification Agent (blueprint §3.1/§4.3/§12): records the actually
// delivered capacity for the whole recovered session, runs the DETERMINISTIC
// tolerance check (pure algorithm — never an LLM), and hands the verdict to
// the trust service, which commits the connection-log hash on-chain so the
// settlement penalty is enforceable evidence, not a promise.
//
// Penalty model (§4.3 "proportional penalty, never a full refund"):
//   shortfall% = max(0, (promised − avg delivered) / promised × 100)
//   penalty%   = max(0, shortfall% − tolerance%)
//   penalty    = floor(provider share × penalty% / 100)   ← provider only;
//   the platform fee is untouched and the buyer receives the penalty.
import { canonicalBytes } from "../a2a/signing.js";
import { voucherDigest } from "./voucher.js";

/** Deterministic tolerance check over the session's delivered samples. */
export function checkDelivery({
  promisedCapacity,
  deliveredSamples,
  tolerancePercent = Number(process.env.DELIVERY_TOLERANCE_PERCENT ?? 10)
}) {
  if (!Number.isFinite(promisedCapacity) || promisedCapacity <= 0) {
    throw new Error(`promisedCapacity must be > 0, got ${promisedCapacity}`);
  }
  if (!Array.isArray(deliveredSamples) || deliveredSamples.length === 0) {
    throw new Error("deliveredSamples must be a non-empty array of Mbps samples");
  }
  const avgDeliveredMbps =
    deliveredSamples.reduce((sum, s) => sum + Number(s), 0) / deliveredSamples.length;
  const shortfallPct = Math.max(0, ((promisedCapacity - avgDeliveredMbps) / promisedCapacity) * 100);
  const penaltyPct = Math.max(0, shortfallPct - tolerancePercent);
  return {
    verdict: penaltyPct > 0 ? "PENALTY" : "OK",
    avgDeliveredMbps,
    shortfallPct,
    penaltyPct,
    tolerancePercent,
    promisedCapacity
  };
}

/**
 * §9 Verification Record (snake_case fields exactly as the integration
 * contract defines): incident_id, session_start, session_end,
 * promised_capacity, delivered_samples, tolerance_range, verdict,
 * penalty_amount. The connection_log_hash is computed OVER this record by
 * connectionLogDigest — it is emitted with the ledger row, not stored inside.
 */
export function connectionLog({
  incidentId,
  nonce,
  promisedCapacity,
  deliveredSamples,
  sessionStart,
  sessionEnd = Date.now(),
  tolerancePercent,
  shortfallPct,
  verdict,
  penaltyAmount
}) {
  return {
    incident_id: incidentId,
    nonce,
    session_start: sessionStart,
    session_end: sessionEnd,
    promised_capacity: promisedCapacity,
    delivered_samples: deliveredSamples,
    avg_delivered_mbps:
      deliveredSamples.reduce((sum, s) => sum + Number(s), 0) / deliveredSamples.length,
    tolerance_range: { percent: tolerancePercent },
    shortfall_pct: shortfallPct,
    verdict,
    penalty_amount: penaltyAmount
  };
}

/** blake2b256 over the canonical record bytes — the tamper-evident hash. */
export function connectionLogDigest(log) {
  return voucherDigest(canonicalBytes(log));
}
