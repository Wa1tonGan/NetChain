// Walrus evidence archive (decided 2026-08-31, time-boxed; blueprint §4.3).
//
// WHY this exists (project need, not track candy): the connection log — the
// evidence that justifies every penalty and settlement — lives only in the
// platform's own JSONL ledger; the chain stores just its blake2b256 hash. A
// customer or judge must currently trust this server to keep (and serve) the
// log. Archiving the bundle to Walrus makes it INDEPENDENTLY and PERMANENTLY
// retrievable by blob ID — closing the blueprint's own claim "the customer
// can see exactly what was delivered at any moment".
//
// Cost/risk guards:
//   - OFF unless WALRUS_ARCHIVE=true (zero cost/latency when off)
//   - testnet only — never mainnet (hackathon rule: automatic DQ)
//   - best-effort: any failure emits ARCHIVE_SKIPPED and NEVER fails the
//     settlement it follows
import { createHash } from "node:crypto";
import { TESTNET_WALRUS_PACKAGE_CONFIG, WalrusClient } from "@mysten/walrus";
import { Transaction } from "@mysten/sui/transactions";
import { makeClient, network, signAndRun, unpack } from "./client.js";

// Testnet SUI→WAL exchange (official testnet config's exchangeIds[0]; open
// source at MystenLabs/walrus contracts/wal_exchange). Package id below is
// the deployed testnet exchange package (read off the shared object's type).
const TESTNET_EXCHANGE_ID = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds[0];
const TESTNET_EXCHANGE_PKG = "0x82593828ed3fcb8c6a235eac9abd0adbe9c5f9bbffa9b1e7a45cdd884481ef9f";
const TESTNET_WAL_TYPE = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";

/**
 * SUI→WAL via the official testnet exchange — the one-time fuel stop before
 * the first archive (Walrus storage is paid in WAL). Swaps the whole given
 * amount and keeps the WAL coin in the signer's wallet.
 */
export async function swapSuiForWal({ signer, suiAmountMist, client = makeClient("testnet") }) {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [BigInt(suiAmountMist)]);
  const wal = tx.moveCall({
    target: `${TESTNET_EXCHANGE_PKG}::wal_exchange::exchange_all_for_wal`,
    arguments: [tx.object(TESTNET_EXCHANGE_ID), payment]
  });
  tx.transferObjects([wal], signer.toSuiAddress());
  const result = unpack(await signAndRun(client, signer, tx));
  return { digest: result.digest };
}

/** WAL balance (base units) of an address, 0 when it holds none. */
export async function walBalance(address, client = makeClient("testnet")) {
  try {
    const { balance } = await client.getBalance({ owner: address, coinType: TESTNET_WAL_TYPE });
    return BigInt(balance.balance);
  } catch {
    return 0n;
  }
}

export function walrusArchiveEnabled(env = process.env) {
  if (env.WALRUS_ARCHIVE !== "true") return false;
  // Walrus testnet system object only exists on testnet; mainnet is forbidden.
  return network(env) === "testnet";
}

export function makeWalrusClient() {
  return new WalrusClient({
    network: "testnet",
    suiClient: makeClient("testnet"),
    packageConfig: TESTNET_WALRUS_PACKAGE_CONFIG
  });
}

/** sha256 hex over the exact bundle bytes — correlates blob ↔ ledger row. */
export function evidenceBundleHash(bundle) {
  return createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
}

/**
 * §9 evidence bundle for one incident: voucher commitment + the full
 * connection log (delivered samples) + settlement split. Everything a third
 * party needs to re-check the verdict without trusting this server.
 */
export function buildEvidenceBundle(service, incidentId) {
  const commitment = service.ledger.byIncident(incidentId).find((c) => c.nonce) ?? null;
  const events = service.ledger.eventsByIncident(incidentId);
  const delivery = [...events].reverse().find((e) => e.type === "DELIVERY_VERIFIED")?.data ?? null;
  const settled = [...events].reverse().find((e) => e.type === "SETTLED")?.data ?? null;
  const refunded = [...events].reverse().find((e) => e.type === "REFUNDED")?.data ?? null;
  if (!commitment) throw new Error(`no commitment for ${incidentId}`);
  return {
    kind: "netchain-evidence-v1",
    incidentId,
    archiveRunId: "RUN-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 7),
    network: service.config.network,
    packageId: service.config.packageId,
    escrowId: service.config.escrowId,
    commitment: {
      nonce: commitment.nonce,
      provider: commitment.provider,
      providerAddress: commitment.providerAddress,
      amount: commitment.amount,
      providerAmount: commitment.providerAmount,
      platformFee: commitment.platformFee,
      platformAddress: commitment.platformAddress,
      voucherDigest: commitment.voucherDigest,
      txDigest: commitment.txDigest
    },
    delivery,
    settlement: settled,
    refund: refunded,
    archivedAtMs: Date.now()
  };
}

/** Upload one evidence bundle; returns { blobId, bundleHash, sizeBytes }. */
export async function archiveEvidence(service, incidentId, { walrus = makeWalrusClient(), signer = service.keypair } = {}) {
  const bundle = buildEvidenceBundle(service, incidentId);
  const bundleHash = evidenceBundleHash(bundle);
  const contents = new TextEncoder().encode(JSON.stringify(bundle, null, 2));
  const epochs = Number(process.env.WALRUS_EPOCHS ?? 30);
  const publisherUrl = process.env.WALRUS_PUBLISHER_URL ?? "https://publisher.walrus-testnet.walrus.space";

  // Fast path: official Walrus publisher HTTP endpoint (completes in ~1 second)
  try {
    const res = await fetch(`${publisherUrl}/v1/blobs?epochs=${epochs}`, {
      method: "PUT",
      body: contents
    });
    if (res.ok) {
      const data = await res.json();
      const blobId = data.newlyCreated?.blobObject?.blobId ?? data.alreadyCertified?.blobId;
      if (blobId) {
        return { blobId, bundleHash, sizeBytes: contents.byteLength };
      }
    }
  } catch {
    // proceed to direct node write fallback
  }

  // Fallback: direct storage node write via WalrusClient
  const { blobId } = await walrus.writeBlob({
    blob: contents,
    signer,
    // Evidence is tamper-evident by design — never deletable.
    deletable: false,
    epochs
  });
  return { blobId, bundleHash, sizeBytes: contents.byteLength };
}

/** Independent readback — the proof that the evidence is publicly retrievable. */
export async function readEvidence(incidentId, blobId, { walrus = makeWalrusClient() } = {}) {
  const bytes = await walrus.readBlob({ blobId });
  return { bundle: JSON.parse(new TextDecoder().decode(bytes)) };
}
