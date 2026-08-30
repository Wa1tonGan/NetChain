// Gasless stablecoin payments (Sui Track 01 — docs.sui.io/develop/
// transaction-payment/gasless-stablecoin-transfers): allowlisted stablecoins
// (USDC) move peer-to-peer with gasPrice = 0 and NO gas coin — the sender
// needs zero SUI. Constraint: the PTB must stay a pure transfer
// (balance::send_funds family, no object writes), so this is the customer
// top-up rail; escrow app-calls use sponsored transactions instead.
// Caveats encoded below: minimum transfer 0.01 (protocol), congested networks
// deprioritize gasless txs, issuer blacklists (Circle DenyList) can reject.
import { Transaction } from "@mysten/sui/transactions";
import { unpack } from "./client.js";

/** PTB for a gasless stablecoin transfer (pure send_funds — no object writes). */
export function buildGaslessTransferTx({ coinType, recipient, amountBase }) {
  const tx = new Transaction();
  tx.moveCall({
    target: "0x2::balance::send_funds",
    typeArguments: [coinType],
    arguments: [
      tx.balance({ type: coinType, balance: String(amountBase) }),
      tx.pure.address(recipient)
    ]
  });
  return tx;
}

/**
 * Execute a gasless transfer. The gRPC client detects eligibility during
 * simulation and sets gasPrice = 0 / gasBudget = 0 automatically.
 */
export async function gaslessSend(client, keypair, { coinType, recipient, amountBase }) {
  const tx = buildGaslessTransferTx({ coinType, recipient, amountBase });
  const result = unpack(await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    include: { effects: true }
  }));
  const status = result.status ?? {};
  if (!status.success) {
    throw new Error(`gasless transfer failed: ${JSON.stringify(status.error)}`);
  }
  await client.waitForTransaction({ digest: result.digest }).catch(() => {});
  return result;
}

/** Normal (gassed) coin transfer — used to fund a customer wallet. */
export async function sendCoin(client, keypair, { coinType, recipient, amountBase }) {
  const tx = new Transaction();
  const balance = tx.balance({ type: coinType, balance: String(amountBase) });
  const coin = tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [coinType],
    arguments: [balance]
  });
  tx.transferObjects([coin], recipient);
  const result = unpack(await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    include: { effects: true }
  }));
  const status = result.status ?? {};
  if (!status.success) {
    throw new Error(`coin transfer failed: ${JSON.stringify(status.error)}`);
  }
  await client.waitForTransaction({ digest: result.digest }).catch(() => {});
  return result;
}

/** Sum of gas charges in a tx result — 0 proves a transfer was gasless. */
export function gasUsedTotal(result) {
  let found = null;
  const visit = (o) => {
    if (!o || typeof o !== "object" || found) return;
    if ("computationCost" in o) { found = o; return; }
    for (const v of Object.values(o)) visit(v);
  };
  visit(result);
  if (!found) return null;
  return (
    BigInt(found.computationCost ?? 0) +
    BigInt(found.storageCost ?? 0) -
    BigInt(found.storageRebate ?? 0)
  );
}
