# NetChain — Autonomous Connectivity Resilience Exchange

> **🌐 Live Demo: http://54.234.35.213/#/home** — running on AWS EC2 (Docker): real
> agent market, real Sui testnet escrow. Click any subscriber → **Run Simulation
> (Relocate KL → Penang)** to watch an autonomous recovery settle on-chain.
> Deploy your own: see [DEPLOY_EC2.md](DEPLOY_EC2.md).

> Detect → Protect → Find → Activate → Verify → Settle.

When traditional failover has already happened but the remaining network is
still insufficient, NetChain autonomously buys back the missing capacity:
it detects the shortfall, protects critical traffic (P0 safety override above
any paid plan), queries pre-onboarded provider agents in parallel (A2A),
selects a viable offer, activates a pre-connected backup path, and settles the
service agreement on **Sui** — with Time-to-Recovery measured, not assumed.

**Tracks:** Sui Track 01 (Payments & Stablecoins — escrow/settlement rails,
stablecoin) · Sui Track 02 (AI × SUI — agent-to-agent commerce where the
on-chain commitment is integral, not an add-on).

## The problem

**1. Network needs change by activity.**
Connectivity is not one-size-fits-all — what a connection must deliver depends
on what the user is doing at that moment. Ordinary browsing and messaging work
fine on baseline connectivity, but real-time and interactive activities change
the requirements entirely: gaming needs consistently low latency, livestreaming
needs sustained uplink bandwidth, video calls need stability and low jitter,
and crowded events need capacity that the shared cell simply cannot give
everyone at once. A network provisioned for the average user fails exactly
when the user's needs spike.

**2. Users do not know when premium network capabilities are useful.**
Telecom operators already have the tools — QoS enforcement, programmable
network slices, on-demand boosts — but these capabilities are invisible to the
people who could benefit from them. A user sitting in a congested stadium has
no way to know that a boost exists, whether it would actually fix their
experience, or whether it is worth paying for. The capability is available but
never offered at the right time, so it goes unused: lost revenue for the
operator, degraded experience for the customer.

**3. Premium network services are not context-aware.**
Existing premium add-ons are static products — "buy a 24-hour speed boost"
regardless of whether you need it for 20 minutes or not at all. They are not
tied to what the user is doing, what the network can actually deliver, or
whether the user is likely to benefit. NetChain flips this: the platform uses
provider-supplied user and network context to understand what the customer is
trying to do and what the current connection cannot sustain, and generates a
purchase offer **only when the customer is likely to actually benefit** —
sized to the need, priced for the moment.

**4. Multi-provider sessions are difficult to manage and settle.**
If the provider serving a session can no longer meet the required service
level, the session should continue through another provider instead of dying —
but that creates hard problems: the customer bought from one place, and now
two or more providers served parts of the same session. NetChain keeps it as
**one customer purchase** (a single escrowed payment for the whole session),
hands the session to a backup provider mid-flight, and splits the payment
fairly between the parties at settlement — with independent verification of
delivered capacity so an under-delivering provider is penalized and the buyer
is made whole, automatically.

## How the system works

### The trust layer

Trust is prepared **before** any incident (blueprint §4.1): a scoped spending
authority (`AuthorityCap`), a pre-funded escrow holding the configured
stablecoin (real Circle USDC on testnet, the MYRC demo coin on localnet), and
provider identities that are the *same keys* on and off chain.

During an incident the Sui layer never blocks the fast path:

1. **Voucher** — the Rescue Agent hands over a Selected Offer signed twice
   (provider + buyer, ed25519 over canonical JSON) and self-contained
   (the original signed offer rides inside — no fixture lookup).
2. **Commit** — the Move `escrow::commit` verifies **BOTH signatures on-chain**
   (`sui::ed25519::ed25519_verify`), checks the scoped authority and voucher
   expiry, then locks funds under the nonce. Idempotent: byte-identical
   replays no-op; same-nonce/different-bytes aborts (`NONCE_REPLAY`).
3. **Verify** — delivered capacity is compared to the promise by a
   deterministic tolerance rule (no LLM); the connection-log hash and penalty
   are committed **on-chain** before settlement (blueprint §4.3).
