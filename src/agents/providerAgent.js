// One independently deployed Network Provider Agent (blueprint §8: Person 2
// owns "2–3 Provider Agents"; acceptance §12 "A2A independence: at least two
// provider agents run as separate services/endpoints").
//
// The agent owns its provider's commercial policy: it receives a Provider
// Request over A2A, quotes a signed Provider Offer from its own profile, and
// simulates path activation. It never sees the buyer's wallet balance — only
// the request's maxBudget cap.
//
// Failure modes exist to make provider failure a first-class demo/test
// (blueprint §11 "Provider A fails during demo" and milestone M5), switched
// live via POST /admin/mode:
//   healthy         default — quote and activate normally
//   down            /health reports unhealthy; offers refuse (503)
//   unresponsive    health passes but offers never answer (client aborts)
//   slow            offers answer only after the bid deadline has passed
//   fail_activation offers answer normally but every activation fails —
//                   exercises the Rescue Agent's failover walk in tests
//                   and the live demo (blueprint §4.2 step 9)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { providerRequestSchema } from "../a2a/schemas/providerRequest.js";
import { providerOfferSchema } from "../a2a/schemas/providerOffer.js";
import { signOffer } from "../a2a/signing.js";

const OFFER_TTL_MS = 60_000;
const MODE_VALUES = ["healthy", "down", "unresponsive", "slow", "fail_activation", "laggy"];

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Provider-side Gonka enrichment: best-effort, never load-bearing. The
// deterministic offer is already computed; the pitch is only attached if it
// arrives inside the window (bid deadline minus a signing margin, measured
// from the moment the request reached this agent), and it becomes part of
// the signed payload (tamper-consistent). "LLM enriches, determinism
// decides."
async function enrichWithPitch(offer, request, profile, gonka, elapsedMs) {
  if (!gonka?.apiKey || !gonka?.baseUrl || !gonka?.model) {
    return null;
  }

  const budgetMs = Math.min(request.bidDeadlineMs - elapsedMs - 200, 4_000);

  if (budgetMs < 300) {
    return null;
  }

  try {
    const response = await gonka.fetchImpl(
      `${gonka.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${gonka.apiKey}`
        },
        body: JSON.stringify({
          model: gonka.model,
          messages: [
            {
              role: "system",
              content:
                "You are the sales agent of a network capacity provider. Reply ONLY with JSON: " +
                '{"pitch": "<=140 char value statement for this offer"}. No prose.'
            },
            {
              role: "user",
              content: JSON.stringify({
                provider: { brand: profile.brand, category: profile.category },
                request: {
                  requestedCapacityMbps: request.requestedCapacityMbps,
                  maxBudget: request.maxBudget,
                  currency: request.currency,
                  emergencyOverride: request.emergencyOverride
                },
                offer: {
                  capacityMbps: offer.capacityMbps,
                  price: offer.price,
                  expectedActivationTimeMs: offer.expectedActivationTimeMs
                }
              })
            }
          ],
          temperature: 0,
          max_tokens: 100
        }),
        signal: AbortSignal.timeout(budgetMs)
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const start = typeof content === "string" ? content.indexOf("{") : -1;
    const end = typeof content === "string" ? content.lastIndexOf("}") : -1;

    if (start === -1 || end <= start) {
      return null;
    }

    const parsed = JSON.parse(content.slice(start, end + 1));
    const pitch = typeof parsed.pitch === "string" ? parsed.pitch.trim() : "";

    return pitch ? { pitch } : null;
  } catch {
    return null; // enrichment is never load-bearing
  }
}

