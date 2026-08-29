# Person 3 → Team Integration Contract (Sui Trust Layer & Reliability)

> Handoff document: the Sui Move contracts, trust service endpoints, event
> schema and timing instrumentation produced by Person 3. Persons 1 & 2 can
> integrate against this without reading Move code. Companion to
> `person2-a2a-contract.md` (our input contract).
>
> **Status: IMPLEMENTED & GREEN.** 13/13 Move unit tests, 8/8 harness checks,
> full demo runs via `npm run demo:sui`. Localnet proven end-to-end; testnet
> pending faucet funding.

## 0. Answer to Person 2's integration message (`msg-to-person3.md`)

Your "Option A — off-chain verify only" premise was: *"re-implementing
recursively-sort-JSON-keys+hash inside Move is not realistic."* Agreed — and
unnecessary: **Sui Move has a native ed25519 verifier.** We pass the canonical
JSON bytes as plain `vector<u8>` arguments; the Move `commit` calls
`sui::ed25519::ed25519_verify` on BOTH signatures before locking funds, and
stores `blake2b256(canonical buyer bytes)` as the voucher digest. No JSON
parsing in Move, no change to your M1 contract, fixtures, or signing format.

- Your step 1 (off-chain verify with `src/a2a/signing.js`) is implemented
  verbatim as the fast-fail front door.
- Your step 2 (digest commitment) is implemented — blake2b256 instead of
  sha256, Sui-native.
- Your steps 3/4 are superseded: the chain DOES verify signatures now, so the
  pitch line upgrades to **"the chain checks both signatures before any fund
  moves — off-chain verification is only a fast-fail optimization."**

Your 4 defaults: (1) nonce de-dup — adopted, plus on-chain strictness (same
nonce + different bytes → abort; byte-identical → idempotent no-op); (2) —;
(3) pull delivery — poller hook ready, file/fixtures path is primary until
your runtime exists; (4) 1.5 s ack + `ESCROW_PENDING` + settlement callback —
adopted: our commit returns after broadcast with the digest, activation never
blocks, and we POST settlement status to your callback (hook below).

## 1. Data Flow (extends Person 2 §1)

```
Person 1                     Person 2                          Person 3 (this workstream)
─────────                    ─────────                         ──────────────────────────
scenarios/*.json
        │
        ▼
buildProviderRequest()  →  Provider Request (parallel A2A)
                            │
                        Selected Offer ─────────────────────→  voucher.js (map + off-chain
                            │                                   pre-verify via signing.js)
                            │                                   │
                            │                                   ▼
                            │                              escrow::commit (Sui TX:
                            │                              ON-CHAIN dual ed25519 verify,
                            │                              nonce lock, event)
                            ▼                                   │
                        activation result ───────────────→  AVAILABLE → settle (payment TX)
                                                                FAILED → refund
                                                                expired → reclaim (anyone)
                                                                │
                                                                ▼
                                                    events/reliability-events.jsonl
                                                    → Telemetry Dashboard (tail or SSE)
```

Non-blocking trust (blueprint §6-E): commit is submitted in parallel with
activation; if the activation result arrives first, settlement waits for the
commitment. Ack-after-broadcast keeps P2's 1.5 s budget.

## 2. Move Package (`move/`, package `netchain`)

| Module | Object/Type | Purpose |
| --- | --- | --- |
| `netchain::myrc` | `Coin<MYRC>` + TreasuryCap | Demo stablecoin, 1 unit = 1 MYR (matches fixture amounts). Escrow is generic `Coin<T>` — a regulated MYR stablecoin or USDC is a type-argument swap (real-world readiness, blueprint §13). No MYR stablecoin exists on Sui today (BloX MYRC is EVM/Solana/Base), so the demo mints its own. |
| `netchain::authority` | `AuthorityCap` (buyer-owned) | Scoped spending authority: `max_per_voucher`, `enabled`, audit counters. Created BEFORE any incident (blueprint §4.1). |
| `netchain::escrow` | `Escrow<T>` (buyer-owned) | Pre-funded pool. `commit` verifies BOTH A2A signatures ON-CHAIN, then locks funds under the nonce. `settle`/`refund`/`reclaim` resolve. |

