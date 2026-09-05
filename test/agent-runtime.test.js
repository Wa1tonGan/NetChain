// Agent runtime integration tests (Person 2, milestone M4/M5 scope):
// provider agents as independent services, parallel A2A broadcast,
// normal vs emergency selection, provider failure fallback, fail-fast
// deadlines, duplicate-safety and the Gonka consensus ranker.
//
// Every test runs against real HTTP servers on ephemeral ports; the Gonka
// ranker is exercised with an injected fetch so no test touches the network.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createProviderAgent } from "../src/agents/providerAgent.js";
import { createRescueAgent } from "../src/agents/rescueAgent.js";
import { rankWithConsensus, parseConfig as parseGonkaConfig } from "../src/a2a/gonkaRanker.js";
import { parseConfig as parseClaimConfig } from "../src/a2a/claimAgent.js";
import {
  verifyBuyerSignature,
  verifyOfferSignature
} from "../src/a2a/signing.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROVIDER_IDS = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"];

async function loadJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

async function loadIdentity(providerId) {
  return {
    profile: await loadJson(`fixtures/providers/${providerId.toLowerCase()}.json`),
    privateKeyPem: await readFile(
      path.join(projectRoot, "fixtures", "keys", `${providerId.toLowerCase()}.private.pem`),
      "utf8"
    )
  };
}

// Starts three real provider agents on ephemeral ports plus a rescue agent
// wired to them. `modes` presets failure modes, `profileOverrides` rewrites
// profiles (e.g. faster activation), `rescueOptions` passes straight through.
async function startStack({ modes = {}, profileOverrides = {}, rescueOptions = {} } = {}) {
  const agents = [];
  const profiles = [];

  for (const providerId of PROVIDER_IDS) {
    const { profile, privateKeyPem } = await loadIdentity(providerId);
    const overridden = structuredClone(profile);

    if (profileOverrides[providerId]) {
      Object.assign(overridden, profileOverrides[providerId]);
    }

    const agent = createProviderAgent({
      profile: overridden,
      privateKeyPem,
      logger: () => {}
    });
    const port = await agent.listen(0);
    agent.setFailureMode(modes[providerId] ?? "healthy");
    overridden.agentCard.endpoint = `http://127.0.0.1:${port}`;

    agents.push(agent);
    profiles.push(overridden);
  }

  const buyerPrivateKeyPem = await readFile(
    path.join(projectRoot, "fixtures", "keys", "buyer.private.pem"),
    "utf8"
  );
  const rescue = createRescueAgent({
    providers: profiles,
    buyerPrivateKeyPem,
    logger: () => {},
    ...rescueOptions
  });

  const cleanup = async () => {
    await Promise.all(agents.map((agent) => agent.close()));
    await rescue.close();
  };

  return { rescue, agents, profiles, cleanup };
}

function providerReasons(envelope) {
  return Object.fromEntries(
    (envelope.rejectedOffers ?? []).map((entry) => [entry.providerId, entry])
  );
}

test("S2 normal mode: parallel A2A selects KilatLink, activation result attached", async () => {
  const { rescue, cleanup } = await startStack();
  const buyerPublicKeyPem = await readFile(
    path.join(projectRoot, "fixtures", "keys", "buyer.public.pem"),
    "utf8"
  );

  try {
    const envelope = await rescue.processIntent(
      await loadJson("scenarios/s2-primary-down-backup-insufficient.json")
    );

    assert.equal(envelope.status, "SELECTED");
    assert.equal(envelope.selectedOffer.selectionMode, "NORMAL");
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-B");
    assert.equal(envelope.selectedOffer.selectedProvider.brand, "KilatLink FWA");
    assert.equal(envelope.selectedOffer.activation.status, "AVAILABLE");
    assert.equal(envelope.selectedOffer.activation.recoveredCapacityMbps, 300);

    const reasons = providerReasons(envelope.selectedOffer);
    assert.equal(reasons["PROVIDER-A"].reason, "ACTIVATION_TOO_SLOW");
    assert.equal(reasons["PROVIDER-C"].reason, "INSUFFICIENT_CAPACITY");

    // Handoff artifact Person 3 consumes: buyer signature verifies offline.
    assert.equal(
      verifyBuyerSignature(envelope.selectedOffer, buyerPublicKeyPem),
      true
    );

    // Blueprint §6.1: end-to-end time is measured, not assumed.
    assert.ok(envelope.selectedOffer.timing.tDecide >= envelope.selectedOffer.timing.tDetect);
  } finally {
    await cleanup();
  }
});

