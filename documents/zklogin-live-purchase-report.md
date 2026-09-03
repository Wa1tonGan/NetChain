# zkLogin Live Purchases — Issue Report

**Date:** 2026-09-03 · **Status:** NOT WORKING end-to-end · **Team decision:** ignore zkLogin for the hackathon prototype; demo via simulated scenarios instead.
**Commit verdict:** do NOT commit the working tree — every change listed in §6 is zkLogin-scoped (plus one cosmetic `Move.lock` churn). Nothing outside zkLogin is touched.

## 1. TL;DR

Clicking **Run live** on `http://localhost:5173/#/dev` can never finish an on-chain escrow commitment today, even with a successful Google sign-in. The entire client → prover → chain path was debugged link by link (§3 lists everything fixed along the way). The remaining blocker is **outside our code**: Mysten's two public testnet provers are each unusable in a different way —

| Prover | Nonce math | Circuit | On-chain result (testnet, protocol 135) |
|---|---|---|---|
| `prover-dev.mystenlabs.com/v1` | ✅ matches SDK 2.27–2.29 | v1 (stale) | ❌ `Groth16 proof verify failed` via **both** JSON-RPC and gRPC submission |
| `prover-dev-v2.mystenlabs.com/v1` | ❌ computes a nonce no SDK version reproduces | v2 (current) | ❌ `400 Nonce … does not match` — no proof issued at all |

No combination of public endpoints can produce an on-chain-accepted proof right now. The only known way forward is a **self-hosted prover** (integration guide Option B) — not attempted; steps in §5.

## 2. Intended flow (what "working" looks like)

Blueprint §3.3/§4: the buyer locks plan price + platform fee in escrow, and per the handoff plan the **live** path must be signed by the user's own wallet: browser builds intent → trust server (`:8200`) returns **unsigned** `commit_as_buyer` PTB bytes → browser zk-signs with the ephemeral key + Groth16 proof → submits to testnet → `/v1/commit/confirm` → verify → settle. The platform key must never be the on-chain buyer. `useAppStore.adoptSelectedOffer` hard-enforces this: no zk proof → no commit (the `⚠️ Not signed in with Google zkLogin…` message is by design, not a crash).

## 3. What was diagnosed and FIXED (verified)

All fixes typecheck (`tsc` clean) and the frontend builds. Ordered by discovery:

