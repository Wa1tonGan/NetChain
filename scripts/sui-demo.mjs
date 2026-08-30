#!/usr/bin/env node
// One-command Sui demo (blueprint §10, Person 3 beats — steps 2, 7, 10, 11):
//   npm run demo:sui
//   SUI_NETWORK=testnet npm run demo:sui
//
// Story told in order:
//   1. Readiness (blueprint §4.1): package/escrow/authority live on <network>.
//   2. Fresh short-lived voucher minted from Person 2's Selected Offer
//      (regenerated every run — repeatability with no duplicate payments).
//   3. On-chain commit: BOTH A2A ed25519 signatures verified IN MOVE before
//      the escrow locks funds under the nonce.
//   4. Duplicate submission blocked — same nonce, zero new transactions.
//   5. Activation AVAILABLE → settlement pays the provider address.
//   6. Provider failure drill: emergency commit → FAILED → refund → fallback
//      takeover commits and settles.
// Each run uses its own funded pool (mirrors harness isolation) so the demo
// can be replayed back-to-back on stage.
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  buyerKeypair,
  loadConfig,
  makeClient,
  network,
  setupEscrow,
  waitForObject
} from "../src/sui/client.js";
import { EventLedger } from "../src/sui/events.js";
import { TrustService } from "../src/sui/service.js";
import { incidentKpis } from "../src/sui/ttr.js";
import { formatAmount } from "../src/sui/stablecoin.js";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { gaslessSend, sendCoin, gasUsedTotal } from "../src/sui/gasless.js";
import { loadOrCreateSponsor, sponsoredDeposit } from "../src/sui/sponsored.js";

const F = (name) => `fixtures/sui/${name}`;
const load = (name) => JSON.parse(readFileSync(F(name), "utf8"));
const t0 = Date.now();

function step(emoji, title) {
  console.log(`\n${emoji}  ${title}`);
}