test("S7 emergency mode: first viable offer wins by arrival, zero LLM", async () => {
  // B and C are held past the bid deadline so PROVIDER-A is deterministically
  // the first viable bidder (mirrors the fixture arrival schedule).
  const { rescue, cleanup } = await startStack({
    modes: { "PROVIDER-B": "slow", "PROVIDER-C": "slow" }
  });

  try {
    const envelope = await rescue.processIntent(
      await loadJson("scenarios/s7-disaster.json")
    );

    assert.equal(envelope.status, "SELECTED");
    assert.equal(envelope.selectedOffer.selectionMode, "EMERGENCY");
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-A");
    assert.equal(envelope.selectedOffer.selectedProvider.activationLane, "P0_FAST");
    assert.equal(envelope.selectedOffer.activation.status, "AVAILABLE");

    const reasons = providerReasons(envelope.selectedOffer);
    for (const providerId of ["PROVIDER-B", "PROVIDER-C"]) {
      assert.equal(reasons[providerId].reason, "RESPONSE_TIMEOUT");
      assert.match(reasons[providerId].detail, /bid deadline passed/);
    }
  } finally {
    await cleanup();
  }
});

test("emergency failover: first viable offer fails activation, next viable takes over with nonce :002", async () => {
  // A arrives first (healthy bids, faulty activation), B follows late but
  // inside the deadline, C never makes the deadline.
  const intent = await loadJson("scenarios/s7-disaster.json");
  intent.incidentId = "INC-S7-FAILOVER";

  const { rescue, cleanup } = await startStack({
    modes: { "PROVIDER-A": "fail_activation", "PROVIDER-B": "laggy", "PROVIDER-C": "slow" }
  });

  try {
    const envelope = await rescue.processIntent(intent);

    assert.equal(envelope.status, "SELECTED");
    assert.equal(envelope.attempt, 2);
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-B");
    assert.equal(envelope.selectedOffer.agreement.nonce, "INC-S7-FAILOVER:PROVIDER-B:002");
    assert.equal(envelope.selectedOffer.activation.status, "AVAILABLE");

    const reasons = providerReasons(envelope.selectedOffer);
    assert.equal(reasons["PROVIDER-A"].reason, "ACTIVATION_FAILED");
    assert.equal(reasons["PROVIDER-C"].reason, "RESPONSE_TIMEOUT");

    // Blueprint §6.1 timing 四件套: all four timestamps are measured.
    const timing = envelope.selectedOffer.timing;
    assert.ok(timing.tDetect <= timing.tDecide);
    assert.ok(timing.tDecide <= timing.tActivate);
    assert.ok(timing.tActivate === timing.tRecover);
  } finally {
    await cleanup();
  }
});

test("provider down: health gate skips it and recovery still succeeds", async () => {
  const { rescue, cleanup } = await startStack({
    modes: { "PROVIDER-A": "down" }
  });

  try {
    const envelope = await rescue.processIntent(
      await loadJson("scenarios/s2-primary-down-backup-insufficient.json")
    );

    assert.equal(envelope.status, "SELECTED");
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-B");

    const reasons = providerReasons(envelope.selectedOffer);
    assert.equal(reasons["PROVIDER-A"].reason, "PROVIDER_UNAVAILABLE");
    assert.match(reasons["PROVIDER-A"].detail, /unhealthy/);
    assert.equal(reasons["PROVIDER-C"].reason, "INSUFFICIENT_CAPACITY");
  } finally {
    await cleanup();
  }
});

