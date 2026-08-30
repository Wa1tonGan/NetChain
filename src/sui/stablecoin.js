// Stablecoin layer (two-track plan, Track 01): the escrow is generic Coin<T>,
// so the ASSET is configuration, not code. Localnet keeps the MYRC demo coin
// (0 decimals — base units equal human units, which is why every existing
// test/flow is unchanged); testnet uses Circle's NATIVE USDC (6 decimals),
// which is on Sui's gasless-transfer allowlist.
//
// Money of record = INTEGER BASE UNITS. USDC human amounts like 3.15 carry
// cents/sub-cents — doing fee/penalty math in human floats would round the
// platform fee away, so conversions happen exactly here and nowhere else.
export const TESTNET_USDC =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

/**
 * Asset config per network. `type === null` means the caller composes the
 * localnet demo-coin type from the deployed package id.
 */
export function stablecoinConfig(network = process.env.SUI_NETWORK ?? "localnet") {
  if (network === "localnet") {
    return { type: null, decimals: 0, currency: "MYR", name: "MYRC" };
  }
  return {
    type: process.env.STABLECOIN_TYPE ?? TESTNET_USDC,
    decimals: Number(process.env.STABLECOIN_DECIMALS ?? 6),
    currency: process.env.STABLECOIN_CURRENCY ?? "USD",
    name: "USDC"
  };
}

/** Human amount → integer base units. Throws on precision loss or garbage. */
export function toBaseUnits(human, decimals) {
  const n = Number(human);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`amount must be a finite positive number, got ${human}`);
  }
  const scaled = n * 10 ** decimals;
  const base = Math.round(scaled);
  if (Math.abs(scaled - base) > 1e-6 || !Number.isSafeInteger(base)) {
    throw new Error(
      `amount ${human} exceeds ${decimals}-decimal precision for this stablecoin`
    );
  }
  return base;
}

export function fromBaseUnits(base, decimals) {
  return base / 10 ** decimals;
}

/** Display form: no trailing zeros ("7", "3.15", "0.525"). */
export function formatAmount(base, decimals) {
  const fixed = (base / 10 ** decimals).toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
