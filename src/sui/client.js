// Sui network client for the trust layer (SDK v2 gRPC — public fullnodes
// removed JSON-RPC; the local single-node fullnode also serves gRPC on its
// RPC port). Everything runs as the BUYER (derived from
// fixtures/keys/buyer.private.pem) — publisher, treasury holder, escrow and
// authority owner — so a single signer covers the readiness phase
// (blueprint §4.1: trust is prepared BEFORE incidents) and the incident flow.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { keypairFromPem } from "./keys.js";
import { TESTNET_USDC, stablecoinConfig, toBaseUnits } from "./stablecoin.js";

const LOCALNET_GRPC = process.env.SUI_LOCALNET_URL ?? "http://127.0.0.1:9000";
const SUI_CLOCK_ID = "0x6";

export function network() {
  return process.env.SUI_NETWORK ?? "testnet";
}

export function configPath(net = network()) {
  return path.resolve(`.sui/config.${net}.json`);
}

export function makeClient(net = network()) {
  const baseUrl = net === "localnet" ? LOCALNET_GRPC : `https://fullnode.${net}.sui.io`;
  return new SuiGrpcClient({ baseUrl, network: net });
}

/** The escrow's asset type: Circle NATIVE USDC. */
export function coinType(config = {}) {
  const cfg = stablecoinConfig(config?.network);
  return cfg.type ?? TESTNET_USDC;
}

// v2 executes return a tagged union ({ $kind: "Transaction", Transaction }).
export function unpack(result) {
  return result?.Transaction ?? result;
}

