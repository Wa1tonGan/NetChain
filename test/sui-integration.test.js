// Offline tests for the live P2↔P3 integration (no Sui node — the chain is
// stubbed; everything above it is REAL: provider agents + rescue agent as
// in-process HTTP servers, real ed25519 signatures, real voucher pipeline).
// Proves: the AI's live Selected Offer → commit → verify → settle runs
// end-to-end with zero fixture handoff, in every integration mode path.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProviderAgent } from "../src/agents/providerAgent.js";
import { createRescueAgent } from "../src/agents/rescueAgent.js";
import { EventLedger } from "../src/sui/events.js";
import { TrustService } from "../src/sui/service.js";
import {
  fetchEnvelope,
  integrationMode,
  pollOnce,
  loadState,
  saveState,
  processEnvelope,
  synthesizeDeliveredSamples,
  INTEGRATION_MODES
} from "../src/sui/integration.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot); // TrustService default paths are repo-relative

const BUYER_ADDRESS = "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24";
const PROVIDER_IDS = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"];
const LEDGER_PATH = "events/test-integration.jsonl";
const STATE_PATH = "events/test-integration-state.json";

// MYRC-era offline defaults: fixtures/keys buyer, localnet money, no platform
// address override — the same shape sui-trust.test.js uses.
const PATHS = {
  offersDir: "fixtures/sui/offers",
  providersDir: "fixtures/providers",
  keysDir: "fixtures/keys",
  providerAddresses: {
    "PROVIDER-A": "0x898b9a61f05ec4589cb8a1833bf0b94e345c45c12d7823055425a74effeb36a9",
    "PROVIDER-B": "0x911c6020630f58f940065290454738def69e1b497adcadd5d8d8e69483fbb984",
    "PROVIDER-C": "0x78a66cfdab75e8775b1cfb37a1b09ba370c9cd221d19a8ec0477f81dd7e63244"
  }
};

let gatewayPort;
let gatewayBaseUrl;
const closeFns = [];

// Stubbed chain: every on-chain call succeeds with a distinct digest. Real
// on-chain behavior is the harness's job (13/13 on testnet).
function stubChain(service, digests = {}) {
  service.client = {
    signAndExecuteTransaction: async () => ({
      status: { success: true },
      digest: digests.digest ?? "TX-STUB",
      events: [{ json: { idempotent: false } }],
      objectTypes: {}
    }),
    waitForTransaction: async () => {},
    waitForObject: async () => {}
  };
}

