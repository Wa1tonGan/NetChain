import assert from "node:assert/strict";
import { createPublicKey, createPrivateKey } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildProviderRequest } from "../src/a2a/buildProviderRequest.js";
import { evaluateOffer, selectOffer } from "../src/a2a/offerEvaluator.js";
import {
  canonicalJson,
  sha256Hex,
  verifyBuyerSignature,
  verifyOfferSignature
} from "../src/a2a/signing.js";
import { providerProfileSchema } from "../src/a2a/schemas/providerProfile.js";
import { providerRequestSchema } from "../src/a2a/schemas/providerRequest.js";
import { providerOfferSchema } from "../src/a2a/schemas/providerOffer.js";
import { selectedOfferSchema } from "../src/a2a/schemas/selectedOffer.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

// Same simulated arrival schedule as scripts/generate-fixtures.mjs.
const ARRIVAL_DELAYS_MS = {
  "PROVIDER-A": 600,
  "PROVIDER-B": 900,
  "PROVIDER-C": 300
};

const INCIDENT_SCENARIOS = {
  s2: "s2-primary-down-backup-insufficient.json",
  "s7-disaster": "s7-disaster.json"
};

async function loadJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

async function loadProfile(providerId) {
  return providerProfileSchema.parse(
    await loadJson(`fixtures/providers/${providerId.toLowerCase()}.json`)
  );
}

const PROVIDER_IDS = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"];

test("provider profiles satisfy the profile/AgentCard contract", async () => {
  for (const providerId of PROVIDER_IDS) {
    const profile = await loadProfile(providerId);

    assert.equal(profile.providerId, providerId);
    assert.equal(profile.agentCard.healthy, true);
    assert.equal(profile.agentCard.credentialsReady, true);
  }
});

test("profile public keys match the provisioned private keys", async () => {
  for (const providerId of PROVIDER_IDS) {
    const profile = await loadProfile(providerId);
    const privatePem = await readFile(
      path.join(projectRoot, "fixtures", "keys", `${providerId.toLowerCase()}.private.pem`),
      "utf8"
    );
    const derivedPublicPem = createPublicKey(
      createPrivateKey(privatePem)
    )
      .export({ type: "spki", format: "pem" })
      .trim();

    assert.equal(profile.publicKey.value, derivedPublicPem);
  }
});