export function loadConfig(filePath = configPath()) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function saveConfig(config, filePath = configPath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

export function buyerKeypair(keysDir = "fixtures/keys") {
  // Demo-only buyer identity, kept for the cap-based localnet flow and
  // tests. The PRODUCT path signs with the zkLogin user (commit_as_buyer);
  // operator actions (settle/refund/verify) use platformKeypair().
  const secret = process.env.SUI_BUYER_SECRET;
  if (secret) return Ed25519Keypair.fromSecretKey(secret);
  return keypairFromPem(readFileSync(path.join(keysDir, "buyer.private.pem"), "utf8"));
}

/** Platform operator key (AuthorityCap holder): settle / refund / verify.
    PLATFORM_SECRET in .env (gitignored). Absent env → null so callers can
    fall back to the demo buyer key in localnet mode. */
export function platformKeypair() {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) return null;
  return Ed25519Keypair.fromSecretKey(secret);
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

export async function ensureGas(client, keypair, {
  // Tunable for tight-but-sufficient faucet top-ups (e.g. 1 SUI): the whole
  // testnet proof costs well under 0.5 SUI (publish dominates).
  minBalance = BigInt(process.env.SUI_MIN_GAS_MIST ?? 2_000_000_000)
} = {}) {
  const address = keypair.toSuiAddress();
  const { balance } = await client.getBalance({ owner: address });
  const total = BigInt(balance.balance);
  if (total >= minBalance) return total;
  if (network() === "mainnet") throw new Error("never faucet mainnet (hackathon rule: no mainnet)");
  await requestSuiFromFaucetV2({
    host: getFaucetHost(network()),
    recipient: address
  });
  return total;
}

/** gRPC renders addresses full-width (0x000…02) — normalize before comparing. */
function shortAddress(address) {
  const hex = address.replace(/^0x/, "").replace(/^0+/, "");
  return `0x${hex || "0"}`;
}

/** Find created object ids by their (normalized) type in a tx's objectTypes map. */
function findCreatedType(result, typeSubstring) {
  const types = result.objectTypes ?? {};
  for (const [objectId, type] of Object.entries(types)) {
    if ((type ?? "").includes(typeSubstring)) {
      return { objectId, type: shortAddress(type) };
    }
  }
  return null;
}

/** Publish move/ and transfer the upgrade cap to the buyer. */
export async function publishPackage(client, keypair, moveDir = "move") {
  const tx = new Transaction();
  const cap = tx.publish({ modules: compiledModules(moveDir), dependencies: ["0x1", "0x2"] });
  tx.transferObjects([cap], keypair.toSuiAddress());
  const result = unpack(await signAndRun(client, keypair, tx));
  // The TreasuryCap type parameter embeds the fresh package id.
  const treasury = findCreatedType(result, "::coin::TreasuryCap<");
  if (!treasury) throw new Error("publish succeeded but TreasuryCap not found in tx objectTypes");
  const packageId = treasury.type.split("<")[1]?.split("::")[0];
  if (!packageId) throw new Error("could not parse packageId from TreasuryCap type");
  return { packageId, treasuryId: treasury.objectId, digest: result.digest };
}

/** Readiness phase: mint MYRC / fund from real stablecoin, create + fund escrow, create AuthorityCap. */
export async function runSetup(client, keypair, config, opts = {}) {
  const { escrowId, authorityId, digest, stablecoin } = await setupEscrow(client, keypair, config, opts);
  config.escrowId = escrowId;
  config.authorityId = authorityId;
  config.buyer = keypair.toSuiAddress();
  config.setupDigest = digest;
  config.stablecoin = stablecoin;
  return config;
}

/**
 * Create a fresh escrow pool + authority. Nonces are keyed per escrow Table,
 * so callers that need clean replay state (the harness) spin their own pool
 * instead of reusing the demo escrow.
 *
 * Asset (two-track plan): localnet mints the MYRC demo coin; testnet funds
 * from the buyer's REAL Circle USDC (faucet coins — no treasury exists).
 * The escrow is SHARED (public_share_object): anyone may deposit (customer
 * top-ups, blueprint §4.4), while commit/settle/refund stay gated by the
 * buyer's AuthorityCap.
 */
export async function setupEscrow(client, keypair, config, {
  stablecoinFund = null, // human amount; defaults per network below
  maxPerVoucher = null // human; testnet defaults to the fund size
} = {}) {
  const asset = stablecoinConfig(config.network);
  const coinT = coinType(config);
  const buyer = keypair.toSuiAddress();
  const fundHuman = stablecoinFund
    ?? (asset.type ? Number(process.env.STABLECOIN_ESCROW_FUND ?? 12) : 2_000);
  const fundBase = toBaseUnits(fundHuman, asset.decimals);
  // Cap in BASE units: localnet default 500 MYRC = 50_000 sen (2 decimals).
  const maxBase = maxPerVoucher ?? (asset.type ? fundBase : toBaseUnits(500, asset.decimals));

  const tx = new Transaction();
  let funding;
  if (asset.type === null) {
    // Localnet: we own the TreasuryCap — mint the demo pool.
    funding = tx.moveCall({
      target: "0x2::coin::mint",
      typeArguments: [coinT],
      arguments: [tx.object(config.treasuryId), tx.pure.u64(fundBase)]
    });
  } else {
    // Testnet: real stablecoin — no treasury. tx.balance sources from the
    // buyer's ADDRESS BALANCE and/or owned coins (faucet coins may land as
    // either), so both forms fund the pool. Coin<T> for escrow::deposit.
    const { balance } = await client.getBalance({ owner: buyer, coinType: asset.type });
    if (Number(balance?.balance ?? 0) < fundBase) {
      throw new Error(
        `insufficient ${asset.name} for the pool: need ${fundBase} base units, buyer holds ` +
        `${balance?.balance ?? 0}. Request testnet ${asset.name} at faucet.circle.com ` +
        `(coins may land as address balances — tx.balance uses both) or lower STABLECOIN_ESCROW_FUND.`
      );
    }
    const fundingBalance = tx.balance({ type: asset.type, balance: String(fundBase) });
    funding = tx.moveCall({
      target: "0x2::coin::from_balance",
      typeArguments: [asset.type],
      arguments: [fundingBalance]
    });
  }
  const escrow = tx.moveCall({
    target: `${config.packageId}::escrow::new`,
    typeArguments: [coinT]
  });
  tx.moveCall({
    target: `${config.packageId}::escrow::deposit`,
    typeArguments: [coinT],
    arguments: [escrow, funding]
  });
  tx.moveCall({
    target: "0x2::transfer::public_share_object",
    typeArguments: [`${config.packageId}::escrow::Escrow<${coinT}>`],
    arguments: [escrow]
  });
  tx.moveCall({
    target: `${config.packageId}::authority::new_to_sender`,
    arguments: [tx.pure.u64(maxBase)]
  });
  const result = unpack(await signAndRun(client, keypair, tx));

  // Discover the fresh escrow/authority objects created by THIS transaction.
  const escrowObj = findCreatedType(result, "::escrow::Escrow");
  const authority = findCreatedType(result, "::authority::AuthorityCap");
  if (!escrowObj || !authority) {
    throw new Error("setup ran but escrow/authority objects not found in tx objectTypes");
  }
  return {
    escrowId: escrowObj.objectId,
    authorityId: authority.objectId,
    digest: result.digest,
    stablecoin: {
      type: coinT, name: asset.name, currency: asset.currency,
      decimals: asset.decimals, fund: fundBase, maxPerVoucher: maxBase
    }
  };
}

/** Fresh objects are not queryable for a moment after their tx — poll for them. */
export async function waitForObject(client, objectId, { tries = 30, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await client.getObject({ objectId });
      if (r?.objectId ?? r?.object?.objectId) return true;
    } catch {
      // not indexed yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function utf8Vector(tx, s) {
  return tx.pure.vector("u8", Array.from(Buffer.from(s, "utf8")));
}
function rawVector(tx, u8) {
  return tx.pure.vector("u8", Array.from(u8));
}

/** escrow::commit — on-chain dual ed25519 verification + nonce lock. */
export async function commitVoucher(client, keypair, config, voucher) {
  const tx = buildCommitVoucherTx(config, voucher);
  return signAndRun(client, keypair, tx);
}

/** escrow::commit_as_buyer — zkLogin buyer-direct path (no AuthorityCap;
    the buyer hands in their own payment Coin inside the same PTB).
    `paymentCoinId` = one of the buyer's own stablecoin coin objects. The
    buyer's coin may hold MORE than the voucher amount (any top-up size), so
    the PTB splits exactly `amount` out of it — the remainder stays in their
    wallet. (The Move side asserts coin::value(payment) == amount, so a
    pre-exact coin is neither required nor assumed.) */
export function buildCommitAsBuyerTx(config, voucher, paymentCoinId) {
  const coinT = coinType(config);
  if (!paymentCoinId) {
    throw new Error(
      "paymentCoinId required — the buyer wallet has no stablecoin coin object; fund it via POST /v1/fund first"
    );
  }
  const tx = new Transaction();
  const payment = tx.splitCoins(tx.object(paymentCoinId), [tx.pure.u64(voucher.amount)])[0];
  tx.moveCall({
    target: `${config.packageId}::escrow::commit_as_buyer`,
    typeArguments: [coinT],
    arguments: [
      tx.object(config.escrowId),
      tx.object(SUI_CLOCK_ID),
      utf8Vector(tx, voucher.incidentId),
      utf8Vector(tx, voucher.providerId),
      tx.pure.u64(voucher.amount), // TOTAL = plan + platform fee
      tx.pure.u64(voucher.expiryMs),
      utf8Vector(tx, voucher.nonce),
      tx.pure.address(voucher.providerAddress),
      tx.pure.address(voucher.platformAddress),
      tx.pure.u64(voucher.platformFee),
      rawVector(tx, voucher.buyerMsg),
      rawVector(tx, voucher.buyerSig),
      rawVector(tx, voucher.buyerPk),
      rawVector(tx, voucher.providerMsg),
      rawVector(tx, voucher.providerSig),
      rawVector(tx, voucher.providerPk),
      payment
    ]
  });
  return tx;
}

export function buildCommitVoucherTx(config, voucher) {
  const coinT = coinType(config);
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::commit`,
    typeArguments: [coinT],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      tx.object(SUI_CLOCK_ID),
      utf8Vector(tx, voucher.incidentId),
      utf8Vector(tx, voucher.providerId),
      tx.pure.u64(voucher.amount), // TOTAL = plan + platform fee
      tx.pure.u64(voucher.expiryMs),
      utf8Vector(tx, voucher.nonce),
      tx.pure.address(voucher.providerAddress),
      tx.pure.address(voucher.platformAddress),
      tx.pure.u64(voucher.platformFee),
      rawVector(tx, voucher.buyerMsg),
      rawVector(tx, voucher.buyerSig),
      rawVector(tx, voucher.buyerPk),
      rawVector(tx, voucher.providerMsg),
      rawVector(tx, voucher.providerSig),
      rawVector(tx, voucher.providerPk)
    ]
  });
  return tx;
}

export async function settleVoucher(client, keypair, config, voucher) {
  const coinT = coinType(config);
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::settle`,
    typeArguments: [coinT],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      utf8Vector(tx, voucher.nonce)
    ]
  });
  return signAndRun(client, keypair, tx);
}

