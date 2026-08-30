#!/usr/bin/env node
// Standalone proof of the two Track-01 payment rails (tiny USDC amounts):
//   1. GASLESS transfer — sender holds ZERO SUI (balance::send_funds, gas 0)
//   2. SPONSORED deposit — customer signs, platform gas wallet pays gas
// Both need the real allowlisted stablecoin, so they run on testnet:
//   SUI_NETWORK=testnet npm run payments:sui
// (The full demo includes the same beats when run on a fresh pool.)
import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  buyerKeypair,
  loadConfig,
  makeClient,
  network
} from "../src/sui/client.js";
import { formatAmount } from "../src/sui/stablecoin.js";
import { gaslessSend, sendCoin, gasUsedTotal } from "../src/sui/gasless.js";
import { loadOrCreateSponsor, sponsoredDeposit } from "../src/sui/sponsored.js";

const net = network();
const config = loadConfig();
if (!config?.escrowId) throw new Error("run npm run sui:setup first");
const st = config.stablecoin;
if (!st || st.type.includes("myrc")) {
  throw new Error("payments proof needs the real stablecoin — run on testnet (SUI_NETWORK=testnet)");
}
const fmt = (base) => formatAmount(base, st.decimals);
const client = makeClient(net);
const buyer = buyerKeypair();

console.log(`[payments] network=${net} asset=${st.name} buyer=${buyer.toSuiAddress().slice(0, 12)}…`);
console.log(`[payments] shared escrow ${config.escrowId.slice(0, 18)}…`);

// 1 — gasless: a customer wallet with USDC but ZERO SUI pays the platform.
console.log("\n💸  gasless transfer (balance::send_funds, gasPrice 0)");
const customer = new Ed25519Keypair();
await sendCoin(client, buyer, {
  coinType: st.type, recipient: customer.toSuiAddress(), amountBase: 20_000
});
console.log(`    customer ${customer.toSuiAddress().slice(0, 18)}… funded with ${fmt(20_000)} ${st.currency} (no SUI)`);
const g = await gaslessSend(client, customer, {
  coinType: st.type,
  recipient: process.env.PLATFORM_ADDRESS,
  amountBase: 10_000
});
const gas = gasUsedTotal(g);
console.log(`    ✅ ${fmt(10_000)} ${st.currency} → platform wallet — gas charged: ${gas === 0n ? "0 (gasless proven)" : String(gas)} — tx ${g.digest}`);

// 2 — sponsored: another customer deposits into the shared escrow; the
// platform's gas wallet pays the SUI gas for the app-call.
console.log("\n🤝  sponsored escrow deposit (customer signs, platform pays gas)");
const sponsor = await loadOrCreateSponsor(client, buyer, net);
console.log(`    sponsor ${sponsor.address.slice(0, 18)}… ${sponsor.created ? "(created + funded 0.1 SUI)" : "(reused)"}`);
const customer2 = new Ed25519Keypair();
await sendCoin(client, buyer, {
  coinType: st.type, recipient: customer2.toSuiAddress(), amountBase: 30_000
});
const s = await sponsoredDeposit({
  client,
  customerKeypair: customer2,
  sponsorKeypair: sponsor.keypair,
  config,
  amountBase: 20_000
});
console.log(`    ✅ ${fmt(20_000)} ${st.currency} deposited into the shared pool — customer had no SUI — tx ${s.digest}`);

console.log("\n[payments] both rails proven — customer never needed SUI.");
