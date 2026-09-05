# NetChain — Autonomous Connectivity Resilience Exchange

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

## The trust layer (this workstream — Person 3)

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
  gateway (proven on testnet, digests below).
- `SUI_INTEGRATION_MODE=full npm run trust:server` — the server polls the
  gateway and auto-commits/verifies/settles **every** resolved incident
  (`POST /v1/verify` also accepts real delivered samples from a monitor).
- `standalone` (default) — the scripted demo + harness, no gateway dependency.

Evidence is public: after settlement the full bundle (voucher + connection
log + split) can be archived to **Walrus** (`npm run walrus:proof`) and
retrieved by blob ID — `sha256(readback) == sha256(archived)`, so a
customer/provider/judge re-checks the verdict without trusting this server.

## Sui objects & addresses (testnet) — TWO-TRACK BUILD (Buyer 1)

Live on Sui **testnet** (refreshed 2026-09-03): the escrow holds **real Circle
USDC** (Sui Track 01 — Payments & Stablecoins); the A2A agent commerce +
verification layer serves Track 02 (AI × SUI). Signed by **Buyer 1** — a real
self-custody buyer wallet (`SUI_BUYER_SECRET`, gitignored). Verifiable on
[SuiScan](https://suiscan.xyz/testnet). Re-deploying is normal during the
build (regenesis/faucet/refunding) — `.sui/config.testnet.json` is always the
source of truth for the current addresses:

| Object | ID |
| --- | --- |
| Package (`netchain`) | `0x531c16cde1a45391ab90f21c9f1e3f06ae3d2965965caee5c3de608a5ed50170` |
| USDC coin type (Circle, gasless-allowlisted) | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` |
| Shared `Escrow<USDC>` pool (Buyer 1-funded, 12 USDC) | `0x9c4c5958a942daba695b1a6cfceeec7bf522ed25bc7d55fc5f4d2d828c2a6a63` |
| `AuthorityCap` (max 12 USDC / voucher) | `0x25f8b7990966f30ecf4864e74033f6e67cc22394a7708bc51a1d920990a339bf` |
| TreasuryCap<MYRC> (demo-coin treasury; supply 0 on testnet) | `0x76afeb422db6b64212ea82d706a2f5d8c7838f0edfba90bf0970af38f69922cf` |
| Buyer 1 (testnet buyer) | `0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24` |
| Platform fee wallet | `0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4` |

Recent proof txs (2026-09-03 session, USDC-native small-budget offers):
LOCK `YQ3yeXgActwaNfHpjJgqrgehvv` (1.47 USDC = 1.40 + 0.07 fee) ·
COMPLETE `HGbrda3TGoF4YXzPwr1ZbyD9SR` (split settlement, penalty 0).

### Proof transactions — every use case, once (blueprint §12 + Sui tracks)

| Use case | Tx digest | Proof |
| --- | --- | --- |
| Readiness: USDC pool + authority, 1 PTB (Buyer 1 signs) | `9HNDNsGRQ7RTHhVu1W8DcYfdp9CxLXRfgkop2kG3QPcK` | §4.1 trust prepared before incidents |
| LOCK: commit (dual on-chain sig verify, 3.15 USDC = 3 + 0.15 fee) | `9mgQJcM6e1QjeExiirPNFtBvAJZ9cHwSSj1g1aMhjTtD` | nonce `INC-S2:PROVIDER-B:001` |
| Duplicate replay blocked (0 new txs) | — (registry short-circuit) | §6.1 idempotency |
| VERIFY: within tolerance → OK, connection log on-chain | `E3pYifDG6q9tD3bENFPM6TxmRBasj4dyhxhmQpx5MLEj` | §4.3/§12 verdict evidence |
| COMPLETE: split settlement (3 → provider · 0.15 → platform) | `GYPMXV2oHrHwwaPXroM4CtRJr3ZYmCVBPvx8s3Ja2MYT` | §12 split-settlement row |
| REFUND (provider failed → pool replenished) | `8h3BiJTay2QB2XbjfN4XoxZNw6vVqEQFBpFkXeJdRmTr` | §6-F graceful refund |
| FAILOVER commit (A down → B) + under-delivery VERIFY (240/300 → PENALTY) | `ETu5ryi7Nxqro2yoshBq9Tbd6TnQvcpcmNYZqCfeyX6K` / `CBCXf54pLKHcf7T2qyUZ3xF9EevLB2fLGarYs2ENqGHc` | §6.1 failover + §4.3 |
| Penalized settlement (4.465 → provider · 0.525 → buyer · 0.26 → platform) | `3BYdP1nD5Raey2xXC3jkpm1dwgCFBFLFyLvayZetdwGs` | §12 verification-proof row |
| **GASLESS**: sender held ZERO SUI — gas charged 0 | `CFjZH6Qo8jAfr1XwY4n83HoxwAUdTMJ3chRYmdH25173` | Track-01 gasless-stablecoin feature |
| **SPONSORED**: customer signed, platform paid gas, into shared pool | `5Nu3krsqjqSvDfBYVBFePqmALPikL2M2WRSxqDMz4LvV` | Track-01/02 sponsored feature |
| **LIVE AI↔Sui loop** (`npm run integrate:sui`): Rescue Agent's real A2A offer → commit → verify → settle, P2 settlement callback | `6MJk8arxYHAtfWfwXiLEBCvfZB2swrPFa3aLsGVAar4p` · `228SdkMAhTeHJCLPREqx6dNB45gALH4kYMx2ibSFtszD` · `6Jswa4NvuSY3rcs4nFabGc8bM2eWR8CHxV2eNZiGAfFV` | Track-02: AI × SUI, "Sui is integral" — live (incident `INC-S2-Imthcxrdw`, 1.965 USDC = 1.875 + 0.09 fee) |
| **WALRUS evidence archive**: voucher + connection log + settlement split on Walrus, sha256(readback) == sha256(archived) | blob `sz4tjxunYifIVN327CFRlXTIdxVHtqKO1E2-0OHLJcM` (incident `INC-S2-Imthdxag1`; settle tx `GCKGwMvvrJPLB7zMBs131rvrpjCoZ1sMco9JCAEjAnoX`) | §4.3 evidence independently retrievable: walruscan.com/testnet/blob/… |

Reliability harness: **13/13 checks on testnet with real USDC** (incl.
on-chain event read-back: ledger `voucherDigest` ↔ `Committed` event
byte-for-byte; Verified verdicts with penalties readable from the node).
Offline suite: **19/19 Move tests, 89/89 repo tests** (Persons 1+2+3).
Live integration: `npm run integrate:sui` (one AI-driven loop) or
`SUI_INTEGRATION_MODE=full npm run trust:server` (auto-settle every incident;
`SUI_INTEGRATION_MODE` = `standalone | one-loop | full` — see
`documents/person3/person3-implementation-guide.md`).
Provider profiles are natively priced in affordable USDC-scale amounts —
typical recovery offers quote 1–5 USDC, the same money the user's SMS budget
offers — so no scale-down happens anywhere in the flow. To shrink quotes for
a tiny escrow pool instead, set `SUI_TESTNET_PRICE_SCALE` < 1 (quote-time
scaling; the fixture generator honors the same env). Localnet runs the
identical contracts on the MYRC demo coin (2 decimals).

`fixtures/sui/` is gitignored (per-run generated, 5-min TTL — the generator
is the single source of truth); `fixtures/selected/` + `fixtures/providers/`
stay committed. Localnet addresses: `.sui/config.localnet.json`.

## Quick start

Prereqs: Node ≥ 20, [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) on PATH or at `%USERPROFILE%/sui-cli/sui.exe`.

### Full UI demo — TESTNET (agent market + zkLogin + Sui escrow)

Everything below runs against **Sui testnet with real Circle USDC** — the
default demo mode. Four terminals, copy-paste as-is:

```bash
# One-time (fresh clone): deps + demo signing keys + publish contracts &
# fund the shared escrow pool with 12 real USDC on testnet.
npm install
npm run provision
SUI_NETWORK=testnet npm run sui:setup
```

```bash
# Terminal 1 — agent market: 3 provider agents (:8101-8103)
#   + rescue gateway (:8082) + claim agent (:8105). Quotes in USD.
SUI_NETWORK=testnet node scripts/start-all.mjs
```

```bash
# Terminal 2 — Sui trust server (:8200): /v1/commit, /v1/activation,
#   /v1/fund, SSE /v1/events — settles in REAL USDC on testnet.
SUI_NETWORK=testnet npm run trust:server
```

```bash
# Terminal 3 — zkLogin bridge (:8787): Google sign-in, salt, zk proofs.
npm run zklogin:server
```

```bash
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
3. **`/dev`** → pick scenario **S2** → run LIVE → reply `60 min, USDC 5` →
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
npm install

# One-time (fresh clones): generate signing keys locally.
# Private keys are gitignored on purpose — never commit them again.
npm run provision

# Persons 1+2 contracts + Person 3 offline tests
npm test

# Move unit tests (19): idempotent commit, replay abort, bad signature,
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

# LIVE AI→Sui loop on testnet (the Track-02 headline, digests below):
# terminal 1+2: the live agent stack, terminal 3: one integrated settlement
SUI_NETWORK=testnet node scripts/start-all.mjs
SUI_NETWORK=testnet SUI_INTEGRATION_MODE=one-loop npm run integrate:sui

# Walrus evidence archive + independent readback (testnet, one-time WAL fuel
# via the official SUI→WAL exchange happens automatically)
WALRUS_ARCHIVE=true SUI_NETWORK=testnet npm run walrus:proof
```

Trust CLI: `npm run trust -- commit <selected-offer.json> | activation <id> AVAILABLE|FAILED | reclaim <nonce> | status <id>`.
Optional HTTP face: `npm run trust:server` (port 8200, SSE at `/v1/events`,
`POST /v1/verify` for delivered samples; `SUI_INTEGRATION_MODE=full` also
starts the gateway poller).

## Agent market quickstart (Person 2)

```bash
node scripts/start-all.mjs        # 3 provider agents (8101–8103) + rescue gateway (8082)

# trigger the S1/S2 stadium scenario through the full pipeline:
curl -s -X POST http://127.0.0.1:8082/recovery/intents \
  -H 'content-type: application/json' \
  -d @scenarios/s2-primary-down-backup-insufficient.json

# watch the provider race / decisions live (SSE):
curl -N http://127.0.0.1:8082/incidents/INC-S2/events

# pull the signed Selected Offer (Person 3's input — the envelope embeds the
# original signed offer, so the trust service needs no fixture files):
curl -s http://127.0.0.1:8082/incidents/INC-S2/result

# kill a provider live and re-run — the fallback demo:
curl -X POST http://127.0.0.1:8102/admin/mode -d '{"mode":"down"}'

npm run generate:fixtures         # regenerate signed fixtures for Person 3
```

Gonka ranking/pitch enrichment is read from `.env` (see `.env.example`
naming); without a key everything runs on the deterministic path.

## Gonka Router integration (AI for Society track)

All AI reasoning in NetChain runs on the Gonka Network via the official
inference gateway (`GONKA_BASE_URL=https://api.gonkarouter.io/v1` in
`.env`). Two independent consumers share the same integration pattern —
every configured model in `GONKA_MODELS` answers independently, answers
are kept raw with their **Gonka Request ID** (`x-request-id` response
header, falling back to the response body `id`), and slow/failed models
are honestly reported, never hidden:

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

`GONKA_BASE_URL` · `GONKA_API_KEY` · `GONKA_MODELS` (≥2 models for
consensus) · `GONKA_VERIFY_WEB` · `GONKA_VERIFY_BUDGET_MS` ·
`TRUTH_AGENT_URL` · `TRUTH_LINK_BUDGET_MS`.

## Architecture

```
Person 1                    Person 2                         Person 3 (Sui Trust Layer)
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
[`documents/blueprint.md`](documents/blueprint.md) · Person 3 deep dives:
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

## Team

| Member | Workstream |
| --- | --- |
| Person 1 | Client & Edge — portals, gateway, watcher, priority controller |
| Person 2 | Agent & Provider Market — Rescue Agent, 3 provider agents, A2A contracts |
| Person 3 | Sui & Reliability Execution — Move trust layer, split settlement, idempotency, TTR instrumentation, fallback harness, live agent-runtime integration, Walrus evidence archive |

## AI tools declaration

Built with AI coding assistance (ZCode / GLM). All contracts, fixtures and
test vectors are generated within the hacking period; commit history reflects
the full build.
