/* RecoveryIntent builder — turns the app's live state (degraded downlink,
   demand, the user's protection settings) into a schema-valid intent for the
   gateway. The s2 scenario template supplies the structural fields the UI
   doesn't model (requirement ceilings, link ids); every cross-validated
   number is recomputed here so the intent always passes the gateway's strict
   schema:
     grossShortfallMbps === required − rawAvailable
     service deficitMbps === required − currentlyAllocated
     recoveryDecision === EXTERNAL_RECOVERY_REQUIRED ⇔ recoveryCapacity > 0 */

import { getScenario } from "./live";

export interface IntentInput {
  incidentId: string;
  customerId?: string;
  /** Mbps the market must supply (the "500 Mbps backup" ask). */
  shortageMbps: number;
  /** Current usable downlink after the degradation (null = unknown). */
  degradedMbps: number | null;
  /** The subscriber's protection settings. */
  budgetUsdc: number;
  durationMinutes: number;
  worstLatencyMs?: number | null;
  worstPacketLossPercent?: number | null;
  priorityLevel?: string;
}

type Intent = Record<string, unknown>;

export function buildRecoveryIntent(input: IntentInput): Intent {
  const template = getScenario("s2") as Intent;
  const net = template.networkState as Record<string, unknown>;
  const reqs = template.requirements as Record<string, unknown>;
  const prio = template.priority as Record<string, unknown>;

  const shortage = Math.max(0, Math.round(input.shortageMbps));
  const required = (input.degradedMbps ?? 0) > 0
    ? Math.round(input.degradedMbps!) + shortage
    : (net.requiredCapacityMbps as number);
  const usable = Math.max(0, required - shortage);

  // One aggregate service row keeps the deficit invariant trivially true.
  const level = input.priorityLevel ?? (prio.level as string);
  const affectedServices = [
    {
      serviceId: "RECOVERY-DEMAND",
      priority: level,
      requiredMbps: shortage,
      currentlyAllocatedMbps: 0,
      deficitMbps: shortage,
    },
  ];

  return {
    ...template,
    incidentId: input.incidentId,
    customerId: input.customerId ?? (template.customerId as string),
    networkState: {
      ...net,
      rawAvailableCapacityMbps: usable,
      usableCapacityMbps: usable,
      requiredCapacityMbps: required,
      grossShortfallMbps: shortage,
      shortfallAfterTrafficProtectionMbps: shortage,
      worstLatencyMs: input.worstLatencyMs ?? (net.worstLatencyMs as number | null),
      worstPacketLossPercent:
        input.worstPacketLossPercent ?? (net.worstPacketLossPercent as number | null),
    },
    affectedServices,
    requirements: {
      ...reqs,
      additionalCapacityNeededMbps: shortage,
      recoveryCapacityNeededMbps: shortage,
    },
    priority: {
      level,
      emergencyOverride: level === "P0",
    },
    constraints: {
      maxBudget: input.budgetUsdc,
      durationMinutes: Math.max(1, Math.round(input.durationMinutes)),
    },
    recoveryDecision: shortage > 0 ? "EXTERNAL_RECOVERY_REQUIRED" : "NO_EXTERNAL_RECOVERY_NEEDED",
  };
}
