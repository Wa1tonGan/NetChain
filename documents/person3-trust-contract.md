# Person 3 → Team Integration Contract (Sui Trust Layer & Reliability)

> Handoff document: the Sui Move contracts, trust service endpoints, event
> schema and timing instrumentation produced by Person 3. Persons 1 & 2 can
> integrate against this without reading Move code. Companion to
> `person2-a2a-contract.md` (our input contract).

## 1. Data Flow (extends Person 2 §1)

```
Person 1                     Person 2                          Person 3 (this workstream)
─────────                    ─────────                         ──────────────────────────
scenarios/*.json
        │
        ▼
buildProviderRequest()  →  Provider Request (parallel A2A)
                            │
                        Selected Offer ─────────────────────→  voucher.js  (map + verify)
                            │                                   │  off-chain pre-verify
                            │                                   ▼
                            │                              escrow::commit  (Sui TX:
                            │                              on-chain dual ed25519 check,
                            │                              nonce lock, event)
                            │                                   │
                            ▼                                   ▼
                        activation result ───────────────→  service: AVAILABLE → settle
                        (PENDING|ACTIVATING|                FAILED → refund
                         AVAILABLE|FAILED)                  expired → reclaim (anyone)
                                                                │
                                                                ▼
                                                    events/reliability-events.jsonl
                                                    + GET /v1/events (SSE)  → dashboard
```

Non-blocking trust (blueprint §6-E): the commit transaction is submitted in
parallel with activation. If the activation result arrives before the commit
confirms, the service queues settlement until the commitment is on-chain.

## 2. Move Package (`move/`, package `netchain`)

| Module | Object/Type | Purpose |
| --- | --- | --- |
| `netchain::myrc` | `Coin<MYRC>` + TreasuryCap | Demo stablecoin, 1 unit = 1 MYR (matches fixture amounts). Escrow is generic `Coin<T>` — a regulated MYR stablecoin or USDC is a type-argument swap, not a contract change. |
| `netchain::authority` | `AuthorityCap` (buyer-owned) | Scoped spending authority: `max_per_voucher`, `enabled`, audit counters (`committed_total`, `incident_count`). Exists BEFORE any incident (blueprint §4.1). |
| `netchain::escrow` | `Escrow<T>` (shared) | Pre-funded pool. `commit` locks funds under the nonce after verifying BOTH A2A ed25519 signatures on-chain; `settle`/`refund`/`reclaim` resolve the commitment. |

### Authorization
- `commit(voucher…, &mut AuthorityCap)` — buyer only (Sui ownership enforces the signer; buyer = `tx_context::sender`).
- `settle(nonce, &AuthorityCap)` / `refund(nonce, &AuthorityCap)` — buyer decides post-verification (provider cannot self-claim past verification).
- `reclaim(nonce, clock)` — **permissionless after expiry** (liveness: funds never stuck if the buyer key is offline).

### Commit checks (in order)
1. Nonce known? → digest match ⇒ **idempotent no-op** (`Committed{idempotent:true}`); digest mismatch ⇒ abort `NONCE_REPLAY`.
2. Provider offer signature over canonical offer bytes (`sui::ed25519::ed25519_verify`).
3. Buyer signature over canonical `{incidentId, selectedProvider, agreement}` bytes.
4. Authority enabled + `amount ≤ max_per_voucher`.
5. `Clock.timestamp_ms() < expiry`.
6. `available ≥ amount` → split into per-nonce lock.

### Error codes (abort codes)
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

### Commitment status
`0 COMMITTED → 1 SETTLED | 2 REFUNDED | 3 RECLAIMED` (terminal; `255` = unknown nonce).

### On-chain events
`EscrowFunded`, `Committed`, `Settled`, `Refunded`, `Reclaimed` — all carry
`escrow_id` + `incident_id`/`nonce`/`amount`; `Committed` adds
`voucher_digest`, `buyer`, `provider`, `idempotent`, `status`. These are the
on-chain half of the recovery event ledger (queryable forever).

## 3. Voucher construction (from Selected Offer — Person 2 §5)

| Move `commit` arg | Source |
| --- | --- |
| `incident_id`, `provider_id` | `selectedOffer.incidentId`, `selectedProvider.providerId` (UTF-8 bytes) |
| `amount` | `agreement.amount` × 1 (MYRC has 0 decimals; 1 unit = 1 MYR) |
| `expiry_ms` | `Date.parse(agreement.expiry)` |
| `nonce` | `agreement.nonce` bytes — THE idempotency key |
| `provider` | provider's Sui address (identity registry below) |
| `buyer_msg` / `buyer_sig` / `buyer_pk` | canonical bytes of `buyerAgreementPayload(selectedOffer)` / `signatures.buyerSignature.value` (base64→raw) / buyer raw public key (32 B) |
| `provider_msg` / `provider_sig` / `provider_pk` | canonical bytes of the winning offer minus `signature` / `signatures.offerSignature.value` / provider raw public key (32 B) |

