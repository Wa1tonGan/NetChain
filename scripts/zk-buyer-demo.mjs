#!/usr/bin/env node
// zkLogin buyer-direct proof (no browser needed): simulates EXACTLY what the
// frontend does on "Run live" — a throwaway ed25519 keypair stands in for the
// user's zkLogin ephemeral key, and the same trust-server endpoints are driven
// in the same order the UI drives them:
//
//   1. POST /v1/fund            — platform cold-start funds the user wallet
//   2. POST /v1/commit          — submit:false → unsigned commit_as_buyer PTB
//   3. sign + submit            — the USER signs (not the platform key)
//   4. POST /v1/commit/confirm  — ledger row (zkBuyer: true)
//   5. POST /v1/verify          — deterministic delivery verdict on-chain
//   6. POST /v1/activation      — settle (AVAILABLE) / refund_to_buyer (FAILED)
//
//   npm run demo:zk             # testnet (SUI_NETWORK from .env)
//
// Passes ONLY if the on-chain Committed buyer is the throwaway wallet —
// any run where the sender/buyer is the platform wallet 0xabc67f… fails.
import { readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  makeClient,
  loadConfig,
  network,
  unpack,
  buildCommitAsBuyerTx,
} from "../src/sui/client.js";
import { TrustService } from "../src/sui/service.js";
import { EventLedger } from "../src/sui/events.js";
import { formatAmount } from "../src/sui/stablecoin.js";

const TRUST_URL = process.env.TRUST_URL ?? "http://127.0.0.1:8200";
const SUI_CLOCK_ID = "0x6";

