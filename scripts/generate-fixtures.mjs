// Regenerates the signed demo fixtures from the provider profiles and the
// Person 1 scenarios:
//   fixtures/offers/   one signed Provider Offer per provider per incident
//   fixtures/selected/ the Selected Offer handed to Person 3
//
// The two scripted incidents show off both selection modes:
//   S2 (NORMAL)    -> NusaNet 5G is rejected (CAMARA setup too slow),
//                     KilatLink FWA wins the ranking.
//   S7 (EMERGENCY) -> the first *viable* offer wins: OrbitSat GO answers
//                     first but cannot serve 300 Mbps, so NusaNet 5G's
//                     P0 fast-lane offer is committed immediately, ahead of
//                     the better-ranked KilatLink FWA offer.
//
// Run after editing anything in fixtures/providers/: node scripts/generate-fixtures.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderRequest } from "../src/a2a/buildProviderRequest.js";
import { computeFeeSplit, feeConfigFromEnv } from "../src/a2a/fees.js";
import { selectOffer } from "../src/a2a/offerEvaluator.js";
import { signBuyerAgreement, signOffer } from "../src/a2a/signing.js";
import { providerProfileSchema } from "../src/a2a/schemas/providerProfile.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const providersDirectory = path.join(projectRoot, "fixtures", "providers");
const keysDirectory = path.join(projectRoot, "fixtures", "keys");
const offersDirectory = path.join(projectRoot, "fixtures", "offers");
const selectedDirectory = path.join(projectRoot, "fixtures", "selected");

// Fixed demo clock so regenerated fixtures stay diff-stable.
const DEMO_EPOCH_MS = Date.parse("2026-08-29T12:00:00Z");
const OFFER_TTL_MS = 60_000;

// Fee economics baked into the fixtures (blueprint §1.3 example: 5%).
const FEES = feeConfigFromEnv();

// Simulated A2A arrival times (ms after tDetect). OrbitSat is always first
// to answer, NusaNet second, KilatLink last.
const ARRIVAL_DELAYS_MS = {
  "PROVIDER-A": 600,
  "PROVIDER-B": 900,
  "PROVIDER-C": 300
};

const INCIDENTS = [
  { scenarioFile: "s2-primary-down-backup-insufficient.json", label: "s2" },
  { scenarioFile: "s7-disaster.json", label: "s7-disaster" }
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function loadProfile(providerId) {
  const raw = JSON.parse(
    readFileSync(path.join(providersDirectory, `${providerId.toLowerCase()}.json`), "utf8")
  );
  return providerProfileSchema.parse(raw);
}

function buildOffer(profile, request, offerExpiry) {
  const lane = request.emergencyOverride
    ? { ...profile.activation.p0FastLane, lane: "P0_FAST" }
    : { ...profile.activation.standard, lane: "STANDARD" };
  const capacityMbps = profile.policy.maxCapacityMbps;
  const hours = request.durationMinutes / 60;
  const price = round2(
    profile.policy.baseFee +
      profile.policy.pricePer100MbpsPerHour * (capacityMbps / 100) * hours
  );

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

  const privateKeyPem = readFileSync(
    path.join(keysDirectory, `${profile.providerId.toLowerCase()}.private.pem`),
    "utf8"
  );
  offer.signature.value = signOffer(offer, privateKeyPem);

  return offer;
}

function buildSelectedOffer(profile, winner, request, rejected, timing) {
  const feeSplit = computeFeeSplit(winner.offer.price, FEES.platformFeePercent);
  const selectedProvider = {
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
  };

  const selected = {
    incidentId: request.incidentId,
    customerId: request.customerId,
    selectionMode: request.emergencyOverride ? "EMERGENCY" : "NORMAL",
    selectedProvider,
    agreement: {
      ...feeSplit,
      platformFeePercent: FEES.platformFeePercent,
      platformAddress: FEES.platformAddress,
      currency: winner.offer.currency,
      durationMinutes: request.durationMinutes,
      nonce: `${request.incidentId}:${winner.offer.providerId}:001`,
      expiry: winner.offer.offerExpiry
    },
    signatures: {
      offerSignature: winner.offer.signature,
      buyerSignature: { algorithm: "ed25519", keyId: "buyer-demo", value: "" }
    },
    rejectedOffers: rejected,
    timing
  };

  const buyerPrivateKeyPem = readFileSync(
    path.join(keysDirectory, "buyer.private.pem"),
    "utf8"
  );
  selected.signatures.buyerSignature.value = signBuyerAgreement(selected, buyerPrivateKeyPem);

  return selected;
}

for (const incident of INCIDENTS) {
  const intent = JSON.parse(
    readFileSync(path.join(projectRoot, "scenarios", incident.scenarioFile), "utf8")
  );
  const request = buildProviderRequest(intent);

  if (!request) {
    throw new Error(`${incident.scenarioFile} does not require external recovery`);
  }

  const profiles = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"].map(loadProfile);
  const offerExpiry = new Date(DEMO_EPOCH_MS + OFFER_TTL_MS).toISOString();
  const arrivals = profiles.map((profile) => ({
    offer: buildOffer(profile, request, offerExpiry),
    profile,
    receivedAtMs: ARRIVAL_DELAYS_MS[profile.providerId]
  }));

  for (const arrival of arrivals) {
    const offerFile = `${incident.label}-${arrival.profile.providerId.toLowerCase()}-offer.json`;
    writeFileSync(
      path.join(offersDirectory, offerFile),
      `${JSON.stringify(arrival.offer, null, 2)}\n`
    );
  }

  const { selected: winner, rejected } = selectOffer(arrivals, request);

  if (!winner) {
    throw new Error(`No viable provider for ${incident.scenarioFile}`);
  }

  const bidDeadlineMs = request.bidDeadlineMs;
  const timing = request.emergencyOverride
    ? {
        tDetect: DEMO_EPOCH_MS,
        tDecide: DEMO_EPOCH_MS + winner.receivedAtMs + 50
      }
    : {
        tDetect: DEMO_EPOCH_MS,
        tDecide: DEMO_EPOCH_MS + bidDeadlineMs
      };

  const selected = buildSelectedOffer(winner.profile, winner, request, rejected, timing);

  writeFileSync(
    path.join(selectedDirectory, `${incident.label}-selected-offer.json`),
    `${JSON.stringify(selected, null, 2)}\n`
  );

  console.log(
    `${incident.label}: ${winner.offer.providerId} (${winner.offer.price} ${winner.offer.currency}, ` +
      `${winner.offer.capacityMbps} Mbps, ${selected.selectionMode}) — ${rejected.length} rejected`
  );
}
