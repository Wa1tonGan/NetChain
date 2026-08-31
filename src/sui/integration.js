// P2-runtime integration (blueprint §8 M3 + handoff item 4): connects Person 2's
// LIVE Rescue Agent gateway (:8082) to the trust service, so the AI's selected
// offer becomes an on-chain commitment without any scripted fixture handoff.
//
//   SUI_INTEGRATION_MODE  standalone (default) | one-loop | full
//     standalone — today's scripted demo; nothing here runs.
//     one-loop   — process exactly ONE incident end-to-end, then stop
//                  (deadline-safe demo beat: `npm run integrate:sui`).
//     full       — long-running poller: every incident the Rescue Agent
//                  resolves is pulled, committed, verified and settled
//                  automatically; settlement is pushed back to P2.
//   SUI_P2_URL      Rescue Agent gateway (default http://127.0.0.1:8082)
//   SUI_P2_POLL_MS  full-mode poll interval (default 3000)
//
// Pipeline per incident (envelope.status === "SELECTED"):
//   commit(selectedOffer)                 — on-chain lock, idempotent by nonce
//   verifyDelivery(incident, samples)     — simulated session monitor OR real
//                                           samples POSTed to /v1/verify
//   activation(AVAILABLE) → settle        — three-way split + P2 callback
// Failure paths keep the existing hooks: activation FAILED → POST /v1/activation
// → refund; NO_VIABLE_OFFER envelopes are observed, never committed.
//
// Processed incidents are tracked in events/integration-<net>.json so a
// restart never double-processes (on top of the ledger/nonce idempotency —
// defense in depth, same two-layer rule as the ledger).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { network } from "./client.js";
import { archiveEvidence, walrusArchiveEnabled } from "./walrus.js";

export const INTEGRATION_MODES = ["standalone", "one-loop", "full"];

export function integrationMode(env = process.env) {
  const mode = (env.SUI_INTEGRATION_MODE ?? "standalone").trim().toLowerCase();
  if (!INTEGRATION_MODES.includes(mode)) {
    throw new Error(`SUI_INTEGRATION_MODE must be one of ${INTEGRATION_MODES.join("|")}, got "${mode}"`);
  }
  return mode;
}

export function p2BaseUrl(env = process.env) {
  return (env.SUI_P2_URL ?? "http://127.0.0.1:8082").replace(/\/$/, "");
}

export function integrationStatePath(net = network()) {
  return path.resolve(`events/integration-${net}.json`);
}

export function loadState(filePath = integrationStatePath()) {
  if (!existsSync(filePath)) return { processed: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return { processed: parsed.processed ?? {} };
  } catch {
    return { processed: {} }; // torn write — start clean, the ledger still guards
  }
}

