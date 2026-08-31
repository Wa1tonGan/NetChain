#!/usr/bin/env node
// Walrus evidence archive proof (blueprint §4.3): archive the latest settled
// incident's evidence bundle to Walrus (if not archived yet), then READ IT
// BACK independently — proving the connection log + voucher + settlement
// split are publicly retrievable by blob ID without trusting this server.
//
//   WALRUS_ARCHIVE=true SUI_NETWORK=testnet npm run walrus:proof
//   WALRUS_ARCHIVE=true SUI_NETWORK=testnet WALRUS_INCIDENT=INC-… npm run walrus:proof
//
// Ledger searched (first that exists): events/integration-<net>.jsonl,
// events/harness-<net>.jsonl, events/reliability-events.jsonl.
import { existsSync, readFileSync } from "node:fs";
import { EventLedger } from "../src/sui/events.js";
import { loadConfig, buyerKeypair, ensureGas, configPath } from "../src/sui/client.js";
import {
  archiveEvidence,
  evidenceBundleHash,
  makeWalrusClient,
  readEvidence,
  swapSuiForWal,
  walBalance,
  walrusArchiveEnabled
} from "../src/sui/walrus.js";
import { TrustService } from "../src/sui/service.js";

const net = process.env.SUI_NETWORK ?? "localnet";

function pickLedger() {
  for (const name of [`events/integration-${net}.jsonl`, `events/harness-${net}.jsonl`, "events/reliability-events.jsonl"]) {
    if (existsSync(name)) return name;
  }
  throw new Error(`no ledger file found for ${net} — run the harness or an integrated loop first`);
}

function latestSettledIncident(ledgerPath) {
  const rows = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const settled = rows.filter((r) => r.type === "SETTLED" && r.incidentId);
  if (settled.length === 0) throw new Error(`no SETTLED incidents in ${ledgerPath}`);
  return settled[settled.length - 1].incidentId;
}

async function main() {
  if (!walrusArchiveEnabled()) {
    console.error("[walrus] disabled — set WALRUS_ARCHIVE=true SUI_NETWORK=testnet (testnet only, never mainnet)");
    process.exit(2);
  }
  const ledgerPath = pickLedger();
  const incidentId = process.env.WALRUS_INCIDENT ?? latestSettledIncident(ledgerPath);
  console.log(`[walrus] network=${net} ledger=${ledgerPath} incident=${incidentId}`);

  const ledger = new EventLedger(ledgerPath);
  const service = new TrustService({ ledger, config: loadConfig(configPath(net)) });
  await ensureGas(service.client, service.keypair);

  // Walrus storage is paid in WAL — one-time fuel stop via the official
  // testnet SUI→WAL exchange when the buyer holds less than ~0.05 WAL.
  const signerAddress = service.keypair.toSuiAddress();
  const wal = await walBalance(signerAddress);
  if (wal < 50_000_000n) {
    const { digest } = await swapSuiForWal({ signer: service.keypair, suiAmountMist: 200_000_000n });
    console.log(`[walrus] swapped 0.2 SUI → WAL (tx ${digest}); balance now ${await walBalance(signerAddress)} base units`);
  }

  const walrus = makeWalrusClient();
  const already = ledger.eventsByIncident(incidentId).find((e) => e.type === "ARCHIVED");

  let blobId;
  let bundleHash;
  if (already) {
    ({ blobId, bundleHash } = already.data);
    console.log(`[walrus] already archived → readback only (blob ${blobId.slice(0, 20)}…)`);
  } else {
    const result = await archiveEvidence(service, incidentId, { walrus });
    blobId = result.blobId;
    bundleHash = result.bundleHash;
    ledger.emit("ARCHIVED", {
      incidentId,
      nonce: ledger.byIncident(incidentId)[0]?.nonce ?? null,
      data: { blobId, bundleHash, sizeBytes: result.sizeBytes }
    });
    console.log(`[walrus] ARCHIVED ${result.sizeBytes} B → blob ${blobId}`);
  }

  console.log(`[walrus] readback (independent retrieval)…`);
  const { bundle } = await readEvidence(incidentId, blobId, { walrus });
  const roundTrip = evidenceBundleHash(bundle);
  console.log(`[walrus] bundle kind      ${bundle.kind}`);
  console.log(`[walrus] nonce            ${bundle.commitment?.nonce ?? "(none)"}`);
  console.log(`[walrus] voucher digest   ${bundle.commitment?.voucherDigest?.slice(0, 16)}…`);
  console.log(`[walrus] verdict recorded ${bundle.delivery?.verdict ?? "(no delivery row)"} (penalty ${bundle.delivery?.penaltyAmount ?? "n/a"})`);
  console.log(`[walrus] sha256(read)     ${roundTrip.slice(0, 16)}…`);
  console.log(`[walrus] sha256(archived) ${bundleHash.slice(0, 16)}…`);
  if (roundTrip !== bundleHash) {
    console.error("[walrus] FAIL — readback hash mismatch");
    process.exit(1);
  }
  console.log(`[walrus] PASS — evidence independently retrievable by blob ID:
  https://walruscan.com/testnet/blob/${blobId}`);
}

main().catch((err) => {
  console.error(`[walrus] FAILED: ${err.message}`);
  process.exit(1);
});
