// Offline tests for the Verification Agent (blueprint §3.1/§4.3/§9/§12):
// deterministic tolerance check (NO LLM), §9 Verification Record, and the
// service flow that commits the verdict on-chain before settling.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { EventLedger } from "../src/sui/events.js";
import { checkDelivery, connectionLog, connectionLogDigest } from "../src/sui/verify.js";
import { TrustService } from "../src/sui/service.js";

const BUYER_ADDRESS = "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24";
const PLATFORM_WALLET = "0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4";
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
const load = (name) => JSON.parse(readFileSync(path.join("fixtures/sui", name), "utf8"));

describe("sui/verify — deterministic delivery check (blueprint §4.3, pure algorithm)", () => {
  it("delivered within tolerance → verdict OK, zero penalty", () => {
    const v = checkDelivery({ promisedCapacity: 200, deliveredSamples: [205, 198, 202, 200] });
    assert.equal(v.avgDeliveredMbps, 201.25);
    assert.equal(v.verdict, "OK");
    assert.equal(v.penaltyPct, 0);
  });

  it("under-delivery beyond tolerance → PENALTY, proportional to the shortfall beyond tolerance", () => {
    const v = checkDelivery({ promisedCapacity: 300, deliveredSamples: [240, 235, 245] });
    assert.equal(v.avgDeliveredMbps, 240);
    assert.equal(v.shortfallPct, 20);
    assert.equal(v.verdict, "PENALTY");
    assert.equal(v.penaltyPct, 10); // 20% shortfall − 10% tolerance
  });

  it("over-delivery never penalizes the provider", () => {
    const v = checkDelivery({ promisedCapacity: 200, deliveredSamples: [250, 260] });
    assert.equal(v.verdict, "OK");
    assert.equal(v.penaltyPct, 0);
  });

  it("tolerance range is configurable via DELIVERY_TOLERANCE_PERCENT", () => {
    process.env.DELIVERY_TOLERANCE_PERCENT = "25";
    try {
      const v = checkDelivery({ promisedCapacity: 300, deliveredSamples: [240] });
      assert.equal(v.verdict, "OK"); // 20% shortfall ≤ 25% tolerance
      assert.equal(v.tolerancePercent, 25);
    } finally {
      delete process.env.DELIVERY_TOLERANCE_PERCENT;
    }
  });

  it("connection log carries the §9 Verification Record fields; digest is deterministic blake2b256", () => {
    // Exactly what service.verifyDelivery assembles from the check outputs.
    const log = connectionLog({
      incidentId: "INC-S2",
      nonce: "INC-S2:PROVIDER-B:001",
      promisedCapacity: 200,
      deliveredSamples: [205, 198],
      sessionStart: 1000,
      sessionEnd: 2000,
      tolerancePercent: 10,
      shortfallPct: 0,
      verdict: "OK",
      penaltyAmount: 0
    });
    // §9 Verification Record fields
    assert.equal(log.incident_id, "INC-S2");
    assert.equal(log.session_start, 1000);
    assert.equal(log.session_end, 2000);
    assert.equal(log.promised_capacity, 200);
    assert.deepEqual(log.delivered_samples, [205, 198]);
    assert.equal(log.tolerance_range.percent, 10);
    assert.equal(log.verdict, "OK");
    assert.equal(log.penalty_amount, 0);

    const digest = connectionLogDigest(log);
    assert.equal(digest.length, 32);
    assert.deepEqual(connectionLogDigest(log), digest); // deterministic
    assert.deepEqual(connectionLogDigest({ ...log, verdict: "PENALTY" }).length, 32);
    assert.notDeepEqual(connectionLogDigest({ ...log, verdict: "PENALTY" }), digest); // evidence binds the verdict
  });
});

describe("sui/service — verifyDelivery → settle (offline, stubbed chain)", () => {
  it("records §9 verdict on-chain, then settles with the penalty compensated to the buyer", async () => {
    execSync("node scripts/sui-fixtures.mjs", { stdio: "ignore" });
    rmSync("events/test-ledger-verify.jsonl", { force: true });
    const ledger = new EventLedger("events/test-ledger-verify.jsonl");
    const service = new TrustService({
      ledger,
      config: {
        network: "localnet",
        packageId: "0xtest",
        escrowId: "0xescrow",
        authorityId: "0xauthority",
        buyer: BUYER_ADDRESS,
        providers: PATHS.providerAddresses
      }
    });
    let txCounter = 0;
    service.client = {
      signAndExecuteTransaction: async () => ({
        status: { success: true },
        digest: `TX-VERIFY-${++txCounter}`,
        events: [{ json: { idempotent: false } }],
        objectTypes: {}
      }),
      waitForTransaction: async () => {}
    };
    process.env.PLATFORM_ADDRESS = PLATFORM_WALLET;
    process.env.PLATFORM_FEE_PERCENT = "5";
    try {
      const committed = await service.commit(load("s2-selected-offer.json"));
      const nonce = committed.voucher.nonce;

      // Under-delivery: promised 200 Mbps, delivered avg 125 → shortfall 37.5%
      // → penalty 27.5% of the provider share (1.8) = 0.495 → floor 0.49.
      const verdict = await service.verifyDelivery("INC-S2", {
        promisedCapacity: 200,
        deliveredSamples: [120, 130],
        sessionStart: 1000,
        sessionEnd: 2000
      });
      assert.equal(verdict.verdict, "PENALTY");
      assert.equal(verdict.penaltyAmount, 495_000); // 27.5% of 1_800_000 base
      assert.equal(verdict.txDigest, "TX-VERIFY-2");

      // §9 record landed in the ledger with its hash.
      const rows = readFileSync("events/test-ledger-verify.jsonl", "utf8")
        .trim().split("\n").map((l) => JSON.parse(l));
      const verifiedRow = rows.find((r) => r.type === "DELIVERY_VERIFIED");
      assert.equal(verifiedRow.nonce, nonce);
      assert.equal(verifiedRow.data.record.verdict, "PENALTY");
      assert.equal(verifiedRow.data.record.penalty_amount, 495_000);
      assert.match(verifiedRow.data.connectionLogHash, /^[0-9a-f]{64}$/);
      assert.equal(verifiedRow.data.connectionLogHash, verdict.connectionLogHash);

      // Settle reads the verdict: provider 1.8 − 0.49 = 1.31, buyer compensated 0.49.
      const settled = await service.activation({ incidentId: "INC-S2", status: "AVAILABLE", recoveredCapacityMbps: 125 });
      assert.equal(settled.status, "SETTLED");
      const settledRow = ledger.lookup(nonce);
      assert.equal(settledRow.penaltyAmount, 495_000);
      assert.equal(settledRow.providerNetAmount, 1_305_000); // 1_800_000 − 495_000
      assert.equal(settledRow.platformFee, 90_000);
      assert.equal(settledRow.platformAddress, PLATFORM_WALLET);
    } finally {
      delete process.env.PLATFORM_ADDRESS;
      delete process.env.PLATFORM_FEE_PERCENT;
    }
  });
});