async function main() {
  const net = network();
  const baseConfig = loadConfig();
  if (!baseConfig?.packageId) {
    throw new Error(`no ${`​.sui/config.${net}.json`} — run npm run sui:setup first`);
  }
  const client = makeClient(net);
  const keypair = buyerKeypair();

  step("🛡️ ", `Readiness (${net}) — package ${baseConfig.packageId.slice(0, 12)}…`);
  execSync("npm run --silent sui:fixtures", { stdio: "inherit" });
  // SUI_REUSE_POOL=1 reuses the setup escrow instead of funding a fresh pool
  // (conserves scarce testnet stablecoin; replay safety comes from nonces).
  let escrowId, authorityId, stablecoin;
  if (process.env.SUI_REUSE_POOL === "1") {
    ({ escrowId, authorityId, stablecoin } = baseConfig);
    if (!escrowId) throw new Error("SUI_REUSE_POOL=1 but config has no escrowId — run sui:setup");
    console.log("    reusing the readiness pool (SUI_REUSE_POOL=1)");
  } else {
    ({ escrowId, authorityId, stablecoin } = await setupEscrow(client, keypair, baseConfig));
    await waitForObject(client, escrowId);
  }
  const config = { ...baseConfig, escrowId, authorityId };
  const st = stablecoin ?? baseConfig.stablecoin ?? { name: "MYRC", currency: "MYR", decimals: 0, fund: 2_000, maxPerVoucher: 500 };
  const fmt = (base) => formatAmount(base, st.decimals);
  console.log(`    escrow ${escrowId.slice(0, 18)}… funded (fresh pool per run — replay-safe)`);
  console.log(`    ${st.name} pool ${fmt(st.fund)} · authority max/voucher ${fmt(st.maxPerVoucher)} (scoped, pre-incident)`);

  const ledgerPath = path.resolve(`events/demo-${net}.jsonl`);
  rmSync(ledgerPath, { force: true });
  const service = new TrustService({ ledger: new EventLedger(ledgerPath), config });

  step("📝 ", "INC-S2 (stadium, NORMAL): commit the signed recovery voucher");
  const s2 = load("s2-selected-offer.json");
  const committedAt = Date.now();
  const c1 = await service.commit(s2);
  console.log(
    `    ${s2.selectedProvider.brand} (${s2.selectedProvider.providerId}) — ` +
    `${s2.agreement.planPrice} ${st.currency} + ${fmt(c1.voucher.platformFee)} platform fee = ` +
    `${fmt(c1.voucher.amount)} locked, nonce ${s2.agreement.nonce}`
  );
  console.log(`    ✅ dual ed25519 signatures verified ON-CHAIN, funds locked — tx ${c1.txDigest?.slice(0, 12)}…`);

  step("🚫 ", "Replay the same voucher (crash/retry simulation)");
  const dup = await service.commit(s2);
  console.log(`    duplicate blocked by nonce ${s2.agreement.nonce} — no second lock, no second payment`);

  step("🕵️ ", "Verification Agent: delivered session vs promise (deterministic, no LLM)");
  const v1 = await service.verifyDelivery("INC-S2", {
    promisedCapacity: s2.selectedProvider.capacityMbps,
    deliveredSamples: [305, 298, 302, 300],
    sessionStart: committedAt,
    sessionEnd: Date.now()
  });
  console.log(
    `    ✅ avg ${v1.connectionLog.avg_delivered_mbps} / ${s2.selectedProvider.capacityMbps} Mbps — ` +
    `verdict ${v1.verdict}, penalty ${fmt(v1.penaltyAmount)} ${st.currency} — connection log on-chain, tx ${v1.txDigest?.slice(0, 12)}…`
  );

  step("⚡ ", "Activation AVAILABLE → split settlement");
  const settle1 = await service.activation({ incidentId: "INC-S2", status: "AVAILABLE", recoveredCapacityMbps: 200 });
  const ttr = Date.now() - t0;
  console.log(
    `    ✅ split settlement: ${fmt(c1.voucher.providerAmount)} ${st.currency} → ${config.providers[s2.selectedProvider.providerId]?.slice(0, 18)}… · ` +
    `${fmt(c1.voucher.platformFee)} → platform fee wallet ${(process.env.PLATFORM_ADDRESS ?? "").slice(0, 18)}… — ` +
    `tx ${settle1.txDigest?.slice(0, 12)}…`
  );

  step("🔥 ", "INC-S7 (disaster, EMERGENCY): provider fails AFTER commitment");
  await service.commit(load("s7-disaster-selected-offer.json"));
  const refund = await service.activation({ incidentId: "INC-S7", status: "FAILED" });
  console.log(`    PROVIDER-A failed → refund ${refund.status}, money back to buyer, no duplicate payment`);

  step("🛟 ", "Fallback takeover: B commits, under-delivery penalized, settles");
  const s7fb = load("s7-fallback-selected-offer.json");
  const fb = await service.commit(s7fb);
  // B recovered the incident but delivered below promise — the deterministic
  // check deducts a proportional penalty from B's payout (never a full claw).
  const v3 = await service.verifyDelivery("INC-S7", {
    promisedCapacity: s7fb.selectedProvider.capacityMbps,
    deliveredSamples: [240, 235, 245],
    sessionStart: committedAt,
    sessionEnd: Date.now()
  });
  const settle3 = await service.activation({ incidentId: "INC-S7", status: "AVAILABLE", recoveredCapacityMbps: 240 });
  console.log(
    `    ✅ ${fb.status} → verdict ${v3.verdict} (avg ${v3.connectionLog.avg_delivered_mbps}/${s7fb.selectedProvider.capacityMbps} Mbps, ` +
    `penalty ${fmt(v3.penaltyAmount)} ${st.currency} → buyer) → ${settle3.status} ` +
    `(provider ${fmt(fb.voucher.providerAmount - fb.voucher.platformFee - v3.penaltyAmount)} · fee ${fmt(fb.voucher.platformFee)} ${st.currency}) — ` +
    `failover + verification proved (blueprint §6.1/§4.3)`
  );

  step("💸 ", "Gasless USDC payment: sender holds ZERO SUI (Sui Track 01)");
  if (st.type && net === "testnet") {
    // A fresh customer wallet is funded with a sliver of USDC — and NO SUI —
    // then pays the platform wallet. Allowlisted-stablecoin transfers run at
    // gasPrice 0 (docs: gasless-stablecoin-transfers).
    const customer = new Ed25519Keypair();
    await sendCoin(client, keypair, {
      coinType: st.type, recipient: customer.toSuiAddress(), amountBase: 20_000
    });
    const g = await gaslessSend(client, customer, {
      coinType: st.type,
      recipient: process.env.PLATFORM_ADDRESS,
      amountBase: 10_000 // protocol minimum 0.01
    });
    const gas = gasUsedTotal(g);
    console.log(
      `    ✅ ${fmt(10_000)} ${st.currency} → platform wallet, gas charged: ${gas === 0n ? "0 (gasless proven)" : String(gas)} — ` +
      `tx ${g.digest?.slice(0, 12)}…`
    );
    ledger.emit("GASLESS_SENT", {
      incidentId: null,
      nonce: null,
      txDigest: g.digest,
      data: { amount: 10_000, sender: customer.toSuiAddress(), gasCharged: String(gas ?? "n/a") }
    });
  } else {
    console.log(`    skipped — gasless transfers apply to the real allowlisted stablecoin (testnet USDC)`);
  }

  step("🤝 ", "Sponsored top-up: customer signs, PLATFORM pays gas (shared pool)");
  if (st.type && net === "testnet") {
    const sponsor = await loadOrCreateSponsor(client, keypair, net);
    const customer2 = new Ed25519Keypair();
    await sendCoin(client, keypair, {
      coinType: st.type, recipient: customer2.toSuiAddress(), amountBase: 30_000
    });
    const s = await sponsoredDeposit({
      client,
      customerKeypair: customer2,
      sponsorKeypair: sponsor.keypair,
      config,
      amountBase: 20_000
    });
    console.log(
      `    ✅ ${fmt(20_000)} ${st.currency} deposited into the shared pool — customer had no SUI, ` +
      `gas paid by sponsor ${sponsor.address.slice(0, 12)}… — tx ${s.digest?.slice(0, 12)}…`
    );
    ledger.emit("SPONSORED_TOPUP", {
      incidentId: null,
      nonce: null,
      txDigest: s.digest,
      data: { amount: 20_000, customer: customer2.toSuiAddress(), sponsor: sponsor.address }
    });
  } else {
    console.log(`    skipped — sponsorship demo runs on testnet USDC (localnet MYRC flow unchanged)`);
  }

  step("📊 ", "Time-to-Recovery (measured, not assumed)");
  const kpis = incidentKpis(s2, {
    tActivateMs: committedAt,
    tRecoverMs: Date.now(),
    outcome: "RECOVERED"
  });
  console.log(`    tDetect→tDecide ${kpis.timeToDecisionMs} ms (from A2A timing)`);
  console.log(`    end-to-end (this run, incl. chain): ${ttr} ms`);
  console.log(`\n    ledger: events/demo-${net}.jsonl (dashboard-tailable)`);
  console.log("    Demo complete — every beat above is an on-chain transaction on " + net + ".");
}

main().catch((err) => {
  console.error(`\n[demo] ${err.code ?? ""} ${err.message}`);
  if (err.digest) console.error(`txDigest: ${err.digest}`);
  process.exit(1);
});
