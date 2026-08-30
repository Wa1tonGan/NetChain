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

// Full pipeline used by the runtime: evaluate every arrival, then order the
// viable ones — EMERGENCY by arrival (first-viable), NORMAL by rank.
export function orderedViable(arrivals, request) {
  const evaluated = arrivals.map((arrival) => ({
    ...arrival,
    evaluation: evaluateOffer(arrival.offer, request)
  }));
  const nonViable = evaluated.filter((entry) => !entry.evaluation.viable);
  const viable = evaluated.filter((entry) => entry.evaluation.viable);
  const ordered = request.emergencyOverride
    ? [...viable].sort((left, right) => left.receivedAtMs - right.receivedAtMs)
    : rankOffers(viable);
  return { ordered, nonViable };
}

// Pure selection over { offer, receivedAtMs } pairs. The runtime orchestrator
// supersedes this with orderedViable() for fallback looping; kept for
// contract tests and offline tooling.
export function selectOffer(arrivals, request) {
  const { ordered, nonViable } = orderedViable(arrivals, request);

  const rejected = nonViable.map((entry) => ({
    providerId: entry.offer.providerId,
    reason: entry.evaluation.reasons[0].code,
    detail: entry.evaluation.reasons.map((item) => item.detail).join("; ")
  }));

  if (ordered.length === 0) {
    return { selected: null, rejected };
  }

  const winner = ordered[0];
  const losingViable = ordered
    .slice(1)
    .map((entry) =>
      request.emergencyOverride && entry.receivedAtMs > winner.receivedAtMs
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
