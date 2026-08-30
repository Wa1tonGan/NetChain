// Network Rescue Agent runtime (blueprint §8, Person 2's core deliverable).
//
// Pipeline for one RecoveryIntent (integration contract: consumes Person 1's
// Incident/Intent, returns a signed Selected Offer to Person 3 and the
// activation result to Person 1):
//
//   1. validate intent, map to Provider Request (buildProviderRequest)
//   2. readiness: cached provider health probes — unhealthy providers are
//      skipped outright (blueprint §6-A "Provider Readiness")
//   3. broadcast the request to every healthy provider IN PARALLEL with a
//      per-provider abort at the bid deadline (§6-C fail-fast). Every
//      arrival/rejection is emitted as an event so Person 1's dashboard can
//      render the provider race and the rejection reason cards.
//   4. order the viable offers — EMERGENCY: by arrival (first-viable, zero
//      LLM, §3.3 step 5); NORMAL: Gonka multi-model consensus when
//      configured, deterministic ranking as the always-available fallback
//      (§6-F)
//   5. sign the buyer side of the agreement (ed25519, signing.js) — the
//      artifact Person 3 verifies (on-chain, per the P4 decision) before
//      locking escrow
//   6. notify Person 3 (optional ack URL, 1.5 s cap), then activate through
//      the activation adapter; if activation fails, the next ordered offer
//      is activated and the nonce sequence increments (attempt 2 = :002) —
//      blueprint §4.2 step 9, demo beat "The Fallback"
//
// Repeat-safety: per-incident result cache (same incident id returns the
// same envelope — the agreement nonce is incident+attempt derived, so
// Person 3's escrow stays idempotent), plus activation dedup on the
// provider side.

import { createServer } from "node:http";

import { validateRecoveryIntent } from "../schemas/recoveryIntent.js";
import { buildProviderRequest } from "../a2a/buildProviderRequest.js";
import { computeFeeSplit } from "../a2a/fees.js";
import { orderedViable } from "../a2a/offerEvaluator.js";
import { rankWithConsensus } from "../a2a/gonkaRanker.js";
import { createActivationAdapter } from "../a2a/activationAdapter.js";
import { feeConfigFromEnv } from "../a2a/fees.js";
import { providerOfferSchema } from "../a2a/schemas/providerOffer.js";
import { selectedOfferSchema } from "../a2a/schemas/selectedOffer.js";
import {
  signBuyerAgreement,
  verifyOfferSignature
} from "../a2a/signing.js";

const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 1_000;
const DEFAULT_HEALTH_CACHE_TTL_MS = 5_000;
// Blueprint §6-E "Non-Blocking Trust": activation must never wait on chain.
const DEFAULT_PERSON3_ACK_TIMEOUT_MS = 1_500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad3(value) {
  return String(value).padStart(3, "0");
}

function rejection(providerId, reason, detail) {
  return { providerId, reason, detail };
}

