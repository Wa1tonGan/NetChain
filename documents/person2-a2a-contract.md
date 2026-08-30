# Person 2 → Person 3 Integration Contract (A2A Provider Market)

> Handoff document: the contracts, fixtures and signature-verification methods
> produced by Person 2 (Rescue Agent + Provider Market). Person 3 can develop
> the Sui logic directly against `fixtures/selected/*.json` — no need to wait
> for the agent runtime to be wired up.

## 1. Data Flow Overview

```
Person 1                     Person 2 (this workstream)                  Person 3
─────────                    ──────────────────────────                  ─────────
scenarios/*.json
(RecoveryIntent)
        │
        ▼
buildProviderRequest()  →  Provider Request (parallel A2A broadcast)
                            │
                            ▼
                        Provider Offer ×3 (ed25519 signed)
                            │
                            ▼  evaluateOffer / selectOffer
                        Selected Offer ─────────────────────────────→  Sui authority/escrow
                        (fixtures/selected/*.json)                     commitment + settlement
                            │
                            ▼
                        activation command/result → Person 1's Traffic Controller
```

## 2. The Three Providers (Malaysian-flavoured fictional brands)

| providerId | Brand | Category | Max Capacity | Latency | Reliability | Standard Activation | P0 Fast Lane | Pricing (MYR) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PROVIDER-A | **NusaNet 5G** | TELCO_5G_QOD | 400 Mbps | 30 ms | 0.9995 | MEDIUM / 8000 ms | FAST / 1500 ms | base 20 + 15/100Mbps·hour |
| PROVIDER-B | **KilatLink FWA** | FWA_BURST | 300 Mbps | 35 ms | 0.999 | FAST / 1500 ms | FAST / 1000 ms | base 15 + 15/100Mbps·hour |
| PROVIDER-C | **OrbitSat GO** | LEO_SATELLITE | 150 Mbps | 120 ms | 0.98 | FAST / 2000 ms | INSTANT / 500 ms | base 10 + 14/100Mbps·hour |

All three are fictional brands simulating real categories: telco 5G QoD
(à la CelcomDigi/Maxis CAMARA services), FWA burst capacity (à la YES FWA),
and LEO satellite backhaul (à la Starlink Business).

## 3. RecoveryIntent → Provider Request Field Mapping

