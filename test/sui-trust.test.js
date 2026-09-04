// Offline tests for Person 3's trust layer (no Sui node required — npm test
// stays green without the toolchain). On-chain behavior is covered by the
// Move unit tests (sui move test) and the harness battery.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { EventLedger } from "../src/sui/events.js";
import { incidentKpis, summarize } from "../src/sui/ttr.js";
import { pemSeed, pemRawPublicKey, keypairFromPem, suiAddressFromPem } from "../src/sui/keys.js";
import { buildVoucher, findOriginalOffer, voucherDigest, VoucherError } from "../src/sui/voucher.js";
import { TrustService } from "../src/sui/service.js";

const BUYER_ADDRESS = "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24";
// Platform fee address (blueprint §1.3/§3.3) — the team's real testnet wallet.
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

// Fixture stability for the offline suite: the last on-chain run may have
// left USD fixtures on disk (testnet price-scaled). The offline suite always
// tests the localnet MYRC path, so regenerate MYRC fixtures before any read.
process.env.SUI_NETWORK = "localnet";
execSync("node scripts/sui-fixtures.mjs", {
  stdio: "ignore",
  env: { ...process.env, SUI_NETWORK: "localnet" }
});

describe("sui/keys — fixture PEM ↔ Sui identity", () => {
  it("derives the known buyer Sui address from the fixture key", () => {
    const pem = readFileSync("fixtures/keys/buyer.public.pem", "utf8");
    assert.equal(suiAddressFromPem(pem), BUYER_ADDRESS);
  });

  it("keypair from PEM seed matches the PEM public key and address", () => {
    const priv = readFileSync("fixtures/keys/buyer.private.pem", "utf8");
    const pub = readFileSync("fixtures/keys/buyer.public.pem", "utf8");
    const keypair = keypairFromPem(priv);
    assert.equal(Buffer.from(keypair.getPublicKey().toRawBytes()).toString("hex"),
      Buffer.from(pemRawPublicKey(pub)).toString("hex"));
    assert.equal(keypair.toSuiAddress(), suiAddressFromPem(pub));
  });

  it("extracts 32-byte seeds and public keys from PKCS#8/SPKI PEMs", () => {
    const priv = readFileSync("fixtures/keys/buyer.private.pem", "utf8");
    const pub = readFileSync("fixtures/keys/buyer.public.pem", "utf8");
    assert.equal(pemSeed(priv).length, 32);
    assert.equal(pemRawPublicKey(pub).length, 32);
  });
});

describe("sui/voucher — Selected Offer → Move commit args", () => {
  it("builds a verified voucher from a fresh fixture (clock overridden)", () => {
    const selected = load("s2-selected-offer.json");
    const nowMs = Date.parse(selected.agreement.expiry) - 1000;
    const voucher = buildVoucher(selected, PATHS, { nowMs });
    assert.equal(voucher.incidentId, "INC-S2");
    assert.equal(voucher.nonce, "INC-S2:PROVIDER-B:001");
    assert.equal(voucher.planAmount, 1.8); // buyer-signed plan price (human units; base-unit fields follow)
    assert.equal(voucher.providerAmount, 180); // §1.2 full quote, base units (2dp sen)
    assert.equal(voucher.amount, 189); // escrow locks plan + fee, base units
    assert.equal(voucher.buyerPk.length, 32);
    assert.equal(voucher.providerPk.length, 32);
    assert.equal(voucher.buyerSig.length, 64);
    assert.equal(voucher.providerSig.length, 64);
    assert.ok(voucher.providerAddress.startsWith("0x"));
  });

  it("rejects tampered voucher payloads with SIGNATURE_INVALID", () => {
    const selected = load("s2-selected-offer.json");
    const nowMs = Date.parse(selected.agreement.expiry) - 1000;
    const tampered = structuredClone(selected);
    tampered.agreement.durationMinutes = 999; // signed field, no schema cross-check → sig must catch it
    assert.throws(() => buildVoucher(tampered, PATHS, { nowMs }), (err) =>
      err instanceof VoucherError && err.code === "SIGNATURE_INVALID");
  });

  it("rejects expired vouchers with VOUCHER_EXPIRED", () => {
    const selected = load("s2-selected-offer.json");
    assert.throws(() => buildVoucher(selected, PATHS, { nowMs: Date.parse(selected.agreement.expiry) + 1 }),
      (err) => err instanceof VoucherError && err.code === "VOUCHER_EXPIRED");
  });

  it("rejects amounts beyond MYRC's 2-decimal precision (sen)", () => {
    const selected = load("s2-selected-offer.json");
    // keep the schema's fee-split cross-checks happy (fee 0 @ 0%), then hit
    // the coin rule on the buyer-signed plan price
    selected.selectedProvider.price = 60.505;
    selected.agreement.planPrice = 60.505;
    selected.agreement.platformFeePercent = 0;
    selected.agreement.platformFee = 0;
    selected.agreement.providerAmount = 60.505;
    selected.agreement.amount = 60.505;
    assert.throws(() => buildVoucher(selected, PATHS, { nowMs: Date.parse(selected.agreement.expiry) - 1000 }),
      (err) => err instanceof VoucherError && err.code === "NON_INTEGRAL_AMOUNT");
  });

  it("finds the original signed offer by offerId", () => {
    const selected = load("s2-selected-offer.json");
    const offer = findOriginalOffer(PATHS.offersDir, selected);
    assert.equal(offer.offerId, selected.selectedProvider.offerId);
    assert.ok(offer.signature.value.length >= 88); // 64-byte ed25519 = 88 base64 chars
  });
});

