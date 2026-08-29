// Generates FRESH signed fixtures for the Sui flow using Person 2's own
// building blocks (buildProviderRequest, selectOffer, signOffer,
// signBuyerAgreement) with an overridable clock. Person 2's committed
// fixtures bake in DEMO_EPOCH_MS = 2026-08-29T12:00Z, so their vouchers are
// already expired at demo time — and expiry lives inside the buyer-signed
// payload, so it cannot be patched without re-signing. This script re-runs
// the SAME deterministic selection with a live clock instead.
//
// Outputs to fixtures/sui/ (Person 2's fixtures/ are left untouched):
//   s2-selected-offer.json               NORMAL  → B commits (60 MYR)
//   s7-disaster-selected-offer.json      EMERGENCY → A commits (140 MYR)
//   s7-fallback-selected-offer.json      EMERGENCY, A excluded (failed) → B takes over
//   s2-refund-selected-offer.json        alias of s2 (B commits → FAILS → refund)
//
//   SUI_FIXTURE_TTL_MS (default 300000 = 5 min) — short-lived voucher story,
//   with enough headroom for a live demo run.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderRequest } from "../src/a2a/buildProviderRequest.js";
import { selectOffer } from "../src/a2a/offerEvaluator.js";
import {
  signBuyerAgreement,
  signOffer
} from "../src/a2a/signing.js";
import { providerProfileSchema } from "../src/a2a/schemas/providerProfile.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "fixtures", "sui");

const EPOCH_MS = Number(process.env.SUI_FIXTURE_EPOCH_MS ?? Date.now());
const TTL_MS = Number(process.env.SUI_FIXTURE_TTL_MS ?? 300_000);
const ARRIVALS = { "PROVIDER-A": 600, "PROVIDER-B": 900, "PROVIDER-C": 300 };

const offerExpiry = new Date(EPOCH_MS + TTL_MS).toISOString();

function loadProfile(providerId) {
  return providerProfileSchema.parse(
    JSON.parse(readFileSync(path.join(root, "fixtures", "providers", `${providerId.toLowerCase()}.json`), "utf8"))
  );
}

function signKey(providerId) {
  return readFileSync(path.join(root, "fixtures", "keys", `${providerId.toLowerCase()}.private.pem`), "utf8");
}

function buildOffer(profile, request) {
  const lane = request.emergencyOverride
    ? { ...profile.activation.p0FastLane, lane: "P0_FAST" }
    : { ...profile.activation.standard, lane: "STANDARD" };
  const capacityMbps = profile.policy.maxCapacityMbps;
  const hours = request.durationMinutes / 60;
  const price = Math.round(
    (profile.policy.baseFee +
      profile.policy.pricePer100MbpsPerHour * (capacityMbps / 100) * hours) * 100
  ) / 100;

  const offer = {
    offerId: `OFF-${request.incidentId}-${profile.providerId}`,
    incidentId: request.incidentId,
    providerId: profile.providerId,
    available: true,
    capacityMbps,
    expectedActivationClass: lane.class,
    expectedActivationTimeMs: lane.timeMs,
    activationLane: lane.lane,
    price,
    currency: profile.policy.currency,
    reliabilityScore: profile.performance.reliabilityScore,
    latencyMs: profile.performance.latencyMs,
    packetLossPercent: profile.performance.packetLossPercent,
    offerExpiry,
    signature: { algorithm: "ed25519", keyId: profile.publicKey.keyId, value: "" }
  };
  offer.signature.value = signOffer(offer, signKey(profile.providerId));
  return offer;
}

function buildSelected(profile, winner, request, rejected, timing) {
  const selected = {
    incidentId: request.incidentId,
    customerId: request.customerId,
    selectionMode: request.emergencyOverride ? "EMERGENCY" : "NORMAL",
    selectedProvider: {
      providerId: winner.offer.providerId,
      brand: profile.brand,
      offerId: winner.offer.offerId,
      capacityMbps: winner.offer.capacityMbps,
      expectedActivationClass: winner.offer.expectedActivationClass,
      expectedActivationTimeMs: winner.offer.expectedActivationTimeMs,
      activationLane: winner.offer.activationLane,
      price: winner.offer.price,
      currency: winner.offer.currency,
      reliabilityScore: winner.offer.reliabilityScore,
      latencyMs: winner.offer.latencyMs,
      packetLossPercent: winner.offer.packetLossPercent
    },
    agreement: {
      amount: winner.offer.price,
      currency: winner.offer.currency,
      durationMinutes: request.durationMinutes,
      nonce: `${request.incidentId}:${winner.offer.providerId}:001`,
      expiry: winner.offer.offerExpiry
    },
    signatures: {
      offerSignature: winner.offer.signature,
      buyerSignature: {
        algorithm: "ed25519",
        keyId: "buyer-demo",
        value: ""
      }
    },
    rejectedOffers: rejected,
    timing
  };
  selected.signatures.buyerSignature.value = signBuyerAgreement(
    selected,
    readFileSync(path.join(root, "fixtures", "keys", "buyer.private.pem"), "utf8")
  );
  return selected;
}

function generate(label, scenarioFile, { exclude = [] } = {}) {
  const intent = JSON.parse(readFileSync(path.join(root, "scenarios", scenarioFile), "utf8"));
  const request = buildProviderRequest(intent);
  if (!request) throw new Error(`${scenarioFile} needs no external recovery`);

  const profiles = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"]
    .filter((id) => !exclude.includes(id))
    .map(loadProfile);
  const arrivals = profiles.map((profile) => ({
    offer: buildOffer(profile, request),
    profile,
    receivedAtMs: ARRIVALS[profile.providerId]
  }));

  const { selected: winner, rejected } = selectOffer(arrivals, request);
  if (!winner) throw new Error(`${label}: no viable provider`);

  const extraRejected = exclude.map((providerId) => ({
    providerId,
    reason: "PROVIDER_UNAVAILABLE",
    detail: "activation FAILED after the original commitment; excluded from re-selection"
  }));

  const timing = request.emergencyOverride
    ? { tDetect: EPOCH_MS, tDecide: EPOCH_MS + winner.receivedAtMs + 50 }
    : { tDetect: EPOCH_MS, tDecide: EPOCH_MS + request.bidDeadlineMs };

  const selected = buildSelected(winner.profile, winner, request, [...extraRejected, ...rejected], timing);
  const file = path.join(outDir, `${label}-selected-offer.json`);
  writeFileSync(file, `${JSON.stringify(selected, null, 2)}\n`);
  console.log(
    `${label}: ${winner.offer.providerId} wins (${winner.offer.price} ${winner.offer.currency}, ` +
    `${selected.selectionMode}, nonce ${selected.agreement.nonce})`
  );
  return selected;
}

mkdirSync(outDir, { recursive: true });
generate("s2", "s2-primary-down-backup-insufficient.json");
generate("s7-disaster", "s7-disaster.json");
// Fallback: PROVIDER-A committed, then failed activation → excluded → B takes over.
generate("s7-fallback", "s7-disaster.json", { exclude: ["PROVIDER-A"] });
// Verbatim duplicate of s2 for the refund drill (B commits → FAILS → refund).
writeFileSync(
  path.join(outDir, "s2-refund-selected-offer.json"),
  readFileSync(path.join(outDir, "s2-selected-offer.json"))
);
console.log(`fresh fixtures in fixtures/sui/ (clock ${new Date(EPOCH_MS).toISOString()}, TTL ${TTL_MS / 1000}s)`);
