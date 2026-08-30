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

## Sui objects & addresses (testnet)

Live on Sui **testnet** — published 2026-08-30 (fee-split + verification
verdict build), all demo/harness transactions verifiable on
[SuiScan](https://suiscan.xyz/testnet) (or suivisor.xyz):

| Object | ID |
| --- | --- |
| Package (`netchain`) | `0x0cef837f0b24aff1dd71a68029b9958c64f811ab0cc1d2ce9571d143180672cd` |
| `TreasuryCap<MYRC>` | `0x9dd1c876ec495e81c77e9614f78eb2caa0b2bdf73181d66b005f7d67b4c809b5` |
| `Escrow<MYRC>` (readiness pool) | `0xd0eea9acd78af0b564056edddd464260aa92eb7e54ffbeed3fc152dc423e64a5` |
| `AuthorityCap` | `0x1ba8951528c97c691473cabdee99e36c4c672dd17b5792c5972004be985ba3d3` |
| Buyer address | `0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24` |
| Platform fee wallet | `0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4` |

### Proof transactions (blueprint §12 acceptance)

| Beat | Tx digest | Proof |
| --- | --- | --- |
| Publish package | `EGn2vwnwpQmBzngCv2tGWi1b8ERKkW982Lz1V5yxdmzz` | fee-split + verification verdict escrow live |
| Readiness (mint + escrow + authority, 1 PTB) | `2WmpuF5gShtwk2scBBvsuYS4hKPdeZ9AhUHxSBmtqjtc` | trust prepared before incidents |
| Commit INC-S2 (dual on-chain sig verify, 63 MYRC locked = 60 + 3 fee) | `3ssNTUBU83Gwdmyf2jdPkh1KFJ4un8ihKs4Voxqhz24t` | nonce `INC-S2:PROVIDER-B:001` |
| Duplicate replay blocked (0 new txs) | — (registry short-circuit) | idempotency |
| **Verification Agent: connection log on-chain** (avg 301.25/300 Mbps → OK) | `4ddZaC8vnvnoSfqr3zNXWXTuNo513CiUkXtBBbcDK4jR` | §4.3/§12 verdict evidence |
| **Split settlement** (60 → provider · 3 → platform fee wallet) | `8QeWcPfJTHAziZiNT9Y8nRLhCgoT2aPf6ji7x4T8QysF` | §12 split-settlement row |
| Emergency refund (provider failed) | `2ezYmGR13J1bLnetuSNQYq1Ppp496ppWXvyXsDamwejF` | §6-F graceful refund |
| Failover commit + **under-delivery verdict** (avg 240/300 → PENALTY) | `8NiXmc8kNRsbdpr5pjuqx7yYDfvcWw99jzgzjDvU6bdK` / `4cm6tMe3515R3E8t1WZNFFEnRDHMt6fwWDaekAkenNFb` | §6.1 Failover + §4.3 penalty |
| Penalized split settlement (90 → provider · 10 → buyer · 5 → platform) | `ELFMiSp2wZhdLPgY5t3sAypfWiBZwr5557kVKcTrLgP1` | §12 verification-proof row |

Reliability harness: **14/14 checks on testnet** (incl. on-chain event
read-back proving ledger `voucherDigest` matches the on-chain `Committed`
event byte-for-byte, and Verified verdicts readable with penalties > 0).
Platform fee wallet holds **16 MYRC** collected fees (4 settlements, verified
on-chain). Total gas for the two full testnet proofs (publish + setup + 26
demo/harness transactions): **0.218 SUI** (~US$0.6).

Localnet addresses: `.sui/config.localnet.json`.

## Quick start

Prereqs: Node ≥ 20, [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) on PATH or at `%USERPROFILE%/sui-cli/sui.exe`.

```bash
npm install

# Persons 1+2 contracts + Person 3 offline tests
npm test

# Move unit tests (16): idempotent commit, replay abort, bad signature,
# expiry, settle-twice, refund, permissionless reclaim, authority limits,
# fee-split settlement (provider + platform), fee guards
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
