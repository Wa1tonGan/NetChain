// Trust service orchestration: consumes Selected Offers from Person 2,
// returns commitment/settlement status, publishes reliability events.
// Shared by the CLI (`npm run trust -- …`) and the optional HTTP server.
// All idempotency is two-layer: this registry (rebuilt from the ledger on
// restart) short-circuits duplicates; the chain aborts same-nonce/different-
// bytes replays and no-ops byte-identical ones (defense in depth).
import { EventLedger } from "./events.js";
import { loadConfig, makeClient, buyerKeypair, commitVoucher, settleVoucher, refundVoucher, reclaimVoucher } from "./client.js";
import { buildVoucher, VoucherError } from "./voucher.js";

export class TrustService {
  constructor({ ledger = new EventLedger(), config = loadConfig(), paths = defaultPaths() } = {}) {
    this.ledger = ledger;
    this.config = config;
    this.paths = paths;
    if (!config?.packageId) {
      throw new Error("no .sui/config.json — run npm run sui:setup first");
    }
    this.client = makeClient(config.network);
    this.keypair = buyerKeypair(paths.keysDir);
  }

  pathsFor() {
    const { providers, buyer } = this.config;
    return { ...this.paths, providerAddresses: providers, buyerAddress: buyer };
  }

  /** Commit a Selected Offer (object or file path). Idempotent by nonce. */
  async commit(selectedOffer) {
    const existing = this.ledger.lookup(selectedOffer.agreement?.nonce);
    if (existing) {
      this.ledger.emit("DUPLICATE_BLOCKED", {
        incidentId: existing.incidentId,
        nonce: existing.nonce,
        data: { reason: "nonce already has a commitment", status: existing.status }
      });
      return { status: existing.status, duplicate: true, commitment: existing };
    }

    let voucher;
    try {
      voucher = buildVoucher(selectedOffer, this.pathsFor());
    } catch (err) {
      const code = err instanceof VoucherError ? err.code : "VOUCHER_INVALID";
      this.ledger.emit("VERIFICATION_FAILED", {
        incidentId: selectedOffer.incidentId,
        nonce: selectedOffer.agreement?.nonce ?? null,
        data: { code, message: err.message }
      });
      err.code = code;
      throw err;
    }
    this.ledger.emit("VERIFIED", {
      incidentId: voucher.incidentId,
      nonce: voucher.nonce,
      data: { provider: voucher.providerId, amount: voucher.amount, verifiedAtMs: voucher.verifiedAtMs }
    });

    const result = await commitVoucher(this.client, this.keypair, this.config, voucher);
    const committedEvent = result.events?.find((e) => e.json?.idempotent !== undefined);
    const idempotent = committedEvent?.json?.idempotent ?? false;
    this.ledger.emit("COMMITTED", {
      incidentId: voucher.incidentId,
      nonce: voucher.nonce,
      txDigest: result.digest,
      data: {
        idempotent,
        amount: voucher.amount,
        provider: voucher.providerId,
        providerAddress: voucher.providerAddress,
        expiryMs: voucher.expiryMs
      }
    });
    return { status: "COMMITTED", duplicate: false, idempotent, txDigest: result.digest, voucher };
  }

  /** Activation result hook: AVAILABLE → settle; FAILED → refund. */
  async activation({ incidentId, status, recoveredCapacityMbps = null, confirmedAtMs = Date.now() }) {
    const commitments = this.ledger.byIncident(incidentId);
    const commitment = commitments.find((c) => c.status === "COMMITTED");
    if (!commitment) {
      throw new Error(`no COMMITTED voucher for ${incidentId} (have: ${commitments.map((c) => c.status).join(",") || "none"})`);
    }
    const voucherLike = { nonce: commitment.nonce };
    if (status === "AVAILABLE") {
      const result = await settleVoucher(this.client, this.keypair, this.config, voucherLike);
      this.ledger.emit("SETTLED", {
        incidentId, nonce: commitment.nonce, txDigest: result.digest,
        data: { amount: this.ledger.lookup(commitment.nonce)?.amount ?? null, recoveredCapacityMbps, confirmedAtMs }
      });
      return { status: "SETTLED", txDigest: result.digest };
    }
    if (status === "FAILED") {
      const result = await refundVoucher(this.client, this.keypair, this.config, voucherLike);
      this.ledger.emit("REFUNDED", {
        incidentId, nonce: commitment.nonce, txDigest: result.digest,
        data: { reason: "activation FAILED", confirmedAtMs }
      });
      return { status: "REFUNDED", txDigest: result.digest };
    }
    this.ledger.emit("ACTIVATION_OBSERVED", {
      incidentId, nonce: commitment.nonce, data: { status, confirmedAtMs }
    });
    return { status: "OBSERVED" };
  }

  async reclaim(nonce) {
    const result = await reclaimVoucher(this.client, this.keypair, this.config, nonce);
    const state = this.ledger.lookup(nonce);
    this.ledger.emit("RECLAIMED", {
      incidentId: state?.incidentId ?? null, nonce, txDigest: result.digest, data: {}
    });
    return { status: "RECLAIMED", txDigest: result.digest };
  }

  status(incidentId) {
    const commitments = this.ledger.byIncident(incidentId);
    return { incidentId, commitments, escrow: { id: this.config.escrowId, network: this.config.network } };
  }
}

export function defaultPaths() {
  return {
    offersDir: "fixtures/offers",
    providersDir: "fixtures/providers",
    keysDir: "fixtures/keys"
  };
}
