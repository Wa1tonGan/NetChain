// Two-track asset sizing for LIVE quotes — the runtime twin of the fixture
// generator's policy (scripts/sui-fixtures.mjs §"Two-track asset sizing").
// The escrow settles the configured stablecoin, so providers must QUOTE in
// that money: on testnet that is real Circle USDC (USD, scaled-down prices so
// faucet-sized escrow pools cover the offers); on localnet the MYRC demo coin
// is quoted in the profile's own currency at profile prices, untouched.
// Same env names + defaults as the fixture generator, so fixture-era and
// live-era offers are always in the same money.
export function quoteAsset(policyCurrency, env = process.env) {
  if ((env.SUI_NETWORK ?? "localnet") !== "testnet") {
    return { currency: policyCurrency, scale: 1 };
  }
  return {
    currency: env.SUI_TESTNET_CURRENCY ?? "USD",
    scale: Number(env.SUI_TESTNET_PRICE_SCALE ?? 0.025)
  };
}