1. **Dead-on-arrival sessions — `maxEpoch = 10`.** `beginZkLogin` used `VITE_ZK_MAX_EPOCH ?? 10` as an *absolute* epoch; testnet is at **epoch 1211**. Every session was born ~1200 epochs expired (guide Step 1 requires `current epoch + offset`). Fixed: fetch epoch via `/suirpc`, mint `maxEpoch = epoch + offset`. Also found `VITE_ZK_MAX_EPOCH` could never take effect (Vite only reads `frontend/.env`, which doesn't exist).
2. **Swallowed prover errors.** The bridge forwards the prover's raw payload whose `error` is an *object* → `new Error(obj)` → `[object Object]`. Fixed to prefer the prover's `message` + JSON fallback; bridge also logs rejections server-side.
3. **Console evidence destroyed by navigation.** The `/zklogin` callback page does a full-page `location.replace` to `/#/home`, wiping DevTools console. (Workaround documented: Preserve log.) Callback now also respects the bridge's `redirect` instead of hardcoding `#/home`.
4. **Overlapping logins.** Each sign-in click mints a fresh keypair and overwrites tab storage, orphaning in-flight Google flows (proven: stored nonce changed between two reads). Fixed with a `loginInFlight` re-entrancy guard + a fail-fast key-mismatch check + a `nonce audit` self-check log (`storedVsRecomputed`, `storedVsJwt`).
5. **Missing tx sender.** Trust-server build failed with `Missing transaction sender` — the server never knew the buyer's address. Fixed: browser sends `buyerAddress`, server `tx.setSender()` before `tx.build()` (address only, no key material).
6. **v1/v2 proof-shape split.** v2 wraps components in `{proof:{…}}`, v1 returns them flat. `zkSignAndSubmit` now accepts both.
7. **Wrong submission route.** JSON-RPC (publicnode) enforces a different zkLogin verifier than gRPC on testnet (cf. `MystenLabs/sui#18026` family). Added `/suigrpc` Vite proxy + gRPC-first submission with JSON-RPC fallback. (Proved irrelevant in the end — both routes reject v1 proofs — but retained as correct behavior.)
8. **DevPage UX.** The LIVE BACKEND card showed no auth state; it now shows a `zkLogin:` status chip + inline Sign-in button. Commit-gate message unified; early warning at intent time.
9. **Missing Move entry point.** `service.js` called `refund_to_buyer` (zk FAILED-path must pay the buyer, not the shared pool) but `escrow.move` didn't define it — added. **Requires republish** (`sui` CLI, not installed here) before it exists on-chain.
10. **Error surfacing.** `postJson` now reads the trust server's `{code, message}` (was `error`-only → bare `→ 500`); trust server logs failures; commit-failure bubble widened with full `console.error`.

## 4. What is NOT fixed (the blocker)

- **No public prover yields an on-chain-accepted proof.** Empirically proven, not hypothesized: SDK Poseidon recomputed locally from exact payload bytes reproduces the JWT nonce every time (`storedVsRecomputed: true, storedVsJwt: true`), while `prover-dev-v2` deterministically computes something else; `prover-dev` proofs are rejected by both submission routes. SDK `nonce.ts`/`poseidon.ts` verified byte-identical between 2.27.1 and 2.29.0, ruling out SDK staleness.
- `refund_to_buyer` exists only in source, not on-chain (needs `npm run sui:setup` with the `sui` CLI).
- Pre-existing test failures unrelated to this work: `test/sui-trust` + `test/sui-verify` sit at 13 pass / 10 fail (voucher USDC scaling, e.g. 49 vs 495000) — confirmed identical with these changes stashed.

## 5. How to resume later (self-hosted prover)

1. Docker Desktop + WSL2 backend, ideally 16 cores / 16 GB (else `PROVER_TIMEOUT=30`).
2. Download the Testnet/Mainnet zkey (`download-main-zkey.sh`), verify `b2sum` = `060beb961802…700aa4e…` (full hash in the integration guide).
3. Run `mysten/zklogin:prover-stable` (with zkey) + `prover-fe-stable` (`PROVER_URI=http://backend:8080/input`).
4. Set `ZK_PROVER_URL=http://localhost:<port>/v1` in `.env`, restart bridge, **sign out and sign in once** (all old sessions/proofs are expired or v1-circuit), Run live on `#/dev`.
5. Also fix `.env.example` (currently points at v2 per an earlier edit in this session — revisit once a working prover is confirmed) and republish Move for `refund_to_buyer`.

## 6. Working-tree inventory (all zkLogin-scoped — do not commit)

Previous agent's handoff implementation (buyer-direct commit path): `frontend/src/services/live.ts`, `frontend/src/services/wallet.ts`, `src/sui/service.js`, `src/sui/client.js`, `src/sui/events.js` (`zkBuyer` flag), `scripts/zk-buyer-demo.mjs` (new) + `demo:zk` in `package.json`, `scripts/sui-setup.mjs` (log wording only).
This session (diagnosis, guards, error surfacing, submission route, contract addition): `frontend/src/services/zklogin.ts`, `frontend/src/pages/DevPage.tsx`, `frontend/src/pages/ZkLoginCallbackPage.tsx`, `frontend/src/store/useAppStore.ts` (message/logging edits only), `frontend/vite.config.ts` (`/suigrpc`), `src/sui/server.js` + `src/zklogin/server.js` (logging), `move/sources/escrow.move` (`refund_to_buyer`), `.env.example` (prover URL/comments).
Noise (no semantic change): `move/Move.lock` (Windows path-separator churn only).

## 7. How to demo without zkLogin

- Simulated scenarios S1–S6 on `#/dev` (scripted timers, no chain) — the primary hackathon demo path.
- `npm run demo:sui` / `npm run harness:sui` for the platform-signed trust-layer proof on testnet (cap path, tests/scripts only — never presented as user-signed).
- Live backend (gateway `:8082` + trust `:8200` + agents) works up to the commit step with any signed-in state; only the user-signed escrow commit is blocked.

## 8. References

- Docs: `https://docs.sui.io/sui-stack/zklogin-integration/zklogin` (formula), `…/integration-guide` (Step 1 epoch, Step 6 prover formats, Step 7 signing, troubleshooting table), `…/wallets/zk-login-wallets` (Enoki/`ZkLoginSigner`).
- Prior art for the verifier split: `MystenLabs/sui#18026` (open), `seal-enoki-zklogin-repro` (gRPC=Dev vs JSON-RPC=Prod verifier selection).
- Live env during diagnosis: testnet epoch 1211 / protocol 135, `@mysten/sui` 2.27.1 (frontend+root), `ZK_PROVER_URL` toggled between v1 and v2 for testing (working `.env` is gitignored).
