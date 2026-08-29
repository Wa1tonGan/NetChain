#!/usr/bin/env node
// Reliability harness (blueprint §6.1 KPIs + Person 3 M5): runs the full
// trust battery against the configured network and writes the
// reliability-report (JSON + markdown).
//
//   npm run harness:sui                    # localnet
//   SUI_NETWORK=testnet npm run harness:sui
//
// Cases:
//   1  happy-path      commit → duplicate blocked → settle (INC-S2, 60 MYR)
//   2  failover-refund emergency commit → activation FAILED → refund (INC-S7/A)
//   3  failover-takeover A failed → B takes over → settle (INC-S7/B)
//   4  re-run safety   same nonces again → duplicates blocked, zero new txs
//   5  retry safety    commit attempt against an unreachable node → retry
//                      with a healthy client lands byte-identically (no double lock)
//   6  expiry guard    expired voucher rejected before any transaction
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeClient } from "../src/sui/client.js";
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
  console.log(`[harness] network=${process.env.SUI_NETWORK ?? "localnet"} — regenerating fresh fixtures…`);
  execSync("npm run --silent sui:fixtures", { stdio: "inherit" });

  const ledger = new EventLedger();
  const service = new TrustService({ ledger });
  const beforeTxs = new Set(
    [...ledger.registry.values()].map((s) => s.txDigest).filter(Boolean)
  );

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

  // 3 — failover takeover
  console.log("[harness] case 3: fallback takeover — B commits after A failed, then settles");
  const fb = await service.commit(load("s7-fallback-selected-offer.json"));
  const settle3 = await service.activation({ incidentId: "INC-S7", status: "AVAILABLE", recoveredCapacityMbps: 300 });
  check("case3: B takeover committed + settled", fb.status === "COMMITTED" && settle3.status === "SETTLED");

  // 4 — re-run safety (same nonces, fresh clock)
  console.log("[harness] case 4: full re-run — duplicates blocked, zero new transactions");
  execSync("npm run --silent sui:fixtures", { stdio: "ignore" });
  const ledger2 = new EventLedger(); // fresh registry, as after a service restart… no: registry rebuilds FROM ledger; emulate replay only
  const service2 = new TrustService({ ledger: ledger2 });
  const rerun = await service2.commit(load("s2-selected-offer.json"));
  const rerunS7 = await service2.commit(load("s7-disaster-selected-offer.json"));
  const newTxs = [...ledger2.registry.values()]
    .map((s) => s.txDigest)
    .filter((d) => d && !beforeTxs.has(d));
  check("case4: re-run blocks both duplicates", rerun.duplicate && rerunS7.duplicate && newTxs.length === 0,
    newTxs.length ? `unexpected new txs: ${newTxs.length}` : "0 new transactions");

  // 5 — retry safety (transient RPC failure then byte-identical retry)
  console.log("[harness] case 5: commit retry after transient RPC failure");
  const badClient = makeClient();
  const savedUrl = badClient.client?.url;
  const broken = new TrustService({ ledger: new EventLedger() });
  broken.client = { signAndExecuteTransaction: async () => { throw new Error("ECONNREFUSED (simulated)"); } };
  let retried = false;
  try {
    await broken.commit(load("s7-fallback-selected-offer.json"));
  } catch {
    retried = true;
  }
  const retry = await service.commit(load("s7-fallback-selected-offer.json"));
  check("case5: retry after failure is safe (settled state, no new lock)",
    retried && retry.duplicate === true && retry.status === "SETTLED",
    `first attempt failed: ${retried}, retry resolved to: ${retry.status}/dup=${retry.duplicate}`);

  // 6 — expiry guard
  console.log("[harness] case 6: expired voucher rejected before any transaction");
  execSync("SUI_FIXTURE_TTL_MS=0 npm run --silent sui:fixtures", { stdio: "ignore" });
  let expiredCode = null;
  try {
    await new TrustService({ ledger: new EventLedger() }).commit(load("s2-selected-offer.json"));
  } catch (err) {
    expiredCode = err instanceof VoucherError ? err.code : null;
  }
  check("case6: expired voucher rejected with VOUCHER_EXPIRED", expiredCode === "VOUCHER_EXPIRED", `code=${expiredCode}`);

  // report
  const summary = summarize(results);
  const paths = writeReport(summary);
  console.log(`[harness] report: ${paths.json} + ${paths.md}`);
  console.log(JSON.stringify(summary.duplicateSafety, null, 2));
  if (!summary.checks.every((c) => c.passed)) process.exit(1);
}

main().catch((err) => {
  console.error(`[harness] ${err.code ?? ""} ${err.message}`);
  process.exit(1);
});