export function createRescueAgent({
  providers,
  buyerPrivateKeyPem,
  fetchImpl = fetch,
  logger = () => {},
  onEvent = () => {},
  healthProbeTimeoutMs = DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
  healthCacheTtlMs = DEFAULT_HEALTH_CACHE_TTL_MS,
  person3 = {},
  gonkaOverrides = {},
  fees,
  activationAdapter
} = {}) {
  const adapter = activationAdapter ?? createActivationAdapter({ fetchImpl, logger });
  const feeConfig = fees ?? feeConfigFromEnv();
  const person3AckUrl = person3.ackUrl ?? process.env.PERSON3_ACK_URL ?? "";
  const person3AckTimeoutMs =
    person3.ackTimeoutMs ?? DEFAULT_PERSON3_ACK_TIMEOUT_MS;

  // -- Incident records: the dashboard/Person 3 view (async contract). ----
  const incidents = new Map(); // incidentId -> record

  function recordFor(incidentId) {
    let record = incidents.get(incidentId);

    if (!record) {
      record = {
        incidentId,
        status: "RECEIVED",
        providerId: null,
        result: null,
        envelope: null,
        settlement: null,
        events: [],
        subscribers: new Set(),
        createdAt: new Date().toISOString()
      };
      incidents.set(incidentId, record);
    }

    return record;
  }

  function pushEvent(record, event) {
    record.events.push(event);

    for (const subscriber of record.subscribers) {
      subscriber.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (event.type === "status") {
      record.status = event.status;

      if (event.providerId) {
        record.providerId = event.providerId;
      }
    }
  }

  // Every pipeline event goes to the host callback AND the incident record
  // (if one exists — the sync CLI path runs without creating records).
  function emit(incidentId, event) {
    const full = { incidentId, atMs: Date.now(), ...event };
    onEvent(full);

    const record = incidents.get(incidentId);

    if (record) {
      pushEvent(record, full);
    }
  }

  // Agent Card / capability cache (blueprint §6-A): profiles are loaded
  // before any incident; live health is layered on top with a TTL.
  const healthCache = new Map(); // providerId -> { healthy, detail, probedAtMs }
  const resultsByIncident = new Map(); // incidentId -> sync envelope (completed)
  const inFlightByIncident = new Map(); // incidentId -> Promise<envelope>

  async function probeHealth(provider) {    try {
      const response = await fetchImpl(`${provider.agentCard.endpoint}/health`, {
        signal: AbortSignal.timeout(healthProbeTimeoutMs)
      });
      const body = await response.json().catch(() => ({}));
      const healthy = response.ok && body.healthy !== false;

      return {
        healthy,
        detail: healthy
          ? "health probe ok"
          : response.ok
            ? "provider reports itself unhealthy"
            : `health probe HTTP ${response.status}`,
        probedAtMs: Date.now()
      };
    } catch (error) {
      return {
        healthy: false,
        detail: `health probe failed: ${error?.name === "TimeoutError" ? "timeout" : error?.message}`,
        probedAtMs: Date.now()
      };
    }
  }

  async function getHealth(provider) {
    const cached = healthCache.get(provider.providerId);
    const fresh = cached && Date.now() - cached.probedAtMs < healthCacheTtlMs;

    if (fresh) {
      return cached;
    }

    const next = await probeHealth(provider);
    healthCache.set(provider.providerId, next);

    return next;
  }

  function callProvider(provider, request, controller) {
    return fetchImpl(`${provider.agentCard.endpoint}/v1/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          return {
            ok: false,
            detail: `provider answered HTTP ${response.status}`
          };
        }

        return { ok: true, body: await response.json() };
      })
      .catch((error) => ({
        ok: false,
        aborted: error?.name === "AbortError",
        detail:
          error?.name === "AbortError"
            ? "aborted by the rescue agent"
            : `call failed: ${error?.message ?? error}`
      }));
  }

  function validateArrival(body, provider, request) {
    let offer;

    try {
      offer = providerOfferSchema.parse(body);
    } catch (error) {
      return { error: rejection(provider.providerId, "OFFER_INVALID", `offer failed schema validation: ${String(error).slice(0, 200)}`) };
    }

    if (offer.providerId !== provider.providerId) {
      return { error: rejection(provider.providerId, "TAMPERED_OFFER", "offer identity does not match the cached agent card") };
    }

    if (offer.incidentId !== request.incidentId) {
      return { error: rejection(provider.providerId, "TAMPERED_OFFER", "offer is for a different incident") };
    }

    if (!verifyOfferSignature(offer, provider.publicKey.value)) {
      return { error: rejection(provider.providerId, "TAMPERED_OFFER", "offer signature does not verify against the cached agent card key") };
    }

    return { offer };
  }

  async function notifyPerson3(selectedOffer) {
    if (!person3AckUrl) {
      return true;
    }

    try {
      await fetchImpl(person3AckUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "SELECTED_OFFER", selectedOffer }),
        signal: AbortSignal.timeout(person3AckTimeoutMs)
      });
      logger("info", `person 3 acked the selected offer for ${selectedOffer.incidentId}`);

      return true;
    } catch (error) {
      // Non-blocking trust (§6-E): activation proceeds even without an ack.
      logger("warn", `person 3 ack failed (continuing in parallel): ${error?.message ?? error}`);

      return false;
    }
  }

  function buildSelectedOffer(profile, candidate, request, rejectedOffers, timing, nonce) {
    const feeSplit = computeFeeSplit(candidate.offer.price, feeConfig.platformFeePercent);
    const selectedProvider = {
      providerId: candidate.offer.providerId,
      brand: profile.brand,
      offerId: candidate.offer.offerId,
      capacityMbps: candidate.offer.capacityMbps,
      expectedActivationClass: candidate.offer.expectedActivationClass,
      expectedActivationTimeMs: candidate.offer.expectedActivationTimeMs,
      activationLane: candidate.offer.activationLane,
      price: candidate.offer.price,
      currency: candidate.offer.currency,
      reliabilityScore: candidate.offer.reliabilityScore,
      latencyMs: candidate.offer.latencyMs,
      packetLossPercent: candidate.offer.packetLossPercent
    };

    const selected = {
      incidentId: request.incidentId,
      customerId: request.customerId,
      selectionMode: request.emergencyOverride ? "EMERGENCY" : "NORMAL",
      selectedProvider,
      agreement: {
        // Fee engine (§1.3): fee on the PLAN PRICE only, added on top and
        // shown openly; escrow locks plan + fee and settles as a split.
        ...feeSplit,
        platformFeePercent: feeConfig.platformFeePercent,
        platformAddress: feeConfig.platformAddress,
        currency: candidate.offer.currency,
        durationMinutes: request.durationMinutes,
        // Incident + attempt derived: re-running the same incident
        // reproduces the same nonce; a failover attempt increments the
        // sequence (:002) so Person 3's escrow dedup stays sound.
        nonce,
        expiry: candidate.offer.offerExpiry
      },
      signatures: {
        offerSignature: candidate.offer.signature,
        buyerSignature: { algorithm: "ed25519", keyId: "buyer-demo", value: "" }
      },
      rejectedOffers,
      timing
    };

    selected.signatures.buyerSignature.value = signBuyerAgreement(
      selected,
      buyerPrivateKeyPem
    );
    selectedOfferSchema.parse(selected);

    return selected;
  }

  async function activateRanked(ordered, profilesById, request, timing, preRejections, rankingNote) {
    const incidentId = request.incidentId;
    const emergency = request.emergencyOverride;
    const rejected = [...preRejections];

    for (let attempt = 1; attempt <= ordered.length; attempt += 1) {
      const candidate = ordered[attempt - 1];
      const profile = profilesById.get(candidate.offer.providerId);
      const nonce = `${incidentId}:${candidate.offer.providerId}:${pad3(attempt)}`;

      emit(incidentId, {
        type: "status",
        status: "ACTIVATING",
        providerId: candidate.offer.providerId,
        attempt
      });

      if (attempt === 1) {
        // Optional Person 3 ack (§6-E): a compact deal preview only — Person 3
        // pulls the full signed artifact from /incidents/:id/result, and
        // activation never blocks on the ack (1.5 s cap).
        await notifyPerson3({
          type: "SELECTED_OFFER_PREVIEW",
          incidentId,
          selectedProvider: {
            providerId: candidate.offer.providerId,
            offerId: candidate.offer.offerId,
            price: candidate.offer.price,
            currency: candidate.offer.currency
          },
          agreement: {
            ...computeFeeSplit(candidate.offer.price, feeConfig.platformFeePercent),
            currency: candidate.offer.currency,
            durationMinutes: request.durationMinutes,
            nonce,
            expiry: candidate.offer.offerExpiry
          }
        });
      }

      const result = await adapter.activate({
        profile,
        offer: candidate.offer,
        incidentId,
        durationMinutes: request.durationMinutes,
        nonce
      });

      if (result.status === "AVAILABLE") {
        emit(incidentId, {
          type: "status",
          status: "AVAILABLE",
          providerId: candidate.offer.providerId,
          attempt,
          sessionId: result.sessionId,
          recoveredCapacityMbps: result.recoveredCapacityMbps
        });

        // Viable providers that were never attempted lose on rank/arrival.
        const winner = ordered[0];
        const neverAttempted = ordered.slice(attempt).map((entry) =>
          emergency && entry.receivedAtMs > winner.receivedAtMs
            ? rejection(
                entry.offer.providerId,
                "SUPERSEDED_BY_FIRST_VIABLE",
                `viable but arrived ${entry.receivedAtMs - winner.receivedAtMs} ms after the first viable offer`
              )
            : rejection(
                entry.offer.providerId,
                "RANKED_BELOW",
                `viable but ${rankingNote ?? "deterministic ranking (activation speed, price, reliability)"} placed it below the selected offer`
              )
        );

        const selected = buildSelectedOffer(
          profile,
          candidate,
          request,
          [...rejected, ...neverAttempted],
          {
            ...timing,
            tActivate: result.confirmedAtMs,
            tRecover: result.confirmedAtMs
          },
          nonce
        );
        selected.activation = {
          status: "AVAILABLE",
          recoveredCapacityMbps: result.recoveredCapacityMbps,
          confirmedAtMs: result.confirmedAtMs
        };
        selectedOfferSchema.parse(selected);

        return { selected, attempt, sessionId: result.sessionId };
      }

      emit(incidentId, {
        type: "rejection",
        providerId: candidate.offer.providerId,
        reason: "ACTIVATION_FAILED",
        detail: `activation attempt ${attempt} failed (${result.backend ?? "adapter"}); moving to the next provider`
      });
      rejected.push(
        rejection(
          candidate.offer.providerId,
          "ACTIVATION_FAILED",
          "offer was viable but activation failed; moved to the next provider"
        )
      );
      logger(
        "warn",
        `activation failed for ${candidate.offer.providerId} on ${incidentId}; falling back (attempt ${attempt})`
      );
    }

    emit(incidentId, { type: "status", status: "FAILED_ALL_ACTIVATIONS" });

    return null;
  }

  async function runRecovery(intent) {
    const tDetect = Date.now();
    const incidentId = intent.incidentId;
    const request = buildProviderRequest(intent);
    let rankingNote;

    if (!request) {
      emit(incidentId, { type: "status", status: "NO_EXTERNAL_RECOVERY_NEEDED" });

      return { status: "NO_EXTERNAL_RECOVERY_NEEDED", incidentId };
    }

    // 1) Readiness gate: only providers that pass health probing are asked.
    const profilesById = new Map(providers.map((provider) => [provider.providerId, provider]));
    const preBroadcastRejections = [];
    const healthByProvider = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        health: await getHealth(provider)
      }))
    );
    const healthy = [];

    for (const { provider, health } of healthByProvider) {
      if (health.healthy) {
        healthy.push(provider);
      } else {
        preBroadcastRejections.push(
          rejection(provider.providerId, "PROVIDER_UNAVAILABLE", health.detail)
        );
        emit(incidentId, {
          type: "rejection",
          providerId: provider.providerId,
          reason: "PROVIDER_UNAVAILABLE",
          detail: health.detail
        });
      }
    }

    emit(incidentId, {
      type: "readiness",
      ready: healthy.map((provider) => provider.providerId)
    });

    if (healthy.length === 0) {
      emit(incidentId, { type: "status", status: "FAILED_NO_VIABLE_PROVIDER" });

      return {
        status: "NO_VIABLE_OFFER",
        incidentId,
        rejectedOffers: preBroadcastRejections,
        timing: { tDetect, tDecide: Date.now() }
      };
    }

    // 2) Parallel broadcast with a per-provider abort at the bid deadline.
    emit(incidentId, { type: "status", status: "QUERYING" });

    const deadlineAtMs = tDetect + request.bidDeadlineMs;
    const pending = new Map();
    const arrivals = [];
    const rejected = [...preBroadcastRejections];

    for (const provider of healthy) {
      const controller = new AbortController();
      pending.set(provider.providerId, {
        controller,
        promise: callProvider(provider, request, controller)
      });
    }

    while (pending.size > 0) {
      const remainingMs = deadlineAtMs - Date.now();

      if (remainingMs <= 0) {
        break;
      }

      const timeoutMarker = Symbol("deadline");
      const settled = await Promise.race([
        ...[...pending.entries()].map(([providerId, entry]) =>
          entry.promise.then((result) => ({ providerId, result }))
        ),
        sleep(remainingMs).then(() => timeoutMarker)
      ]);

      if (settled === timeoutMarker) {
        break;
      }

      const { providerId, result } = settled;
      const provider = profilesById.get(providerId);
      pending.delete(providerId);

      if (!result.ok) {
        const entry = rejection(
          providerId,
          result.aborted ? "RESPONSE_TIMEOUT" : "PROVIDER_UNAVAILABLE",
          result.aborted
            ? "bid window closed before the offer arrived"
            : result.detail
        );
        rejected.push(entry);
        emit(incidentId, { type: "rejection", ...entry });
        continue;
      }

      const validated = validateArrival(result.body, provider, request);

      if (validated.error) {
        rejected.push(validated.error);
        emit(incidentId, { type: "rejection", ...validated.error });
        continue;
      }

      const arrival = {
        offer: validated.offer,
        receivedAtMs: Date.now() - tDetect
      };
      arrivals.push(arrival);
      emit(incidentId, {
        type: "arrival",
        providerId: providerId,
        receivedAtMs: arrival.receivedAtMs,
        offerId: arrival.offer.offerId,
        pitch: arrival.offer.enrichment?.pitch
      });
    }

    // 3) Stop the stragglers: whatever is still pending after the deadline
    //    is aborted and recorded as a miss. The wrapped call promises never
    //    reject, so aborting is safe without extra handling.
    for (const [providerId, entry] of pending.entries()) {
      entry.controller.abort();
      await entry.promise;

      const miss = rejection(
        providerId,
        "RESPONSE_TIMEOUT",
        "bid deadline passed before the offer arrived"
      );
      rejected.push(miss);
      emit(incidentId, { type: "rejection", ...miss });
    }

    // 4) Selection: viability stays deterministic; only NORMAL ranking may
    //    consult Gonka (and it must answer within the budget or the local
    //    rank takes over).
    const { ordered: deterministicOrder, nonViable } = orderedViable(arrivals, request);

    for (const entry of nonViable) {
      const entryRejection = rejection(
        entry.offer.providerId,
        entry.evaluation.reasons[0].code,
        entry.evaluation.reasons.map((item) => item.detail).join("; ")
      );
      rejected.push(entryRejection);
      emit(incidentId, { type: "rejection", ...entryRejection });
    }

    if (deterministicOrder.length === 0) {
      emit(incidentId, { type: "status", status: "FAILED_NO_VIABLE_PROVIDER" });

      return {
        status: "NO_VIABLE_OFFER",
        incidentId,
        rejectedOffers: rejected,
        timing: { tDetect, tDecide: Date.now() }
      };
    }

    let ordered = deterministicOrder;

    if (!request.emergencyOverride && deterministicOrder.length >= 2) {
      const consensusOrder = await rankWithConsensus(
        deterministicOrder,
        request,
        gonkaOverrides
      );

      if (consensusOrder) {
        const byProvider = new Map(
          deterministicOrder.map((entry) => [entry.offer.providerId, entry])
        );
        ordered = consensusOrder.map((providerId) => byProvider.get(providerId));
        rankingNote = "Gonka consensus ranking";
        logger(
          "info",
          `gonka consensus ranking for ${incidentId}: ${consensusOrder.join(" > ")}`
        );
      }
    }

    const tDecide = Date.now();
    emit(incidentId, {
      type: "status",
      status: "SELECTED",
      providerId: ordered[0].offer.providerId
    });

    // 5) Activation walk with fallback (§4.2 step 9).
    const outcome = await activateRanked(
      ordered,
      profilesById,
      request,
      { tDetect, tDecide },
      rejected,
      rankingNote
    );

    if (outcome) {
      return {
        status: "SELECTED",
        incidentId,
        selectedOffer: outcome.selected,
        attempt: outcome.attempt,
        timing: outcome.selected.timing
      };
    }

    return {
      status: "NO_VIABLE_OFFER",
      incidentId,
      rejectedOffers: rejected,
      timing: { tDetect, tDecide: Date.now() }
    };
  }

  function processIntent(intent) {
    const validated = validateRecoveryIntent(intent);
    const cached = resultsByIncident.get(validated.incidentId);

    if (cached) {
      return cached;
    }

    const inFlight = inFlightByIncident.get(validated.incidentId);

    if (inFlight) {
      return inFlight;
    }

    const running = runRecovery(validated)
      .then((envelope) => {
        if (envelope.status === "SELECTED" || envelope.status === "NO_VIABLE_OFFER") {
          resultsByIncident.set(validated.incidentId, envelope);
        }

        return envelope;
      })
      .finally(() => {
        inFlightByIncident.delete(validated.incidentId);
      });

    inFlightByIncident.set(validated.incidentId, running);

    return running;
  }

  async function readiness() {
    const entries = await Promise.all(
      providers.map(async (provider) => {
        const health = await getHealth(provider);

        return {
          providerId: provider.providerId,
          brand: provider.brand,
          agentCard: provider.agentCard,
          policy: provider.policy,
          healthy: health.healthy,
          detail: health.detail,
          lastHealthCheckAt: new Date(health.probedAtMs).toISOString()
        };
      })
    );

    return {
      rescueAgent: { healthy: true },
      providers: entries
    };
  }

  function reset() {
    healthCache.clear();
    resultsByIncident.clear();
    inFlightByIncident.clear();
    incidents.clear();
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    // Browser dashboards (Person 1's UI) live on other origins — answer the
    // CORS preflight so their JSON POSTs get through.
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.end();
      return;
    }

    const json = (statusCode, payload) => {
      response.statusCode = statusCode;
      response.setHeader("content-type", "application/json");
      response.setHeader("access-control-allow-origin", "*");
      response.end(JSON.stringify(payload));
    };

    const readBody = () =>
      new Promise((resolve, reject) => {
        let raw = "";
        request.on("data", (chunk) => {
          raw += chunk;
        });
        request.on("end", () => resolve(raw));
        request.on("error", reject);
      });

    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { healthy: true, incidents: incidents.size });
    }

    if (request.method === "GET" && url.pathname === "/readiness") {
      return readiness().then(
        (payload) => json(200, payload),
        (error) => json(500, { error: String(error) })
      );
    }

    // Person 1's dashboard contract: async submission + SSE event stream.
    if (request.method === "POST" && (url.pathname === "/recovery/intents" || url.pathname === "/v1/recovery/intents")) {
      return readBody()
        .then((raw) => {
          let intent;

          try {
            const body = JSON.parse(raw || "{}");
            intent = validateRecoveryIntent(body.intent ?? body);
          } catch (error) {
            return json(400, { error: "INVALID_INTENT", detail: String(error).slice(0, 300) });
          }

          const existing = incidents.get(intent.incidentId);

          if (existing) {
            // Duplicate intents (same incidentId) return the existing
            // incident — no second query, no second activation.
            return json(200, {
              incidentId: intent.incidentId,
              status: existing.status,
              duplicate: true
            });
          }

          const record = recordFor(intent.incidentId);
          pushEvent(record, { type: "status", status: "RECEIVED", atMs: Date.now() });
          json(202, { incidentId: intent.incidentId, status: "RECEIVED" });

          processIntent(intent)
            .then((envelope) => {
              record.envelope = envelope;
              record.result = envelope.selectedOffer ?? null;

              if (!["AVAILABLE", "SETTLED"].includes(record.status)) {
                pushEvent(record, {
                  type: "status",
                  status: envelope.status,
                  atMs: Date.now()
                });
              }
            })
            .catch((error) => {
              pushEvent(record, {
                type: "status",
                status: "FAILED",
                detail: String(error?.message ?? error),
                atMs: Date.now()
              });
            });

          return undefined;
        })
        .catch((error) => json(400, { error: String(error) }));
    }

    const incidentMatch = url.pathname.match(/^\/incidents\/([^/]+)(\/(result|events))?$/);

    if (request.method === "GET" && incidentMatch) {
      const incidentId = decodeURIComponent(incidentMatch[1]);
      const subResource = incidentMatch[3];
      const record = incidents.get(incidentId);

      if (!record) {
        return json(404, { error: "NOT_FOUND" });
      }

      if (subResource === "result") {
        // Person 3 pulls the bare Selected Offer artifact from here.
        if (!record.result) {
          return json(409, { error: "NOT_READY", status: record.status });
        }

        return json(200, record.result);
      }

      if (subResource === "events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*"
        });

        for (const event of record.events) {
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        record.subscribers.add(response);
        request.on("close", () => record.subscribers.delete(response));

        return;
      }

      const { subscribers, ...view } = record;
      void subscribers;

      return json(200, view);
    }

    // Person 3 reports commitment/settlement status back here.
    if (request.method === "POST" && url.pathname === "/callbacks/settlement") {
      return readBody()
        .then((raw) => {
          const body = JSON.parse(raw || "{}");
          const record = incidents.get(body.incidentId);

          if (!record) {
            return json(404, { error: "NOT_FOUND" });
          }

          record.status = body.status ?? "SETTLED";
          record.settlement = body;
          pushEvent(record, {
            type: "settlement",
            status: record.status,
            atMs: Date.now()
          });

          return json(200, { incidentId: body.incidentId, status: record.status });
        })
        .catch((error) => json(400, { error: String(error) }));
    }

    // Synchronous path (CLI/tests): full pipeline in one request.
    if (request.method === "POST" && (url.pathname === "/v1/recovery" || url.pathname === "/recovery")) {
      return readBody()
        .then((raw) => {
          const body = JSON.parse(raw || "{}");
          // Accept both a bare RecoveryIntent and {"intent": {...}}.
          return processIntent(body.intent ?? body);
        })
        .then(
          (envelope) => json(200, envelope),
          (error) => json(400, { error: String(error) })
        );
    }

    const recoveryMatch = url.pathname.match(/^\/v1\/recovery\/([^/]+)$/);

    if (request.method === "GET" && recoveryMatch) {
      const envelope = resultsByIncident.get(decodeURIComponent(recoveryMatch[1]));

      return json(
        envelope ? 200 : 404,
        envelope ?? { error: "unknown incident" }
      );
    }

    if (request.method === "GET" && url.pathname === "/v1/recoveries") {
      return json(200, { recoveries: [...resultsByIncident.values()] });
    }

    return json(404, { error: "not found" });
  });

  return {
    processIntent,
    readiness,
    reset,
    server,
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
