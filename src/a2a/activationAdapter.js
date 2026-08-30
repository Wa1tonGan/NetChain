// Activation adapter seam (blueprint §3.1 "Activation Adapter", §11 risk row
// "Real provider APIs unavailable"). The Rescue Agent never activates a
// provider directly: it goes through this adapter, whose backend is chosen by
// provider category. The hackathon backends both talk to the provider agent's
// simulated REST surface, but a real CAMARA QoD sandbox would plug in at the
// same seam without touching the Rescue Agent's flow.
//
//   TELCO_5G_QOD  -> CAMARA_QOD_MOCK  (CAMARA Quality-on-Demand session shape)
//   everything else -> GENERIC_MOCK    (generic provider activation call)

import { providerOfferSchema } from "./schemas/providerOffer.js";

const BACKEND_BY_CATEGORY = {
  TELCO_5G_QOD: "CAMARA_QOD_MOCK",
  FWA_BURST: "GENERIC_MOCK",
  LEO_SATELLITE: "GENERIC_MOCK"
};

// Activation must fail deterministically instead of hanging: the offer's own
// expected activation time plus a fixed margin is the whole budget.
const ACTIVATION_MARGIN_MS = 2000;

function normalizeResult(payload, offer) {
  const status = payload?.status === "AVAILABLE" ? "AVAILABLE" : "FAILED";
  const recoveredCapacityMbps =
    typeof payload?.recoveredCapacityMbps === "number"
      ? payload.recoveredCapacityMbps
      : status === "AVAILABLE"
        ? offer.capacityMbps
        : 0;

  return {
    status,
    recoveredCapacityMbps,
    confirmedAtMs: Date.now(),
    backend: payload?.backend,
    // CAMARA QoD-shaped session reference from the provider; event-stream only.
    sessionId: payload?.sessionId
  };
}

export function backendForCategory(category) {
  return BACKEND_BY_CATEGORY[category] ?? "GENERIC_MOCK";
}

export function createActivationAdapter({ fetchImpl = fetch, logger } = {}) {
  async function activate({ profile, offer, incidentId, durationMinutes }) {
    providerOfferSchema.parse(offer);

    const backend = backendForCategory(profile.category);
    const timeoutMs = offer.expectedActivationTimeMs + ACTIVATION_MARGIN_MS;
    const startedAtMs = Date.now();

    try {
      const response = await fetchImpl(`${profile.agentCard.endpoint}/v1/activation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incidentId,
          offerId: offer.offerId,
          // CAMARA QoD mock consumes a session-shaped request; the generic
          // mock ignores it. Same wire call, provider-side, for both.
          session: {
            qosProfile: backend === "CAMARA_QOD_MOCK" ? "QOS_E" : "BEST_EFFORT",
            durationMinutes,
            serverCapability: "capacity_burst"
          },
          backend
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        logger?.warn?.(
          `activation for ${offer.providerId} returned HTTP ${response.status}`
        );
        return {
          status: "FAILED",
          recoveredCapacityMbps: 0,
          confirmedAtMs: Date.now(),
          backend
        };
      }

      const normalized = normalizeResult(await response.json(), offer);
      logger?.info?.(
        `activation ${offer.providerId} -> ${normalized.status} in ${Date.now() - startedAtMs} ms (${backend})`
      );
      return normalized;
    } catch (error) {
      logger?.warn?.(
        `activation for ${offer.providerId} failed: ${error?.name === "TimeoutError" ? "timed out" : error?.message}`
      );
      return {
        status: "FAILED",
        recoveredCapacityMbps: 0,
        confirmedAtMs: Date.now(),
        backend
      };
    }
  }

  return { activate, backendForCategory };
}
