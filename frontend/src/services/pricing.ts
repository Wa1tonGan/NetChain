/* Money & SMS-request pricing rules.
   Simple, transparent pricing: pay-as-you-go per recovery. */

export const RATE = 0.00084;
export const PLATFORM_FEE_PERCENT = 5; // 5%
export const PLATFORM_FEE = 0.30; // Min USDC 0.30
export const DEMAND_MBPS = 500;
export const UNDER_DELIVERY_RATIO = 0.9;

export const rm = (n: number): string =>
  "USDC " + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rm0 = (n: number): string => (Number.isInteger(n) ? "USDC " + n : rm(n));

export const costOf = (mbps: number, min: number): number => +(mbps * min * RATE).toFixed(2);

export const calcPlatformFee = (planCost: number): number => {
  const percentageFee = +(planCost * (PLATFORM_FEE_PERCENT / 100)).toFixed(2);
  return Math.max(PLATFORM_FEE, percentageFee);
};

export interface SplitBreakdown {
  planPrice: number;
  platformFee: number;
  totalEscrow: number;
  providerAddress: string;
  platformAddress: string;
}

export const calcSplitSettlement = (totalCost: number): SplitBreakdown => {
  const fee = calcPlatformFee(totalCost);
  const plan = Math.max(0, +(totalCost - fee).toFixed(2));
  return {
    planPrice: plan,
    platformFee: fee,
    totalEscrow: totalCost,
    providerAddress: "0x3b91a78824f923b01a88b1cc92487e419823ad760334",
    platformAddress: "0x71f3a9b2c44e5d16820ccb7713a2ff0e999a82c5512",
  };
};

/** Fit the requested duration into the user's budget on 15-minute plan steps. */
export function adjustPlan(
  min: number,
  budget: number,
  mbps: number
): { min: number; cost: number; adjusted: boolean } {
  min = Math.max(15, Math.round(min / 15) * 15);
  let adjusted = false;
  while (costOf(mbps, min) > budget && min > 15) {
    min -= 15;
    adjusted = true;
  }
  const cost = costOf(mbps, min);
  if (cost > budget) adjusted = true;
  return { min, cost, adjusted };
}

export interface ParsedSms {
  min: number;
  budget: number;
}

/** Parse SMS reply like "30 min, USDC 14" into duration + budget.
    Accepts USDC-both-ways ("USDC 14", "14 usdc") and the legacy "RM 14". */
export function parseSms(text: string, defaultBudget: number): ParsedSms | null {
  const m = /(\d+)\s*(?:m\b|min\b|mins\b|minute|minutes)\b/i.exec(text || "");
  const b =
    /(?:usdc|rm)\s*(\d+(?:\.\d{1,2})?)\b/i.exec(text || "") ??
    /(\d+(?:\.\d{1,2})?)\s*usdc\b/i.exec(text || "");
  if (!m && !b) return null;
  return {
    min: m ? Math.max(5, parseInt(m[1], 10)) : 30,
    budget: b ? parseFloat(b[1]) : defaultBudget,
  };
}