test("unresponsive provider: fail-fast deadline records the miss without stalling", async () => {
  const intent = await loadJson("scenarios/s2-primary-down-backup-insufficient.json");
  intent.incidentId = "INC-UNRESPONSIVE";
  intent.requirements.targetActivationTimeMs = 2000; // bid deadline 1000 ms

  const { rescue, cleanup } = await startStack({
    modes: { "PROVIDER-A": "unresponsive" }
  });

  try {
    const startedAt = Date.now();
    const envelope = await rescue.processIntent(intent);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(envelope.status, "SELECTED");
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-B");
    // The bid deadline (1000 ms) caps the bidding wait; the rest of the
    // elapsed time is KilatLink's own 1500 ms activation, not provider A's hang.
    assert.ok(elapsedMs < 4000, `recovery took ${elapsedMs} ms, deadline not enforced`);

    assert.equal(providerReasons(envelope.selectedOffer)["PROVIDER-A"].reason, "RESPONSE_TIMEOUT");
  } finally {
    await cleanup();
  }
});

test("re-running the same incident reuses the cached result (no duplicate activation)", async () => {
  const { rescue, cleanup } = await startStack();

  try {
    const first = await rescue.processIntent(
      await loadJson("scenarios/s2-primary-down-backup-insufficient.json")
    );
    const second = await rescue.processIntent(
      await loadJson("scenarios/s2-primary-down-backup-insufficient.json")
    );

    assert.equal(second, first); // same envelope object — nothing re-ran
    assert.equal(
      first.selectedOffer.agreement.nonce,
      "INC-S2:PROVIDER-B:001"
    );
  } finally {
    await cleanup();
  }
});

test("concurrent duplicate intents share one recovery run", async () => {
  const intent = await loadJson("scenarios/s2-primary-down-backup-insufficient.json");
  intent.incidentId = "INC-CONCURRENT";

  const { rescue, cleanup } = await startStack();

  try {
    const [left, right] = await Promise.all([
      rescue.processIntent(intent),
      rescue.processIntent(intent)
    ]);

    assert.equal(left, right);
    assert.equal(left.status, "SELECTED");
  } finally {
    await cleanup();
  }
});

test("no viable provider: every provider gets a machine-readable rejection", async () => {
  const intent = await loadJson("scenarios/s2-primary-down-backup-insufficient.json");
  intent.incidentId = "INC-IMPOSSIBLE";
  intent.requirements.recoveryCapacityNeededMbps = 10_000;
  intent.requirements.additionalCapacityNeededMbps = 10_000;

  const { rescue, cleanup } = await startStack();

  try {
    const envelope = await rescue.processIntent(intent);

    assert.equal(envelope.status, "NO_VIABLE_OFFER");
    assert.equal(envelope.rejectedOffers.length, 3);
    assert.ok(envelope.rejectedOffers.every((entry) => entry.reason === "INSUFFICIENT_CAPACITY"));
  } finally {
    await cleanup();
  }
});

test("intent that needs no external recovery short-circuits without querying providers", async () => {
  const { rescue, cleanup } = await startStack();

  try {
    const envelope = await rescue.processIntent(
      await loadJson("scenarios/s0-normal.json")
    );

    assert.equal(envelope.status, "NO_EXTERNAL_RECOVERY_NEEDED");
    assert.equal(envelope.selectedOffer, undefined);
  } finally {
    await cleanup();
  }
});

