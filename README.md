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
authority (`AuthorityCap`), a pre-funded escrow holding a MYR stablecoin, and
provider identities that are the *same keys* on and off chain.

During an incident the Sui layer never blocks the fast path:

1. **Voucher** — the Rescue Agent hands over a Selected Offer signed twice
   (provider + buyer, ed25519 over canonical JSON).
2. **Commit** — the Move `escrow::commit` verifies **BOTH signatures on-chain**
   (`sui::ed25519::ed25519_verify`), checks the scoped authority and voucher
   expiry, then locks funds under the nonce. Idempotent: byte-identical
   replays no-op; same-nonce/different-bytes aborts (`NONCE_REPLAY`).
3. **Settle** — activation `AVAILABLE` → the buyer releases the locked
   payment to the provider address. `FAILED` → refund. Expired → **anyone**
   can reclaim (liveness: funds never stuck).
4. **Measure** — every step emits a reliability event; Time-to-Recovery,
   success rate and duplicate-safety are aggregated into a report.

Duplicate-safety (blueprint §6.1) is two-layer: a service-side nonce registry
(rebuilt from an append-only JSONL ledger on restart) blocks duplicates with
zero transactions, and the chain independently rejects replays.

## Sui objects & addresses (testnet) — TWO-TRACK BUILD (Buyer 1)

Live on Sui **testnet** (2026-08-30): the escrow holds **real Circle USDC**
(Sui Track 01 — Payments & Stablecoins); the A2A agent commerce + verification
layer serves Track 02 (AI × SUI). Signed by **Buyer 1** — a real self-custody
buyer wallet (`SUI_BUYER_SECRET`, gitignored). Verifiable on
[SuiScan](https://suiscan.xyz/testnet):

| Object | ID |
| --- | --- |
| Package (`netchain`) | `0xa648e1fbb1ae8f04ce6c3b0790c36f2f0a1a1f6e59368946f76f37a0020235bf` |
| USDC coin type (Circle, gasless-allowlisted) | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` |
| Shared `Escrow<USDC>` pool (Buyer 1-funded, 12 USDC) | `0xd76c663118aea97c6674bacbd10e7a4a4719bddc984a8f11df2ccb214193347b` |
| `AuthorityCap` | `0x3842e9fc89add742d4573c34236d85b5ccea440cae654ae2b7188ba55929d237` |
| Buyer 1 (testnet buyer) | `0xbed2dff8b7a0c265d2e25d8835057a8a0acb017eb03718fccd38832c0a758cf0` |
| Platform fee wallet | `0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4` |

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

Reliability harness: **13/13 checks on testnet with real USDC** (incl.
on-chain event read-back: ledger `voucherDigest` ↔ `Committed` event
byte-for-byte; Verified verdicts with penalties readable from the node).
Offline suite: **19/19 Move tests, 83/83 repo tests** (Persons 1+2+3).
Testnet fixture amounts are price-scaled (×0.05) to fit faucet drips —
`SUI_TESTNET_PRICE_SCALE` / `STABLECOIN_ESCROW_FUND` scale them up.
Localnet runs the identical contracts on the MYRC demo coin (2 decimals).

`fixtures/sui/` is gitignored (per-run generated, 5-min TTL — the generator
is the single source of truth); `fixtures/selected/` + `fixtures/providers/`
stay committed. Localnet addresses: `.sui/config.localnet.json`.

## Quick start

Prereqs: Node ≥ 20, [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) on PATH or at `%USERPROFILE%/sui-cli/sui.exe`.

```bash
npm install

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
```

Trust CLI: `npm run trust -- commit <selected-offer.json> | activation <id> AVAILABLE|FAILED | reclaim <nonce> | status <id>`.
Optional HTTP face: `npm run trust:server` (port 8200, SSE at `/v1/events`).

## Agent market quickstart (Person 2)

```bash
node scripts/start-all.mjs        # 3 provider agents (8101–8103) + rescue gateway (8082)

# trigger the S1/S2 stadium scenario through the full pipeline:
curl -s -X POST http://127.0.0.1:8082/recovery/intents \
  -H 'content-type: application/json' \
  -d @scenarios/s2-primary-down-backup-insufficient.json

# watch the provider race / decisions live (SSE):
curl -N http://127.0.0.1:8082/incidents/INC-S2/events

# pull the signed Selected Offer (Person 3's input):
curl -s http://127.0.0.1:8082/incidents/INC-S2/result

# kill a provider live and re-run — the fallback demo:
curl -X POST http://127.0.0.1:8102/admin/mode -d '{"mode":"down"}'

npm run generate:fixtures         # regenerate signed fixtures for Person 3
```

Gonka ranking/pitch enrichment is read from `.env` (see `.env.example`
naming); without a key everything runs on the deterministic path.

## Architecture

```
Person 1                    Person 2                         Person 3 (Sui Trust Layer)
─────────                   ─────────                        ──────────────────────────
scenarios (RecoveryIntent)
      │
      ▼
buildProviderRequest() → A2A parallel broadcast → offers
                            │
                        Selected Offer (dual-signed) ────→ voucher verify (off-chain, fast-fail)
                            │                              escrow::commit (ON-CHAIN signature
                            │                              verification + nonce lock)
                        activation result ──────────────→  settle | refund | reclaim
                            │                              │
                        traffic moved                 events JSONL + SSE → dashboard
                                                          → reliability-report
```

Details: [`documents/person3-trust-contract.md`](documents/person3-trust-contract.md) ·
[`documents/person2-a2a-contract.md`](documents/person2-a2a-contract.md) · blueprint in
[`documents/blueprint.md`](documents/blueprint.md).

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
| Person 3 | Sui & Reliability Execution — Move trust layer, settlement, idempotency, TTR instrumentation, fallback harness |

## AI tools declaration

Built with AI coding assistance (ZCode / GLM). All contracts, fixtures and
test vectors are generated within the hacking period; commit history reflects
the full build.