### Authorization
- `commit(voucher…, &mut AuthorityCap)` — buyer only (Sui ownership = signer proof; buyer = `tx_context::sender`).
- `settle(nonce, &AuthorityCap)` / `refund(nonce, &AuthorityCap)` — buyer decides post-verification (provider cannot self-claim past verification).
- `reclaim(nonce, clock)` — **permissionless after expiry** (liveness: nothing is stuck if the buyer key is offline).

### Commit checks (in order)
1. Nonce known? digest match ⇒ **idempotent no-op** (`Committed{idempotent:true}`); mismatch ⇒ abort `NONCE_REPLAY`.
2. Provider offer signature over canonical offer bytes.
3. Buyer signature over canonical `{incidentId, selectedProvider, agreement}` bytes.
4. Authority enabled + `amount ≤ max_per_voucher`.
5. `Clock.timestamp_ms() < expiry`.
6. `available ≥ amount` → split into per-nonce lock.

### Error codes (Move abort codes)
| Code | Name | Raised in |
| --- | --- | --- |
| 1 | `SIGNATURE_INVALID` | escrow |
| 2 | `VOUCHER_EXPIRED` | escrow |
| 3 | `NONCE_REPLAY` | escrow |
| 4 | `AUTHORITY_DISABLED` | authority |
| 5 | `AUTHORITY_EXCEEDED` | authority |
| 6 | `INSUFFICIENT_ESCROW` | escrow |
| 7 | `UNKNOWN_COMMITMENT` | escrow |
| 8 | `ALREADY_FINALIZED` | escrow |
| 9 | `NOT_EXPIRED` | escrow |

Commitment status: `0 COMMITTED → 1 SETTLED | 2 REFUNDED | 3 RECLAIMED` (`255` unknown).
On-chain events: `EscrowFunded`, `Committed`, `Settled`, `Refunded`, `Reclaimed`.

**Two-layer idempotency** (blueprint §6.1 Duplicate-Safety): service ledger
registry short-circuits duplicates with zero transactions; the chain itself
no-ops byte-identical replays and aborts (`NONCE_REPLAY`) same-nonce /
different-bytes forgeries. Both layers independently proven in the harness.

## 3. Voucher construction (from Selected Offer — Person 2 §5)

| Move `commit` arg | Source |
| --- | --- |
| `incident_id`, `provider_id` | `selectedOffer.incidentId`, `selectedProvider.providerId` (UTF-8) |
| `amount` | `agreement.amount` (MYRC = 0 decimals; 1 unit = 1 MYR; non-integers rejected) |
| `expiry_ms` | `Date.parse(agreement.expiry)` |
| `nonce` | `agreement.nonce` bytes — THE idempotency key |
| `provider` | provider Sui address (identity registry below) |
| `buyer_msg` / `buyer_sig` / `buyer_pk` | canonical `buyerAgreementPayload` bytes / `signatures.buyerSignature` / buyer raw pubkey (32 B) |
| `provider_msg` / `provider_sig` / `provider_pk` | canonical winning-offer-minus-signature bytes / `signatures.offerSignature` / provider raw pubkey (32 B) |

The original signed offer is looked up by `offerId` in `fixtures/sui/offers/`
(the Selected Offer carries only a projection). Off-chain pre-verify uses
Person 2's own `src/a2a/signing.js`.

## 4. Identity registry (one identity, A2A + Sui)

Sui keypairs derive from the fixture PKCS#8 PEM seeds (`src/sui/keys.js`);
address = `blake2b256(0x00 ‖ pubkey)`. Node-crypto and SDK signatures over the
same bytes are identical (proven in `scripts/spike-keys.mjs`).

| Identity | A2A keyId | Sui address |
| --- | --- | --- |
| Buyer | `buyer-demo` | `0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24` |
| PROVIDER-A/B/C | `provider-*-demo` | derived per network; recorded in `.sui/config.<net>.json` → `providers` |

## 5. Trust service (`src/sui/`, JS ESM)

CLI (primary, demo-safe — no server needed):
`npm run trust -- commit <selected-offer.json> | activation <id> AVAILABLE|FAILED | settle | refund | reclaim <nonce> | status <id>`

HTTP (optional, port **8200**): `POST /v1/commit`, `POST /v1/activation`,
`GET /v1/status/:incidentId`, `GET /v1/events` (SSE).

P2-defaults hooks (adopted from `msg-to-person3.md`):
- Pull mode: service can poll `GET /incidents/:id/result` and feed `commit`.
- Settlement callback: every `SETTLED`/`REFUNDED`/`RECLAIMED` can be POSTed to
  P2's `/callbacks/settlement`.