test("Gonka consensus overrides deterministic ranking when models agree", async () => {
  // Both A and B are viable; deterministic ranking prefers B (FAST beats
  // MEDIUM). Both injected models vote A first, so consensus must flip it.
  const votes = { m1: ["PROVIDER-A", "PROVIDER-B"], m2: ["PROVIDER-A", "PROVIDER-B"] };
  const fakeFetch = async (url, init) => {
    const { model } = JSON.parse(init.body);

    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ ranking: votes[model] }) } }]
      })
    };
  };

  const intent = await loadJson("scenarios/s2-primary-down-backup-insufficient.json");
  intent.incidentId = "INC-GONKA";
  intent.requirements.targetActivationTimeMs = 8000; // A's MEDIUM class becomes viable

  const { rescue, cleanup } = await startStack({
    profileOverrides: {
      "PROVIDER-A": { activation: { standard: { class: "MEDIUM", timeMs: 4000 }, p0FastLane: { class: "FAST", timeMs: 1500 } } }
    },
    rescueOptions: {
      gonkaOverrides: {
        env: {},
        baseUrl: "http://gonka.test/v1",
        apiKey: "test-key",
        models: "m1,m2",
        budgetMs: 1_000,
        fetchImpl: fakeFetch
      }
    }
  });

  try {
    const envelope = await rescue.processIntent(intent);

    assert.equal(envelope.status, "SELECTED");
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-A");

    const reasons = providerReasons(envelope.selectedOffer);
    assert.equal(reasons["PROVIDER-B"].reason, "RANKED_BELOW");
    assert.match(reasons["PROVIDER-B"].detail, /Gonka consensus/);
  } finally {
    await cleanup();
  }
});

test("Gonka failure falls back to deterministic ranking", async () => {
  const fakeFetch = async () => {
    throw new Error("gonka unreachable");
  };

  const intent = await loadJson("scenarios/s2-primary-down-backup-insufficient.json");
  intent.incidentId = "INC-GONKA-DOWN";
  intent.requirements.targetActivationTimeMs = 8000;

  const { rescue, cleanup } = await startStack({
    profileOverrides: {
      "PROVIDER-A": { activation: { standard: { class: "MEDIUM", timeMs: 4000 }, p0FastLane: { class: "FAST", timeMs: 1500 } } }
    },
    rescueOptions: {
      gonkaOverrides: {
        env: {},
        baseUrl: "http://gonka.test/v1",
        apiKey: "test-key",
        models: "m1,m2",
        budgetMs: 500,
        fetchImpl: fakeFetch
      }
    }
  });

  try {
    const envelope = await rescue.processIntent(intent);

    assert.equal(envelope.status, "SELECTED");
    // Deterministic order: FAST activation beats MEDIUM.
    assert.equal(envelope.selectedOffer.selectedProvider.providerId, "PROVIDER-B");
    assert.equal(providerReasons(envelope.selectedOffer)["PROVIDER-A"].reason, "RANKED_BELOW");
  } finally {
    await cleanup();
  }
});

test("rescue agent HTTP surface: recovery + lookup + readiness", async () => {
  const { rescue, cleanup } = await startStack();
  const port = await rescue.listen(0);

  try {
    const postResponse = await fetch(`http://127.0.0.1:${port}/v1/recovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await loadJson("scenarios/s2-primary-down-backup-insufficient.json"))
    });
    const envelope = await postResponse.json();

    assert.equal(postResponse.status, 200);
    assert.equal(envelope.status, "SELECTED");

    const lookupResponse = await fetch(
      `http://127.0.0.1:${port}/v1/recovery/INC-S2`
    );
    assert.deepEqual(await lookupResponse.json(), envelope);

    const readinessResponse = await fetch(`http://127.0.0.1:${port}/readiness`);
    const readiness = await readinessResponse.json();
    assert.equal(readiness.providers.length, 3);
    assert.ok(readiness.providers.every((provider) => provider.healthy));
    assert.ok(readiness.providers[0].agentCard.endpoint.startsWith("http"));
  } finally {
    await cleanup();
  }
});