describe("sui/voucher — platform fee split (blueprint §1.3/§3.3)", () => {
  function withEnv(map, fn) {
    const prev = {};
    for (const [k, v] of Object.entries(map)) {
      prev[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }
  const expiryIn = (selected) => Date.parse(selected.agreement.expiry) - 1000;

  it("charges the fee on top: provider keeps the full quote, escrow locks plan + fee", () => {
    withEnv({ PLATFORM_ADDRESS: PLATFORM_WALLET, PLATFORM_FEE_PERCENT: "5" }, () => {
      const selected = load("s2-selected-offer.json");
      const voucher = buildVoucher(selected, PATHS, { nowMs: expiryIn(selected) });
      assert.equal(voucher.planAmount, 1.8); // buyer-signed plan price
      assert.equal(voucher.platformFee, 9); // signed platformFee (5% of 1.8), base units
      assert.equal(voucher.amount, 189); // TOTAL locked on-chain
      assert.equal(voucher.providerAmount, 180); // §1.2: full quote stays with provider (base units)
      assert.equal(voucher.platformAddress, PLATFORM_WALLET);
    });
  });

  it("fee comes from the buyer-SIGNED agreement, not the service env", () => {
    // The Rescue Agent signed platformFee = 0.09 (5% of 1.8) into the agreement.
    // A service running with a different PLATFORM_FEE_PERCENT must NOT
    // recompute — the buyer approved exactly what is signed.
    withEnv({ PLATFORM_ADDRESS: PLATFORM_WALLET, PLATFORM_FEE_PERCENT: "9" }, () => {
      const selected = load("s2-selected-offer.json");
      const voucher = buildVoucher(selected, PATHS, { nowMs: expiryIn(selected) });
      assert.equal(voucher.platformFee, 9); // signed, not recomputed at 9%
      assert.equal(voucher.amount, 189);
    });
  });

  it("platformAddress prefers the buyer-signed agreement over service env", () => {
    withEnv({ PLATFORM_ADDRESS: "0x0000000000000000000000000000000000000009" }, () => {
      const selected = load("s2-selected-offer.json");
      const voucher = buildVoucher(selected, PATHS, { nowMs: expiryIn(selected) });
      assert.equal(voucher.platformAddress, PLATFORM_WALLET); // signed address wins
    });
  });

  it("voucherDigest = blake2b256(buyer bytes, 32) — correlates the ledger row with the on-chain event", () => {
    // Known blake2b-256 vector for the empty input — pins dkLen=32 (blake2b512 would differ).
    assert.equal(
      Buffer.from(voucherDigest(new Uint8Array(0))).toString("hex"),
      "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"
    );
    const selected = load("s2-selected-offer.json");
    const voucher = buildVoucher(selected, PATHS, { nowMs: expiryIn(selected) });
    assert.equal(voucher.voucherDigest.length, 32);
    assert.deepEqual(voucher.voucherDigest, voucherDigest(voucher.buyerMsg));
  });
});

describe("sui/service — COMMITTED row carries the split (offline, stubbed chain)", () => {
  it("ledger COMMITTED row exposes providerAmount/platformFee/platformAddress/voucherDigest", async () => {
    // Fresh fixtures (offline regen, no chain) — service.commit has no clock override.
    execSync("node scripts/sui-fixtures.mjs", { stdio: "ignore" });
    rmSync("events/test-ledger-fee.jsonl", { force: true });
    const ledger = new EventLedger("events/test-ledger-fee.jsonl");
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
    service.client = {
      signAndExecuteTransaction: async () => ({
        status: { success: true },
        digest: "TX-FEE",
        events: [{ json: { idempotent: false } }],
        objectTypes: {}
      }),
      waitForTransaction: async () => {}
    };
    const nonce = load("s2-selected-offer.json").agreement.nonce;
    process.env.PLATFORM_ADDRESS = PLATFORM_WALLET;
    process.env.PLATFORM_FEE_PERCENT = "5";
    let result;
    try {
      result = await service.commit(load("s2-selected-offer.json"));
    } finally {
      delete process.env.PLATFORM_ADDRESS;
      delete process.env.PLATFORM_FEE_PERCENT;
    }
    assert.equal(result.status, "COMMITTED");
    assert.equal(result.voucher.platformFee, 9);
    assert.equal(result.voucher.amount, 189);

    const row = ledger.lookup(nonce);
    assert.equal(row.amount, 189);
    assert.equal(row.providerAmount, 180);
    assert.equal(row.platformFee, 9);
    assert.equal(row.platformAddress, PLATFORM_WALLET);
    assert.match(row.voucherDigest, /^[0-9a-f]{64}$/);
  });
});

describe("sui/events — ledger registry + restart resilience", () => {
  it("indexes lifecycle events only and survives rebuild", () => {
    rmSync("events/test-ledger.jsonl", { force: true });
    const ledger = new EventLedger("events/test-ledger.jsonl");
    ledger.emit("VERIFIED", { incidentId: "INC-T", nonce: "N1" });
    assert.equal(ledger.lookup("N1"), null, "VERIFIED alone must not create commitment state");

    const committed = ledger.emit("COMMITTED", { incidentId: "INC-T", nonce: "N1", txDigest: "TX1", data: { amount: 60, idempotent: false } });
    assert.equal(committed.seq >= 2, true);
    assert.equal(ledger.lookup("N1").status, "COMMITTED");

    ledger.emit("SETTLED", { incidentId: "INC-T", nonce: "N1", txDigest: "TX2" });
    assert.equal(ledger.lookup("N1").status, "SETTLED");

    const rebuilt = new EventLedger("events/test-ledger.jsonl");
    assert.equal(rebuilt.lookup("N1").status, "SETTLED");
    assert.equal(rebuilt.lookup("N1").amount, 60);
  });

  it("byIncident filters commitments", () => {
    rmSync("events/test-ledger-2.jsonl", { force: true });
    const ledger = new EventLedger("events/test-ledger-2.jsonl");
    ledger.emit("COMMITTED", { incidentId: "INC-A", nonce: "NA", data: {} });
    ledger.emit("COMMITTED", { incidentId: "INC-B", nonce: "NB", data: {} });
    assert.equal(ledger.byIncident("INC-A").length, 1);
    assert.equal(ledger.byIncident("INC-A")[0].nonce, "NA");
  });
});

describe("sui/ttr — KPI aggregation", () => {
  it("computes blueprint §6.1 timings per incident", () => {
    const kpis = incidentKpis(
      { incidentId: "I", selectionMode: "NORMAL", selectedProvider: { providerId: "P" }, agreement: { amount: 60, currency: "MYR" }, timing: { tDetect: 1000, tDecide: 3500 } },
      { tActivateMs: 5000, tRecoverMs: 8000, outcome: "RECOVERED" }
    );
    assert.equal(kpis.timeToDecisionMs, 2500);
    assert.equal(kpis.timeToActivationMs, 4000);
    assert.equal(kpis.timeToRecoveryMs, 7000);
    assert.equal(kpis.outcome, "RECOVERED");
  });

  it("summarizes battery results into duplicate-safety + success rate", () => {
    const summary = summarize([
      { kind: "CHECK", name: "duplicate blocked", passed: true },
      { kind: "CHECK", name: "duplicate retry", passed: true },
      { kind: "INCIDENT", kpis: { incidentId: "A", outcome: "RECOVERED", timeToRecoveryMs: 500 } }
    ]);
    assert.equal(summary.incidentsTotal, 1);
    assert.equal(summary.recoverySuccessRate, 1);
    assert.equal(summary.timeToRecovery.avgMs, 500);
    assert.equal(summary.duplicateSafety.allBlocked, true);
  });
});