export function createProviderAgent({ profile, privateKeyPem, logger, gonka }) {
  let failureMode = "healthy";

  // offer cache: identical requestId -> identical signed offer (A2A retries
  // must not mint a second commitment); activation cache: incident+offer ->
  // single simulated activation even when called repeatedly (blueprint §6.1
  // "Duplicate-Safety").
  const offersByRequestId = new Map();
  const activationsByKey = new Map();

  function buildOfferDraft(request) {
    const lane = request.emergencyOverride
      ? { ...profile.activation.p0FastLane, lane: "P0_FAST" }
      : { ...profile.activation.standard, lane: "STANDARD" };
    const capacityMbps = profile.policy.maxCapacityMbps;
    const hours = request.durationMinutes / 60;
    const price = round2(
      profile.policy.baseFee +
        profile.policy.pricePer100MbpsPerHour * (capacityMbps / 100) * hours
    );

    return {
      offerId: `OFF-${request.incidentId}-${profile.providerId}`,
      incidentId: request.incidentId,
      providerId: profile.providerId,
      available: true,
      capacityMbps,
      expectedActivationClass: lane.class,
      expectedActivationTimeMs: lane.timeMs,
      activationLane: lane.lane,
      price,
      currency: profile.policy.currency,
      reliabilityScore: profile.performance.reliabilityScore,
      latencyMs: profile.performance.latencyMs,
      packetLossPercent: profile.performance.packetLossPercent,
      offerExpiry: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
      signature: { algorithm: "ed25519", keyId: profile.publicKey.keyId, value: "" }
    };
  }

  // Deterministic quote first; Gonka pitch enrichment races the bid window;
  // the offer is signed last so whatever made it in is tamper-consistent.
  async function quoteOffer(request, elapsedMs) {
    const cached = offersByRequestId.get(request.requestId);

    if (cached) {
      return cached;
    }

    const offer = buildOfferDraft(request);
    const enrichment = await enrichWithPitch(offer, request, profile, gonka, elapsedMs);

    if (enrichment) {
      offer.enrichment = enrichment;
    }

    offer.signature.value = signOffer(offer, privateKeyPem);
    providerOfferSchema.parse(offer);
    offersByRequestId.set(request.requestId, offer);

    return offer;
  }

  function activateOnce({ incidentId, offerId }) {
    const key = `${incidentId}:${offerId}`;
    const inFlight = activationsByKey.get(key);

    if (inFlight) {
      return inFlight;
    }

    const activation = (async () => {
      const offer = [...offersByRequestId.values()].find(
        (entry) => entry.offerId === offerId
      );

      if (!offer) {
        return { status: "FAILED", reason: "UNKNOWN_OFFER" };
      }

      await new Promise((resolve) =>
        setTimeout(resolve, offer.expectedActivationTimeMs)
      );

      if (failureMode === "fail_activation") {
        return { status: "FAILED", reason: "PROVIDER_FAULT" };
      }

      return {
        status: "AVAILABLE",
        providerId: profile.providerId,
        offerId,
        // CAMARA QoD-shaped session reference for the dashboard event stream.
        sessionId: `QOD-${incidentId}-${offer.expectedActivationClass}-${profile.providerId}`,
        recoveredCapacityMbps: offer.capacityMbps,
        confirmedAtMs: Date.now()
      };
    })();

    activationsByKey.set(key, activation);

    return activation;
  }

  function sleepIgnoringAborts(ms) {
    // Unref'd: the "unresponsive" mode parks a handler for a long time on
    // purpose; the timer must not keep the process alive after tests/demo
    // shutdown. The client's abort deadline is what ends the request.
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  async function handleOffers(httpResponse, body, receivedAtMs) {
    let parsedRequest;

    try {
      parsedRequest = providerRequestSchema.parse(body);
    } catch (error) {
      reply(httpResponse, 400, { error: "invalid provider request", detail: String(error) });
      return;
    }

    if (failureMode === "down") {
      reply(httpResponse, 503, {
        available: false,
        providerId: profile.providerId,
        reason: "PROVIDER_DOWN"
      });
      return;
    }

    if (failureMode === "unresponsive") {
      await sleepIgnoringAborts(10 * 60_000); // the client's deadline aborts us
      reply(httpResponse, 503, { available: false, providerId: profile.providerId });
      return;
    }

    if (failureMode === "slow") {
      await sleepIgnoringAborts(parsedRequest.bidDeadlineMs + 250);
    }

    if (failureMode === "laggy") {
      // Deliberately second in the race but well inside the bid deadline —
      // used to pin arrival order in failover tests and the live demo.
      await sleepIgnoringAborts(150);
    }

    reply(httpResponse, 200, await quoteOffer(parsedRequest, Date.now() - receivedAtMs));
  }

  function reply(json, statusCode, payload) {
    json.statusCode = statusCode;
    json.setHeader("content-type", "application/json");
    json.end(JSON.stringify(payload));
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      return reply(
        response,
        200,
        {
          providerId: profile.providerId,
          healthy: failureMode !== "down",
          credentialsReady: true,
          failureMode
        }
      );
    }

    if (request.method === "GET" && (url.pathname === "/agent-card" || url.pathname === "/v1/agent-card")) {
      return reply(response, 200, { ...profile.agentCard, providerId: profile.providerId });
    }

    if (request.method === "POST" && (url.pathname === "/offers" || url.pathname === "/v1/offers")) {
      const receivedAtMs = Date.now();
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return reply(response, 400, { error: "invalid JSON" });
        }
        handleOffers(response, body, receivedAtMs).catch((error) => {
          logger?.warn?.(`offers handler error: ${error.message}`);
          if (!response.headersSent) {
            reply(response, 500, { error: "internal" });
          }
        });
      });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/activation" || url.pathname === "/v1/activation")) {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return reply(response, 400, { error: "invalid JSON" });
        }

        if (!body.incidentId || !body.offerId) {
          return reply(response, 400, { error: "incidentId and offerId are required" });
        }

        if (failureMode === "down") {
          return reply(response, 503, { status: "FAILED", reason: "PROVIDER_DOWN" });
        }

        activateOnce(body)
          .then((result) => reply(response, 200, result))
          .catch((error) => {
            logger?.warn?.(`activation error: ${error.message}`);
            if (!response.headersSent) {
              reply(response, 500, { status: "FAILED", reason: "internal" });
            }
          });
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/admin/mode") {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        try {
          const { mode } = JSON.parse(raw || "{}");

          if (!MODE_VALUES.includes(mode)) {
            return reply(response, 400, {
              error: `mode must be one of: ${MODE_VALUES.join(" | ")}`
            });
          }

          failureMode = mode;
          logger?.info?.(`failure mode set to ${mode}`);
          reply(response, 200, { providerId: profile.providerId, failureMode });
        } catch {
          reply(response, 400, { error: "invalid JSON" });
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/admin/mode") {
      return reply(response, 200, { providerId: profile.providerId, failureMode });
    }

    reply(response, 404, { error: "not found" });
  });

  return {
    profile,
    server,
    setFailureMode(mode) {
      failureMode = mode;
    },
    get failureMode() {
      return failureMode;
    },
    listen(port) {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

export function loadProviderIdentity(profilePath, keyPath) {
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const privateKeyPem = readFileSync(keyPath, "utf8");

  return { profile, privateKeyPem };
}