test("canonicalJson is deterministic across key order", () => {
  const left = { b: 1, a: { d: [2, 1], c: true } };
  const right = { a: { c: true, d: [2, 1] }, b: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(sha256Hex(left), sha256Hex(right));
});

test("every RecoveryIntent produces a valid Provider Request or none", async () => {
  const scenarioFiles = (await readdir(path.join(projectRoot, "scenarios")))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  for (const fileName of scenarioFiles) {
    const intent = await loadJson(path.join("scenarios", fileName));
    const request = buildProviderRequest(intent);

    if (intent.recoveryDecision === "NO_EXTERNAL_RECOVERY_NEEDED") {
      assert.equal(request, null, `${fileName} must not request providers`);
      continue;
    }

    assert.doesNotThrow(
      () => providerRequestSchema.parse(request),
      `${fileName} must produce a valid Provider Request`
    );
    assert.ok(request.requestedCapacityMbps > 0);
    assert.ok(request.bidDeadlineMs < request.targetActivationTimeMs);
    assert.equal(request.emergencyOverride, intent.priority.emergencyOverride);
  }
});

for (const [label, scenarioFile] of Object.entries(INCIDENT_SCENARIOS)) {
  test(`${label}: offer fixtures are signed by their providers`, async () => {
    for (const providerId of PROVIDER_IDS) {
      const offer = await loadJson(
        `fixtures/offers/${label}-${providerId.toLowerCase()}-offer.json`
      );
      providerOfferSchema.parse(offer);

      assert.equal(offer.incidentId, (await loadJson(path.join("scenarios", scenarioFile))).incidentId);

      const profile = await loadProfile(providerId);
      assert.equal(
        verifyOfferSignature(offer, profile.publicKey.value),
        true,
        `${providerId} offer signature must verify`
      );
    }
  });

  test(`${label}: selected offer is contract-valid and fully signed`, async () => {
    const selected = await loadJson(`fixtures/selected/${label}-selected-offer.json`);
    selectedOfferSchema.parse(selected);

    const providerProfile = await loadProfile(selected.selectedProvider.providerId);
    assert.equal(
      verifyBuyerSignature(selected, await readFile(
        path.join(projectRoot, "fixtures", "keys", "buyer.public.pem"),
        "utf8"
      )),
      true,
      "buyer signature must verify"
    );

    const winningOffer = await loadJson(
      `fixtures/offers/${label}-${selected.selectedProvider.providerId.toLowerCase()}-offer.json`
    );
    assert.deepEqual(selected.signatures.offerSignature, winningOffer.signature);
    assert.equal(
      verifyOfferSignature(winningOffer, providerProfile.publicKey.value),
      true
    );
    assert.equal(selected.selectedProvider.offerId, winningOffer.offerId);
  });

  test(`${label}: selection matches the incident requirements`, async () => {
    const intent = await loadJson(path.join("scenarios", scenarioFile));
    const selected = await loadJson(`fixtures/selected/${label}-selected-offer.json`);

    assert.equal(selected.incidentId, intent.incidentId);
    assert.equal(
      selected.selectionMode,
      intent.priority.emergencyOverride ? "EMERGENCY" : "NORMAL"
    );
    assert.ok(
      selected.selectedProvider.capacityMbps >=
        intent.requirements.recoveryCapacityNeededMbps
    );
    assert.ok(selected.agreement.amount <= intent.constraints.maxBudget);
    assert.ok(
      selected.selectedProvider.latencyMs <= intent.requirements.maximumLatencyMs
    );
    assert.ok(
      selected.selectedProvider.reliabilityScore >=
        intent.requirements.minimumReliability
    );
    assert.equal(
      selected.agreement.nonce,
      `${selected.incidentId}:${selected.selectedProvider.providerId}:001`
    );
  });

  test(`${label}: re-running the deterministic selection reproduces the fixture`, async () => {
    const intent = await loadJson(path.join("scenarios", scenarioFile));
    const request = buildProviderRequest(intent, { ...process.env, SUI_NETWORK: "localnet" });
    const selected = await loadJson(`fixtures/selected/${label}-selected-offer.json`);

    const arrivals = [];
    for (const providerId of PROVIDER_IDS) {
      arrivals.push({
        offer: await loadJson(
          `fixtures/offers/${label}-${providerId.toLowerCase()}-offer.json`
        ),
        receivedAtMs: ARRIVAL_DELAYS_MS[providerId]
      });
    }

    const { selected: winner, rejected } = selectOffer(arrivals, request);

    assert.equal(winner.offer.providerId, selected.selectedProvider.providerId);
    assert.deepEqual(
      rejected.map(({ providerId, reason }) => ({ providerId, reason })),
      selected.rejectedOffers.map(({ providerId, reason }) => ({ providerId, reason }))
    );
  });
}

test("S2 normal mode picks KilatLink FWA over the slow CAMARA setup", async () => {
  const selected = await loadJson("fixtures/selected/s2-selected-offer.json");

  assert.equal(selected.selectedProvider.providerId, "PROVIDER-B");
  assert.deepEqual(
    selected.rejectedOffers.map((entry) => entry.reason),
    ["ACTIVATION_TOO_SLOW", "INSUFFICIENT_CAPACITY"]
  );
});

test("S7 emergency mode commits the first viable offer (P0 fast lane)", async () => {
  const selected = await loadJson("fixtures/selected/s7-disaster-selected-offer.json");

  assert.equal(selected.selectionMode, "EMERGENCY");
  assert.equal(selected.selectedProvider.providerId, "PROVIDER-A");
  assert.equal(selected.selectedProvider.activationLane, "P0_FAST");
  assert.deepEqual(
    selected.rejectedOffers.map((entry) => entry.reason),
    ["INSUFFICIENT_CAPACITY", "SUPERSEDED_BY_FIRST_VIABLE"]
  );
});

test("evaluator rejects every offer when none can serve the request", () => {
  const request = {
    requestId: "REQ-TEST",
    incidentId: "INC-TEST",
    customerId: "CUST-TEST",
    requestedCapacityMbps: 500,
    requiredProfile: { maxLatencyMs: 10, maxPacketLossPercent: 0.1, minReliability: 0.9999 },
    durationMinutes: 60,
    maxBudget: 1,
    currency: "MYR",
    targetActivationTimeMs: 1000,
    bidDeadlineMs: 500,
    emergencyOverride: false,
    requestedAction: "FIND_ADDITIONAL_CONNECTIVITY",
    preAuthorized: true
  };

  const offer = {
    offerId: "OFF-TEST",
    incidentId: "INC-TEST",
    providerId: "PROVIDER-A",
    available: true,
    capacityMbps: 400,
    expectedActivationClass: "MEDIUM",
    expectedActivationTimeMs: 8000,
    activationLane: "STANDARD",
    price: 80,
    currency: "MYR",
    reliabilityScore: 0.9995,
    latencyMs: 30,
    packetLossPercent: 0.3,
    offerExpiry: "2030-01-01T00:00:00.000Z",
    signature: { algorithm: "ed25519", keyId: "k", value: "sig" }
  };

  const { selected, rejected } = selectOffer(
    [{ offer, receivedAtMs: 0 }],
    request
  );

  assert.equal(selected, null);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].providerId, "PROVIDER-A");
  assert.ok(rejected[0].detail.includes("8000 ms > 1000 ms"));
  assert.equal(evaluateOffer(offer, request).viable, false);
});
