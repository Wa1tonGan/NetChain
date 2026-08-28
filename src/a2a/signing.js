import { createHash } from "node:crypto";
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify
} from "node:crypto";

// Deterministic signature helpers shared by the Rescue Agent, the provider
// agents and Person 3's verification side. Everything signs the *canonical*
// JSON form (recursively key-sorted, no whitespace) so that the same logical
// payload always produces the same bytes across processes and languages.

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function sha256Hex(value) {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

export function signPayload(privateKeyPem, payload) {
  return cryptoSign(
    null,
    canonicalBytes(payload),
    createPrivateKey(privateKeyPem)
  ).toString("base64");
}

export function verifyPayload(publicKeyPem, payload, signatureBase64) {
  return cryptoVerify(
    null,
    canonicalBytes(payload),
    createPublicKey(publicKeyPem),
    Buffer.from(signatureBase64, "base64")
  );
}

// The Provider Offer contract signs the whole offer minus its own
// `signature` field.
export function offerSigningPayload(offer) {
  const { signature, ...unsigned } = offer;
  return unsigned;
}

export function signOffer(offer, providerPrivateKeyPem) {
  return signPayload(providerPrivateKeyPem, offerSigningPayload(offer));
}

export function verifyOfferSignature(offer, providerPublicKeyPem) {
  return verifyPayload(
    providerPublicKeyPem,
    offerSigningPayload(offer),
    offer.signature.value
  );
}

// The buyer (Rescue Agent) signs the deal terms Person 3 turns into the Sui
// commitment — not the whole result object, so rejectedOffers/timing can be
// enriched later without invalidating the voucher.
export function buyerAgreementPayload(selectedOffer) {
  return {
    incidentId: selectedOffer.incidentId,
    selectedProvider: selectedOffer.selectedProvider,
    agreement: selectedOffer.agreement
  };
}

export function signBuyerAgreement(selectedOffer, buyerPrivateKeyPem) {
  return signPayload(buyerPrivateKeyPem, buyerAgreementPayload(selectedOffer));
}

export function verifyBuyerSignature(selectedOffer, buyerPublicKeyPem) {
  return verifyPayload(
    buyerPublicKeyPem,
    buyerAgreementPayload(selectedOffer),
    selectedOffer.signatures.buyerSignature.value
  );
}