export function saveState(state, filePath = integrationStatePath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/**
 * Simulated Verification-Agent session monitor (blueprint §3.1 "off-chain
 * session monitor"): deterministic jitter around the ACTUAL recovered
 * capacity, seeded by nonce so re-runs of the same incident produce the same
 * log (demo-replayable, harness-comparable). When the provider under-delivers
 * (recovered < promised beyond tolerance) the penalty path follows naturally.
 */
export function synthesizeDeliveredSamples({ promisedMbps, recoveredMbps, nonce, sampleCount = 8 }) {
  const seed = createHash("sha256").update(String(nonce)).digest().readUInt32LE(0);
  let state = seed || 1;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = recoveredMbps ?? promisedMbps;
  return Array.from({ length: sampleCount }, () =>
    Math.round(base * (0.97 + rand() * 0.06) * 10) / 10
  );
}

/**
 * Run the full trust pipeline for one Rescue-Agent envelope. Idempotent:
 * a duplicate commit short-circuits the chain side, and a SETTLED/REFUNDED
 * nonce skips the rest entirely.
 */
export async function processEnvelope(service, envelope, { log = () => {}, simulateMonitor = true } = {}) {
  const { incidentId } = envelope;
  const selected = envelope.selectedOffer ?? null;

  if (envelope.status !== "SELECTED" || !selected) {
    service.ledger.emit("INTEGRATION_SKIPPED", {
      incidentId,
      data: { status: envelope.status, reason: "no selected offer to commit" }
    });
    log("info", `[integration] ${incidentId}: skipped (${envelope.status}) — nothing to commit`);
    return { status: "SKIPPED", reason: envelope.status };
  }

  const nonce = selected.agreement.nonce;
  const existing = service.ledger.lookup(nonce);
  if (existing && ["SETTLED", "REFUNDED", "RECLAIMED"].includes(existing.status)) {
    log("info", `[integration] ${incidentId}: nonce already ${existing.status} — no new transactions`);
    return { status: existing.status, alreadyDone: true };
  }

  // 1 — on-chain commitment (ledger guards duplicates; chain re-verifies sigs).
  const commit = await service.commit(selected);
  log("info", `[integration] ${incidentId}: COMMIT ${commit.status} tx=${commit.txDigest ?? "(duplicate)"}`);

  if (commit.duplicate && commit.status !== "COMMITTED") {
    return { status: commit.status, alreadyDone: true };
  }

  // 2 — verification (blueprint §4.3). The envelope carries the activation
  //     outcome; the simulated monitor turns it into session samples unless a
  //     real monitor posted samples via /v1/verify first.
  const promised = selected.selectedProvider.capacityMbps;
  const recovered = selected.activation?.recoveredCapacityMbps ?? promised;
  const deliveredSamples = simulateMonitor
    ? synthesizeDeliveredSamples({ promisedMbps: promised, recoveredMbps: recovered, nonce })
    : null;
  const verify = await service.verifyDelivery(incidentId, {
    promisedCapacity: promised,
    deliveredSamples,
    sessionStart: selected.activation?.confirmedAtMs ?? null
  });
  log("info", `[integration] ${incidentId}: VERIFY verdict=${verify.verdict} penalty=${verify.penaltyAmount} tx=${verify.txDigest}`);

  // 3 — settlement split (provider / platform / penalty→buyer) + P2 callback.
  const settle = await service.activation({ incidentId, status: "AVAILABLE", recoveredCapacityMbps: recovered });
  log("info", `[integration] ${incidentId}: ${settle.status} tx=${settle.txDigest}`);

  // 4 — Walrus evidence archive (blueprint §4.3): voucher + full connection
  //     log + settlement split become independently retrievable by blob ID.
  //     Best-effort and OFF by default (WALRUS_ARCHIVE=true) — never fails
  //     the settlement it follows.
  let archive = null;
  if (walrusArchiveEnabled()) {
    try {
      archive = await archiveEvidence(service, incidentId);
      service.ledger.emit("ARCHIVED", {
        incidentId, nonce, data: { blobId: archive.blobId, bundleHash: archive.bundleHash, sizeBytes: archive.sizeBytes }
      });
      log("info", `[integration] ${incidentId}: ARCHIVE blob=${archive.blobId.slice(0, 20)}… (${archive.sizeBytes} B)`);
    } catch (err) {
      service.ledger.emit("ARCHIVE_SKIPPED", { incidentId, nonce, data: { error: err.message } });
      log("warn", `[integration] ${incidentId}: archive skipped — ${err.message}`);
    }
  }

  return { status: settle.status, commit, verify, settle, archive };
}

/** Fetch the Rescue Agent's result envelope for one incident. */
export async function fetchEnvelope(baseUrl, incidentId) {
  const response = await fetch(`${baseUrl}/incidents/${encodeURIComponent(incidentId)}`);
  if (!response.ok) throw new Error(`gateway ${baseUrl}/incidents/${incidentId} → ${response.status}`);
  const record = await response.json();
  return record.envelope ?? { status: record.status, incidentId, selectedOffer: record.result ?? null };
}

/** List recoveries the gateway has resolved (GET /v1/recoveries). */
export async function listRecoveries(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/recoveries`);
  if (!response.ok) throw new Error(`gateway ${baseUrl}/v1/recoveries → ${response.status}`);
  const body = await response.json();
  return body.recoveries ?? [];
}

/**
 * One poll pass (full mode): process every unseen SELECTED/NO_VIABLE_OFFER
 * envelope. Returns the incidents handled in this pass.
 */
export async function pollOnce(service, { baseUrl = p2BaseUrl(), state = null, log = () => {} } = {}) {
  const live = state ?? loadState();
  const recoveries = await listRecoveries(baseUrl);
  const handled = [];
  for (const envelope of recoveries) {
    const { incidentId } = envelope;
    if (live.processed[incidentId]) continue;
    try {
      const result = await processEnvelope(service, envelope, { log });
      live.processed[incidentId] = { status: result.status, atMs: Date.now() };
      handled.push({ incidentId, ...result });
    } catch (err) {
      // A voucher failure (expired, signature, currency) must not wedge the
      // poller — mark it so the next pass moves on; the ledger holds the
      // VERIFICATION_FAILED row.
      service.ledger.emit("INTEGRATION_SKIPPED", {
        incidentId,
        data: { status: envelope.status, reason: `pipeline error: ${err.message}` }
      });
      live.processed[incidentId] = { status: "ERROR", error: err.message, atMs: Date.now() };
      log("warn", `[integration] ${incidentId}: pipeline error — ${err.message}`);
    }
  }
  if (handled.length > 0) saveState(live);
  return handled;
}

/** Full-mode background loop. Returns a stop() function. */
export function startPolling(service, { baseUrl = p2BaseUrl(), intervalMs = Number(process.env.SUI_P2_POLL_MS ?? 3000), log = () => {} } = {}) {
  const state = loadState();
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await pollOnce(service, { baseUrl, state, log });
    } catch (err) {
      log("warn", `[integration] poll failed (${err.message}) — gateway down? retrying`);
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick(); // first pass immediately
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
