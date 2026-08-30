# Person 3 — Sui & Reliability Execution Plan (NetChain)

**Scope:** Move contracts (scoped authority, Coin<T> escrow, on-chain voucher verification, settlement), trust service (commit/settle status), idempotency/nonce, recovery event ledger, fallback test harness, TTR instrumentation, demo integration. Input = Person 2's Selected Offer (`fixtures/selected/*.json`, verified via `src/a2a/signing.js` per `documents/person2-a2a-contract.md`). **Deadline: Devfolio 5 Sep 11:59 PM MYT; pitch 6 Sep (7 days).**

## 1. Decisions YOU confirmed (rounds 1–2)
1. **Both Sui tracks** — Track 01 (escrow/settlement payment rails, stablecoin) + Track 02 (agent-to-agent commerce, "Sui is integral").
2. **Stablecoin escrow** — generic `Coin<T>` escrow + demo MYRC coin (1:1 MYR units). Fact: no MYR stablecoin exists on Sui (BloX MYRC = EVM/Solana/Base only) → story: "asset-agnostic rails, swap in a regulated MYR stablecoin or USDC by changing a type argument."
3. **On-chain signature verification** — Move `commit()` verifies BOTH ed25519 signatures (`sui::ed25519::ed25519_verify`, native per Sui docs) over Person 2's canonical-JSON payloads before locking escrow. Node pre-verifies as fast-fail.
4. **Localnet dev → testnet deploy early → testnet demo** (acceptance: ≥1 commitment + ≥1 settlement tx on testnet).
5. **Identity:** derive Sui keypairs from the fixture PKCS#8 PEMs (extract 32-byte seed → `Ed25519Keypair.fromSecretKey`) — one identity across A2A and Sui; fallback to fresh keys if derivation spikes badly.
6. **Objects:** `AuthorityCap` (scoped spending authority) + shared `Escrow` + on-chain events. No provider registry / on-chain ledger table (Sui events suffice).
7. **Settlement:** auto-settle when activation result = AVAILABLE; CLI override for demo control.