Off-chain pre-verify (fast-fail before any TX) uses Person 2's own
`src/a2a/signing.js` — `verifyOfferSignature`, `verifyBuyerSignature` — plus
schema validation via `selectedOfferSchema`.

## 4. Identity registry (one identity, A2A + Sui)

Sui keypairs are derived from the fixture PKCS#8 PEM seeds
(`src/sui/keys.js`); Sui address = `blake2b256(0x00 ‖ pubkey)`. Verified:
Node-crypto and SDK signatures over the same bytes are identical, so the same
key signs the A2A voucher and the Sui transaction.

| Identity | A2A keyId | Sui address (localnet) |
| --- | --- | --- |
| Buyer | `buyer-demo` | `0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24` |
| PROVIDER-A/B/C | `provider-*-demo` | derived at setup, recorded in `.sui/config.json` |

## 5. Trust service (`src/sui/`, JS ESM, port **8200**)

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/commit` | Body: Selected Offer JSON. Verifies, commits on-chain, returns `{status, txDigest, commitment}`. |
| `POST /v1/activation` | Body: `{incidentId, status, recoveredCapacityMbps?, confirmedAtMs?}`. `AVAILABLE` → auto-settle; `FAILED` → auto-refund. |
| `GET /v1/status/:incidentId` | Full incident state (voucher, commitment, tx digests, timings). |
| `GET /v1/events` | SSE stream of reliability events. |

CLI (always available, demo-safe): `npm run trust -- commit|settle|refund|reclaim|status|show|report <args>`.
File-driven flow is the primary demo path: fixtures in → JSONL events out.

Service-level idempotency: a nonce registry (rebuilt from the event ledger on
restart) short-circuits duplicate requests before they hit the chain.

## 6. Event schema — `events/reliability-events.jsonl`

One JSON object per line, append-only (dashboard: tail the file; SSE mirrors it):

```json
{"seq": 7, "ts": 1788004802500, "type": "SETTLED", "incidentId": "INC-S2",
 "nonce": "INC-S2:PROVIDER-B:001", "txDigest": "ABCD…", "data": {"amount": 60, "provider": "PROVIDER-B"}}
```

Event types: `ESCROW_READY`, `VERIFIED`, `VERIFICATION_FAILED`, `COMMITTED`,
`DUPLICATE_BLOCKED`, `SETTLED`, `REFUNDED`, `RECLAIMED`, `COMMIT_RETRY`,
`TTR_MEASURED`, `HARNESS_RESULT`.
TTR aggregation (`src/sui/ttr.js`): `tDetect`/`tDecide` from the Selected
Offer, `tActivate`/`tRecover` from activation events → blueprint §6.1 KPIs
(`reliability-report.json` / `.md`).

## 7. Deployment registry — `.sui/config.json` (written by `npm run sui:setup`)

```json
{"network": "localnet|testnet", "packageId": "0x…", "escrowId": "0x…",
 "authorityId": "0x…", "treasuryId": "0x…", "buyer": "0x…",
 "providers": {"PROVIDER-A": "0x…", "PROVIDER-B": "0x…", "PROVIDER-C": "0x…"},
 "txDigest": "0x…"}
```

## 8. Commands

```bash
npm run sui:setup            # publish + mint MYRC + fund escrow + authority
npm run sui:fixtures         # regenerate fresh-clock fixtures (+ fallback incidents)
npm run trust -- status INC-S2
npm run demo:sui             # one-command end-to-end demo
npm run harness:sui          # fallback/idempotency battery → reliability-report
sui move test --path move    # Move unit tests
npm test                     # Persons 1+2 tests (Sui tests gated by SUI_NETWORK)
```

## 9. Coordination notes

- **Person 2:** we run `scripts/sui-fixtures.mjs` — imports your
  `buildProviderRequest/selectOffer/signOffer/signBuyerAgreement` with a
  clock override, so fixtures are fresh at demo time (your baked
  `DEMO_EPOCH_MS` produces already-expired vouchers on-chain). No edits to
  your files. Extra synthesized incidents: `INC-S9-FALLBACK` (~100 Mbps, B→C
  takeover) and the S2 graceful-refund case.
- **Person 1:** the dashboard can tail `events/reliability-events.jsonl`
  today; `GET /v1/events` (SSE) when your runtime exists.
- **Demo step 11 note:** with the shipped profiles, Provider C (150 Mbps) can
  never serve S2 (200) or S7 (300). The forced-fallback beat runs on
  `INC-S9-FALLBACK`; if B fails during S2 the honest outcome is
  "no viable provider → refund, no duplicate payment" — frame as a feature.

## 10. Test vectors (Move unit tests)

Buyer seed = 32×`0x07`, provider seed = 32×`0x09` (deterministic).
- Buyer: pk `ea4a6c63…446d22c`, address `0xa0cc…33da`
- Provider: pk `fd172438…35e9f618`, address `0x6c88…97ad3`
- Messages: `INC-T:PROVIDER-B:001|{agreement-canonical-bytes}` /
  `…|{offer-canonical-bytes}` (hex in `move/tests/escrow_tests.move`).