| Provider Request field | Source (Person 1's RecoveryIntent) |
| --- | --- |
| `requestedCapacityMbps` | `requirements.recoveryCapacityNeededMbps` |
| `requiredProfile.maxLatencyMs` | `requirements.maximumLatencyMs` |
| `requiredProfile.maxPacketLossPercent` | `requirements.maximumPacketLossPercent` |
| `requiredProfile.minReliability` | `requirements.minimumReliability` |
| `durationMinutes` | `constraints.durationMinutes` |
| `maxBudget` | `constraints.maxBudget` |
| `targetActivationTimeMs` | `requirements.targetActivationTimeMs` |
| `bidDeadlineMs` | `floor(targetActivationTimeMs / 2)` (fail-fast: bids must arrive within half the activation target) |
| `emergencyOverride` | `priority.emergencyOverride` |
| `requestedAction` | passed through from `requestedAction` |
| `currency` | constant `"MYR"` (documented MVP assumption; RecoveryIntent carries no currency field) |
| `preAuthorized` | always `true` — backed by Person 3's pre-funded Sui escrow (blueprint §4.1 / §6-E) |

When `recoveryDecision === "NO_EXTERNAL_RECOVERY_NEEDED"` (s0/s1/s6), no
Provider Request is produced.

## 4. Selection Policy (deterministic; Gonka replaces only the ranking later)

- **NORMAL mode**: filter for viable offers (capacity / latency / packet loss /
  reliability / budget / activation time / currency must all pass), then rank
  by **activation speed → price → reliability** and take the first.
- **EMERGENCY mode** (`emergencyOverride=true`, i.e. P0): **the first viable
  offer to arrive wins outright** — no comparison, no ranking. This mirrors
  blueprint's first-viable emergency rule.
- No viable offer → `selected: null` plus per-provider rejection reasons
  (used for fallback and dashboard display).

Results for the two scripted demo scenarios (fixtures generated and signed):

| Scenario | Mode | Winner | Amount | Rejections |
| --- | --- | --- | --- | --- |
| S2 (primary down, backup insufficient, need 200 Mbps) | NORMAL | **KilatLink FWA** 300 Mbps | 60 MYR | A: ACTIVATION_TOO_SLOW (CAMARA session setup 8s > 5s target); C: INSUFFICIENT_CAPACITY (150 < 200, plus latency/reliability failures) |
| S7 (disaster P0, need 300 Mbps) | EMERGENCY | **NusaNet 5G** 400 Mbps (P0 fast lane) | 140 MYR | C: INSUFFICIENT_CAPACITY; B: SUPERSEDED_BY_FIRST_VIABLE (viable but arrived 300 ms late) |

> Note the S7 demo point: normal ranking would have picked KilatLink (faster
> and cheaper), but under P0 mode NusaNet wins by arrival — emergency mode
> trades optimality for deterministic timing. This is exactly the blueprint
> §6-C semantics.

## 5. Signatures & Verification (required reading for Person 3)

All signatures are **ed25519** over **canonical JSON** (recursively key-sorted,
no whitespace). Tooling lives in `src/a2a/signing.js`; Person 3 imports it
directly:

```js
import { verifyOfferSignature, verifyBuyerSignature } from "../src/a2a/signing.js";

// 1) Verify the provider signature: checks the canonical JSON of the offer
//    minus its `signature` field. The public key comes from
//    fixtures/providers/provider-*.json (publicKey.value, embedded PEM).
verifyOfferSignature(winningOffer, profile.publicKey.value); // => true/false

// 2) Verify the buyer signature: the Rescue Agent signs
//    { incidentId, selectedProvider, agreement } with the buyer key.
//    Private key: fixtures/keys/buyer.private.pem; public key:
//    fixtures/keys/buyer.public.pem.
verifyBuyerSignature(selectedOffer, buyerPublicKeyPem); // => true/false
```

When building the Sui Voucher (blueprint §9 field mapping):

| Sui Voucher field | Source |
| --- | --- |
| `incident_id` | `selectedOffer.incidentId` |
| `buyer` | `selectedOffer.customerId` |
| `provider` | `selectedOffer.selectedProvider.providerId` |
| `amount` | `selectedOffer.agreement.amount` = **planPrice + platformFee** (the escrow lock; blueprint §1.3: plan 300 + fee 15 → 315) |
| `provider_amount` | `selectedOffer.agreement.providerAmount` (= planPrice; settles to the provider address) |
| `platform_fee` | `selectedOffer.agreement.platformFee` (= planPrice × `platformFeePercent`/100; settles to `platform_address`) |
| `platform_address` | `selectedOffer.agreement.platformAddress` (env `PLATFORM_ADDRESS`; Person 3's Move split pays this slice to the platform) |
| `nonce` | `selectedOffer.agreement.nonce`, format `INC-*:PROVIDER-*:001` — **re-running the same incident must reuse the same nonce** (idempotency guarantee); a failover attempt increments the sequence (`:002`), which means a second commitment and a refund of the failed attempt's escrow — Person 3 must handle both |
| `expiry` | `selectedOffer.agreement.expiry` |
| `buyer_signature` / `provider_signature` | `selectedOffer.signatures.buyerSignature / offerSignature` |
| `authority_object` / `escrow_object` | Person 3's own objects (created before any incident) |

> **Fee engine (§1.3 / §3.1 / §7.1):** the Rescue Agent computes the platform
> fee on the **plan price only** (never a wallet balance) and adds it on top.
> The provider side never sees the fee — offers quote the plan price, and the
> viability check compares the plan price to the buyer's `maxBudget`. The
> customer-visible fields are `agreement.planPrice` + `agreement.platformFee`
> (+ `platformFeePercent`), so Person 1's UI can show the transparent split.
> Percentage is env-configurable: `PLATFORM_FEE_PERCENT` (default 5, the
> blueprint's own worked example).

## 6. File Map

```
src/a2a/
  schemas/providerProfile.js   # provider profile + Agent Card contract
  schemas/providerRequest.js   # inquiry contract (mapping documented in header)
  schemas/providerOffer.js     # offer contract (signature + optional Gonka
                               #   enrichment { pitch, counterOffer } — signed in)
  schemas/selectedOffer.js     # ⭐ Selected Offer / Recovery Result (handed to Person 3)
                               #   rejection reasons incl. TAMPERED_OFFER /
                               #   ACTIVATION_FAILED; timing has optional
                               #   tActivate/tRecover (runtime fills them)
  signing.js                   # canonicalJson + ed25519 sign/verify + verify helpers
  buildProviderRequest.js      # RecoveryIntent → Provider Request
  offerEvaluator.js            # evaluateOffer + orderedViable (runtime pipeline)
                               #   + selectOffer (offline/contract tests)
  gonkaRanker.js               # NORMAL-mode 3-model consensus ranking; deterministic
                               #   fallback on timeout/failure; never used for EMERGENCY
  activationAdapter.js         # provider-agnostic activation seam (CAMARA QoD mock
                               #   for TELCO_5G_QOD, generic otherwise)
src/agents/
  providerAgent.js             # REST provider agent: signed offers, activation
                               #   simulation with dedup, Gonka pitch enrichment,
                               #   failure modes (healthy | down | unresponsive |
                               #   slow | fail_activation | laggy) via /admin/mode
  rescueAgent.js               # Rescue Agent runtime + gateway: parallel A2A
                               #   broadcast, health gating, fail-fast deadlines,
                               #   selection, buyer signing, activation walk with
                               #   fallback (nonce :001 → :002 …), event stream
scripts/
  provision-demo-identity.mjs  # one-off: generate keys + three provider profiles
  generate-fixtures.mjs        # re-runnable: generate signed fixtures from profiles + scenarios
  start-all.mjs                # one command: 3 provider agents + rescue agent
  start-provider-agents.mjs    # providers only (ports from profiles: 8101–8103)
  start-rescue-agent.mjs       # rescue gateway only (GATEWAY_PORT, default 8082)
fixtures/
  providers/provider-*.json    # three profiles (embedded public keys, double as Agent Cards)
  keys/*.pem + README.md       # demo keys (see keys/README.md)
  offers/s2-*-offer.json       # three signed offers for S2
  offers/s7-disaster-*-offer.json
  selected/s2-selected-offer.json            # ⭐ Person 3 input (NORMAL)
  selected/s7-disaster-selected-offer.json   # ⭐ Person 3 input (EMERGENCY)
test/
  a2a-contracts.test.js        # contract tests (signatures, fixtures, reproducible selection)
  agent-runtime.test.js        # 17 runtime tests: parallel A2A, fail-fast, health
                               #   gating, activation failover + nonce :002, duplicate
                               #   safety, gateway routes, Gonka ranker + enrichment
```

## 7. Common Commands

```bash
npm test                          # all 50 tests (Person 1 + Person 2)
npm run provision                 # regenerate demo keys (invalidates all signatures!)
npm run generate:fixtures         # regenerate offers + selected fixtures
node scripts/start-all.mjs        # ⭐ one command: providers 8101–8103 + gateway 8082
node scripts/start-all.mjs --down=PROVIDER-B   # boot with a provider pre-killed
```

### 7.1 Runtime API (gateway on :8082)

| Route | Who | Behaviour |
| --- | --- | --- |
| `POST /recovery/intents` | Person 1 | RecoveryIntent in → `202 {incidentId, status:"RECEIVED"}`, pipeline runs async. Duplicate incidentId → `200 {duplicate:true}`, never a second run |
| `GET /incidents/:id` | Person 1 dashboard | `{status, providerId, events[], settlement}` |
| `GET /incidents/:id/events` | Person 1 dashboard | SSE stream: `status` (RECEIVED→QUERYING→SELECTED→ACTIVATING→AVAILABLE→SETTLED), `arrival` (with receivedAtMs + pitch), `rejection` (reason card), `readiness`, `settlement` |
| `GET /incidents/:id/result` | **Person 3** | Bare Selected Offer artifact (409 until ready) |
| `POST /callbacks/settlement` | **Person 3** | Reports commitment/settlement status; incident view flips (e.g. `SETTLED`) |
| `POST /v1/recovery` | CLI/tests | Synchronous full pipeline → envelope `{status, selectedOffer, attempt, timing}` |
| `GET /readiness` | Person 1 | Cached agent cards + live provider health |
| Provider `POST /admin/mode` | demo | Flip failure mode live (`healthy\|down\|unresponsive\|slow\|fail_activation\|laggy`) |

### 7.2 Runtime semantics (changes vs the M1 fixtures-only contract)

- **Fee engine**: every Selected Offer's `agreement` now carries the full
  escrow split — `planPrice` (= provider quote), `platformFee` (=
  `PLATFORM_FEE_PERCENT` × planPrice, default 5%), `amount` (=
  planPrice + platformFee, the escrow lock), `providerAmount` (= planPrice)
  and `platformAddress` (env `PLATFORM_ADDRESS`). The schema enforces the
  arithmetic, so a skimmed fee fails validation. Fixtures were regenerated
  (S2: 60 plan + 3 fee = 63 escrowed).
- **Nonce sequence**: attempt-derived — `INC-*:PROVIDER-*:001` for the first
  activation, `:002` when the first provider's activation fails and the next
  ordered offer takes over (msg-to-person3 §"4 defaults", demo beat "The
  Fallback"). Re-running the same incident reproduces the same nonce.
- **Timing 四件套**: `tDetect`/`tDecide` at selection, `tActivate`/`tRecover`
  stamped when the provider confirms AVAILABLE.
- **Emergency selection**: collect all bids until the deadline (per-provider
  abort at `bidDeadlineMs`), then first-viable-by-arrival wins — zero LLM on
  the P0 path. Viable later arrivals are kept as failover candidates and
  recorded as `SUPERSEDED_BY_FIRST_VIABLE`.
- **Normal selection**: deterministic ranking, upgraded to Gonka 3-model
  consensus (Borda merge, budget-capped) when ≥2 offers are viable; any
  failure falls back to the deterministic order.
- **Gonka enrichment** (provider side): each provider races a one-line pitch
  against `bidDeadlineMs − 200ms`; included only if it makes the window, and
  signed into the offer (tamper-consistent). Display-only for the Rescue
  Agent. Observed real latency 2.7–12 s, so pitches appear opportunistically —
  "LLM enriches, determinism decides."
- **TAMPERED_OFFER**: an offer whose identity/signature fails verification
  against the cached agent-card key is rejected and never ranked.

## 8. Remaining Work for M5 (nice-to-have; contracts unchanged)

- ~~CAMARA sandbox activation~~ — **decided 2026-08-30: not buildable.** The
  available sandbox does not expose the QoD API, so activation stays on the
  CAMARA-shaped mock backend (`activationAdapter.js`); pitch: "adapter
  implements the CAMARA QoD contract, sandboxed mock backend".
- Salvage from the deleted stash branch if wanted (copies were saved to
  `/tmp/person2-stash-scripts/`): `reliability-report.mjs` (repeated-run
  report) and `demo-fallback.mjs`;
- Real counter-offer quoting when a provider cannot satisfy a request
  (schema field already exists).
