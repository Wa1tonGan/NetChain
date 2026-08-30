#!/usr/bin/env node
// Readiness phase (blueprint §4.1): publish the package, mint MYRC, create +
// fund the escrow, create the scoped AuthorityCap — all BEFORE any incident.
// Idempotent per network: skips steps already recorded in .sui/config.json.
//   SUI_NETWORK=localnet|testnet npm run sui:setup
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buyerKeypair,
  ensureGas,
  loadConfig,
  makeClient,
  network,
  publishPackage,
  runSetup,
  saveConfig,
  waitForObject
} from "../src/sui/client.js";
import { EventLedger } from "../src/sui/events.js";
import { suiAddressFromPem } from "../src/sui/keys.js";
import { loadProviderProfiles } from "../src/sui/voucher.js";

function findSui() {
  // Empty-string env values (e.g. `SUI_BIN=` in .env) must fall through to the default.
  return process.env.SUI_BIN || path.join(process.env.USERPROFILE ?? process.env.HOME, "sui-cli", "sui.exe");
}

const config = { ...(loadConfig() ?? {}), network: network() };
const client = makeClient();
const keypair = buyerKeypair();

console.log(`[setup] network=${config.network} buyer=${keypair.toSuiAddress()}`);
await ensureGas(client, keypair);

if (!config.packageId || config.network !== network()) {
  console.log("[setup] building Move package…");
  execSync(`"${findSui()}" move build --path move`, { stdio: "inherit" });
  console.log("[setup] publishing…");
  const published = await publishPackage(client, keypair);
  Object.assign(config, published);
  saveConfig(config);
  console.log(`[setup] package=${published.packageId} treasury=${published.treasuryId}`);
  // Fresh objects lag behind their tx in gRPC indexing — wait before use.
  await waitForObject(client, published.packageId);
  await waitForObject(client, published.treasuryId);
} else {
  console.log(`[setup] reusing package=${config.packageId}`);
}

if (!config.escrowId || !config.authorityId) {
  console.log("[setup] minting MYRC + funding escrow + creating AuthorityCap…");
  await runSetup(client, keypair, config);
  saveConfig(config);
  console.log(`[setup] escrow=${config.escrowId} authority=${config.authorityId}`);
} else {
  console.log(`[setup] reusing escrow=${config.escrowId}`);
}

// Provider payout addresses come from the SAME identity keys as their A2A
// signatures (one identity across negotiation and settlement).
const profiles = loadProviderProfiles("fixtures/providers");
config.providers = {};
for (const [providerId, profile] of profiles) {
  config.providers[providerId] = suiAddressFromPem(profile.publicKey.value);
}
saveConfig(config);

const ledger = new EventLedger();
ledger.emit("ESCROW_READY", {
  incidentId: null,
  data: {
    network: config.network,
    packageId: config.packageId,
    escrowId: config.escrowId,
    authorityId: config.authorityId,
    buyer: config.buyer
  }
});

console.log("[setup] readiness complete (blueprint §4.1):");
console.log(JSON.stringify(config, null, 2));
if (!existsSync("fixtures/keys/buyer.private.pem")) {
  throw new Error("fixture keys missing — run npm run provision first");
}
