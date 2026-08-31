// Offline tests for the stablecoin layer (two-track plan): real Circle USDC
// on testnet (6 decimals — money of record is integer base units), the MYRC
// demo coin on localnet (0 decimals — base units == human units, so every
// existing test/assertion keeps working unchanged).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  stablecoinConfig,
  toBaseUnits,
  fromBaseUnits,
  formatAmount
} from "../src/sui/stablecoin.js";

const TESTNET_USDC =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

describe("sui/stablecoin — network asset config (Track 01)", () => {
  it("testnet resolves to Circle's allowlisted USDC (6 decimals, USD)", () => {
    const cfg = stablecoinConfig("testnet");
    assert.equal(cfg.type, TESTNET_USDC);
    assert.equal(cfg.decimals, 6);
    assert.equal(cfg.currency, "USD");
    assert.equal(cfg.name, "USDC");
  });

  it("STABLECOIN_TYPE/DECIMALS/CURRENCY env overrides testnet config", () => {
    process.env.STABLECOIN_TYPE = "0xabc::coin::COIN";
    process.env.STABLECOIN_DECIMALS = "2";
    process.env.STABLECOIN_CURRENCY = "EUR";
    try {
      const cfg = stablecoinConfig("testnet");
      assert.equal(cfg.type, "0xabc::coin::COIN");
      assert.equal(cfg.decimals, 2);
      assert.equal(cfg.currency, "EUR");
    } finally {
      delete process.env.STABLECOIN_TYPE;
      delete process.env.STABLECOIN_DECIMALS;
      delete process.env.STABLECOIN_CURRENCY;
    }
  });

  it("localnet keeps the MYRC demo coin (2 decimals = sen, MYR, type composed from package)", () => {
    const cfg = stablecoinConfig("localnet");
    assert.equal(cfg.type, null); // composed with packageId by the caller
    assert.equal(cfg.decimals, 2); // base unit = 1 sen (fractional fees representable)
    assert.equal(cfg.currency, "MYR");
    assert.equal(cfg.name, "MYRC");
  });
});

describe("sui/stablecoin — exact base-unit money math", () => {
  it("converts human USDC (6 decimals) to integer base units", () => {
    assert.equal(toBaseUnits(3.15, 6), 3_150_000);
    assert.equal(toBaseUnits(0.01, 6), 10_000); // gasless minimum
    assert.equal(toBaseUnits(12, 6), 12_000_000);
    assert.equal(toBaseUnits(60, 0), 60); // MYRC: base == human
  });

  it("rejects amounts with more precision than the coin supports", () => {
    assert.throws(() => toBaseUnits(0.0000005, 6), /precision/i);
    assert.throws(() => toBaseUnits(3.155, 2), /precision/i);
  });

  it("rejects non-finite / negative amounts", () => {
    assert.throws(() => toBaseUnits(-1, 6), /amount/i);
    assert.throws(() => toBaseUnits("abc", 6), /amount/i);
    assert.throws(() => toBaseUnits(Number.MAX_VALUE, 6), /amount/i);
  });

  it("round-trips base ↔ human and formats for display", () => {
    assert.equal(fromBaseUnits(3_150_000, 6), 3.15);
    assert.equal(formatAmount(3_150_000, 6), "3.15");
    assert.equal(formatAmount(525_000, 6), "0.525");
    assert.equal(formatAmount(7_000_000, 6), "7"); // no trailing zeros
    assert.equal(formatAmount(63, 0), "63");
  });

  it("fee math in base units never loses the platform fee to rounding", () => {
    // 5% of 3.15 USDC = 0.1575 — human-unit floor would round it to zero.
    const base = toBaseUnits(3.15, 6);
    const fee = Math.floor((base * 5) / 100);
    assert.equal(fee, 157_500);
    assert.equal(formatAmount(base + fee, 6), "3.3075");
  });
});