4. **Settle** — activation `AVAILABLE` → one split settlement: the provider
   receives its full quoted price, the platform fee goes to the fee wallet,
   any penalty goes back to the buyer. `FAILED` → refund. Expired →
   **anyone** can reclaim (liveness: funds never stuck).
5. **Measure** — every step emits a reliability event; Time-to-Recovery,
   success rate and duplicate-safety are aggregated into a report.

Duplicate-safety (blueprint §6.1) is two-layer: a service-side nonce registry
(rebuilt from an append-only JSONL ledger on restart) blocks duplicates with
zero transactions, and the chain independently rejects replays.

**The loop is live** (`src/sui/integration.js`): the Rescue Agent's gateway is
wired to the trust service with a deadline-safe mode switch —
`SUI_INTEGRATION_MODE=standalone | one-loop | full` (same pipeline code in
all three; flip one env var, no code changes):

- `npm run integrate:sui` — ONE AI-driven incident end-to-end: submit intent →
  A2A race → commit → verify → split settle → settlement callback to the
  gateway.
- `SUI_INTEGRATION_MODE=full npm run trust:server` — the server polls the
  gateway and auto-commits/verifies/settles **every** resolved incident
  (`POST /v1/verify` also accepts real delivered samples from a monitor).
- `standalone` (default) — the scripted demo + harness, no gateway dependency.

Evidence is public: after settlement the full bundle (voucher + connection
log + split) can be archived to **Walrus** (`npm run walrus:proof`) and
retrieved by blob ID — `sha256(readback) == sha256(archived)`, so a
customer/provider/judge re-checks the verdict without trusting this server.

