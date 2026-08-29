// Selected Offer → Sui voucher. Verifies everything Person 2's contract
// demands off-chain (schema, both ed25519 signatures via their own signing.js,
// nonce/expiry/amount rules) and emits the exact arguments the Move
// escrow::commit call expects. The chain re-verifies both signatures — this
// module is the fast-fail front door, not the trust anchor.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  buyerAgreementPayload,
  canonicalBytes,
  offerSigningPayload,
  verifyBuyerSignature,
  verifyOfferSignature
} from "../a2a/signing.js";
import { selectedOfferSchema } from "../a2a/schemas/selectedOffer.js";
import { pemRawPublicKey } from "./keys.js";

export class VoucherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VoucherError";
    this.code = code; // mirrors documents/person3-trust-contract.md §5
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// The Selected Offer carries a projection of the winning offer; the provider
// signature covers the ORIGINAL offer minus its `signature` field, so we look
// the original up by offerId across the offers directory. (HTTP callers can
// pass the original offer directly instead.)
export function findOriginalOffer(offersDir, selectedOffer) {
  const offerId = selectedOffer.selectedProvider.offerId;
  for (const file of readdirSync(offersDir)) {
    if (!file.endsWith(".json")) continue;
    const offer = readJson(path.join(offersDir, file));
    if (offer.offerId === offerId) return offer;
  }
  throw new VoucherError(
    "OFFER_NOT_FOUND",
    `no offer fixture with offerId ${offerId} in ${offersDir}`
  );
}

export function loadProviderProfiles(providersDir) {
  const profiles = new Map();
  for (const file of readdirSync(providersDir)) {
    if (!file.endsWith(".json")) continue;
    const profile = readJson(path.join(providersDir, file));
    profiles.set(profile.providerId, profile);
  }
  return profiles;
}

function base64ToBytes(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * @param {object} selectedOffer - parsed Selected Offer JSON
 * @param {object} paths - { offersDir, providersDir, keysDir,
 *                           providerAddresses?, buyerAddress? }
 * @param {object} opts - { nowMs?: number } (clock override for tests)
 */
export function buildVoucher(selectedOffer, paths, opts = {}) {
  // 1. Schema (strict + cross-checks: amount==price, nonce prefix, timing).
  selectedOfferSchema.parse(selectedOffer);

  // 2. Currency: the demo MYRC asset settles integer MYR only.
  const { amount, currency } = selectedOffer.agreement;
  if (currency !== "MYR") {
    throw new VoucherError("UNSUPPORTED_CURRENCY", `escrow demo settles MYR, got ${currency}`);
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new VoucherError(
      "NON_INTEGRAL_AMOUNT",
      `MYRC has 0 decimals; agreement.amount must be an integer MYR value, got ${amount}`
    );
  }

  // 3. Provider signature off-chain, against the profile's embedded PEM.
  const originalOffer =
    opts.originalOffer ?? findOriginalOffer(paths.offersDir, selectedOffer);
  const profile = loadProviderProfiles(paths.providersDir).get(
    selectedOffer.selectedProvider.providerId
  );
  if (!profile) {
    throw new VoucherError(
      "UNKNOWN_PROVIDER",
      `no profile for ${selectedOffer.selectedProvider.providerId}`
    );
  }
  if (!verifyOfferSignature(originalOffer, profile.publicKey.value)) {
    throw new VoucherError("SIGNATURE_INVALID", "provider offerSignature failed verification");
  }

  // 4. Buyer (Rescue Agent) signature off-chain.
  const buyerPublicPem = readFileSync(path.join(paths.keysDir, "buyer.public.pem"), "utf8");
  if (!verifyBuyerSignature(selectedOffer, buyerPublicPem)) {
    throw new VoucherError("SIGNATURE_INVALID", "buyer buyerSignature failed verification");
  }

  // 5. Expiry against the service clock (the on-chain Clock re-checks).
  const expiryMs = Date.parse(selectedOffer.agreement.expiry);
  const nowMs = opts.nowMs ?? Date.now();
  if (!(expiryMs > nowMs)) {
    throw new VoucherError("VOUCHER_EXPIRED", `voucher expired at ${selectedOffer.agreement.expiry}`);
  }

  // 6. Assemble Move commit arguments: two (msg, sig, pk) triples + terms.
  return {
    incidentId: selectedOffer.incidentId,
    customerId: selectedOffer.customerId,
    selectionMode: selectedOffer.selectionMode,
    providerId: selectedOffer.selectedProvider.providerId,
    brand: selectedOffer.selectedProvider.brand,
    offerId: selectedOffer.selectedProvider.offerId,
    amount, // MYRC units (1 = 1 MYR)
    expiryMs,
    nonce: selectedOffer.agreement.nonce,
    buyerMsg: canonicalBytes(buyerAgreementPayload(selectedOffer)),
    buyerSig: base64ToBytes(selectedOffer.signatures.buyerSignature.value),
    buyerPk: pemRawPublicKey(buyerPublicPem),
    providerMsg: canonicalBytes(offerSigningPayload(originalOffer)),
    providerSig: base64ToBytes(originalOffer.signature.value),
    providerPk: pemRawPublicKey(profile.publicKey.value),
    providerAddress: paths.providerAddresses?.[selectedOffer.selectedProvider.providerId] ?? null,
    buyerAddress: paths.buyerAddress ?? null,
    verifiedAtMs: nowMs
  };
}
