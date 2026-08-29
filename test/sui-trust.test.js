// Offline tests for Person 3's trust layer (no Sui node required — npm test
// stays green without the toolchain). On-chain behavior is covered by the
// Move unit tests (sui move test) and the harness battery.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { EventLedger } from "../src/sui/events.js";
import { incidentKpis, summarize } from "../src/sui/ttr.js";
import { pemSeed, pemRawPublicKey, keypairFromPem, suiAddressFromPem } from "../src/sui/keys.js";
import { buildVoucher, findOriginalOffer, VoucherError } from "../src/sui/voucher.js";

const BUYER_ADDRESS = "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24";
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
    assert.equal(voucher.amount, 60);
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

  it("rejects non-integer amounts (MYRC has 0 decimals)", () => {
    const selected = load("s2-selected-offer.json");
    // keep the schema's amount==price cross-check happy, then hit the coin rule
    selected.agreement.amount = 60.5;
    selected.selectedProvider.price = 60.5;
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
