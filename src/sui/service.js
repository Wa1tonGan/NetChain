// Trust service orchestration: consumes Selected Offers from Person 2,
// returns commitment/settlement status, publishes reliability events.
// Shared by the CLI (`npm run trust -- …`) and the optional HTTP server.
// All idempotency is two-layer: this registry (rebuilt from the ledger on
// restart) short-circuits duplicates; the chain aborts same-nonce/different-
// bytes replays and no-ops byte-identical ones (defense in depth).
import { EventLedger } from "./events.js";
import { loadConfig, makeClient, buyerKeypair, platformKeypair, commitVoucher, settleVoucher, refundVoucher, reclaimVoucher, verifyDeliveryOnChain, buildCommitAsBuyerTx } from "./client.js";
import { sendCoin } from "./gasless.js";
import { buildVoucher, VoucherError } from "./voucher.js";
import { checkDelivery, connectionLog, connectionLogDigest } from "./verify.js";

export class TrustService {
  constructor({ ledger = new EventLedger(), config = loadConfig(), paths = defaultPaths() } = {}) {
    this.ledger = ledger;
    this.config = config;
    this.paths = paths;
    if (!config?.packageId) {
      throw new Error("no .sui/config.json — run npm run sui:setup first");
    }
    this.client = makeClient(config.network);
    // Operator key for settle/refund/verify (AuthorityCap holder). The
    // buyer-side key/env is retired from the product path: commitments are
    // signed by the zkLogin user (commit_as_buyer) or the demo cap path.
    this.keypair = platformKeypair() ?? buyerKeypair(paths.keysDir);
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
      data: {
        provider: voucher.providerId,
        amount: voucher.amount,
        platformFee: voucher.platformFee,
        verifiedAtMs: voucher.verifiedAtMs
      }
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
        providerAmount: voucher.providerAmount,
        platformFee: voucher.platformFee,
        platformAddress: voucher.platformAddress,
        // Same 32 bytes Move stores on-chain — correlates this row with the
        // on-chain Committed event (hex).
        voucherDigest: Buffer.from(voucher.voucherDigest).toString("hex"),
        provider: voucher.providerId,
        providerAddress: voucher.providerAddress,
        expiryMs: voucher.expiryMs
      }
    });
    return { status: "COMMITTED", duplicate: false, idempotent, txDigest: result.digest, voucher };
  }

  /**
   * zkLogin buyer-direct commit, step 1 (build-only): run every voucher
   * validation, then return the UNSIGNED commit_as_buyer PTB bytes for the
   * buyer to zk-sign in their browser. No key material leaves the user's
   * session; the service never sees a buyer signature over the tx.
   *
   * `buyerAddress` (the zkLogin user's Sui address, sent by the frontend)
   * is required: the PTB's sender must be the buyer so the SDK can resolve
   * gas from THEIR SUI coins and Move can record tx_context::sender as the
   * on-chain buyer. Never defaults to a platform/buyer fixture key.
   */
  async buildCommitForZkLogin(selectedOffer) {
    // Strip transport-only fields before schema validation (strict schema
    // rejects unknown keys): submit flag, the buyer's payment coin object,
    // and the buyer's zkLogin address.
    const { submit, paymentCoinId, buyerAddress, ...offer } = selectedOffer ?? {};
    if (!buyerAddress || !/^0x[0-9a-fA-F]{40,64}$/.test(buyerAddress)) {
      throw Object.assign(
        new Error("buyerAddress required — connect the zkLogin wallet first (the buyer must be the zk user, never a platform key)"),
        { code: "BUYER_ADDRESS_REQUIRED" }
      );
    }
    if (!paymentCoinId) {
      throw Object.assign(
        new Error(
          "paymentCoinId required — the zkLogin wallet has no USDC coin object. Fund it first (faucet transfer or POST /v1/fund), then retry the recovery"
        ),
        { code: "BUYER_NOT_FUNDED" }
      );
    }
    const existing = this.ledger.lookup(offer.agreement?.nonce);
    if (existing) {
      return { status: existing.status, duplicate: true, commitment: existing };
    }

    let voucher;
    try {
      voucher = buildVoucher(offer, this.pathsFor());
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
      data: {
        provider: voucher.providerId,
        amount: voucher.amount,
        platformFee: voucher.platformFee,
        verifiedAtMs: voucher.verifiedAtMs
      }
    });

    const tx = buildCommitAsBuyerTx(this.config, voucher, selectedOffer.paymentCoinId);
    tx.setSender(buyerAddress);
    const txBytes = await tx.build({ client: this.client });
    return {
      status: "BUILD_OK",
      voucher,
      buyerAddress,
      txBytes: Buffer.from(txBytes).toString("base64")
    };
  }

  /**
   * zkLogin commit, step 2 (confirm): the buyer submitted the zk-signed tx.
   * Verify the digest exists and carries our Committed event for this nonce,
   * then write the ledger row (same shape as the cap path).
   */
  async confirmZkCommit({ incidentId, nonce, txDigest, voucher }) {
    if (!txDigest) throw new Error("txDigest required");
    const existing = this.ledger.lookup(nonce);
    if (existing) {
      this.ledger.emit("DUPLICATE_BLOCKED", {
        incidentId: existing.incidentId,
        nonce: existing.nonce,
        data: { reason: "nonce already has a commitment", status: existing.status }
      });
      return { status: existing.status, duplicate: true, commitment: existing };
    }

    const result = await this.client.waitForTransaction({
      digest: txDigest,
      options: { showEvents: true, showEffects: true }
    });
    const committedEvent = result.events?.find(
      (e) => e.json?.idempotent !== undefined || (e.id?.name === "Committed" && e.json?.nonce)
    );
    const failed = result.effects?.status?.status !== "success";
    if (failed || !committedEvent) {
      this.ledger.emit("VERIFICATION_FAILED", {
        incidentId,
        nonce,
        txDigest,
        data: { code: "CHAIN_CONFIRM_FAILED", message: result.effects?.status?.error ?? "no Committed event" }
      });
      throw new Error("on-chain confirmation failed");
    }

    const idempotent = committedEvent.json?.idempotent ?? false;
    this.ledger.emit("COMMITTED", {
      incidentId,
      nonce,
      txDigest,
      data: {
        idempotent,
        amount: voucher?.amount,
        providerAmount: voucher?.providerAmount,
        platformFee: voucher?.platformFee,
        platformAddress: voucher?.platformAddress,
        buyer: committedEvent.json?.buyer,
        voucherDigest: voucher?.voucherDigest ? Buffer.from(voucher.voucherDigest).toString("hex") : undefined
      }
    });
    return { status: "COMMITTED", duplicate: false, idempotent, txDigest };
  }

  /**
   * Cold-start funding for zkLogin users: the platform key sends stablecoin
   * (+ optional SUI gas) to the user's wallet so they can pay their own
   * commit_as_buyer. Requires PLATFORM_SECRET; refuses silently otherwise.
   * Body: { address, stableBase?, suiMist? }
   */
  async fundUser({ address, stableBase = 0, suiMist = 0 }) {
    const platform = platformKeypair();
    if (!platform) {
      throw Object.assign(new Error("PLATFORM_SECRET not configured"), { code: "FUNDING_DISABLED" });
    }

    const results = {};
    if (stableBase > 0) {
      // Network money: MYRC (localnet demo coin) or the configured testnet
      // asset (real Circle USDC) — never hardcode the demo coin.
      const stableType = this.config.stablecoin?.type ?? `${this.config.packageId}::myrc::MYRC`;
      const stable = await sendCoin(this.client, platform, {
        coinType: stableType,
        recipient: address,
        amountBase: stableBase
      });
      results.stableTxDigest = stable.digest;
    }
    if (suiMist > 0) {
      const sui = await sendCoin(this.client, platform, {
        coinType: "0x2::sui::SUI",
        recipient: address,
        amountBase: suiMist
      });
      results.suiTxDigest = sui.digest;
    }

    this.ledger.emit("USER_FUNDED", {
      incidentId: null,
      nonce: `fund:${address}:${Date.now()}`,
      data: { address, stableBase, suiMist, ...results }
    });
    return { status: "FUNDED", ...results };
  }

  /**
   * Verification Agent hook (blueprint §4.3): run the deterministic tolerance
   * check over the session's delivered samples, then commit the verdict
   * (connection-log hash + penalty) ON-CHAIN before settlement. The penalty
   * is deducted from the PROVIDER share at settle; the buyer is compensated.
   */
  async verifyDelivery(incidentId, {
    promisedCapacity,
    deliveredSamples,
    sessionStart = null,
    sessionEnd = Date.now(),
    tolerancePercent = undefined
  }) {
    const commitments = this.ledger.byIncident(incidentId);
    const commitment = commitments.find((c) => c.status === "COMMITTED");
    if (!commitment) {
      throw new Error(`no COMMITTED voucher for ${incidentId} (have: ${commitments.map((c) => c.status).join(",") || "none"})`);
    }
    const check = checkDelivery({
      promisedCapacity,
      deliveredSamples,
      ...(tolerancePercent !== undefined ? { tolerancePercent } : {})
    });
    const providerAmount = commitment.providerAmount ?? 0;
    const penaltyAmount = Math.floor((providerAmount * check.penaltyPct) / 100);
    const log = connectionLog({
      incidentId,
      nonce: commitment.nonce,
      promisedCapacity,
      deliveredSamples,
      sessionStart,
      sessionEnd,
      tolerancePercent: check.tolerancePercent,
      shortfallPct: check.shortfallPct,
      verdict: check.verdict,
      penaltyAmount
    });
    const logDigest = connectionLogDigest(log);
    const result = await verifyDeliveryOnChain(this.client, this.keypair, this.config, {
      nonce: commitment.nonce,
      logDigest,
      penalty: penaltyAmount
    });
    const connectionLogHash = Buffer.from(logDigest).toString("hex");
    this.ledger.emit("DELIVERY_VERIFIED", {
      incidentId,
      nonce: commitment.nonce,
      txDigest: result.digest,
      data: {
        record: log,
        connectionLogHash,
        verdict: check.verdict,
        penaltyAmount,
        avgDeliveredMbps: check.avgDeliveredMbps,
        shortfallPct: check.shortfallPct
      }
    });
    return { status: "VERIFIED", verdict: check.verdict, penaltyAmount, connectionLogHash, connectionLog: log, txDigest: result.digest };
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
      const penaltyAmount = commitment.penaltyAmount ?? 0;
      this.ledger.emit("SETTLED", {
        incidentId, nonce: commitment.nonce, txDigest: result.digest,
        data: {
          amount: commitment.amount,
          providerAmount: commitment.providerAmount,
          providerNetAmount: (commitment.providerAmount ?? 0) - penaltyAmount,
          penaltyAmount,
          platformFee: commitment.platformFee,
          platformAddress: commitment.platformAddress,
          recoveredCapacityMbps,
          confirmedAtMs
        }
      });
      await this.postSettlement(incidentId, "SETTLED", commitment.nonce, result.digest);
      return { status: "SETTLED", txDigest: result.digest, penaltyAmount };
    }
    if (status === "FAILED") {
      const result = await refundVoucher(this.client, this.keypair, this.config, voucherLike);
      this.ledger.emit("REFUNDED", {
        incidentId, nonce: commitment.nonce, txDigest: result.digest,
        data: { reason: "activation FAILED", confirmedAtMs }
      });
      await this.postSettlement(incidentId, "REFUNDED", commitment.nonce, result.digest);
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
    await this.postSettlement(state?.incidentId, "RECLAIMED", nonce, result.digest);
    return { status: "RECLAIMED", txDigest: result.digest };
  }

  /**
   * Person 2 default #4: push settlement status to their callback endpoint.
   * Fire-and-forget — a callback failure must never fail the settlement.
   */
  async postSettlement(incidentId, status, nonce, txDigest) {
    const url = this.config?.p2CallbackUrl ?? process.env.P2_CALLBACK_URL;
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId, status, nonce, txDigest, ts: Date.now() })
      });
      this.ledger.emit("CALLBACK_SENT", { incidentId, nonce, data: { status, url } });
    } catch (err) {
      this.ledger.emit("CALLBACK_FAILED", { incidentId, nonce, data: { status, url, error: err.message } });
    }
  }

  /**
   * Person 2 default #3: pull delivery — fetch their
   * `GET /incidents/:id/result` and commit whatever Selected Offer it holds.
   */
  async commitFromUrl(resultUrl) {
    const response = await fetch(resultUrl);
    if (!response.ok) throw new Error(`pull ${resultUrl} → ${response.status}`);
    const body = await response.json();
    const selected = body.selectedOffer ?? body.result?.selectedOffer ?? body;
    return this.commit(selected);
  }

  status(incidentId) {
    const commitments = this.ledger.byIncident(incidentId);
    return { incidentId, commitments, escrow: { id: this.config.escrowId, network: this.config.network } };
  }
}

export function defaultPaths() {
  return {
    offersDir: "fixtures/sui/offers",
    providersDir: "fixtures/providers",
    keysDir: "fixtures/keys"
  };
}
