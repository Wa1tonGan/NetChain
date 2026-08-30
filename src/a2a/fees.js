// Platform fee engine (blueprint §1.3, §3.1, §7.1). The Rescue Agent — and
// only the Rescue Agent — computes the platform fee on the PLAN PRICE (the
// provider's quote), never on a wallet balance, and adds it on top:
//   plan 300 + PLATFORM_FEE_PERCENT 5% = customer charged 315 escrowed,
//   settled as 300 to the provider address + 15 to the platform address.

function round2(value) {
  return Math.round(value * 100) / 100;
}

export const DEFAULT_PLATFORM_FEE_PERCENT = 5;

// Env-driven config with the blueprint's example (5%) as the default.
export function feeConfigFromEnv(env = process.env) {
  const percent = Number(env.PLATFORM_FEE_PERCENT ?? DEFAULT_PLATFORM_FEE_PERCENT);

  return {
    platformFeePercent: Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? percent
      : DEFAULT_PLATFORM_FEE_PERCENT,
    // The platform's own payout address for the fee split. Person 3's Move
    // contract sends this slice of the escrow here at settlement.
    platformAddress: env.PLATFORM_ADDRESS ?? "0xPLATFORM_DEMO"
  };
}

export function computeFeeSplit(planPrice, platformFeePercent) {
  const platformFee = round2(planPrice * (platformFeePercent / 100));

  return {
    planPrice: round2(planPrice),
    platformFee,
    providerAmount: round2(planPrice),
    amount: round2(planPrice + platformFee)
  };
}
