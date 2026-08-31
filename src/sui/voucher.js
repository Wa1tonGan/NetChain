// Selected Offer → Sui voucher. Verifies everything Person 2's contract
// demands off-chain (schema, both ed25519 signatures via their own signing.js,
// nonce/expiry/amount rules) and emits the exact arguments the Move
// escrow::commit call expects. The chain re-verifies both signatures — this
// module is the fast-fail front door, not the trust anchor.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import {
  buyerAgreementPayload,
  canonicalBytes,
  offerSigningPayload,
  verifyBuyerSignature,
  verifyOfferSignature
} from "../a2a/signing.js";
import { selectedOfferSchema } from "../a2a/schemas/selectedOffer.js";
import { pemRawPublicKey } from "./keys.js";
import { stablecoinConfig, toBaseUnits } from "./stablecoin.js";

export class VoucherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VoucherError";
    this.code = code; // mirrors documents/person3-trust-contract.md §5
  }
}

// blake2b256 — the exact hash the Move commit stores as voucher_digest
// (hash::blake2b256 over the canonical buyer-agreement bytes). The JS ledger
// row carries the same digest in hex, so an off-chain row can be correlated
// with the on-chain Committed event byte for byte.
export function voucherDigest(bytes) {
  return blake2b(bytes, { dkLen: 32 });
}

/**
 * Platform fee config (blueprint §1.3): env-configurable % charged ON TOP of
 * the plan price and shown openly; providers keep their full quoted price
 * (§1.2). No PLATFORM_ADDRESS → fee 0 → settle pays the provider everything.
 */
export function platformFeeConfig() {
  const address = process.env.PLATFORM_ADDRESS ?? null;
  if (!address) return { address: null, percent: 0 };
  const percent = Number(process.env.PLATFORM_FEE_PERCENT ?? 5);
  return { address, percent };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// The Selected Offer carries a projection of the winning offer; the provider
// signature covers the ORIGINAL offer minus its `signature` field. Live
// envelopes embed the original offer (self-contained, no fixture lookup);
// fixture-era offers are looked up by offerId across the offers directory.
// Either way the offer must be the one the projection claims — providerId AND
// offerId must match selectedProvider (an embedded foreign offer with a valid
// signature from the same provider must not be committable).
export function resolveOriginalOffer(selectedOffer, offersDir, opts = {}) {
  const original = opts.originalOffer ?? selectedOffer.originalOffer ?? null;
  const { providerId, offerId } = selectedOffer.selectedProvider;
  if (original) {
    if (original.providerId !== providerId || original.offerId !== offerId) {
      throw new VoucherError(
        "OFFER_MISMATCH",
        `embedded originalOffer is ${original.providerId}/${original.offerId}, projection claims ${providerId}/${offerId}`
      );
    }
    return original;
  }
  for (const file of readdirSync(offersDir)) {
    if (!file.endsWith(".json")) continue;
    const offer = readJson(path.join(offersDir, file));
    if (offer.offerId === offerId && offer.providerId === providerId) return offer;
  }
  throw new VoucherError(
    "OFFER_NOT_FOUND",
    `no offer fixture with offerId ${offerId} in ${offersDir} (live envelopes must embed originalOffer)`
  );
}

// Kept for compatibility with existing callers/tests.
export function findOriginalOffer(offersDir, selectedOffer) {
  return resolveOriginalOffer(selectedOffer, offersDir);
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

  // 2. Asset + amounts: the network's configured stablecoin (localnet MYRC
  //    0 decimals; testnet real USDC 6 decimals). Money of record = integer
  //    BASE units. The fee is the buyer-SIGNED agreement.platformFee — the
  //    Rescue Agent approved exactly that split, so the service never
  //    recomputes it (P2's schema cross-checks fee == round2(planPrice × %)).
  const { planPrice, platformFee: signedFee, platformAddress: signedPlatformAddress, providerAmount: signedProviderAmount, currency } = selectedOffer.agreement;
  const asset = stablecoinConfig();
  if (currency !== asset.currency) {
    throw new VoucherError(
      "UNSUPPORTED_CURRENCY",
      `escrow settles ${asset.currency} (${asset.name}), got ${currency}`
    );
  }
  let planBase;
  try {
    planBase = toBaseUnits(planPrice, asset.decimals);
  } catch {
    throw new VoucherError(
      "NON_INTEGRAL_AMOUNT",
      `agreement.planPrice ${planPrice} exceeds ${asset.decimals}-decimal precision (${asset.currency})`
    );
  }
  const feeBase = toBaseUnits(signedFee ?? 0, asset.decimals);
  const providerBase = toBaseUnits(signedProviderAmount ?? planPrice, asset.decimals);

  // 3. Provider signature off-chain, against the profile's embedded PEM.
  const originalOffer = resolveOriginalOffer(selectedOffer, paths.offersDir, opts);
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
  //    All amounts are BASE units of the configured asset. The provider share
  //    stays the full signed quote; the platform fee is the buyer-signed one,
  //    charged on top (blueprint §3.3). On localnet (0 decimals) base == human.
  const feeCfg = platformFeeConfig();
  const buyerMsg = canonicalBytes(buyerAgreementPayload(selectedOffer));
  const providerMsg = canonicalBytes(offerSigningPayload(originalOffer));
  const providerAddress = paths.providerAddresses?.[selectedOffer.selectedProvider.providerId] ?? null;
  return {
    incidentId: selectedOffer.incidentId,
    customerId: selectedOffer.customerId,
    selectionMode: selectedOffer.selectionMode,
    providerId: selectedOffer.selectedProvider.providerId,
    brand: selectedOffer.selectedProvider.brand,
    offerId: selectedOffer.selectedProvider.offerId,
    planAmount: planPrice, // buyer-signed plan price (provider's full quote), human
    assetName: asset.name,
    assetDecimals: asset.decimals,
    platformFee: feeBase,
    platformAddress: signedPlatformAddress ?? feeCfg.address ?? providerAddress, // unused on-chain when fee == 0
    providerAmount: providerBase,
    amount: planBase + feeBase, // BASE units; what the escrow locks
    expiryMs,
    nonce: selectedOffer.agreement.nonce,
    buyerMsg,
    buyerSig: base64ToBytes(selectedOffer.signatures.buyerSignature.value),
    buyerPk: pemRawPublicKey(buyerPublicPem),
    providerMsg,
    providerSig: base64ToBytes(originalOffer.signature.value),
    providerPk: pemRawPublicKey(profile.publicKey.value),
    providerAddress,
    buyerAddress: paths.buyerAddress ?? null,
    voucherDigest: voucherDigest(buyerMsg),
    verifiedAtMs: nowMs
  };
}
