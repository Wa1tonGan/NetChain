#!/usr/bin/env node
// One-loop integration driver (SUI_INTEGRATION_MODE=one-loop): runs ONE
// incident end-to-end through the LIVE Rescue Agent gateway and the trust
// service — the deadline-safe fallback of the full system (the same pipeline
// the trust:server poller runs in full mode, driven once, by hand).
//
//   npm run integrate:sui
//   SUI_P2_INCIDENT_ID=INC-DEMO-1 npm run integrate:sui   # pull an existing one
//
// Prereqs (two terminals):
//   node scripts/start-provider-agents.mjs        # :8101–8103
//   node scripts/start-rescue-agent.mjs           # :8082
// plus a set-up escrow for the network: npm run sui:setup (testnet config
// persists; localnet needs `sui start --with-faucet --force-regenesis`).
//
// What proves what: the AI's SELECTED offer (real A2A race, real activation,
// real buyer+provider ed25519 signatures) is committed, verified and settled
// ON-CHAIN with zero fixture handoff — Track-02 "AI × SUI, Sui is integral",
// live.
import { readFileSync } from "node:fs";
import { EventLedger } from "../src/sui/events.js";
import { TrustService } from "../src/sui/service.js";
import {
  fetchEnvelope,
  integrationMode,
  listRecoveries,
  loadState,
  p2BaseUrl,
  pollOnce,
  processEnvelope,
  saveState
} from "../src/sui/integration.js";

const mode = integrationMode();
if (mode === "standalone") {
  console.error("[integrate] SUI_INTEGRATION_MODE=standalone — the gateway loop is disabled.");
  console.error("[integrate] set SUI_INTEGRATION_MODE=one-loop (this driver) or full (trust:server poller).");
  process.exit(2);
}
if (mode === "full") {
  console.log("[integrate] note: full mode usually runs via `npm run trust:server`; running this one-shot anyway.");
}

const baseUrl = p2BaseUrl();
const net = process.env.SUI_NETWORK ?? "localnet";
const log = (level, msg) => console[level === "warn" ? "error" : "log"](msg);

async function pickEnvelope() {
  const incidentId = process.env.SUI_P2_INCIDENT_ID;
  if (incidentId) {
    console.log(`[integrate] pulling existing incident ${incidentId} from ${baseUrl}`);
    return fetchEnvelope(baseUrl, incidentId);
  }
  // Submit a fresh RecoveryIntent through the ASYNC portal route — the real
  // Person 1 contract: 202 now, the incident record + envelope appear at
  // GET /incidents/:id (and P2's settlement callback has a record to land on;
  // the sync /v1/recovery route keeps no record).
  const intentPath = process.env.SUI_P2_INTENT ?? "scenarios/s2-primary-down-backup-insufficient.json";
  const intent = JSON.parse(readFileSync(intentPath, "utf8"));
  intent.incidentId = process.env.SUI_P2_INCIDENT_ID ?? `${intent.incidentId}-I${Date.now().toString(36)}`;
  console.log(`[integrate] POST intent ${intent.incidentId} (from ${intentPath}) → ${baseUrl}`);
  const response = await fetch(`${baseUrl}/recovery/intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent })
  });
  if (!response.ok) throw new Error(`gateway /recovery/intents → ${response.status}`);
  return pollEnvelope(baseUrl, intent.incidentId);
}

/** Poll GET /incidents/:id until the Rescue Agent resolves (SELECTED/failed). */
async function pollEnvelope(baseUrl, incidentId, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/incidents/${encodeURIComponent(incidentId)}`);
    if (response.ok) {
      const record = await response.json();
      if (record.envelope?.status === "SELECTED") return record.envelope;
      if (["NO_VIABLE_OFFER", "FAILED", "FAILED_ALL_ACTIVATIONS", "FAILED_NO_VIABLE_PROVIDER"].includes(record.envelope?.status ?? record.status)) {
        return record.envelope ?? { status: record.status, incidentId };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`gateway did not resolve ${incidentId} within ${timeoutMs} ms`);
}

async function main() {
  console.log(`[integrate] network=${net} mode=one-loop gateway=${baseUrl}`);
  // Own ledger (harness pattern): fresh replay state for integration runs —
  // the demo-era rows in reliability-events.jsonl must not block a new proof
  // against a fresh pool. On-chain idempotency still holds via the nonce
  // Table of the configured escrow.
  const ledger = new EventLedger(`events/integration-${net}.jsonl`);
  const service = new TrustService({ ledger });
  const envelope = await pickEnvelope();

  if (envelope.status !== "SELECTED") {
    // Nothing to commit — record the pass so a re-run can proceed to the
    // next incident instead of re-observing a dead end forever.
    const state = loadState();
    state.processed[envelope.incidentId] ??= { status: envelope.status, atMs: Date.now() };
    saveState(state);
    process.exit(1);
  }

  const result = await processEnvelope(service, envelope, { log });
  const state = loadState();
  state.processed[envelope.incidentId] = { status: result.status, atMs: Date.now() };
  saveState(state);

  console.log("\n[integrate] — result —");
  console.log(`  incident      ${envelope.incidentId}`);
  console.log(`  provider      ${envelope.selectedOffer.selectedProvider.providerId} (${envelope.selectedOffer.selectedProvider.brand})`);
  console.log(`  nonce         ${envelope.selectedOffer.agreement.nonce}`);
  if (result.commit) console.log(`  commit tx     ${result.commit.txDigest ?? "(duplicate)"}`);
  if (result.verify) {
    console.log(`  verify tx     ${result.verify.txDigest}`);
    console.log(`  verdict       ${result.verify.verdict} (penalty ${result.verify.penaltyAmount})`);
    console.log(`  log hash      ${result.verify.connectionLogHash}`);
  }
  if (result.settle) console.log(`  settle tx     ${result.settle.txDigest}`);
  console.log(`  callback      ${process.env.P2_CALLBACK_URL ?? "(P2_CALLBACK_URL unset — not pushed)"}`);
  if (result.status !== "SETTLED") process.exit(1);
}

main().catch((err) => {
  console.error(`[integrate] FAILED: ${err.message}`);
  process.exit(1);
});