## 2. ⚠️ Defaults I adopted (rounds 3–4 went unanswered) — VETO any
8. **Failure/liveness:** `refund(nonce)` on FAILED; **permissionless** `reclaim(nonce)` after expiry (no stuck funds).
9. **Runtime:** HTTP trust service on **port 8200** (P2 reserved 8101–8103) **plus CLI** (`npm run trust -- commit|settle|refund|reclaim|status|report`).
10. **Event channel:** append-only JSONL `events/reliability-events.jsonl` + SSE mirror `GET /v1/events` (Person 1's dashboard can tail files today, upgrade later).
11. **Fallback input:** handcraft `fixtures/selected/s2-fallback-selected-offer.json` (Provider C wins after B fails) using **P2's own schema + signing.js** — legitimate signatures, no coordination needed.
12. **Fixture expiry trap:** fixtures carry expiry 2026-08-29T12:01Z (60s TTL, already past). On-chain Clock is real → harness/demo **regenerates fixtures at run start** (`npm run generate:fixtures` is deterministic — nonces stay `INC-S2:PROVIDER-B:001`, so idempotency re-run tests remain valid).
13. **Repo:** same repo, `move/` + `src/sui/` + `test/sui-*` + `scripts/sui-*`, plain JS ESM (repo style), `@mysten/sui` the only new dep; work on **herman** branch, PR to main when stable.
14. **Deliverables:** `documents/person3-trust-contract.md` (mirror of P2's doc) + one-command demo runner + TTR KPI report (md+json) + duplicate-safety/repeated-run reliability report (blueprint M5).
15. **No extras** (zkLogin / sponsored tx / Walrus) — protect the core.

## 3. Move package (`move/`)
- `myrc.move` — one-time-issue `Coin<MYRC>` + TreasuryCap (demo treasury mints e.g. 10,000 MYRC to buyer at setup).
- `authority.move` — `AuthorityCap { max_per_voucher: u64, enabled: bool, … }`, buyer-owned.
- `escrow.move` — shared `Escrow<T> { balance: Balance<T>, commitments: Table<vector<u8>, Commitment> }`:
  - `commit(...)` — args: voucher fields, canonical offer bytes + provider sig + provider pubkey, canonical buyer-agreement bytes + buyer sig + buyer pubkey. Verifies **both signatures on-chain**, checks authority enabled/limit, nonce unused, `expiry > Clock.timestamp_ms()`; splits Balance and locks under `blake2b256(nonce)`; stores commitment with digest binding of the signed buyer message; emits `Committed`. **Idempotency:** same nonce + same digest → no-op success (returns existing commitment); same nonce + different digest → abort `NONCE_REPLAY`.
  - `settle(nonce, provider_addr)` — pays out, `SETTLED`, emits `Settled`; double-settle aborts.
  - `refund(nonce)` — activation FAILED path → funds back to buyer, `Refunded`.
  - `reclaim(nonce, clock)` — permissionless after expiry, `Reclaimed`.
  - Events carry incident_id, nonce, amount, provider.
- `sui move test` unit tests: bad-sig abort, duplicate commit, expiry, settle-twice, reclaim timing, authority limit.

## 4. Trust service (`src/sui/`, JS ESM)
`keys.js` (PEM seed→keypair, address map) · `voucher.js` (Selected Offer → voucher, canonical bytes via P2's `signing.js`, off-chain pre-verify, field/nonce/expiry validation) · `client.js` (SuiClient localnet/testnet via `SUI_NETWORK` env, package publish, PTB builders, gas) · `service.js` (no-framework `node:http` on 8200: `POST /v1/commit`, `POST /v1/activation`, `GET /v1/status/:incidentId`, `GET /v1/events` SSE) · `events.js` (JSONL + SSE, schema `{seq, ts, type, incidentId, nonce, txDigest?, data}`) · `ttr.js` (aggregates tDetect/tDecide from fixture + tActivate/tRecover from activation events → KPI report) · `cli.js` · `scripts/sui-setup.mjs` (publish, mint, fund escrow, create authority, save object IDs to `.sui/config.json`) · `scripts/sui-demo.mjs` (one command: verify→commit→activate-sim→settle + forced B-failure fallback) · `scripts/sui-harness.mjs` (battery: happy path, emergency, duplicate-commit, settle-twice, FAILED refund, expiry reclaim, full re-run no-duplicates; localnet+testnet flag; emits `reliability-report.{md,json}`).

## 5. Contract doc (`documents/person3-trust-contract.md`)
Voucher field mapping (P2 §5), Move API, HTTP endpoints + error codes (`SIGNATURE_INVALID`, `VOUCHER_EXPIRED`, `NONCE_REPLAY`, `AUTHORITY_EXCEEDED`, `INSUFFICIENT_ESCROW`), event schema + JSONL path, object-ID registry, commands, note to P2 about the handcrafted fallback fixture.

## 6. Schedule (Aug 29 → Sep 5)
- **D1 Fri 29:** contract doc draft; localnet up; **spike #1:** pin exact `sui::ed25519` API on installed toolchain; **spike #2:** PEM→Sui derivation; myrc+escrow compile; Move tests started.
- **D2 Sat 30:** escrow complete + Move tests green; publish script; Node→localnet commit PTB on S2 fixture end-to-end.
- **D3 Sun 31:** **testnet deploy + faucet funding + object IDs**; service + JSONL/SSE events; testnet settle (acceptance criterion met early).
- **D4 Mon 1:** fallback fixture; harness battery (localnet + testnet flag); TTR instrumentation + KPI report.
- **D5 Tue 2:** integration with P1/P2 runtimes if they exist (HTTP contract already stable); demo runner; buffer.
- **D6 Wed 3:** hardening: repeated-run report, README (setup/addresses/commands), PR to main.
- **D7 Thu 4:** freeze; video clips of Sui beats; rehearsal. **Fri 5:** submission buffer (hard 11:59 PM MYT).

## 7. Risks & fallbacks
- `sui::ed25519` API mismatch on toolchain → day-1 spike; fallback = off-chain verify + digest commitment (your Q3 option 2), flagged to team.
- Testnet faucet limits → fund reserve wallet D3; harness reruns on localnet; demo has localnet fallback + recorded testnet tx links.
- PEM derivation fails → fresh Sui keys (Q6 fallback); on-chain verification unaffected (pubkeys passed as args).
- P1/P2 runtimes slip → file-based contract (fixtures in, JSONL out) keeps you unblocked.
- Rule guard: testnet only, no real-fund mainnet (instant DQ); commit history within 26 Aug–5 Sep window.