function requireNonNegativeNumber(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
}

export function calculateRecoveryRequirements({
  rawAvailableCapacityMbps,
  usableCapacityMbps,
  requiredCapacityMbps,
  trafficReductionMbps = 0
}) {
  requireNonNegativeNumber(
    "rawAvailableCapacityMbps",
    rawAvailableCapacityMbps
  );
  requireNonNegativeNumber("usableCapacityMbps", usableCapacityMbps);
  requireNonNegativeNumber("requiredCapacityMbps", requiredCapacityMbps);
  requireNonNegativeNumber("trafficReductionMbps", trafficReductionMbps);

  if (usableCapacityMbps > rawAvailableCapacityMbps) {
    throw new RangeError(
      "usableCapacityMbps cannot exceed rawAvailableCapacityMbps"
    );
  }

  const grossShortfallMbps = Math.max(
    requiredCapacityMbps - rawAvailableCapacityMbps,
    0
  );
  const shortfallAfterTrafficProtectionMbps = Math.max(
    requiredCapacityMbps - usableCapacityMbps - trafficReductionMbps,
    0
  );

  return {
    grossShortfallMbps,
    shortfallAfterTrafficProtectionMbps,
    additionalCapacityNeededMbps: Math.min(
      grossShortfallMbps,
      shortfallAfterTrafficProtectionMbps
    ),
    recoveryCapacityNeededMbps: shortfallAfterTrafficProtectionMbps
  };
}
