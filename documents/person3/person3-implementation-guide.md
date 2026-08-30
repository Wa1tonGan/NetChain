# Person 3 Implementation Guide — Sui Trust Layer & Reliability

> **Audience:** every team member (and judges). Read §1 in 60 seconds; read
> the rest when you need detail. Deep companion: `person3-trust-contract.md`
> (wire-level contract). Blueprint references in brackets throughout.
>
> **Status 2026-08-30:** complete and proven on Sui testnet — 19/19 Move
> tests, 56/56 repo JS tests, **14/14 harness checks on testnet**. Every
> blueprint §12 acceptance row that belongs to the trust layer is green,
> including split settlement and the verification/penalty loop.

---

## 1. The 60-second version

**What it is:** the money-and-proof layer. Person 2's agents decide *who* to
buy recovery capacity from; my layer makes that deal **enforceable**: it
locks the customer's money in escrow on Sui, proves both parties signed the
deal, pays out after delivery is verified, and penalizes under-delivery —
with every step visible as an on-chain transaction.

**The one-sentence pitch:** *"Trust is prepared before the incident, so
during the incident the only things that touch the chain are one lock
transaction and one settle transaction — cents of gas, enforced by the chain,
not by our word."*

```
Person 2 Selected Offer ──► verify both ed25519 signatures ──► escrow::commit
        (off-chain, ms)              (off-chain AND on-chain)      │ locks plan+fee
                                                                   ▼
        activation AVAILABLE ──► escrow::verify (connection-log hash + penalty)
        (did delivery meet the promise? pure algorithm)           │ verdict on-chain
                                                                  ▼
                                    escrow::settle ──► provider 90 · buyer +10 · platform 5
```

**Run everything:**

```bash
npm test                    # 56 offline JS tests (no chain needed)
sui move test --path move   # 19 Move tests
npm run demo:sui            # full demo story on localnet (start localnet first)
npm run harness:sui         # 14-check reliability battery → reliability-report
SUI_NETWORK=testnet npm run demo:sui   # same story, real testnet
```

**The numbers that matter (all on testnet, see README proof table):**
commit `3ssNTUBU…` locks 63 = 60 plan + 3 fee → verification `4ddZaC8v…`
writes the connection log on-chain → settlement `8QeWcPfJ…` pays 60 to the
provider and 3 to the platform wallet → degraded fallback: verdict
`4cm6tMe3…` penalizes 10 MYRC to the buyer → settlement `ELFMiSp2…` pays
90/10/5. **Whole proof cost 0.218 SUI of gas.**

---

## 2. Mental model — three rules the implementation follows

1. **Off-chain is for decisions, on-chain is for money and proof** (§3.3).
   Signing, verification, selection, tolerance math: milliseconds, off-chain.
   Locking funds, recording verdicts, paying out: transactions, on-chain.
   Nothing on-chain ever parses JSON — bytes go in, signatures are checked by
   the chain itself.

2. **Prepare trust BEFORE the incident** (§4.1). The package is published,
   the escrow pre-funded, the scoped spending authority (`AuthorityCap`)
   minted, provider payout addresses registered — all in one readiness
   transaction. During the incident there is no "set up payment" step.

3. **The voucher is a document, not an object.** The deal is an off-chain,
   dual-signed JSON file. The chain stores only its **blake2b256 fingerprint**
   (32 bytes) plus term fields in the escrow's nonce-keyed Tables. One
   shared `Escrow` object serves every deal — no per-deal object churn, no
   wasted gas, nothing to clean up. (Evaluated and rejected: Walrus blob
   archival — adds a storage step, zero speed; documented as future work in
   the contract doc §3a.)

---

## 3. Repository map (what lives where)

