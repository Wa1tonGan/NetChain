/* Money & SMS-request pricing rules.
   RATE: RM per Mbps per minute (demo rate).
   The individual user has no backup network: when the primary line
   fails, the agreed capacity equals the full demand (500 Mbps). */

export const RATE = 0.00084;
export const PLATFORM_FEE = 0.30;
export const DEMAND_MBPS = 500;
export const UNDER_DELIVERY_RATIO = 0.9; // provider delivers 90% → 10% penalty refund

export const rm = (n: number): string =>
  "RM " + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rm0 = (n: number): string => (Number.isInteger(n) ? "RM " + n : rm(n));

export const costOf = (mbps: number, min: number): number => +(mbps * min * RATE).toFixed(2);

/** Fit the requested duration into the user's budget on 15-minute plan steps. */
export function adjustPlan(
  min: number,
  budget: number,
  mbps: number
): { min: number; cost: number; adjusted: boolean } {
  min = Math.max(15, Math.round(min / 15) * 15); // plans come in 15-minute steps
  let adjusted = false;
  while (costOf(mbps, min) > budget && min > 15) {
    min -= 15;
    adjusted = true;
  }
  const cost = costOf(mbps, min);
  if (cost > budget) adjusted = true; // clamped at the 15-minute minimum
  return { min, cost, adjusted };
}

export interface ParsedSms {
  min: number;
  budget: number;
}

/** Parse a free-text SMS reply like "45 min, RM 14" into duration + budget. */
export function parseSms(text: string, defaultBudget: number): ParsedSms | null {
  const m = /(\d+)\s*(?:m\b|min\b|mins\b|minute|minutes)\b/i.exec(text || "");
  const b = /rm\s*(\d+(?:\.\d{1,2})?)\b/i.exec(text || "");
  if (!m && !b) return null;
  return {
    min: m ? Math.max(5, parseInt(m[1], 10)) : 30,
    budget: b ? parseFloat(b[1]) : defaultBudget,
  };
}