On-chain state is verifiable on [SuiScan](https://suiscan.xyz/testnet); the
current package, escrow pool, authority and fee-wallet addresses always live
in `.sui/config.<network>.json` — the single source of truth, never copied
into docs.

## Quick start

Prereqs: Node ≥ 20, [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) on PATH or at `%USERPROFILE%/sui-cli/sui.exe`.

### Full UI demo — TESTNET (agent market + zkLogin + Sui escrow)

Everything below runs against **Sui testnet with real Circle USDC** — the
default demo mode. One command brings up the whole stack:

```bash
npm install
npm run provision
SUI_NETWORK=testnet npm run sui:setup   # one-time: publish contracts & fund the shared escrow pool
npm run dev                             # agent market + trust server + zkLogin bridge + frontend
```

Or run the four services in separate terminals:

```bash
# Terminal 1 — agent market: 3 provider agents (:8101-8103)
#   + rescue gateway (:8082) + claim agent (:8105). Quotes in USD.
SUI_NETWORK=testnet node scripts/start-all.mjs

# Terminal 2 — Sui trust server (:8200): /v1/commit, /v1/commit/confirm,
#   /v1/activation, /v1/fund, /v1/verify, /v1/status/:id, SSE /v1/events —
#   settles in REAL USDC on testnet.
SUI_NETWORK=testnet npm run trust:server

# Terminal 3 — zkLogin bridge (:8787): Google sign-in, salt, zk proofs.
npm run zklogin:server

# Terminal 4 — frontend (:5173)
cd frontend && npm run dev
```

Then open `http://localhost:5173`:

1. **Sign in** → Continue with Google (zkLogin) — the browser derives your
   zk identity and (via the prover) signs escrow commitments itself.
2. **Fund your zk wallet once** (the escrow is paid from YOUR USDC):
   ```bash
   curl -X POST http://127.0.0.1:8200/v1/fund -H 'content-type: application/json' \
     -d '{"address":"<YOUR_ZK_ADDRESS>","stableBase":3000000,"suiMist":50000000}'
   ```
3. **`/dev`** → pick a scenario (e.g. **S2**) → run LIVE → reply with a budget →
   providers quote (USD) → the browser zk-signs the commit → verify →
   split settlement, both tx digests land in Activity + SuiScan.

Health checks (all should respond):

```bash
curl http://127.0.0.1:8082/health            # agent market
curl http://127.0.0.1:8200/v1/status/x       # trust server
curl http://127.0.0.1:8787/api/zklogin/health
```

Rules of the road: keep `SUI_NETWORK=testnet` on **both** the market and the
trust server (mismatched money → `UNSUPPORTED_CURRENCY`); if you ever redeploy
the package, restart the trust server so it reloads `.sui/config.testnet.json`
(the single source of truth for addresses). Localnet is still available for
offline rehearsal: drop the env prefix and run `sui start --with-faucet`.

```bash
# Contracts + offline test suite
npm test

# Move unit tests: idempotent commit, replay abort, bad signature,
# expiry, settle-twice, refund (joins pool), permissionless reclaim, authority limits,
# fee-split settlement, fee guards, verification verdict + penalty splits
sui move test --path move

# One command, full story (localnet): readiness → on-chain commit →
# duplicate-block → settlement → FAILED refund → failover takeover → TTR
sui start --with-faucet --force-regenesis &   # terminal 2: localnet
npm run demo:sui

# Reliability battery → events/reliability-report.{json,md}
npm run harness:sui

# Testnet (acceptance: ≥1 commitment + ≥1 settlement on testnet)
SUI_NETWORK=testnet npm run sui:setup
SUI_NETWORK=testnet npm run demo:sui
SUI_NETWORK=testnet npm run harness:sui

# LIVE AI→Sui loop on testnet (the Track-02 headline):
# terminal 1+2: the live agent stack, terminal 3: one integrated settlement
SUI_NETWORK=testnet node scripts/start-all.mjs
SUI_NETWORK=testnet SUI_INTEGRATION_MODE=one-loop npm run integrate:sui

# Walrus evidence archive + independent readback (testnet, one-time WAL fuel
# via the official SUI→WAL exchange happens automatically)
WALRUS_ARCHIVE=true SUI_NETWORK=testnet npm run walrus:proof
```

Trust CLI: `npm run trust -- commit <selected-offer.json> | activation <id> AVAILABLE|FAILED | reclaim <nonce> | status <id>`.
Optional HTTP face: `npm run trust:server` (SSE at `/v1/events`,
`POST /v1/verify` for delivered samples; `SUI_INTEGRATION_MODE=full` also
starts the gateway poller).

## Agent market quickstart

```bash
node scripts/start-all.mjs        # 3 provider agents (8101–8103) + rescue gateway (8082)
                                  # + claim agent (8105); a fresh dynamic provider market is rolled on launch

# trigger a scenario through the full pipeline (S0–S8: normal, primary-down,
# backup-insufficient, high-latency, packet-loss, demand-surge, emergency, …):
curl -s -X POST http://127.0.0.1:8082/recovery/intents \
  -H 'content-type: application/json' \
  -d @scenarios/s2-primary-down-backup-insufficient.json

# watch the provider race / decisions live (SSE):
curl -N http://127.0.0.1:8082/incidents/INC-S2/events

# pull the signed Selected Offer (the trust service's input — the envelope
# embeds the original signed offer, so no fixture files are needed):
curl -s http://127.0.0.1:8082/incidents/INC-S2/result

# kill a provider live and re-run — the fallback demo:
curl -X POST http://127.0.0.1:8102/admin/mode -d '{"mode":"down"}'

npm run generate:fixtures         # regenerate signed fixtures for the trust layer
```

Gonka ranking/pitch enrichment is read from `.env` (see `.env.example`
naming); without a key everything runs on the deterministic path.

## Gonka Router integration (AI for Society track)

All AI reasoning in NetChain runs on the Gonka Network via the official
inference gateway (`GONKA_BASE_URL` in `.env`). Two independent consumers
share the same integration pattern — every configured model in `GONKA_MODELS`
answers independently, answers are kept raw with their **Gonka Request ID**
(`x-request-id` response header, falling back to the response body `id`), and
slow/failed models are honestly reported, never hidden:

| Consumer | File | Role | Multi-model consensus |
| --- | --- | --- | --- |
| Gonka Ranker | `src/a2a/gonkaRanker.js` | Borda-count ranking of provider quotes at market close (votes within `GONKA_RANKING_BUDGET_MS`; ties fall back to the deterministic order) | ✅ every model votes |
| Truth Agent | `src/a2a/claimAgent.js` | SLA claim verification: claim extraction → live-data pass → parallel per-model verdicts → consensus score 0–100 + confidence band | ✅ mean score, disagreement widens the band |

### Truth Agent as the rescue market's audit layer

Beyond the public fact-checking UI (`/truth` — paste a URL, tweet or text),
the Truth Agent audits every settlement: after the deterministic
`checkDelivery()` verdict (the **only** money-path arbiter — the audit
never blocks or changes settlement), `src/sui/truthLink.js` posts the
provider's **signed SLA claims** (promised Mbps, claimed reliability /
latency / activation time) plus the session's connection-log and probe
evidence to `POST /claims` on the Truth Agent (structured input path).
Every configured Gonka model judges the claims against that evidence;
the result lands on the ledger as a `CLAIM_VERIFIED` event carrying per-
model verdicts, scores, reasoning and **Gonka Request IDs**, and renders
on the Activity detail page's Truth Agent audit card (with a deep link to
`/truth?run=<claimRunId>` for the full trace).