- Ack: `commit` returns the digest after broadcast (≤1.5 s budget); the
  commitment confirms asynchronously and activation proceeds in parallel.

Service-level idempotency: nonce registry rebuilt from the ledger on restart;
the harness/demo use **per-run escrow pools** so repeated runs start from
virgin replay state (repeatability acceptance criterion).

## 6. Event schema — `events/reliability-events.jsonl`

One JSON object per line, append-only (dashboard: tail the file; SSE mirrors):

```json
{"seq":7,"ts":1788004802500,"type":"SETTLED","incidentId":"INC-S2",
 "nonce":"INC-S2:PROVIDER-B:001","txDigest":"ABCD…","data":{"amount":60,"provider":"PROVIDER-B"}}
```

Types: `ESCROW_READY`, `VERIFIED`, `VERIFICATION_FAILED`, `COMMITTED`,
`DUPLICATE_BLOCKED`, `SETTLED`, `REFUNDED`, `RECLAIMED`, `COMMIT_RETRY`,
`ACTIVATION_OBSERVED`, `TTR_MEASURED`, `HARNESS_RESULT`.
TTR aggregation (`src/sui/ttr.js`) → blueprint §6.1 KPIs →
`reliability-report.{json,md}` per harness run.

## 7. Deployment registry — `.sui/config.<network>.json` (per network)

```json
{"network":"localnet|testnet","packageId":"0x…","treasuryId":"0x…",
 "escrowId":"0x…","authorityId":"0x…","buyer":"0x…","setupDigest":"…",
 "providers":{"PROVIDER-A":"0x…","PROVIDER-B":"0x…","PROVIDER-C":"0x…"}}
```

## 8. Commands

```bash
npm run sui:setup       # readiness: publish + mint + fund escrow + authority
npm run sui:fixtures    # fresh short-lived signed fixtures (reused every run)
npm run demo:sui        # one-command demo — all blueprint §10 beats
npm run harness:sui     # 8-check reliability battery → reliability-report
npm run trust -- …      # CLI operations
sui move test --path move   # 13 Move unit tests
npm test                # Persons 1+2 tests (Sui JS tests gated by SUI_NETWORK)
```

## 9. Test vectors (Move unit tests)

Buyer seed = 32×`0x07`, provider seed = 32×`0x09` (deterministic).
Buyer pk `ea4a6c63…446d22c` → address `0xa0cc…33da`; provider pk
`fd172438…35e9f618` → `0x6c88…97ad3`. Hex in `move/tests/escrow_tests.move`.

## 10. Coordination notes

- **Person 2 — the fallback scenario reality (important for the demo script):**
  with the shipped provider profiles, Provider C (150 Mbps) can NEVER be
  viable in S2 (200 Mbps) or S7 (300 Mbps), and when C *is* viable it outranks
  B on price. Blueprint demo step 11's literal "B down → C" is impossible with
  honest numbers. What IS proven (and better matches the §6.1 KPI table):
  **S7 EMERGENCY: A commits → A fails → B takes over** (B was
  `SUPERSEDED_BY_FIRST_VIABLE`, still viable) plus the S2 graceful-refund case.
  Recommend the team demo script adopts the A→B wording.
- **Person 2:** fixture freshness — your generator bakes
  `DEMO_EPOCH_MS = 2026-08-29T12:00Z`, so committed fixtures expire on-chain
  at demo time (expiry is inside the buyer-signed payload and can't be
  patched). `scripts/sui-fixtures.mjs` re-runs YOUR pipeline with a live
  clock — same deterministic nonces, fresh signatures — and writes to
  `fixtures/sui/`. Your committed fixtures remain untouched.
- **Person 1:** the dashboard can tail `events/reliability-events.jsonl`
  today; `GET /v1/events` (SSE) when your runtime exists. TTR headline KPI is
  emitted as `TTR_MEASURED` per incident.
- **SDK note:** public Sui fullnodes removed JSON-RPC — all client work runs
  on `@mysten/sui` v2 gRPC (`SuiGrpcClient`). Localnet serves gRPC on its RPC
  port (9000). Commit history note: `waitForObject`/`waitForTransaction`
  exist because gRPC indexes objects asynchronously right after a tx.
