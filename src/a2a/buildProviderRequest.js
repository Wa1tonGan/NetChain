// RecoveryIntent (Person 1) -> Provider Request (Person 2).
// The mapping table is documented in ../schemas/providerRequest.js.

export function buildProviderRequest(intent) {
  if (intent.recoveryDecision === "NO_EXTERNAL_RECOVERY_NEEDED") {
    return null;
  }

  return {
    requestId: `${intent.incidentId}:req:001`,
    incidentId: intent.incidentId,
    customerId: intent.customerId,
    requestedCapacityMbps: intent.requirements.recoveryCapacityNeededMbps,
    requiredProfile: {
      maxLatencyMs: intent.requirements.maximumLatencyMs,
      maxPacketLossPercent: intent.requirements.maximumPacketLossPercent,
      minReliability: intent.requirements.minimumReliability
    },
    durationMinutes: intent.constraints.durationMinutes,
    maxBudget: intent.constraints.maxBudget,
    currency: "MYR",
    targetActivationTimeMs: intent.requirements.targetActivationTimeMs,
    bidDeadlineMs: Math.floor(intent.requirements.targetActivationTimeMs / 2),
    emergencyOverride: intent.priority.emergencyOverride,
    requestedAction: intent.requestedAction,
    preAuthorized: true
  };
}