### Track checklist coverage

- **Claim Extraction** — `/truth` accepts URL / tweet / text; the audit
  path extracts structured claims from signed offers.
- **Decentralized Verification** — Gonka-hosted models judge against
  live web data (`GONKA_VERIFY_WEB=true`: page snapshot + DuckDuckGo
  snippets) or the session's probe evidence (internal knowledge base).
- **Truth Score & Reasoning** — 0–100 consensus score, per-model scores
  and ≤180-char reasoning each, confidence band widened on disagreement.
- **Transparency UI** — every inference step carries its Gonka Request
  ID: `/truth` trace, the per-model table on the audit card, and the
  ledger event (`events/reliability-events.jsonl`).

### Env vars (see `.env.example`)

`GONKA_BASE_URL` · `GONKA_API_KEY` · `GONKA_MODELS` (Rescue Agent consensus) ·
`TRUTH_AGENT_MODELS` (Truth Agent models; falls back to `GONKA_MODELS`) ·
`GONKA_VERIFY_WEB` · `GONKA_VERIFY_BUDGET_MS` · `TRUTH_AGENT_URL` · `TRUTH_LINK_BUDGET_MS`.

## Architecture

```
Scenarios & Edge            Agent & Provider Market          Sui Trust Layer
─────────                   ─────────                        ──────────────────────────
scenarios (RecoveryIntent)
      │
      ▼
buildProviderRequest() → A2A parallel broadcast → offers
                            │
                        Selected Offer (dual-signed,          voucher verify (off-chain, fast-fail;
                        self-contained envelope) ──────→      original offer re-verified against
                            │                                 the provider's pinned key)
                            │                              escrow::commit (ON-CHAIN signature
                            │                              verification + nonce lock)
                        activation result ──────────────→  settle | refund | reclaim
                            │
                        delivered capacity ─────────────→  escrow::verify (log hash + penalty
                            │                              ON-CHAIN, deterministic tolerance)
                        traffic moved                 split settlement → provider + fee
                                                          (+ penalty → buyer); P2 callback;
                                                      events JSONL + SSE → dashboard
                                                          → reliability-report → Walrus archive
```

Details: [`documents/person3-trust-contract.md`](documents/person3-trust-contract.md) ·
[`documents/person2-a2a-contract.md`](documents/person2-a2a-contract.md) · blueprint in
[`documents/blueprint.md`](documents/blueprint.md) · deep dives:
[`documents/person3/person3-integration-guide.md`](documents/person3/person3-integration-guide.md)
(live loop + Walrus, with diagrams) ·
[`documents/person3/sui-tracks-status.md`](documents/person3/sui-tracks-status.md)
(official track mapping, gas model, zkLogin boundary).

## Why Sui (and not an add-on)

- **On-chain verification:** the Move contract itself checks the agent
  market's ed25519 signatures before any fund moves — the commitment is
  only as valid as the negotiation that produced it.
- **Idempotency as a chain property:** the nonce table makes duplicate
  settlement impossible even with crashing/retrying clients.
- **Asset-agnostic rails:** escrow is generic `Coin<T>`; the demo runs on
  MYRC (1 unit = 1 MYR). A regulated MYR stablecoin (e.g. BloX MYRC — today
  EVM/Solana/Base only) or USDC is a type-argument change, not a contract
  change.
- **Programmable transaction blocks:** readiness (mint + fund + authority)
  is a single setup transaction before any incident exists.

