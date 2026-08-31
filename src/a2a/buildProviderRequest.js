// RecoveryIntent (Person 1) -> Provider Request (Person 2).
// The mapping table is documented in ../schemas/providerRequest.js.
// Currency: the money the escrow settles (quoteAsset mirrors the fixture
// generator — testnet real-USDC USD, localnet profile currency).
import { quoteAsset } from "./quoteAsset.js";

export function buildProviderRequest(intent, env = process.env) {
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
    currency: quoteAsset("MYR", env).currency,
    targetActivationTimeMs: intent.requirements.targetActivationTimeMs,
    bidDeadlineMs: Math.floor(intent.requirements.targetActivationTimeMs / 2),
    emergencyOverride: intent.priority.emergencyOverride,
    requestedAction: intent.requestedAction,
    preAuthorized: true
  };
}