async function startStack({ incidentId }) {
  // Provider agents on ephemeral ports (real HTTP, real signing keys).
  const { readFile: readF } = await import("node:fs/promises");
  const providers = [];
  for (const providerId of PROVIDER_IDS) {
    const profile = JSON.parse(
      await readF(path.join(projectRoot, "fixtures", "providers", `${providerId.toLowerCase()}.json`), "utf8")
    );
    const privateKeyPem = await readF(
      path.join(projectRoot, "fixtures", "keys", `${providerId.toLowerCase()}.private.pem`),
      "utf8"
    );
    const agent = createProviderAgent({ profile, privateKeyPem });
    const port = await agent.listen(0);
    closeFns.push(() => agent.close());
    providers.push({ ...profile, agentCard: { ...profile.agentCard, endpoint: `http://127.0.0.1:${port}` } });
  }

  // Rescue agent with providers pointing at the ephemeral endpoints. NO Gonka
  // key → deterministic ranking (offline rule: no network).
  const buyerPrivateKeyPem = await readF(
    path.join(projectRoot, "fixtures", "keys", "buyer.private.pem"),
    "utf8"
  );
  const rescue = createRescueAgent({
    providers,
    buyerPrivateKeyPem,
    fees: { platformFeePercent: 5, platformAddress: "0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4" },
    person3: { ackUrl: "" }
  });
  gatewayPort = await rescue.listen(0);
  gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
  closeFns.push(() => rescue.close());

  // Submit the intent through the REAL async gateway route (Person 1's
  // portal contract): 202 now, incident record + envelope via GET /incidents.
  const { readFile } = await import("node:fs/promises");
  const intent = JSON.parse(
    await readFile(path.join(projectRoot, "scenarios", "s2-primary-down-backup-insufficient.json"), "utf8")
  );
  intent.incidentId = incidentId;
  const response = await fetch(`${gatewayBaseUrl}/recovery/intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent })
  });
  assert.equal(response.status, 202);
  return { incidentId, intent };
}

async function waitForSelection(incidentId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${gatewayBaseUrl}/incidents/${encodeURIComponent(incidentId)}`);
    if (response.ok) {
      const record = await response.json();
      if (record.envelope?.status === "SELECTED") return record.envelope;
      if (record.status === "FAILED" || record.envelope?.status === "NO_VIABLE_OFFER") {
        throw new Error(`gateway failed the incident: ${JSON.stringify(record.envelope ?? record.status)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`gateway did not resolve ${incidentId} within ${timeoutMs} ms`);
}

describe("sui/integration — live gateway → trust pipeline (offline, stubbed chain)", () => {
  before(async () => {
    // Localnet money: MYRC fixtures at profile prices (offline suite rule).
    const { execSync } = await import("node:child_process");
    execSync("node scripts/sui-fixtures.mjs", {
      stdio: "ignore",
      env: { ...process.env, SUI_NETWORK: "localnet" }
    });
  });

  after(async () => {
    for (const close of closeFns.reverse()) await close();
    rmSync(LEDGER_PATH, { force: true });
    rmSync(STATE_PATH, { force: true });
    rmSync("events/test-integration-callbacks.jsonl", { force: true });
  });

  it("mode switch validates", () => {
    assert.deepEqual(integrationMode({ SUI_INTEGRATION_MODE: "full" }), "full");
    assert.equal(integrationMode({}), "standalone");
    assert.throws(() => integrationMode({ SUI_INTEGRATION_MODE: "yolo" }), /one of/);
    assert.deepEqual(INTEGRATION_MODES, ["standalone", "one-loop", "full"]);
  });

  it("synthesizeDeliveredSamples is nonce-deterministic and bounded", () => {
    const a = synthesizeDeliveredSamples({ promisedMbps: 300, recoveredMbps: 300, nonce: "N:1" });
    const b = synthesizeDeliveredSamples({ promisedMbps: 300, recoveredMbps: 300, nonce: "N:1" });
    assert.deepEqual(a, b);
    assert.equal(a.length, 8);
    for (const sample of a) {
      assert.ok(sample >= 300 * 0.96 && sample <= 300 * 1.04, `sample ${sample} out of band`);
    }
  });

  it("processEnvelope: SELECTED → commit → verify → settle (self-contained envelope)", async () => {
    const { incidentId } = await startStack({ incidentId: "INC-INT-1" });
    const envelope = await waitForSelection(incidentId);
    assert.equal(envelope.status, "SELECTED");
    // Self-contained: the live envelope embeds the original signed offer.
    assert.ok(envelope.selectedOffer.originalOffer, "live envelope must embed originalOffer");
    assert.equal(envelope.selectedOffer.originalOffer.offerId, envelope.selectedOffer.selectedProvider.offerId);

    rmSync(LEDGER_PATH, { force: true });
    const service = new TrustService({
      ledger: new EventLedger(LEDGER_PATH),
      config: {
        network: "localnet",
        packageId: "0xtest",
        escrowId: "0xescrow",
        authorityId: "0xauthority",
        buyer: BUYER_ADDRESS,
        providers: PATHS.providerAddresses
      }
    });
    stubChain(service, { digest: "TX-INT-1" });

    const result = await processEnvelope(service, envelope, { log: () => {} });
    assert.equal(result.status, "SETTLED");
    assert.equal(result.commit.status, "COMMITTED");
    assert.equal(result.verify.verdict, "OK");
    assert.equal(result.settle.status, "SETTLED");

    // The ledger row correlates with the on-chain commit (voucher digest).
    const row = service.ledger.lookup(envelope.selectedOffer.agreement.nonce);
    assert.equal(row.status, "SETTLED");
    assert.match(row.voucherDigest, /^[0-9a-f]{64}$/);
  });

  it("processEnvelope is idempotent (second run: zero new transactions)", async () => {
    const envelope = await fetchEnvelope(gatewayBaseUrl, "INC-INT-1");
    rmSync(STATE_PATH, { force: true });
    const service = new TrustService({
      ledger: new EventLedger(LEDGER_PATH), // same ledger — nonces already settled
      config: {
        network: "localnet",
        packageId: "0xtest",
        escrowId: "0xescrow",
        authorityId: "0xauthority",
        buyer: BUYER_ADDRESS,
        providers: PATHS.providerAddresses
      }
    });
    stubChain(service, { digest: "TX-SHOULD-NOT-HAPPEN" });

    const again = await processEnvelope(service, envelope, { log: () => {} });
    assert.equal(again.status, "SETTLED");
    assert.equal(again.alreadyDone, true);
    assert.equal(again.commit, undefined, "no second commit may run");
  });

  it("pollOnce (full-mode pass): processes unseen incidents, tracks state", async () => {
    // Fresh incident for the poller pass.
    const { readFile } = await import("node:fs/promises");
    const intent = JSON.parse(
      await readFile(path.join(projectRoot, "scenarios", "s5-demand-surge.json"), "utf8")
    );
    intent.incidentId = "INC-INT-POLL";
    await fetch(`${gatewayBaseUrl}/recovery/intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent })
    });
    await waitForSelection("INC-INT-POLL");

    rmSync(STATE_PATH, { force: true });
    const state = loadState(STATE_PATH);
    const service = new TrustService({
      ledger: new EventLedger(LEDGER_PATH),
      config: {
        network: "localnet",
        packageId: "0xtest",
        escrowId: "0xescrow",
        authorityId: "0xauthority",
        buyer: BUYER_ADDRESS,
        providers: PATHS.providerAddresses
      }
    });
    stubChain(service, { digest: "TX-POLL" });

    const handled = await pollOnce(service, { baseUrl: gatewayBaseUrl, state, log: () => {} });
    const pollRow = handled.find((entry) => entry.incidentId === "INC-INT-POLL");
    assert.ok(pollRow, "poller must handle the unseen incident");
    assert.equal(pollRow.status, "SETTLED");
    saveState(state, STATE_PATH);

    // Second pass: same state → nothing new.
    const handled2 = await pollOnce(service, { baseUrl: gatewayBaseUrl, state, log: () => {} });
    assert.equal(handled2.find((entry) => entry.incidentId === "INC-INT-POLL"), undefined);
  });

  it("pollOnce reports a dead gateway (startPolling is the one that tolerates it)", async () => {
    const state = loadState(STATE_PATH);
    const service = new TrustService({
      ledger: new EventLedger(LEDGER_PATH),
      config: {
        network: "localnet",
        packageId: "0xtest",
        escrowId: "0xescrow",
        authorityId: "0xauthority",
        buyer: BUYER_ADDRESS,
        providers: PATHS.providerAddresses
      }
    });
    stubChain(service);
    await assert.rejects(
      () => pollOnce(service, { baseUrl: "http://127.0.0.1:1", state, log: () => {} }),
      /fetch failed|ECONNREFUSED/
    );

    // The full-mode poller must survive a dead gateway without an unhandled
    // rejection (node:test fails the run on one — surviving IS the assert).
    const stop = await import("../src/sui/integration.js").then(
      ({ startPolling }) => startPolling(service, { baseUrl: "http://127.0.0.1:1", intervalMs: 50, log: () => {} })
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();
  });
});