| Path | What it is |
| --- | --- |
| `move/sources/myrc.move` | Demo stablecoin MYRC (1 unit = 1 MYR). Escrow is generic `Coin<T>` — swapping in a real MYR stablecoin or USDC is a type-argument change. |
| `move/sources/authority.move` | `AuthorityCap` — buyer's scoped spending authority (`max_per_voucher`, `enabled`, audit counters). |
| `move/sources/escrow.move` | The trust machine: `new / deposit / commit / verify / settle / refund / reclaim`. |
| `move/tests/escrow_tests.move` | 19 unit tests with fixed signature test vectors. |
| `src/sui/voucher.js` | Selected Offer → Move arguments. Fast-fail front door: schema + both signatures + expiry + fee enrichment. Exports `voucherDigest` (blake2b256). |
| `src/sui/verify.js` | The Verification Agent's brain: deterministic tolerance check (NO LLM) + §9 Verification Record + its hash. |
| `src/sui/service.js` | `TrustService` — orchestration: commit / verifyDelivery / activation (settle-refund) / reclaim, with ledger + P2 hooks. |
| `src/sui/client.js` | SDK v2 gRPC client: publish, PTB builders (commit/verify/settle/refund/reclaim), gas, event queries, lag handling. |
| `src/sui/events.js` | Append-only JSONL ledger + in-memory nonce registry (rebuilds on restart). |
| `src/sui/ttr.js` | KPI aggregation → `reliability-report.{json,md}` (§6.1). |
| `src/sui/server.js` | Optional HTTP+SSE face on :8200 (`POST /v1/commit`, `/v1/activation`, `GET /v1/status/:id`, `GET /v1/events`). |
| `scripts/sui-setup.mjs` | Readiness: publish + mint + fund + authority (idempotent per network). |
| `scripts/sui-fixtures.mjs` | Regenerates Person 2's pipeline with a LIVE clock (fixtures expire on-chain — see traps). |
| `scripts/sui-demo.mjs` | One-command demo — every blueprint §10 beat, in order. |
| `scripts/sui-harness.mjs` | 14-check battery incl. on-chain event read-back → reliability report. |
| `scripts/trust.mjs` | CLI: `commit / activation / verify / settle / refund / reclaim / status / events`. |
| `.env.example` | Every environment variable, documented. `cp .env.example .env`. |
| `fixtures/sui/` | Committed vouchers (regenerated per run — they expire by design). |
| `events/*.jsonl` | Runtime ledgers (gitignored) — dashboard-tailable. |

---

## 4. The Move contract — the trust machine

**Objects.** One shared `Escrow<T>` (buyer-owned): `available` balance pool +
`locked` Table (nonce → locked balance) + `commitments` Table (nonce →
record). Plus the buyer's `AuthorityCap`. That's the whole object graph —
everything else is off-chain bytes and events.

**Lifecycle (each is one transaction):**

| Function | Who can call | What it does |
| --- | --- | --- |
| `deposit` | escrow owner | Pre-fund the pool (readiness). |
| `commit` | buyer (AuthorityCap) | Verifies BOTH ed25519 signatures ON-CHAIN over Person 2's canonical bytes, checks nonce/authority/expiry/fee/balance, locks `amount` = plan + fee, stores the commitment with the voucher digest, emits `Committed`. **Idempotent:** same nonce + same bytes → no-op success; same nonce + different bytes → abort `NONCE_REPLAY`. |
| `verify` | buyer (AuthorityCap) | Records the deterministic delivery verdict: connection-log hash + penalty, once per nonce. Guard `penalty < amount − fee` → the provider payout can never be zeroed ("never a full refund", §4.3). Emits `Verified`. |
| `settle` | buyer (AuthorityCap) | Three-way split in ONE tx: **penalty → buyer** (compensation), **fee → platform wallet**, **remainder → provider** (its full quoted price, minus verified penalty). Emits `Settled` with the full split as evidence. |
| `refund` | buyer (AuthorityCap) | Activation FAILED → full locked total back to the buyer. The fee never leaves escrow on failure. |
| `reclaim` | **anyone** | Permissionless after expiry — liveness guarantee: no funds can be stuck if the buyer key is offline. |

