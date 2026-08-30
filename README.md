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

## Sui objects & addresses (testnet) — TWO-TRACK BUILD

Live on Sui **testnet** (2026-08-30): the escrow now holds **real Circle USDC**
(Sui Track 01 — Payments & Stablecoins), and the agent-commerce trust layer
serves Sui Track 02 (AI × SUI). All transactions verifiable on
[SuiScan](https://suiscan.xyz/testnet):

| Object | ID |
| --- | --- |
| Package (`netchain`) | `0xa648e1fbb1ae8f04ce6c3b0790c36f2f0a1a1f6e59368946f76f37a0020235bf` |
| USDC coin type (Circle, allowlisted for gasless) | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` |
| Shared `Escrow<USDC>` pool | `0xac38c19b44ff705426c917ce57f83e5ec2ee905efcf8e5af38202bf654887c9f` |
| `AuthorityCap` | `0x1496f81239e74b2c891027a2855a7b02b2def8a530733dee452ee2e11133092f` |
| Buyer address | `0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24` |
| Platform fee wallet | `0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4` |

### Proof transactions (blueprint §12 + Sui tracks)

| Beat | Tx digest | Proof |
| --- | --- | --- |
| Publish (fee-split + verification escrow) | `JgFF81xqkGkocC8rxseRZwyS7z2GXKgyjD74bZ9aQVD` | asset-agnostic `Escrow<T>` runs REAL USDC |
| Readiness (USDC pool + authority, 1 PTB) | `FhH81PSXa2tXQVHtnZXxX9nZLqq9cEEh977onBio2xfK` | trust prepared before incidents |
| Commit INC-S2 (dual on-chain sig verify, 1.575 USDC = 1.5 + 0.075 fee) | `GrsvnTZSA99YfZPa4QHqSm7XyfMXDADzBSAUXuX4o9XM` | nonce `INC-S2:PROVIDER-B:001` |
| Duplicate replay blocked (0 new txs) | — (registry short-circuit) | idempotency |
| Verification Agent: connection log on-chain (301.25/300 Mbps → OK) | `2qKLdyeEjqbyJ4Dr4RGkvyMxRcuy3dXtYLm1px9kDtAk` | §4.3/§12 verdict evidence |
| Split settlement (1.5 → provider · 0.075 → platform fee wallet) | `A3JMupTo8FaLGx3iP7khgWaazAYtSuuHUeDR5KvP1Fiv` | §12 split-settlement row |
| Emergency refund → pool replenished | `4RQkjX1uMjeiX7eJAsQwK3HzqPFeEsXgSodvJDcB2pKZ` | §6-F graceful refund |
| Failover commit + under-delivery verdict (240/300 Mbps → PENALTY) | `4o95S7TcT6v2NZ9Yewk2offGUx9GuH4R96DLyMSgir5Z` / `GzmujG7yHhVj4PbuhgRv6AnEf527vKDBvmc2ZYuUqnNV` | §6.1 Failover + §4.3 |
| Penalized settlement (2.2355 → provider · 0.263 → buyer · 0.1315 → platform) | `7js57vfjbJw46UhvzCL1JLBJgQUceeDrtMJxxQ5hbRmX` | §12 verification-proof row |

### Payment rails — Sui Track 01 features (real USDC, zero-SUI senders)

| Rail | Tx digest | Proof |
| --- | --- | --- |
| **Gasless transfer** — sender held ZERO SUI, gas charged 0 (`balance::send_funds`, allowlisted USDC) | `6wKn5fqyNnZnCAwyLprhA5C3QQSJCrTjpxAtJiZoigK2` | docs.sui.io gasless-stablecoin-transfers |
| **Sponsored deposit** — customer signed, platform gas wallet paid gas, into the shared pool | `6n7ad4R79kj8qdJQ3zgAZ9M2ufRtXj3m6dZk96X3dNcb` | sponsored-transaction flow, two-identity signing |

Reliability harness: **13/13 checks on testnet** (USDC); the offline suite
covers the MYRC localnet path — **19/19 Move tests, 64/64 JS tests**. On-chain
event read-back proves ledger `voucherDigest` ↔ `Committed` event
byte-for-byte, and Verified verdicts (with penalties) are readable from the
node. Testnet fixture amounts are price-scaled (×0.025) to fit faucet drips —
`SUI_TESTNET_PRICE_SCALE` / `STABLECOIN_ESCROW_FUND` scale them up with
faucet balance. Localnet runs the identical contracts on the MYRC demo coin.

Localnet addresses: `.sui/config.localnet.json`.

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