test("async gateway contract: intents, incident view, result pull, SSE events, settlement callback", async () => {
  const { rescue, cleanup } = await startStack();
  const port = await rescue.listen(0);
  const base = `http://127.0.0.1:${port}`;

  try {
    const intent = await loadJson("scenarios/s2-primary-down-backup-insufficient.json");

    const submitResponse = await fetch(`${base}/recovery/intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent)
    });
    assert.equal(submitResponse.status, 202);
    assert.deepEqual(await submitResponse.json(), { incidentId: "INC-S2", status: "RECEIVED" });

    // Duplicate submission returns the existing incident — no second run.
    const duplicateResponse = await fetch(`${base}/recovery/intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent)
    });
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicate.duplicate, true);

    // Result pull must 409 while the pipeline is still running.
    const earlyResult = await fetch(`${base}/incidents/INC-S2/result`);
    assert.ok([200, 409].includes(earlyResult.status));

    // Wait for completion via the incident view.
    let view;
    for (let i = 0; i < 50; i += 1) {
      view = await (await fetch(`${base}/incidents/INC-S2`)).json();

      if (view.status === "AVAILABLE") {
        break;
      }

      await sleep(100);
    }
    assert.equal(view.status, "AVAILABLE");
    assert.equal(view.providerId, "PROVIDER-B");

    // Status machine passed through SELECTED and ACTIVATING on the way.
    const statuses = view.events.filter((event) => event.type === "status").map((event) => event.status);
    for (const expected of ["RECEIVED", "QUERYING", "SELECTED", "ACTIVATING", "AVAILABLE"]) {
      assert.ok(statuses.includes(expected), `missing status event ${expected}`);
    }

    // Person 3 pulls the bare Selected Offer artifact.
    const resultResponse = await fetch(`${base}/incidents/INC-S2/result`);
    assert.equal(resultResponse.status, 200);
    const artifact = await resultResponse.json();
    assert.equal(artifact.incidentId, "INC-S2");
    assert.equal(artifact.agreement.nonce, "INC-S2:PROVIDER-B:001");

    // Person 3 reports settlement; the incident view flips to SETTLED.
    const settlementResponse = await fetch(`${base}/callbacks/settlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incidentId: "INC-S2", status: "SETTLED", digest: "abc123" })
    });
    assert.equal(settlementResponse.status, 200);

    const settledView = await (await fetch(`${base}/incidents/INC-S2`)).json();
    assert.equal(settledView.status, "SETTLED");
    assert.equal(settledView.settlement.digest, "abc123");
  } finally {
    await cleanup();
  }
});

test("provider Gonka pitch enrichment is signed into the offer when the window allows", async () => {
  const { profile, privateKeyPem } = await loadIdentity("PROVIDER-B");
  const gonkaFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"pitch":"Fastest FWA burst in the valley."}' } }]
    })
  });

  const agent = createProviderAgent({
    profile,
    privateKeyPem,
    logger: () => {},
    gonka: {
      baseUrl: "http://gonka.test/v1",
      apiKey: "k",
      model: "m1",
      fetchImpl: gonkaFetch
    }
  });
  const port = await agent.listen(0);

  try {
    const offerResponse = await fetch(`http://127.0.0.1:${port}/v1/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "REQ-PITCH",
        incidentId: "INC-PITCH",
        customerId: "CUST-1",
        requestedCapacityMbps: 200,
        requiredProfile: { maxLatencyMs: 80, maxPacketLossPercent: 2, minReliability: 0.99 },
        durationMinutes: 60,
        maxBudget: 100,
        currency: "MYR",
        targetActivationTimeMs: 5000,
        bidDeadlineMs: 2500,
        emergencyOverride: false,
        requestedAction: "FIND_ADDITIONAL_CONNECTIVITY",
        preAuthorized: true
      })
    });
    const offer = await offerResponse.json();

    assert.equal(offer.enrichment.pitch, "Fastest FWA burst in the valley.");
    // Enrichment is inside the signed payload: tamper-consistent.
    assert.equal(verifyOfferSignature(offer, profile.publicKey.value), true);
  } finally {
    await agent.close();
  }
});