export async function refundVoucher(client, keypair, config, voucher) {
  const coinT = coinType(config);
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::refund`,
    typeArguments: [coinT],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      utf8Vector(tx, voucher.nonce)
    ]
  });
  return signAndRun(client, keypair, tx);
}

/** escrow::verify — record the deterministic delivery verdict on-chain. */
export async function verifyDeliveryOnChain(client, keypair, config, { nonce, logDigest, penalty }) {
  const coinT = coinType(config);
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::verify`,
    typeArguments: [coinT],
    arguments: [
      tx.object(config.escrowId),
      tx.object(config.authorityId),
      utf8Vector(tx, nonce),
      rawVector(tx, logDigest),
      tx.pure.u64(penalty)
    ]
  });
  return signAndRun(client, keypair, tx);
}

export async function reclaimVoucher(client, keypair, config, nonce) {
  const coinT = coinType(config);
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::escrow::reclaim`,
    typeArguments: [coinT],
    arguments: [tx.object(config.escrowId), utf8Vector(tx, nonce)]
  });
  return signAndRun(client, keypair, tx);
}

export async function signAndRun(client, keypair, tx) {
  const raw = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    include: { effects: true, events: true, objectTypes: true }
  });
  const result = unpack(raw);
  const status = result.status ?? { success: false, error: { message: "no status in response" } };
  if (!status.success) {
    const message = typeof status.error === "string"
      ? status.error
      : (status.error?.message ?? JSON.stringify(status.error));
    const err = new Error(message);
    err.digest = result.digest;
    throw err;
  }
  // gRPC nodes index objects asynchronously: a tx that mutates an object we
  // use next (escrow → settle) must be awaited, or the next build's
  // simulation resolves a stale object version and aborts "not found".
  await client.waitForTransaction({ digest: result.digest }).catch(() => {});
  return result;
}

export async function queryEscrowEvents(client, config, { limit = 200 } = {}) {
  // gRPC v2 filter format: "package::module" (the old JSON-RPC MoveModule
  // object shape is rejected by the ledger service).
  const { events } = await client.listEvents({
    filter: { emitModule: `${config.packageId}::escrow` },
    limit
  });
  return events;
}
