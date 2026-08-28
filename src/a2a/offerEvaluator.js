// Deterministic offer evaluation + selection. This is the local, no-LLM
// fallback path required by blueprint §6-C/§6-F: Gonka will later replace
// rankOffers(), but viability and the emergency first-viable rule stay
// deterministic no matter what.

const ACTIVATION_CLASS_RANK = Object.fromEntries(
  ["INSTANT", "FAST", "MEDIUM", "SLOW"].map((name, index) => [name, index])
);

function reason(code, detail) {
  return { code, detail };
}

export function evaluateOffer(offer, request) {
  const reasons = [];

  if (!offer.available) {
    reasons.push(reason("PROVIDER_UNAVAILABLE", "provider marked itself unavailable"));
  }

  if (offer.capacityMbps < request.requestedCapacityMbps) {
    reasons.push(
      reason(
        "INSUFFICIENT_CAPACITY",
        `offered ${offer.capacityMbps} Mbps < ${request.requestedCapacityMbps} Mbps required`
      )
    );
  }

  if (offer.latencyMs > request.requiredProfile.maxLatencyMs) {
    reasons.push(
      reason(
        "LATENCY_EXCEEDED",
        `offered ${offer.latencyMs} ms latency > ${request.requiredProfile.maxLatencyMs} ms allowed`
      )
    );
  }

  if (offer.packetLossPercent > request.requiredProfile.maxPacketLossPercent) {
    reasons.push(
      reason(
        "PACKET_LOSS_EXCEEDED",
        `offered ${offer.packetLossPercent}% loss > ${request.requiredProfile.maxPacketLossPercent}% allowed`
      )
    );
  }

  if (offer.reliabilityScore < request.requiredProfile.minReliability) {
    reasons.push(
      reason(
        "RELIABILITY_BELOW_MINIMUM",
        `reliability ${offer.reliabilityScore} < ${request.requiredProfile.minReliability} required`
      )
    );
  }

  if (offer.currency !== request.currency) {
    reasons.push(
      reason("BUDGET_EXCEEDED", `quoted in ${offer.currency}, request is in ${request.currency}`)
    );
  } else if (offer.price > request.maxBudget) {
    reasons.push(
      reason("BUDGET_EXCEEDED", `price ${offer.price} > budget ${request.maxBudget}`)
    );
  }

  if (offer.expectedActivationTimeMs > request.targetActivationTimeMs) {
    reasons.push(
      reason(
        "ACTIVATION_TOO_SLOW",
        `expected activation ${offer.expectedActivationTimeMs} ms > ${request.targetActivationTimeMs} ms target`
      )
    );
  }

  return { viable: reasons.length === 0, reasons };
}

// NORMAL mode: rank viable offers by activation speed, then price, then
// reliability. Arrival order is deliberately ignored.
export function rankOffers(viableArrivals) {
  return [...viableArrivals].sort((left, right) => {
    const classDifference =
      ACTIVATION_CLASS_RANK[left.offer.expectedActivationClass] -
      ACTIVATION_CLASS_RANK[right.offer.expectedActivationClass];

    if (classDifference !== 0) {
      return classDifference;
    }

    const priceDifference = left.offer.price - right.offer.price;

    if (priceDifference !== 0) {
      return priceDifference;
    }

    return right.offer.reliabilityScore - left.offer.reliabilityScore;
  });
}

// EMERGENCY mode: the first *viable* offer to arrive wins outright — the
// Rescue Agent stops querying and commits. arrivals are
// { offer, receivedAtMs } pairs, receivedAtMs measured from tDetect.
export function selectOffer(arrivals, request) {
  const evaluated = arrivals.map((arrival) => ({
    ...arrival,
    evaluation: evaluateOffer(arrival.offer, request)
  }));

  const viable = evaluated.filter((entry) => entry.evaluation.viable);
  const rejected = evaluated
    .filter((entry) => !entry.evaluation.viable)
    .map((entry) => ({
      providerId: entry.offer.providerId,
      reason: entry.evaluation.reasons[0].code,
      detail: entry.evaluation.reasons.map((item) => item.detail).join("; ")
    }));

  if (viable.length === 0) {
    return { selected: null, rejected };
  }

  const emergencyMode = request.emergencyOverride || viable.length === 1;
  const winner = emergencyMode
    ? [...viable].sort((left, right) => left.receivedAtMs - right.receivedAtMs)[0]
    : rankOffers(viable)[0];

  const losingViable = viable
    .filter((entry) => entry.offer.providerId !== winner.offer.providerId)
    .map((entry) =>
      emergencyMode && entry.receivedAtMs > winner.receivedAtMs
        ? {
            providerId: entry.offer.providerId,
            reason: "SUPERSEDED_BY_FIRST_VIABLE",
            detail: `viable but arrived ${entry.receivedAtMs - winner.receivedAtMs} ms after the first viable offer`
          }
        : {
            providerId: entry.offer.providerId,
            reason: "RANKED_BELOW",
            detail: "viable but ranked below the selected offer"
          }
    );

  return {
    selected: winner,
    rejected: [...rejected, ...losingViable]
  };
}
