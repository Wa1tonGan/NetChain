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
import { buildSlaClaimPayload, runSlaAudit } from "./truthLink.js";

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
        expiryMs: voucher.expiryMs,
        capacityMbps: selectedOffer?.selectedProvider?.capacityMbps ?? null,
        providerClaims: selectedOffer?.selectedProvider
          ? {
              reliabilityScore: selectedOffer.selectedProvider.reliabilityScore,
              latencyMs: selectedOffer.selectedProvider.latencyMs,
              packetLossPercent: selectedOffer.selectedProvider.packetLossPercent,
              expectedActivationTimeMs: selectedOffer.selectedProvider.expectedActivationTimeMs
            }
          : null,
        timing: { tDetectMs: selectedOffer?.timing?.tDetect ?? null }
      }
    });
    return { status: "COMMITTED", duplicate: false, idempotent, txDigest: result.digest, voucher };
  }

  /**
   * zkLogin buyer-direct commit, step 1 (build-only): run every voucher
   * validation, then return the UNSIGNED commit_as_buyer PTB bytes for the
   * buyer to zk-sign in their browser. No key material leaves the user's
   * session; the service never sees a buyer signature over the tx.
   */
  async buildCommitForZkLogin(selectedOffer) {
    // Strip transport-only fields before schema validation (strict schema
    // rejects unknown keys): submit flag + the buyer's zkLogin address.
    const { submit, buyerAddress, ...offer } = selectedOffer ?? {};
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

    let txBytes;
    try {
      const tx = buildCommitAsBuyerTx(this.config, voucher, buyerAddress);
      txBytes = await tx.build({ client: this.client });
    } catch (err) {
      // PTB build failures are deterministic buyer-side problems (missing
      // sender, unfunded balance, stale coin) — surface them as a coded 422
      // instead of the catch-all 500.
      throw Object.assign(new Error(`commit PTB build failed: ${err.message}`), {
        code: "COMMIT_BUILD_FAILED"
      });
    }
    return {
      status: "BUILD_OK",
      voucher,
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

    // gRPC client: JSON-RPC-style `options` is ignored by waitForTransaction
    // (returns null events) — `include` on getTransaction is the way to get
    // events + effects. Event shape here is {eventType, json, module, …}, so
    // match the Committed event by type suffix / json payload.
    const result = await this.client.getTransaction({
      digest: txDigest,
      include: { events: true, effects: true }
    });
    const tx = result.Transaction ?? result;
    const committedEvent = (tx.events ?? []).find(
      (e) => e.json?.idempotent !== undefined || String(e.eventType ?? "").endsWith("::escrow::Committed")
    );
    const failed = tx.status?.success === false;
    if (failed || !committedEvent) {
      this.ledger.emit("VERIFICATION_FAILED", {
        incidentId,
        nonce,
        txDigest,
        data: { code: "CHAIN_CONFIRM_FAILED", message: tx.status?.error ?? "no Committed event" }
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

    // Gas guard: every agent-mode commit/settle is signed (and gas-paid) by
    // the platform key — when its SUI runs dry the whole flow fails with
    // "insufficient SUI balance". Best-effort faucet top-up before funding.
    try {
      const platformAddr = platform.toSuiAddress();
      const sui = await this.client
        .getBalance({ owner: platformAddr, coinType: "0x2::sui::SUI" })
        .catch(() => null);
      // gRPC client nests: { balance: { balance } }; JSON-RPC: { totalBalance }
      const mist = Number(sui?.balance?.balance ?? sui?.totalBalance ?? 0);
      if (mist < 50_000_000) {
        const faucet = await import("@mysten/sui/faucet").catch(() => null);
        if (faucet?.requestSuiFromFaucetV2) {
          await faucet.requestSuiFromFaucetV2({
            host: faucet.getFaucetHost(this.config.network ?? "testnet"),
            recipient: platformAddr,
          });
          this.ledger.emit("OPERATOR_FUNDED", {
            incidentId: null,
            nonce: `faucet:${platformAddr}:${Date.now()}`,
            data: { note: "platform gas low — faucet top-up" }
          });
        }
      }
    } catch {
      // faucet rate-limited or offline — continue; the send may still succeed
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
    tolerancePercent = undefined,
    providerClaims = null,
    timing = null
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

    // Truth Agent SLA audit (Gonka multi-model) — independent layer, NEVER
    // load-bearing for money: fire-and-forget so settlement is not delayed,
    // result lands in the ledger as CLAIM_VERIFIED when the audit completes.
    // Failure here degrades to a FAILED/TIMEOUT audit event, never an error.
    void runSlaAudit(
      buildSlaClaimPayload({
        incidentId,
        nonce: commitment.nonce,
        brand: commitment.provider ?? null,
        promisedCapacity,
        deliveredSamples,
        check,
        providerClaims,
        timing
      })
    )
      .then((audit) =>
        this.ledger.emit("CLAIM_VERIFIED", {
          incidentId,
          nonce: commitment.nonce,
          data: {
            claimRunId: audit.claimRunId ?? null,
            status: audit.status,
            verdict: audit.verdict ?? null,
            score: audit.score ?? null,
            confidenceBand: audit.confidenceBand ?? null,
            agree: audit.agree ?? null,
            models: audit.models ?? [],
            durationMs: audit.durationMs ?? null,
            error: audit.error ?? null
          }
        })
      )
      .catch((err) => {
        this.ledger.emit("CLAIM_VERIFIED", {
          incidentId,
          nonce: commitment.nonce,
          data: { status: "FAILED", error: String(err?.message ?? err) }
        });
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

      // Truth Agent SLA audit: if verifyDelivery was not called first (e.g.
      // direct browser recovery flow), fire the multi-model audit now so
      // every settled incident receives its independent SLA audit card.
      const alreadyAudited = this.ledger.eventsByIncident(incidentId).some((e) => e.type === "CLAIM_VERIFIED");
      if (!alreadyAudited) {
        const promisedCapacity = commitment.capacityMbps ?? recoveredCapacityMbps ?? 500;
        const deliveredSamples = [recoveredCapacityMbps ?? promisedCapacity];
        const check = {
          verdict: "OK",
          avgDeliveredMbps: deliveredSamples[0],
          shortfallPct: 0,
          penaltyPct: 0,
          tolerancePercent: 10
        };
        const timing = {
          tDetectMs: commitment.timing?.tDetectMs ?? null,
          tRecoverMs: confirmedAtMs
        };
        void runSlaAudit(
          buildSlaClaimPayload({
            incidentId,
            nonce: commitment.nonce,
            brand: commitment.provider ?? null,
            promisedCapacity,
            deliveredSamples,
            check,
            providerClaims: commitment.providerClaims ?? null,
            timing
          })
        )
          .then((audit) =>
            this.ledger.emit("CLAIM_VERIFIED", {
              incidentId,
              nonce: commitment.nonce,
              data: {
                claimRunId: audit.claimRunId ?? null,
                status: audit.status,
                verdict: audit.verdict ?? null,
                score: audit.score ?? null,
                confidenceBand: audit.confidenceBand ?? null,
                agree: audit.agree ?? null,
                models: audit.models ?? [],
                durationMs: audit.durationMs ?? null,
                error: audit.error ?? null
              }
            })
          )
          .catch((err) => {
            this.ledger.emit("CLAIM_VERIFIED", {
              incidentId,
              nonce: commitment.nonce,
              data: { status: "FAILED", error: String(err?.message ?? err) }
            });
          });
      }
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
