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

Live on Sui **testnet** — published 2026-08-30, all demo/harness transactions
verifiable on [SuiScan](https://suiscan.xyz/testnet) (or suivisor.xyz):

| Object | ID |
| --- | --- |
| Package (`netchain`) | `0x4b275edf56d5c5d89c4237d7c13953382e9573f64d8708dee1f5d477a4e9ffe8` |
| `TreasuryCap<MYRC>` | `0x6b58f769ce82c4e0bdb4ea404d12d3a22793ac771ebe36bafc364389d908f521` |
| `Escrow<MYRC>` (readiness pool) | `0xef10856b0612fe381de6555e3b4421fc755cd39c7c169041f4b87c3efd400849` |
| `AuthorityCap` | `0xc202c71200f8d4ee6f5d4bc4d213ab1cace1484219ee50505b84177b590fa54e` |
| Buyer address | `0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24` |
| Platform fee wallet | `0xabc67fa394146947b426d6b9ed95cac2bddf4fa0b33593667c3603941002c8f4` |

### Proof transactions (blueprint §12 acceptance)

| Beat | Tx digest | Proof |
| --- | --- | --- |
| Publish package | `55vNBKV4Nphnz37tPjpjRRpFYkBtvaaGt2DS88x4sSXj` | fee-split escrow live |
| Readiness (mint + escrow + authority, 1 PTB) | `g1erABT8vinTCg4GxK7pWEpZCsbqS8LUAUyu22fETNN` | trust prepared before incidents |
| Commit INC-S2 (dual on-chain sig verify, 63 MYRC locked = 60 + 3 fee) | `5NXGsNFDDAn9y9s17EEfapeSh4yYnZeqXue8gkrXVGvz` | nonce `INC-S2:PROVIDER-B:001` |
| Duplicate replay blocked (0 new txs) | — (registry short-circuit) | idempotency |
| **Split settlement** (60 → provider · 3 → platform fee wallet) | `4ri9GsiktNo8p6zpZpnG2cTUqVd5hi5iJEDnMqtBRAYs` | §12 split-settlement row |
| Emergency refund (provider failed) | `BZtEYmjSf7V23Kkn5ttrpWUfAXS4irHTGE1k64bqzfco` | §6-F graceful refund |
| Failover takeover commit + settle (105 + 5 fee) | `FCSpoVG9mncpFwZ8gEBEWyzikhVNZD2EwAgtzX1oRNPL` / `3HTL8rXfYeP6Ji5uvyxKxXF5EPdG1o7kiK8vMAoPW756` | §6.1 Failover KPI |

Reliability harness: **11/11 checks on testnet** (incl. on-chain event
read-back proving the ledger `voucherDigest` matches the on-chain
`Committed` event byte-for-byte). Total gas for the entire testnet proof:
**0.104 SUI** (~US$0.3) — publish + setup + 13 demo/harness transactions.

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
