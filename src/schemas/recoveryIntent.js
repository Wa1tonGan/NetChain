import { z } from "zod";

export const severityValues = [
  "info",
  "warning",
  "high",
  "critical",
  "life_critical"
];

export const priorityValues = ["P0", "P1", "P2", "P3", "P4", "P5"];

export const detectedConditionValues = [
  "LINK_FAILURE",
  "NETWORK_DEGRADATION",
  "HIGH_LATENCY",
  "HIGH_PACKET_LOSS",
  "CAPACITY_SHORTFALL",
  "DEMAND_SURGE",
  "MEDICAL_EMERGENCY",
  "DISASTER_EMERGENCY",
  "INDIVIDUAL_PRIORITY_REQUEST"
];

export const requestedActionValues = [
  "NO_ACTION",
  "PROTECT_EXISTING_CAPACITY",
  "FIND_ADDITIONAL_CONNECTIVITY",
  "FIND_LOWER_LATENCY_PATH",
  "FIND_LOWER_PACKET_LOSS_PATH",
  "ACQUIRE_BURST_CAPACITY",
  "RESTORE_CONNECTIVITY",
  "EMERGENCY_RECOVERY"
];

const nonNegativeNumber = z.number().finite().nonnegative();
const positiveInteger = z.number().int().positive();

const affectedServiceSchema = z
  .object({
    serviceId: z.string().min(1),
    priority: z.enum(priorityValues),
    requiredMbps: nonNegativeNumber,
    currentlyAllocatedMbps: nonNegativeNumber,
    deficitMbps: nonNegativeNumber
  })
  .strict()
  .superRefine((service, context) => {
    const expectedDeficit = Math.max(
      service.requiredMbps - service.currentlyAllocatedMbps,
      0
    );

    if (service.deficitMbps !== expectedDeficit) {
      context.addIssue({
        code: "custom",
        path: ["deficitMbps"],
        message: `Expected deficitMbps to equal ${expectedDeficit}`
      });
    }
  });

export const recoveryIntentSchema = z
  .object({
    incidentId: z.string().min(1),
    customerId: z.string().min(1),
    trigger: z
      .object({
        source: z.enum(["network", "event"]),
        type: z.string().min(1),
        severity: z.enum(severityValues)
      })
      .strict(),
    detectedConditions: z.array(z.enum(detectedConditionValues)),
    networkState: z
      .object({
        activeLinkIds: z.array(z.string().min(1)),
        unavailableLinkIds: z.array(z.string().min(1)),
        rawAvailableCapacityMbps: nonNegativeNumber,
        usableCapacityMbps: nonNegativeNumber,
        requiredCapacityMbps: nonNegativeNumber,
        grossShortfallMbps: nonNegativeNumber,
        shortfallAfterTrafficProtectionMbps: nonNegativeNumber,
        worstLatencyMs: nonNegativeNumber.nullable(),
        worstPacketLossPercent: nonNegativeNumber.nullable()
      })
      .strict(),
    affectedServices: z.array(affectedServiceSchema),
    requirements: z
      .object({
        additionalCapacityNeededMbps: nonNegativeNumber,
        recoveryCapacityNeededMbps: nonNegativeNumber,
        maximumLatencyMs: nonNegativeNumber,
        maximumPacketLossPercent: nonNegativeNumber,
        minimumReliability: z.number().min(0).max(1),
        targetActivationTimeMs: positiveInteger
      })
      .strict(),
    priority: z
      .object({
        level: z.enum(priorityValues),
        emergencyOverride: z.boolean()
      })
      .strict(),
    constraints: z
      .object({
        maxBudget: nonNegativeNumber,
        durationMinutes: positiveInteger
      })
      .strict(),
    recoveryDecision: z.enum([
      "NO_EXTERNAL_RECOVERY_NEEDED",
      "EXTERNAL_RECOVERY_REQUIRED"
    ]),
    requestedAction: z.enum(requestedActionValues)
  })
  .strict()
  .superRefine((intent, context) => {
    const expectedGrossShortfall = Math.max(
      intent.networkState.requiredCapacityMbps -
        intent.networkState.rawAvailableCapacityMbps,
      0
    );

    if (intent.networkState.grossShortfallMbps !== expectedGrossShortfall) {
      context.addIssue({
        code: "custom",
        path: ["networkState", "grossShortfallMbps"],
        message: `Expected grossShortfallMbps to equal ${expectedGrossShortfall}`
      });
    }

    if (
      intent.requirements.additionalCapacityNeededMbps >
      intent.requirements.recoveryCapacityNeededMbps
    ) {
      context.addIssue({
        code: "custom",
        path: ["requirements", "additionalCapacityNeededMbps"],
        message: "Additional capacity cannot exceed traffic requiring recovery"
      });
    }

    const externalRecoveryRequired =
      intent.recoveryDecision === "EXTERNAL_RECOVERY_REQUIRED";
    const recoveryCapacityNeeded =
      intent.requirements.recoveryCapacityNeededMbps;

    if (externalRecoveryRequired !== (recoveryCapacityNeeded > 0)) {
      context.addIssue({
        code: "custom",
        path: ["recoveryDecision"],
        message:
          "Recovery decision must agree with recoveryCapacityNeededMbps"
      });
    }
  });

export function validateRecoveryIntent(value) {
  return recoveryIntentSchema.parse(value);
}
