import { z } from "zod";

// Provider Request = what the Rescue Agent broadcasts to every ready
// provider in parallel. Blueprint §9 "Provider Request", restated in
// camelCase to match the RecoveryIntent contract from Person 1.
//
// Field derivation lives in ../buildProviderRequest.js:
//   requestedCapacityMbps   <- requirements.recoveryCapacityNeededMbps
//   requiredProfile         <- requirements.maximumLatencyMs /
//                              maximumPacketLossPercent / minimumReliability
//   durationMinutes         <- constraints.durationMinutes
//   maxBudget               <- constraints.maxBudget
//   targetActivationTimeMs  <- requirements.targetActivationTimeMs
//   bidDeadlineMs           <- floor(targetActivationTimeMs / 2)
//   emergencyOverride       <- priority.emergencyOverride
//   requestedAction         <- intent.requestedAction
//   currency                <- "MYR" (documented MVP assumption; Person 1's
//                              RecoveryIntent carries no currency field)
//   preAuthorized           <- always true: payment is backed by Person 3's
//                              pre-funded Sui escrow before any incident
//                              (blueprint §4.1 / §6-E), so providers may
//                              activate without a mid-incident payment flow.

export const providerRequestSchema = z
  .object({
    requestId: z.string().min(1),
    incidentId: z.string().min(1),
    customerId: z.string().min(1),
    requestedCapacityMbps: z.number().finite().positive(),
    requiredProfile: z
      .object({
        maxLatencyMs: z.number().finite().nonnegative(),
        maxPacketLossPercent: z.number().finite().nonnegative(),
        minReliability: z.number().min(0).max(1)
      })
      .strict(),
    durationMinutes: z.number().int().positive(),
    maxBudget: z.number().finite().nonnegative(),
    currency: z.enum(["MYR", "USD"]),
    targetActivationTimeMs: z.number().int().positive(),
    bidDeadlineMs: z.number().int().positive(),
    emergencyOverride: z.boolean(),
    requestedAction: z.string().min(1),
    preAuthorized: z.literal(true)
  })
  .strict()
  .superRefine((request, context) => {
    if (request.bidDeadlineMs >= request.targetActivationTimeMs) {
      context.addIssue({
        code: "custom",
        path: ["bidDeadlineMs"],
        message:
          "bidDeadlineMs must leave time to activate within targetActivationTimeMs"
      });
    }
  });
