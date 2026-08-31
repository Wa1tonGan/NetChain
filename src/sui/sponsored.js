// Sponsored transactions (Sui Track 01/02 helpful feature): the CUSTOMER or
// agent signs the intent; the PLATFORM's gas wallet pays the SUI gas. This is
// the rail for app-call flows (escrow deposits) where the sender holds only
// the stablecoin — pure transfers skip gas entirely via gasless.js instead.
//
// Two-identity signing: the transaction bytes are built with the customer as
// sender, then signed by BOTH the customer (intent) and the sponsor (gas).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { coinType, unpack } from "./client.js";

const SPONSOR_FUND_MIST = 100_000_000n; // 0.1 SUI — dozens of sponsored txs

/** Lazy platform gas wallet per network (gitignored .sui/), funded by the buyer. */
export async function loadOrCreateSponsor(client, buyerKeypair, network) {
  const file = path.resolve(`.sui/sponsor.${network}.key.json`);
  if (existsSync(file)) {
    const { secretKey, address } = JSON.parse(readFileSync(file, "utf8"));
    return { keypair: Ed25519Keypair.fromSecretKey(secretKey), address, created: false };
  }
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  const tx = new Transaction();
  tx.transferObjects([tx.splitCoins(tx.gas, [SPONSOR_FUND_MIST])[0]], address);
  const result = unpack(await client.signAndExecuteTransaction({
    signer: buyerKeypair,
    transaction: tx,
    include: { effects: true }
  }));
  const status = result.status ?? {};
  if (!status.success) throw new Error(`sponsor funding failed: ${JSON.stringify(status.error)}`);
  await client.waitForTransaction({ digest: result.digest }).catch(() => {});
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ secretKey: keypair.getSecretKey(), address }, null, 2)}\n`);
  return { keypair, address, created: true };
}

/**
 * Customer deposits stablecoin into the SHARED escrow; the sponsor pays gas.
 * The customer needs zero SUI — only the stablecoin being deposited. The gas
 * coin is the SPONSOR's (setGasOwner + setGasPayment), so the SDK never tries
 * to select gas from the sender's (empty) balance.
 */
export async function sponsoredDeposit({ client, customerKeypair, sponsorKeypair, config, amountBase }) {
  const coinT = coinType(config);
  const sponsorAddress = sponsorKeypair.toSuiAddress();
  const { objects: sponsorCoins } = await client.listCoins({
    owner: sponsorAddress,
    coinType: "0x2::sui::SUI"
  });
  if (!sponsorCoins?.length) {
    throw new Error(`sponsor ${sponsorAddress} has no SUI gas coin — fund it first`);
  }
  const tx = new Transaction();
  tx.setSender(customerKeypair.toSuiAddress());
  tx.setGasOwner(sponsorAddress);
  tx.setGasPayment([{
    objectId: sponsorCoins[0].objectId,
    version: sponsorCoins[0].version,
    digest: sponsorCoins[0].digest
  }]);
  const balance = tx.balance({ type: coinT, balance: String(amountBase) });
  const coin = tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [coinT],
    arguments: [balance]
  });
  tx.moveCall({
    target: `${config.packageId}::escrow::deposit`,
    typeArguments: [coinT],
    arguments: [tx.object(config.escrowId), coin]
  });
  const bytes = await tx.build({ client });
  const senderSig = (await customerKeypair.signTransaction(bytes)).signature;
  const sponsorSig = (await sponsorKeypair.signTransaction(bytes)).signature;
  const result = unpack(await client.executeTransaction({
    transaction: bytes, // raw BCS bytes — the gRPC layer base64-decodes only the signatures
    signatures: [senderSig, sponsorSig],
    include: { effects: true }
  }));
  const status = result.status ?? {};
  if (!status.success) {
    throw new Error(`sponsored deposit failed: ${JSON.stringify(status.error)}`);
  }
  await client.waitForTransaction({ digest: result.digest }).catch(() => {});
  return result;
}
