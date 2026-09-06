import { readFileSync } from "node:fs";
import path from "node:path";
import { signBuyerAgreement, signOffer } from "../a2a/signing.js";
import { computeFeeSplit, feeConfigFromEnv } from "../a2a/fees.js";

/**
 * Creates a valid, signed SelectedOffer for Digi Fibre Air (PROVIDER-B)
 * with the target demo price (default 1.80 USDC), signed by both the provider
 * and buyer keys so it can be committed directly to the Sui Trust Layer.
 */
export function createDemoOffer({
  incidentId = `INC-DEMO-${Date.now().toString(36).toUpperCase()}`,
  price = 1.8,
  currency = "USD",
  capacityMbps = 500,
  durationMinutes = 30,
  rootDir = process.cwd()
} = {}) {
  const now = Date.now();
  const expiry = new Date(now + 300_000).toISOString();

  const originalOffer = {
    offerId: `OFF-${incidentId}-PROVIDER-B`,
    incidentId,
    providerId: "PROVIDER-B",
    available: true,
    capacityMbps,
    durationMinutes,
    expectedActivationClass: "FAST",
    expectedActivationTimeMs: 1500,
    activationLane: "STANDARD",
    price,
    currency,
    reliabilityScore: 0.999,
    latencyMs: 18,
    packetLossPercent: 0.0,
    offerExpiry: expiry,
    signature: { algorithm: "ed25519", keyId: "provider-b-demo", value: "" }
  };

  const providerKey = readFileSync(path.join(rootDir, "fixtures/keys/provider-b.private.pem"), "utf8");
  originalOffer.signature.value = signOffer(originalOffer, providerKey);

  const fees = feeConfigFromEnv();
  const feeSplit = computeFeeSplit(originalOffer.price, fees.platformFeePercent);

  const selectedOffer = {
    incidentId,
    customerId: "USER-RECOVERY-001",
    selectionMode: "NORMAL",
    selectedProvider: {
      providerId: "PROVIDER-B",
      brand: "Digi Fibre Air",
      offerId: originalOffer.offerId,
      capacityMbps,
      expectedActivationClass: "FAST",
      expectedActivationTimeMs: 1500,
      activationLane: "STANDARD",
      price,
      currency,
      reliabilityScore: 0.999,
      latencyMs: 18,
      packetLossPercent: 0.0
    },
    agreement: {
      ...feeSplit,
      platformFeePercent: fees.platformFeePercent,
      platformAddress: fees.platformAddress,
      currency,
      durationMinutes,
      nonce: `${incidentId}:PROVIDER-B:${Date.now()}`,
      expiry
    },
    signatures: {
      offerSignature: originalOffer.signature,
      buyerSignature: {
        algorithm: "ed25519",
        keyId: "buyer-demo",
        value: ""
      }
    },
    originalOffer,
    rejectedOffers: [
      { providerId: "PROVIDER-A", reason: "RANKED_BELOW", detail: "USDC 2.20 > USDC 1.80" },
      { providerId: "PROVIDER-C", reason: "RANKED_BELOW", detail: "USDC 1.95 > USDC 1.80" }
    ],
    timing: { tDetect: now, tDecide: now + 6500 }
  };

  const buyerKey = readFileSync(path.join(rootDir, "fixtures/keys/buyer.private.pem"), "utf8");
  selectedOffer.signatures.buyerSignature.value = signBuyerAgreement(selectedOffer, buyerKey);

  return selectedOffer;
}
