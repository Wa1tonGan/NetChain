#!/usr/bin/env node
// Reliability harness (blueprint §6.1 KPIs + Person 3 M5): runs the full
// trust battery and writes the reliability-report (JSON + markdown).
//
//   npm run harness:sui                    # localnet
//   SUI_NETWORK=testnet npm run harness:sui
//
// The battery uses its OWN escrow pool and event ledger
// (events/harness-<net>.jsonl) so repeated runs start from virgin replay
// state without touching the demo escrow or the demo ledger.
//
// Cases:
//   1  happy-path      commit → duplicate blocked → settle (INC-S2, 60 MYR)
//   2  failover-refund emergency commit → activation FAILED → refund (INC-S7/A)
//   3  failover-takeover A failed → B takes over → settle (INC-S7/B)
//   4  re-run safety   same nonces again → duplicates blocked, zero new txs
//   5  retry safety    commit attempt against an unreachable node → retry
//                      resolves to the already-settled state (no new lock)
//   6  expiry guard    expired voucher rejected before any transaction
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig, makeClient, setupEscrow, buyerKeypair, waitForObject } from "../src/sui/client.js";
import { EventLedger } from "../src/sui/events.js";
import { TrustService } from "../src/sui/service.js";
import { summarize, writeReport } from "../src/sui/ttr.js";
import { VoucherError } from "../src/sui/voucher.js";

const results = [];
const F = (name) => `fixtures/sui/${name}`;
const load = (name) => JSON.parse(readFileSync(F(name), "utf8"));
const check = (name, passed, detail = null) => {
  results.push({ kind: "CHECK", name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const net = process.env.SUI_NETWORK ?? "localnet";
  console.log(`[harness] network=${net} — regenerating fresh fixtures…`);
  execSync("npm run --silent sui:fixtures", { stdio: "inherit" });

  const baseConfig = loadConfig();
  if (!baseConfig?.packageId) throw new Error("no config — run npm run sui:setup first");
  const client = makeClient(net);
  const keypair = buyerKeypair();
  const { escrowId, authorityId } = await setupEscrow(client, keypair, baseConfig);
  await waitForObject(client, escrowId);
  await waitForObject(client, authorityId);
  const config = { ...baseConfig, escrowId, authorityId };
  console.log(`[harness] harness escrow=${escrowId.slice(0, 12)}… authority=${authorityId.slice(0, 12)}…`);

  const ledgerPath = path.resolve(`events/harness-${net}.jsonl`);
  rmSync(ledgerPath, { force: true });
  const ledger = new EventLedger(ledgerPath);
  const service = new TrustService({ ledger, config });

  // 1 — happy path
  console.log("[harness] case 1: happy path (INC-S2 commit → duplicate blocked → settle)");
  const s2 = load("s2-selected-offer.json");
  const c1 = await service.commit(s2);
  const dup = await service.commit(s2);
  const settle1 = await service.activation({ incidentId: "INC-S2", status: "AVAILABLE", recoveredCapacityMbps: 200 });
  check("case1: committed once, settled", c1.status === "COMMITTED" && settle1.status === "SETTLED");
  check("case1: duplicate commit blocked (no second tx)", dup.duplicate === true && dup.commitment.txDigest === c1.txDigest);

  // 2 — provider failure → graceful refund
  console.log("[harness] case 2: emergency commit → activation FAILED → refund (INC-S7/PROVIDER-A)");
  await service.commit(load("s7-disaster-selected-offer.json"));
  const refund = await service.activation({ incidentId: "INC-S7", status: "FAILED" });
  check("case2: refunded without duplicate payment", refund.status === "REFUNDED");

  // 3 — failover takeover + retry safety
  console.log("[harness] case 3: fallback takeover — B commits after A failed, then settles");
  // 3a. Transient RPC failure first: the attempt dies mid-flight (after
  //     verification, before any on-chain effect). Retrying must be safe.
  const broken = new TrustService({ ledger: new EventLedger(ledgerPath), config });
  broken.client = { signAndExecuteTransaction: async () => { throw new Error("ECONNREFUSED (simulated)"); } };
  let firstAttemptFailed = false;
  try {
    await broken.commit(load("s7-fallback-selected-offer.json"));
  } catch {
    firstAttemptFailed = true;
  }
  const fb = await service.commit(load("s7-fallback-selected-offer.json"));
  const fbRetry = await service.commit(load("s7-fallback-selected-offer.json"));
  const settle3 = await service.activation({ incidentId: "INC-S7", status: "AVAILABLE", recoveredCapacityMbps: 300 });
  check("case3: B takeover committed + settled", firstAttemptFailed && fb.status === "COMMITTED" && settle3.status === "SETTLED",
    `broken attempt failed: ${firstAttemptFailed}`);
  check("case3: retry after transient failure lands exactly once",
    fbRetry.duplicate === true && fbRetry.commitment.txDigest === fb.txDigest);

  // 4 — re-run safety (registry short-circuits BEFORE the chain)
  console.log("[harness] case 4: full re-run — duplicates blocked, zero new transactions");
  const txsBeforeRerun = new Set(
    [...ledger.registry.values()].map((s) => s.txDigest).filter(Boolean)
  );
  const service2 = new TrustService({ ledger: new EventLedger(ledgerPath), config });
  const rerun = await service2.commit(load("s2-selected-offer.json"));
  const rerunS7 = await service2.commit(load("s7-disaster-selected-offer.json"));
  const rerunFb = await service2.commit(load("s7-fallback-selected-offer.json"));
  const newTxs = [...service2.ledger.registry.values()]
    .map((s) => s.txDigest)
    .filter((d) => d && !txsBeforeRerun.has(d));
  check("case4: re-run blocks all duplicates",
    rerun.duplicate && rerunS7.duplicate && rerunFb.duplicate && newTxs.length === 0,
    newTxs.length ? `unexpected new txs: ${newTxs.length}` : "0 new transactions");

  // 5 — expiry guard
  console.log("[harness] case 5: expired voucher rejected before any transaction");
  execSync("npm run --silent sui:fixtures", { stdio: "ignore", env: { ...process.env, SUI_FIXTURE_TTL_MS: "0" } });
  let expiredCode = null;
  try {
    await new TrustService({ ledger: new EventLedger(ledgerPath), config }).commit(load("s9-expiry-selected-offer.json"));
  } catch (err) {
    expiredCode = err instanceof VoucherError ? err.code : null;
  }
  check("case5: expired voucher rejected with VOUCHER_EXPIRED", expiredCode === "VOUCHER_EXPIRED", `code=${expiredCode}`);

  // incident KPIs from the run
  results.push({
    kind: "INCIDENT",
    incidentId: "INC-S2",
    kpis: {
      incidentId: "INC-S2",
      selectionMode: s2.selectionMode,
      provider: s2.selectedProvider.providerId,
      amount: s2.agreement.amount,
      outcome: "RECOVERED",
      timeToDecisionMs: s2.timing.tDecide - s2.timing.tDetect,
      timeToActivationMs: null,
      timeToRecoveryMs: (settle1.status === "SETTLED" ? Date.now() - s2.timing.tDetect : null)
    }
  });

  const summary = summarize(results);
  summary.generatedAt = new Date().toISOString();
  const paths = writeReport(summary);
  console.log(`[harness] report: ${paths.json} + ${paths.md}`);
  console.log(JSON.stringify(summary.duplicateSafety, null, 2));
  if (!summary.checks.every((c) => c.passed)) process.exit(1);
}

main().catch((err) => {
  console.error(`[harness] ${err.code ?? ""} ${err.message}`);
  process.exit(1);
});