**Money example (the demo's real numbers, §1.3/§3.3/§4.3):**
fallback plan 105 MYR + 5% fee 5 = **105 locked** → delivered 240 of promised
300 Mbps → shortfall 20% > 10% tolerance → penalty 10% of provider share =
10 → settle pays **provider 90, buyer +10, platform 5**. The buyer sees the
fee openly; the provider is never skimmed; the penalty is enforced by the
chain with the connection log as evidence.

**Error codes** (mirrored in `VoucherError` JS-side): 1 `SIGNATURE_INVALID`,
2 `VOUCHER_EXPIRED`, 3 `NONCE_REPLAY`, 4/5 authority, 6 `INSUFFICIENT_ESCROW`,
7 `UNKNOWN_COMMITMENT`, 8 `ALREADY_FINALIZED`, 9 `NOT_EXPIRED`,
10 `INVALID_FEE`, 11 `INVALID_PENALTY`.

---

## 5. The voucher pipeline (Person 2's output → on-chain commitment)

Person 2's Selected Offer (`fixtures/sui/s2-selected-offer.json`) carries:
winning provider projection, `agreement {amount, currency, durationMinutes,
nonce, expiry}`, and **two ed25519 signatures** — the provider signed the
original offer, the buyer (Rescue Agent) signed
`{incidentId, selectedProvider, agreement}`. Canonicalization = recursive
key-sort JSON (`src/a2a/signing.js` — reused verbatim).

`buildVoucher()` (voucher.js) then, in order:
1. zod schema + cross-checks (amount == price, nonce prefix),
2. MYRC rules (integer MYR only),
3. provider signature vs the profile's embedded PEM,
4. buyer signature vs `fixtures/keys/buyer.public.pem`,
5. expiry vs the service clock (the on-chain Clock re-checks),
6. fee enrichment from env + assembly of the exact Move arguments, including
   `voucherDigest = blake2b256(canonical buyer bytes)`.

The chain re-verifies both signatures — **off-chain verification is only a
fast-fail optimization so bad vouchers never pay the tx round trip**
(trust-contract §0). The nonce (`INC-S2:PROVIDER-B:001`) is THE idempotency
key end to end.

---

## 6. Fee split & verification — the money rules

- **Fee base = plan price, never the wallet balance** (§1.3). 5% of 60 = 3,
  charged ON TOP: escrow locks 63. Env: `PLATFORM_FEE_PERCENT`.
- **Providers keep their full quote** (§1.2) — the fee comes from the
  customer, on top. Env: `PLATFORM_ADDRESS` (the team's fee wallet,
  `0xabc67fa…`). Unset → fee 0 → settle pays the provider everything.
- **Verification is deterministic** (§4.3): `shortfall% = (promised − avg
  delivered)/promised`; `penalty% = max(0, shortfall% − tolerance%)`
  (`DELIVERY_TOLERANCE_PERCENT`, default 10); `penalty = floor(providerShare ×
  penalty%/100)`. No LLM anywhere near the verdict — same inputs, same
  verdict, provable to judges.
- **The connection log** is the §9 Verification Record (incident, session
  start/end, promised, samples, avg, tolerance, verdict, penalty). Its
  blake2b256 hash goes ON-CHAIN in `escrow::verify`; the full record goes to
  the JSONL ledger. On-chain evidence, human-readable audit trail.
- **Honest scope:** delivered samples are provided to the service (simulated
  session monitor) — the blueprint's MVP stance (§2.1 note). Plugging a real
  bandwidth probe later changes nothing on-chain: it just fills
  `deliveredSamples`.

---

## 7. Idempotency & replay safety (§6.1) — two independent layers

1. **Service layer (zero transactions):** every nonce is indexed from the
   JSONL ledger into an in-memory registry, rebuilt on restart. A duplicate
   commit is short-circuited with `DUPLICATE_BLOCKED` — the duplicate demo
   beat literally costs 0 gas.
2. **Chain layer:** same nonce + byte-identical voucher → idempotent no-op
   (`Committed{idempotent:true}`); same nonce + different bytes → abort
   `NONCE_REPLAY`. The chain does not trust our registry.

Plus **per-run escrow pools**: demo and harness each spin a fresh funded pool
per run (one PTB), so repeated runs start from virgin replay state — the
repeatability acceptance criterion. The harness proves a full re-run creates
**zero new transactions**.

---

## 8. Events & observability

**Off-chain half:** `events/<context>-<network>.jsonl` — one JSON object per
line `{seq, ts, type, incidentId, nonce, txDigest, data}`. Types:
`ESCROW_READY, VERIFIED, VERIFICATION_FAILED, COMMITTED, DUPLICATE_BLOCKED,
DELIVERY_VERIFIED, SETTLED, REFUNDED, RECLAIMED, COMMIT_RETRY,
ACTIVATION_OBSERVED, CALLBACK_SENT/FAILED, TTR_MEASURED, HARNESS_RESULT`.
Person 1's dashboard can tail the file today; SSE mirrors at
`GET /v1/events`. COMMITTED rows carry `voucherDigest` (hex) and the full fee
split; DELIVERY_VERIFIED rows carry the §9 record + `connectionLogHash`.

**On-chain half:** `EscrowFunded, Committed, Settled, Refunded, Reclaimed,
Verified` — queryable forever. The harness READS THEM BACK via gRPC
(`listEvents({filter:{emitModule:"<pkg>::escrow"}})`) and asserts the ledger
digest matches the on-chain event byte-for-byte, and that penalized verdicts
are on-chain. Ledger ↔ chain correlation is proven, not claimed.

**KPIs** (ttr.js): time-to-decision (from Person 2's fixture timing),
time-to-activation, end-to-end TTR, recovery success rate, duplicate-safety —
aggregated into `events/reliability-report.{json,md}` per harness run (§6.1).

---

## 9. Running it

```bash
cp .env.example .env          # then set SUI_NETWORK, PLATFORM_ADDRESS, fee %
npm install                   # deps: @mysten/sui (v2 gRPC), @noble/hashes, zod

# Localnet (free, unlimited rehearsal — start the node first)
sui start --with-faucet --force-regenesis      # terminal 1 (node crashed by OOM? just restart it)
npm run sui:setup                              # publish + mint + escrow + authority
npm run demo:sui                               # the whole story
npm run harness:sui                            # 14-check battery + report

# Testnet (the evidence chain — README has the digests)
SUI_NETWORK=testnet npm run sui:setup
SUI_NETWORK=testnet npm run demo:sui
SUI_NETWORK=testnet npm run harness:sui

# CLI operations (all idempotent by nonce)
npm run trust -- commit fixtures/sui/s2-selected-offer.json
npm run trust -- verify INC-S2 300 305,298,302,300   # <id> <promised> <samples>
npm run trust -- activation INC-S2 AVAILABLE
npm run trust -- status INC-S2
```

Key `.env` variables (full list in `.env.example`): `SUI_NETWORK`,
`SUI_LOCALNET_URL`, `SUI_BIN`, `SUI_MIN_GAS_MIST` (gas-floor check — lower it
when the faucet granted exactly 1 SUI), `SUI_FIXTURE_TTL_MS`,
`TRUST_PORT` (8200, P2 reserved 8101–8103), `P2_CALLBACK_URL`,
`PLATFORM_ADDRESS`, `PLATFORM_FEE_PERCENT`, `DELIVERY_TOLERANCE_PERCENT`.

---

## 10. Verified on-chain evidence (testnet, 2026-08-30)

Package `0x0cef837f…72cd` · escrow `0xd0eea9ac…64a5` · authority
`0x1ba89515…ba3d3` · platform fee wallet `0xabc67fa…c8f4` holds 16 MYRC of
collected fees. Full digest table with per-beat proof: **README → "Proof
transactions"**. Highlights: commit `3ssNTUBU…` (63 locked),
verification `4ddZaC8vnvno…` (OK verdict on-chain), penalized verdict
`4cm6tMe3515…` (240/300 Mbps), penalized settlement `ELFMiSp2wZhd…`
(90 provider / 10 buyer / 5 platform). Harness **14/14 on testnet**.
Cumulative gas for two complete proofs: **0.218 SUI**.

---

## 11. Traps we already fell into (don't rediscover them)

- **Fixture expiry:** expiry lives INSIDE the buyer-signed payload — stale
  fixtures fail on-chain honestly. `sui:fixtures` regenerates with a live
  clock (same deterministic nonces, so idempotency tests stay valid); demo
  and harness regenerate at start. Always regenerate right before committing
  fixtures to git.
- **gRPC indexing lag:** objects/txs are queryable a moment AFTER the tx —
  `waitForObject`/`waitForTransaction` are wired in; don't remove them.
- **SDK v2 shapes:** results are tagged unions (`unpack()`); events have
  `.json` (not `.parsedJson`); `vector<u8>` event fields arrive as **base64**
  (ledger stores hex — decode with `Buffer.from(x, "base64")`); event filter
  is `{filter:{emitModule:"pkg::module"}}` — the old JSON-RPC `MoveModule`
  object is rejected; `@noble/hashes` v2 import path is
  `@noble/hashes/blake2.js` with `{dkLen: 32}`.
- **`--env-file-if-exists=.env`** (Node 22) loads config into every npm
  script; process env still wins over `.env` — `SUI_NETWORK=testnet` on the
  command line overrides the file.
- **Full-width addresses:** gRPC renders `0x000…02` full-width — normalize
  before comparing (`shortAddress` in client.js).
- **Localnet OOM:** the local validator can die after hours (`memory
  allocation … failed`) — restart it, `rm .sui/config.localnet.json`, re-run
  `sui:setup`. Never affects testnet evidence.
- **Never mainnet** — hard rule, `ensureGas` refuses (hackathon DQ risk).

---

## 12. Integration points (what P1/P2 need to know)

- **Person 2 → me:** a Selected Offer (file, HTTP `POST /v1/commit`, or pull
  via `commitFromUrl`). P2's defaults are wired: pull-mode poller hook,
  settlement callback (`P2_CALLBACK_URL` — fire-and-forget, never fails the
  settlement), ack-after-broadcast (commit returns the digest immediately).
- **Person 1 ← me:** tail `events/*.jsonl` or SSE `:8200/v1/events` for the
  live incident timeline + TTR; `reliability-report.md` for the dashboard
  summary. My beats map to blueprint §10: readiness (beat 2), voucher +
  escrow state (7), verification + settlement (10), failover + penalty (11).
- **Activation input:** `activation {incidentId, status}` —
  AVAILABLE → verify-then-settle path, FAILED → refund. The activation
  adapter (P2/P1) just reports; the money rules live here.

## 13. What is simulated vs real (honesty for the pitch)

Real: signature verification (off + on chain), escrow math, fee split,
verdict enforcement, replay protection, event durability, testnet
transactions. Simulated (by blueprint design): delivered-bandwidth samples
(session monitor), the actual packet reroute (CAMARA/SD-WAN adapter is P1/P2's
mock layer), MYRC as a stand-in for a regulated MYR stablecoin (type-argument
swap, §13).