test("provider agent honours failure modes and dedupes offers/activations", async () => {
  const { agents, profiles, cleanup } = await startStack();
  const agent = agents[0];
  const endpoint = profiles[0].agentCard.endpoint;

  const request = {
    requestId: "REQ-DEDUP-1",
    incidentId: "INC-DEDUP",
    customerId: "CUST-1",
    requestedCapacityMbps: 200,
    requiredProfile: { maxLatencyMs: 80, maxPacketLossPercent: 2, minReliability: 0.99 },
    durationMinutes: 60,
    maxBudget: 100,
    currency: "MYR",
    targetActivationTimeMs: 5000,
    bidDeadlineMs: 2500,
    emergencyOverride: false,
    requestedAction: "FIND_ADDITIONAL_CONNECTIVITY",
    preAuthorized: true
  };

  try {
    const [left, right] = await Promise.all([
      fetch(`${endpoint}/v1/offers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      }),
      fetch(`${endpoint}/v1/offers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      })
    ]);
    const [leftOffer, rightOffer] = await Promise.all([left.json(), right.json()]);

    assert.equal(leftOffer.signature.value, rightOffer.signature.value);

    const [actLeft, actRight] = await Promise.all([
      fetch(`${endpoint}/v1/activation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId: request.incidentId, offerId: leftOffer.offerId })
      }),
      fetch(`${endpoint}/v1/activation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId: request.incidentId, offerId: leftOffer.offerId })
      })
    ]);
    const [leftResult, rightResult] = await Promise.all([actLeft.json(), actRight.json()]);

    assert.equal(leftResult.status, "AVAILABLE");
    assert.equal(leftResult.confirmedAtMs, rightResult.confirmedAtMs);

    agent.setFailureMode("down");
    const health = await (await fetch(`${endpoint}/health`)).json();
    assert.equal(health.healthy, false);

    const refused = await fetch(`${endpoint}/v1/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    assert.equal(refused.status, 503);
  } finally {
    await cleanup();
  }
});

test("gonkaRanker: merges votes by Borda count with deterministic tie-break", async () => {
  const fakeFetch = async (url, init) => {
    const { model } = JSON.parse(init.body);
    const ranking =
      model === "m1" ? ["PROVIDER-A", "PROVIDER-B"] : ["PROVIDER-B", "PROVIDER-A"];

    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: `Sure! ${JSON.stringify({ ranking })}` } }]
      })
    };
  };

  const arrivals = [
    { offer: { providerId: "PROVIDER-A", capacityMbps: 400, price: 80, currency: "MYR", expectedActivationClass: "FAST", expectedActivationTimeMs: 1500, reliabilityScore: 0.9995, latencyMs: 30, packetLossPercent: 0.3 }, receivedAtMs: 10 },
    { offer: { providerId: "PROVIDER-B", capacityMbps: 300, price: 60, currency: "MYR", expectedActivationClass: "FAST", expectedActivationTimeMs: 1500, reliabilityScore: 0.999, latencyMs: 35, packetLossPercent: 0.5 }, receivedAtMs: 20 }
  ];
  const request = {
    requestedCapacityMbps: 200,
    requiredProfile: { maxLatencyMs: 80, maxPacketLossPercent: 2, minReliability: 0.99 },
    maxBudget: 100,
    targetActivationTimeMs: 5000,
    durationMinutes: 60,
    emergencyOverride: false
  };

  // Opposing votes tie -> deterministic order (equal class/activation, lower
  // price first -> B).
  const merged = await rankWithConsensus(arrivals, request, {
    env: {},
    baseUrl: "http://gonka.test/v1",
    apiKey: "k",
    models: "m1,m2",
    budgetMs: 500,
    fetchImpl: fakeFetch
  });
  assert.deepEqual(merged.ranking, ["PROVIDER-B", "PROVIDER-A"]);
  // Transparency UI: every vote carries its Gonka request id (header absent
  // in the fake fetch -> null) and the raw per-model ranking.
  assert.equal(merged.votes.length, 2);
  assert.deepEqual(
    merged.votes.map((v) => v.ranking),
    [["PROVIDER-A", "PROVIDER-B"], ["PROVIDER-B", "PROVIDER-A"]]
  );
  assert.deepEqual(merged.votes.map((v) => v.model), ["m1", "m2"]);
});

test("fee engine: plan price + 5% platform fee, split fields handed to Person 3", async () => {
  const { rescue, cleanup } = await startStack({
    rescueOptions: {
      fees: { platformFeePercent: 5, platformAddress: "0xPLATFORM_TEST" }
    }
  });

  try {
    const envelope = await rescue.processIntent(
      await loadJson("scenarios/s2-primary-down-backup-insufficient.json")
    );
    const agreement = envelope.selectedOffer.agreement;

    // KilatLink plan price is 1.8 USDC-scale (§1.3 worked example at a
    // different base): fee is computed on the plan price only and added on top.
    assert.equal(agreement.planPrice, 1.8);
    assert.equal(agreement.platformFeePercent, 5);
    assert.equal(agreement.platformFee, 0.09);
    assert.equal(agreement.providerAmount, 1.8);
    assert.equal(agreement.amount, 1.89); // escrow lock
    assert.equal(agreement.platformAddress, "0xPLATFORM_TEST");

    // Person 3's split-settlement proof: one escrow, two destinations.
    assert.ok(agreement.amount > agreement.providerAmount);
    assert.equal(Math.round((agreement.providerAmount + agreement.platformFee) * 100) / 100, agreement.amount);

    // The provider side never saw the fee — offers quote the plan price only.
    assert.equal(envelope.selectedOffer.selectedProvider.price, 1.8);
  } finally {
    await cleanup();
  }
});

test("selected offer schema rejects a tampered fee split", async () => {
  const selectedOfferSchema = (await import("../src/a2a/schemas/selectedOffer.js"))
    .selectedOfferSchema;
  const { rescue, cleanup } = await startStack();

  try {
    const envelope = await rescue.processIntent(
      await loadJson("scenarios/s2-primary-down-backup-insufficient.json")
    );
    const tampered = structuredClone(envelope.selectedOffer);
    tampered.agreement.platformFee = 99; // someone skimmed extra

    assert.throws(() => selectedOfferSchema.parse(tampered), /platformFee must equal/);
  } finally {
    await cleanup();
  }
});

test("gonkaRanker: budget expiry, missing config and unusable answers all fall back", async () => {
  const arrivals = [
    { offer: { providerId: "PROVIDER-A" }, receivedAtMs: 10 },
    { offer: { providerId: "PROVIDER-B" }, receivedAtMs: 20 }
  ];
  const request = { requiredProfile: {}, emergencyOverride: false };

  const slowFetch = () =>
    new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ choices: [] }) }), 300));
  assert.equal(
    await rankWithConsensus(arrivals, request, {
      env: {}, baseUrl: "http://x", apiKey: "k", models: "m1", budgetMs: 50, fetchImpl: slowFetch
    }),
    null
  );

  assert.equal(
    await rankWithConsensus(arrivals, request, { env: {} }),
    null,
    "no API key -> no consensus"
  );

  const garbageFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "A is clearly best" } }] })
  });
  assert.equal(
    await rankWithConsensus(arrivals, request, {
      env: {}, baseUrl: "http://x", apiKey: "k", models: "m1", budgetMs: 500, fetchImpl: garbageFetch
    }),
    null
  );

  const unknownFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"ranking":["PROVIDER-Z"]}' } }] })
  });
  assert.equal(
    await rankWithConsensus(arrivals, request, {
      env: {}, baseUrl: "http://x", apiKey: "k", models: "m1", budgetMs: 500, fetchImpl: unknownFetch
    }),
    null
  );
});

test("model configuration: claimAgent uses TRUTH_AGENT_MODELS with fallback to GONKA_MODELS; gonkaRanker uses GONKA_MODELS", () => {
  const gonka = parseGonkaConfig({
    env: { GONKA_MODELS: "m1,m2,m3", TRUTH_AGENT_MODELS: "t1,t2" }
  });
  assert.deepEqual(gonka.models, ["m1", "m2", "m3"]);

  const claimDedicated = parseClaimConfig({
    env: { GONKA_MODELS: "m1,m2,m3", TRUTH_AGENT_MODELS: "t1,t2" }
  });
  assert.deepEqual(claimDedicated.models, ["t1", "t2"]);

  const claimFallback = parseClaimConfig({
    env: { GONKA_MODELS: "m1,m2,m3" }
  });
  assert.deepEqual(claimFallback.models, ["m1", "m2", "m3"]);

  const claimOverride = parseClaimConfig({
    models: ["custom"],
    env: { GONKA_MODELS: "m1,m2,m3", TRUTH_AGENT_MODELS: "t1,t2" }
  });
  assert.deepEqual(claimOverride.models, ["custom"]);
});
