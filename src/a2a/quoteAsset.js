// Money the A2A market quotes in. Provider profiles are natively priced in
// affordable USDC-scale amounts (a typical recovery quotes 1–5 USDC — the
// same money the user offers in their SMS budget), so no scale-down happens
// downstream: the quoted price IS the escrowed price. The scale hook remains
// for tiny escrow pools: set SUI_TESTNET_PRICE_SCALE < 1 to shrink quotes at
// quote time (same env contract as the fixture generator).
// Money the A2A market quotes in. Always quotes in USD (Circle USDC).
export function quoteAsset(policyCurrency = "USD", env = process.env) {
  return {
    currency: env.SUI_TESTNET_CURRENCY ?? "USD",
    scale: Number(env.SUI_TESTNET_PRICE_SCALE ?? 1)
  };
}
