#!/usr/bin/env node
// One-off: top up a buyer's SUI gas from the legacy demo buyer (which holds
// SUI but no longer signs testnet txs once SUI_BUYER_SECRET is set).
//   node --env-file-if-exists=.env scripts/fund-buyer-gas.mjs [recipient] [mist]
import { readFileSync } from "node:fs";
import { keypairFromPem } from "../src/sui/keys.js";
import { makeClient, network } from "../src/sui/client.js";
import { sendSui } from "../src/sui/gasless.js";

const recipient = process.argv[2] ?? process.env.SUI_BUYER_RECIPIENT;
const amountMist = BigInt(process.argv[3] ?? 200_000_000n); // 0.2 SUI
if (!recipient) throw new Error("usage: fund-buyer-gas.mjs <recipientAddress> [mistAmount]");

const client = makeClient(network());
const funder = keypairFromPem(readFileSync("fixtures/keys/buyer.private.pem", "utf8"));
const r = await sendSui(client, funder, { recipient, amountMist });
console.log(`sent ${Number(amountMist) / 1e9} SUI → ${recipient} — tx ${r.digest}`);