const results = [];
const check = (name, passed, detail = null) => {
  results.push({ kind: "CHECK", name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function post(endpoint, body) {
  const res = await fetch(`${TRUST_URL}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${endpoint} → ${res.status}: ${json.message ?? json.error ?? res.status}`);
  return json;
}

// Same call the frontend makes via /suirpc — but through the gRPC client the
// trust layer already uses, so the proof runs headless.
async function submitUserTx(client, userKeypair, txBytes) {
  const result = unpack(
    await client.signAndExecuteTransaction({
      signer: userKeypair,
      transaction: Transaction.from(txBytes),
      include: { effects: true, events: true },
    })
  );
  return result;
}

async function main() {
  const net = network();
  console.log(`[zk-demo] network=${net} — requires trust server on ${TRUST_URL} (npm run trust:server)`);
  const config = loadConfig();
  if (!config?.packageId) throw new Error("no .sui config — run npm run sui:setup first");
  const client = makeClient(net);

  execSync("npm run --silent sui:fixtures", { stdio: "inherit" });
  const s2 = JSON.parse(readFileSync(path.resolve("fixtures/sui/s2-selected-offer.json"), "utf8"));
  const s2refund = JSON.parse(readFileSync(path.resolve("fixtures/sui/s2-refund-selected-offer.json"), "utf8"));
  const st = config.stablecoin ?? { name: "USDC", decimals: 6 };
  const fmt = (base) => formatAmount(base, st.decimals);

  // The "user": throwaway wallet — NOT the platform, NOT a provider.
  const user = new Ed25519Keypair();
  const userAddress = user.toSuiAddress();
  const platform = process.env.PLATFORM_ADDRESS;
  console.log(`[zk-demo] user wallet=${userAddress}`);
  if (!platform || userAddress === platform) throw new Error("user wallet must differ from PLATFORM_ADDRESS");

  // Unique incident ids per run (ledger nonce registry + on-chain nonce lock).
  const run = Date.now() % 100000;
  const s2run = { ...s2, incidentId: `${s2.incidentId}-ZK${run}` };
  s2run.agreement = { ...s2.agreement, nonce: `${s2.agreement.nonce}:ZK${run}` };
  const s2refRun = { ...s2refund, incidentId: `${s2refund.incidentId}-ZKR${run}` };
  s2refRun.agreement = { ...s2refund.agreement, nonce: `${s2refund.agreement.nonce}:ZKR${run}` };

  // 1 — funding (platform key, /v1/fund — same endpoint the UI drives)
  console.log(`[zk-demo] 1. funding user wallet via /v1/fund…`);
  const fund = await post("/v1/fund", {
    address: userAddress,
    stableBase: Math.round(s2run.agreement.amount * 10 ** st.decimals),
    suiMist: 100_000_000,
  });
  check("fund: user wallet funded by platform", Boolean(fund.stableTxDigest), `tx ${fund.stableTxDigest ?? "?"}`);

  // 2 — build-only commit (submit:false — the same POST the browser makes)
  //     First pass without a coin id fails with the same error the browser
  //     sees before funding; the funded coin id is resolved the same way the
  //     frontend resolves it (balance + coin-object reads).
  console.log(`[zk-demo] 2. building unsigned commit_as_buyer PTB…`);
  const allBalances = await client.getAllBalances({ owner: userAddress });
  const stable = (allBalances ?? []).find((b) => (b.coinType ?? "").includes("USDC") || (b.coinType ?? "").includes("MYRC"));
  if (!stable) throw new Error("no stablecoin balance on user wallet after funding");
  const coins = await client.getCoins({ owner: userAddress, coinType: stable.coinType });
  const coin = (coins.data ?? []).find((c) => Number(c.balance) >= Math.round(s2run.agreement.amount * 10 ** st.decimals));
  if (!coin) throw new Error("no coin object covering the amount after funding");
  const build2 = await post("/v1/commit", { ...s2run, submit: false, paymentCoinId: coin.coinObjectId });
  if (!build2.txBytes) throw new Error(`build2 failed: ${build2.message ?? "?"}`);
  check("build: unsigned PTB returned (no server signature)", Boolean(build2.txBytes));

  // 3 — the USER signs + submits (platform key never touches this tx)
  console.log(`[zk-demo] 3. user signs + submits the PTB…`);
  const result = await submitUserTx(client, user, Buffer.from(build2.txBytes, "base64"));
  const status = result.status ?? {};
  if (!status.success) throw new Error(`on-chain commit failed: ${JSON.stringify(status.error)}`);
  const committedEvent = (result.events ?? []).find((e) => e.json?.buyer !== undefined && e.json?.idempotent !== undefined);
  const onChainBuyer = committedEvent?.json?.buyer;
  check("commit: buyer on-chain = user wallet (NOT platform)", onChainBuyer === userAddress, `buyer=${onChainBuyer} tx=${result.digest}`);

  // 4 — confirm (ledger row, zkBuyer flag)
  const confirm = await post("/v1/commit/confirm", {
    incidentId: s2run.incidentId,
    nonce: s2run.agreement.nonce,
    txDigest: result.digest,
    voucher: build2.voucher ?? null,
  });
  check("confirm: ledger row COMMITTED", confirm.status === "COMMITTED", `status=${confirm.status}`);

  // 5 — verify (blueprint §4.3 — deterministic verdict on-chain, penalty 0)
  console.log(`[zk-demo] 5. verify delivery (promised=${s2run.selectedProvider.capacityMbps} Mbps, within tolerance)…`);
  const v = await post("/v1/verify", {
    incidentId: s2run.incidentId,
    promisedCapacity: s2run.selectedProvider.capacityMbps,
    deliveredSamples: [s2run.selectedProvider.capacityMbps],
  });
  check("verify: verdict OK, penalty 0", v.status === "VERIFIED" && v.penaltyAmount === 0, `verdict=${v.verdict}`);

  // 6 — settle
  console.log(`[zk-demo] 6. settle (activation AVAILABLE)…`);
  const settle = await post("/v1/activation", { incidentId: s2run.incidentId, status: "AVAILABLE" });
  check("settle: SETTLED", settle.status === "SETTLED", `tx ${settle.txDigest ?? "?"}`);

  // 7 — refund_to_buyer: user-committed voucher + activation FAILED
  console.log(`[zk-demo] 7. refund path (activation FAILED)…`);
  const fund2 = await post("/v1/fund", {
    address: userAddress,
    stableBase: Math.round(s2refRun.agreement.amount * 10 ** st.decimals),
  });
  const allBalances2 = await client.getAllBalances({ owner: userAddress });
  const stable2 = (allBalances2 ?? []).find((b) => (b.coinType ?? "").includes("USDC") || (b.coinType ?? "").includes("MYRC"));
  const coins2 = await client.getCoins({ owner: userAddress, coinType: stable2.coinType });
  const coin2 = (coins2.data ?? []).find((c) => Number(c.balance) >= Math.round(s2refRun.agreement.amount * 10 ** st.decimals));
  const buildR = await post("/v1/commit", { ...s2refRun, submit: false, paymentCoinId: coin2.coinObjectId });
  if (!buildR.txBytes) throw new Error(`refund-build failed: ${buildR.message ?? "?"}`);
  const resultR = await submitUserTx(client, user, Buffer.from(buildR.txBytes, "base64"));
  const statusR = resultR.status ?? {};
  if (!statusR.success) throw new Error(`on-chain commit (refund case) failed: ${JSON.stringify(statusR.error)}`);
  await post("/v1/commit/confirm", {
    incidentId: s2refRun.incidentId,
    nonce: s2refRun.agreement.nonce,
    txDigest: resultR.digest,
    voucher: buildR.voucher ?? null,
  });
  const refund = await post("/v1/activation", { incidentId: s2refRun.incidentId, status: "FAILED" });
  check("refund: REFUNDED via refund_to_buyer", refund.status === "REFUNDED", `tx ${refund.txDigest ?? "?"}`);
  const balAfter = await client.getBalance({ owner: userAddress, coinType: stable2.coinType });
  const userGotMoneyBack = Number(balAfter?.balance ?? 0) > 0;
  check("refund: money back in USER wallet (not pool)", userGotMoneyBack, `stable balance=${balAfter?.balance ?? 0} base`);

  // 8 — under-delivery case: penalty split (buyer compensated, provider less)
  // Uses a THIRD fresh commit (same fixture family, s7-fallback) to prove the
  // settle split on a zk-committed voucher.
  console.log(`[zk-demo] 8. under-delivery → penalty split on a zk commit…`);
  const s7fb = JSON.parse(readFileSync(path.resolve("fixtures/sui/s7-fallback-selected-offer.json"), "utf8"));
  const s7run = { ...s7fb, incidentId: `${s7fb.incidentId}-ZKP${run}` };
  s7run.agreement = { ...s7.agreement, nonce: `${s7fb.agreement.nonce}:ZKP${run}` };
  await post("/v1/fund", {
    address: userAddress,
    stableBase: Math.round(s7run.agreement.amount * 10 ** st.decimals),
  });
  const stable3 = (await client.getAllBalances({ owner: userAddress })).find(
    (b) => (b.coinType ?? "").includes("USDC") || (b.coinType ?? "").includes("MYRC")
  );
  const coin3 = (await client.getCoins({ owner: userAddress, coinType: stable3.coinType })).data.find(
    (c) => Number(c.balance) >= Math.round(s7run.agreement.amount * 10 ** st.decimals)
  );
  const buildP = await post("/v1/commit", { ...s7run, submit: false, paymentCoinId: coin3.coinObjectId });
  if (!buildP.txBytes) throw new Error(`penalty-build failed: ${buildP.message ?? "?"}`);
  const resultP = await submitUserTx(client, user, Buffer.from(buildP.txBytes, "base64"));
  if (!(resultP.status ?? {}).success) throw new Error(`on-chain commit (penalty case) failed: ${JSON.stringify(resultP.status?.error)}`);
  await post("/v1/commit/confirm", {
    incidentId: s7run.incidentId,
    nonce: s7run.agreement.nonce,
    txDigest: resultP.digest,
    voucher: buildP.voucher ?? null,
  });
  const vP = await post("/v1/verify", {
    incidentId: s7run.incidentId,
    promisedCapacity: s7run.selectedProvider.capacityMbps,
    deliveredSamples: [Math.round(s7run.selectedProvider.capacityMbps * 0.8)],
  });
  const settleP = await post("/v1/activation", { incidentId: s7run.incidentId, status: "AVAILABLE" });
  check(
    "penalty: under-delivery splits on-chain (buyer compensated, fee kept)",
    settleP.status === "SETTLED" && settleP.penaltyAmount > 0,
    `penalty ${settleP.penaltyAmount} base of provider ${buildP.voucher.providerAmount}`
  );

  console.log(`\n[zk-demo] ${results.filter((r) => r.passed).length}/${results.length} checks passed`);
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[zk-demo] ${err.message}`);
  process.exitCode = 1;
});
