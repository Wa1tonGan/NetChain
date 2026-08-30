# Message to Person 1 — status, your remaining work + new dashboard UI requirement

> Copy-paste everything below the line.

---

**Subject: Persons 2+3 are done and merged — your integration point is ready, plus one new requirement: the live "agent conversation" dashboard UI**

Hey — update from the Person 2 + Person 3 side. We merged both workstreams on branch `person2-+-person3` and they run end-to-end: incident → agent market → signed deal → Sui escrow → split settlement. **75/75 tests green.** This message covers (1) what's done, (2) exactly how you plug into it, and (3) a new requirement we're assigning to you: the **visual A2A/agent-thinking dashboard UI**.

## 1. What is already done

**Person 2 (agent market):**
- Rescue Agent gateway on `:8082` + three independent provider agents on `:8101–8103` (NusaNet 5G / KilatLink FWA / OrbitSat GO), each its own HTTP service with its own key and failure modes
- Parallel A2A race with per-provider deadlines, deterministic + Gonka multi-model ranking, activation failover (nonce `:001 → :002`)
- Fee engine: platform fee (default 5%) computed on the plan price and added on top — baked into the buyer-signed agreement
- One command: `node scripts/start-all.mjs`

**Person 3 (Sui trust layer):**
- Move escrow with **on-chain dual ed25519 signature verification**, nonce replay-block (0-transaction service-side registry + chain-level)
- Split settlement (provider full quote + platform fee slice), refund, permissionless reclaim, delivery verification with penalty
- Trust service on `:8200`, SSE at `/v1/events`; proven 14/14 on Sui testnet

**Joint (decided this week):**
- Fee-split agreement shape unified across both sides — what the buyer signs is exactly what settles
- **Duration is now first-class end-to-end**: scenario `constraints.durationMinutes` → provider request → **provider offer** (new, schema-required) → buyer-signed agreement. The evaluator rejects offers covering fewer minutes than requested.

## 2. Your part — what exists and what remains

Already in the repo (from your earlier drop):
- `src/watcher/recoveryCalculations.js` — detection → shortfall → RecoveryIntent (the 9 scenario JSONs come from this)
- `src/policy/priorityController.js` — P0 above VVIP > VIP > Normal
- `src/schemas/recoveryIntent.js` — the intent schema

Remaining (blueprint):
1. **Portals/UI** — VIP/VVIP dashboard + individual mobile view (plan, provider, recovery timer)
2. **Alert + reply flow** — degradation alert, user replies with a desired duration → that becomes `constraints.durationMinutes`
3. **Wallet top-up** — top up platform wallet before submitting recovery
4. **Live watcher service** — today scenarios are POSTed manually; nothing runs the watcher continuously and auto-fires the intent

**Your integration point (nothing to wait for):**

```bash
curl -X POST http://127.0.0.1:8082/recovery/intents \
  -H 'content-type: application/json' \
  -d @scenarios/s2-primary-down-backup-insufficient.json
```

- Same request accepts `{"intent": {...}}` or a bare intent; duplicate `incidentId` returns the existing incident (no second run)
- `GET /incidents/:id` → status view · `GET /incidents/:id/result` → the signed Selected Offer
- Contract details: `documents/person2-a2a-contract.md` §3 + §7.1

## 3. NEW REQUIREMENT — build the live "agent conversation" dashboard UI

We need a UI page that shows the A2A communication process and the agents' "thinking" in a way a non-technical judge understands in 5 seconds. **This is NOT a log viewer — no raw JSON, no event dumps.** Every event must be translated into one plain-language card/sentence.

**What to show:**

1. **Stage pipeline** (top row, light up as they happen):
   `📩 Incident received → 📣 Asking providers → 🧠 Deciding & signing → ⚡ Activating → ✅ Backup live → 💰 Settled`

2. **Provider race cards** (one per provider): brand, answer time ("answered in 0.9 s"), the pitch (when Gonka adds one), and on rejection a **plain-language reason card** — e.g. "✗ too slow to activate (needs 8 s, target 5 s)", "✗ not enough capacity (150 < 200 Mbps)". Winner card gets a ⭐ and the money line: "RM60 for 60 min + RM3 platform fee → RM63 escrowed".

3. **Agent thinking timeline** — one sentence per event, newest on top, e.g.:
   - "📣 Asked all 3 providers in parallel — wallet balance stays hidden"
   - "⏱️ OrbitSat GO answered first but can't serve 300 Mbps → rejected"
   - "🏆 KilatLink FWA wins the ranking — buyer signature applied"
   - "⚡ Activating KilatLink's backup path…"
   - "🔗 Deal locked on Sui — both signatures verified ON-CHAIN"

4. **Sui chain panel** (small, right side): lock / settle / refund / delivery-verdict events, same plain-sentence style ("💸 Paid: RM60 → provider · RM3 → platform").

**Data sources — already streaming, zero backend work needed:**
- `GET /incidents/:id/events` (SSE, port 8082, CORS open) — event types: `status` (RECEIVED/QUERYING/SELECTED/ACTIVATING/AVAILABLE/SETTLED/FAILED_*), `arrival` (providerId, receivedAtMs, pitch), `rejection` (providerId, reason, detail), `settlement`
- `GET /incidents/:id/result` — deal terms for the winner card (price, fee split, duration, nonce)
- `GET /v1/events` (SSE, port 8200) — chain events: `VERIFIED`, `COMMITTED`, `SETTLED`, `REFUNDED`, `DELIVERY_VERIFIED` (filter by `incidentId`)

**Translation table for rejection reasons (never show the raw code):**

| Code | Say |
| --- | --- |
| ACTIVATION_TOO_SLOW | too slow to activate |
| INSUFFICIENT_CAPACITY | not enough capacity |
| INSUFFICIENT_DURATION | can't cover the requested duration |
| LATENCY_EXCEEDED | latency too high |
| PACKET_LOSS_EXCEEDED | packet loss too high |
| RELIABILITY_BELOW_MINIMUM | not reliable enough |
| BUDGET_EXCEEDED | over budget |
| RESPONSE_TIMEOUT | didn't answer before the deadline |
| PROVIDER_UNAVAILABLE | provider is down |
| SUPERSEDED_BY_FIRST_VIABLE | viable, but a faster offer won the P0 race |
| RANKED_BELOW | viable, but ranked lower |
| TAMPERED_OFFER / OFFER_INVALID | offer failed the signature check |
| ACTIVATION_FAILED | activation failed |

Implementation notes: one self-contained HTML page is enough (no framework, no build step); keep the provider brand map hardcoded (PROVIDER-A/B/C → NusaNet 5G / KilatLink FWA / OrbitSat GO); connecting to `?incident=INC-S2` via URL param makes demo resets easy. This page doubles as your P0 demo view — judges will watch this screen while the scenario runs.

Timeline-wise this is your last big deliverable — the data contracts above are final, so you can build against the running stack anytime (`node scripts/start-all.mjs` + POST a scenario). Ping us when the first cut is up and we'll do a joint dry run.
