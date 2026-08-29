// Sui network client for the trust layer. Everything runs as the BUYER
// (derived from fixtures/keys/buyer.private.pem) — publisher, treasury holder,
// escrow/authority owner — so a single signer covers the readiness phase
// (blueprint §4.1: trust is prepared BEFORE incidents) and the incident flow.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import { keypairFromPem } from "./keys.js";

export const CONFIG_PATH = path.resolve(".sui/config.json");
const LOCALNET_URL = process.env.SUI_LOCALNET_URL ?? "http://127.0.0.1:9000";
const SUI_CLOCK_ID = "0x6";

export function network() {
  return process.env.SUI_NETWORK ?? "localnet";
}

export function makeClient(net = network()) {
  return new SuiClient({
    url: net === "localnet" ? LOCALNET_URL : getFullnodeUrl(net)
  });
}

export function loadConfig(configPath = CONFIG_PATH) {
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function saveConfig(config, configPath = CONFIG_PATH) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function buyerKeypair(keysDir = "fixtures/keys") {
  return keypairFromPem(readFileSync(path.join(keysDir, "buyer.private.pem"), "utf8"));
}

function compiledModules(moveDir = "move") {
  const dir = path.join(moveDir, "build", "netchain", "bytecode_modules");
  if (!existsSync(dir)) {
    throw new Error(`no compiled bytecode at ${dir} — run: sui move build --path ${moveDir}`);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".mv"))
    .map((f) => Array.from(readFileSync(path.join(dir, f))));
}

export async function ensureGas(client, keypair, { minBalance = 2_000_000_000n } = {}) {
  const address = keypair.toSuiAddress();
  const { data } = await client.getAllCoins({ owner: address });
  const total = data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  if (total >= minBalance) return total;
  if (network() === "mainnet") throw new Error("never faucet mainnet (hackathon rule: no mainnet)");
  await requestSuiFromFaucetV2({
    host: getFaucetHost(network()),
    recipient: address
  });
  return total;
}

/** Publish move/ and transfer the upgrade cap to the buyer. */
export async function publishPackage(client, keypair, moveDir = "move") {
  const tx = new Transaction();
  const cap = tx.publish({ modules: compiledModules(moveDir), dependencies: ["0x1", "0x2"] });
  tx.transferObjects([cap], keypair.toSuiAddress());
  const result = await signAndRun(client, keypair, tx, { showObjectChanges: true });
  const packageId = result.objectChanges?.find((c) => c.type === "published")?.packageId;
  const treasuryId = result.objectChanges?.find(
    (c) => c.type === "created" && c.objectType.startsWith("0x2::coin::TreasuryCap")
  )?.objectId;
  return { packageId, treasuryId, digest: result.digest };
}

/** Readiness phase: mint MYRC, create + fund escrow, create AuthorityCap. */
export async function runSetup(client, keypair, config, {
  mintAmount = 10_000,
  escrowFund = 2_000,
  maxPerVoucher = 500
} = {}) {
  const myrc = `${config.packageId}::myrc::MYRC`;
  const buyer = keypair.toSuiAddress();
  const tx = new Transaction();
  const minted = tx.moveCall({
    target: "0x2::coin::mint",
    typeArguments: [myrc],
    arguments: [tx.object(config.treasuryId), tx.pure.u64(mintAmount)]
  });
  const escrow = tx.moveCall({
    target: `${config.packageId}::escrow::new`,
    typeArguments: [myrc]
  });
  tx.moveCall({
    target: `${config.packageId}::escrow::deposit`,
    typeArguments: [myrc],
    arguments: [escrow, minted]
  });
  tx.transferObjects([escrow], buyer);
  tx.moveCall({
    target: `${config.packageId}::authority::new_to_sender`,
    arguments: [tx.pure.u64(maxPerVoucher)]
  });
  const result = await signAndRun(client, keypair, tx, { showObjectChanges: true });
  const created = result.objectChanges?.filter((c) => c.type === "created") ?? [];
  config.escrowId = created.find((c) => c.objectType.includes("::escrow::Escrow"))?.objectId;
  config.authorityId = created.find((c) => c.objectType.includes("::authority::AuthorityCap"))?.objectId;
  config.buyer = buyer;
  config.setupDigest = result.digest;
  return config;
}

function utf8Vector(tx, s) {
  return tx.pure.vector("u8", Array.from(Buffer.from(s, "utf8")));
}
function rawVector(tx, u8) {
  return tx.pure.vector("u8", Array.from(u8));
}

/** escrow::commit — on-chain dual ed25519 verification + nonce lock. */
export async function commitVoucher(client, keypair, config, voucher) {
  const myrc = `${config.packageId}::myrc::MYRC`;
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::commit`,
    typeArguments: [myrc],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      tx.object(SUI_CLOCK_ID),
      utf8Vector(tx, voucher.incidentId),
      utf8Vector(tx, voucher.providerId),
      tx.pure.u64(voucher.amount),
      tx.pure.u64(voucher.expiryMs),
      utf8Vector(tx, voucher.nonce),
      tx.pure.address(voucher.providerAddress),
      rawVector(tx, voucher.buyerMsg),
      rawVector(tx, voucher.buyerSig),
      rawVector(tx, voucher.buyerPk),
      rawVector(tx, voucher.providerMsg),
      rawVector(tx, voucher.providerSig),
      rawVector(tx, voucher.providerPk)
    ]
  });
  return signAndRun(client, keypair, tx);
}

export async function settleVoucher(client, keypair, config, voucher) {
  const myrc = `${config.packageId}::myrc::MYRC`;
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::settle`,
    typeArguments: [myrc],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      utf8Vector(tx, voucher.nonce)
    ]
  });
  return signAndRun(client, keypair, tx);
}

export async function refundVoucher(client, keypair, config, voucher) {
  const myrc = `${config.packageId}::myrc::MYRC`;
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::refund`,
    typeArguments: [myrc],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      utf8Vector(tx, voucher.nonce)
    ]
  });
  return signAndRun(client, keypair, tx);
}

export async function reclaimVoucher(client, keypair, config, nonce) {
  const myrc = `${config.packageId}::myrc::MYRC`;
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::reclaim`,
    typeArguments: [myrc],
    arguments: [tx.object(config.escrowId), utf8Vector(tx, nonce)]
  });
  return signAndRun(client, keypair, tx);
}

async function signAndRun(client, keypair, tx, extraOptions = {}) {
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true, ...extraOptions }
  });
  if (result.effects?.status?.status !== "success") {
    const err = new Error(result.effects?.status?.error ?? "transaction failed");
    err.digest = result.digest;
    throw err;
  }
  return result;
}

export async function queryEscrowEvents(client, config, { limit = 200 } = {}) {
  return client.queryEvents({
    query: { MoveModule: { package: config.packageId, module: "escrow" } },
    order: "ascending",
    limit
  });
}
