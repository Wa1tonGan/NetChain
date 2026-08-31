# Sui Tracks Status — NetChain (Person 3)

**Purpose:** map what is built to the OFFICIAL MUBA 2026 Sui track text, record the
payment-gas model in one place, and pin the zkLogin boundary between Person 1 and
Person 3. Nothing in this repo was added *because a track listed it* — every feature
below exists because the blueprint's own flow needs it; the track mapping is the
consequence. This doc is judge- and team-facing.

Sources: `MUBA_Blockchain_Hackathon_Opening_Ceremony.pdf` (official track reveal),
`documents/blueprint.md` (team plan), `README.md` (proof digests).

---

## 1. Official track text → what we built

### Track 01 — Payments & Stablecoins

> "Build the future of money movement on Sui: payments, payouts, remittance, wallets,
> payroll, **escrow** and treasury tools." Ideas list includes **escrow**; helpful
> features: **sponsored transactions, zkLogin, Programmable Transaction Blocks**.

| Track asks | Our feature | Proof (README digest table) |
| --- | --- | --- |
| Escrow / money movement | Shared `Escrow<USDC>` pool: lock → verify → split settle / refund / reclaim, idempotent by nonce | 13/13 harness checks on testnet, real Circle USDC |
| Stablecoins | Real Circle USDC (6 decimals) on testnet; asset = config (localnet MYRC 2dp "sen"); integer base units are the money of record | `scripts/sui-payments.mjs` |
| Sponsored transactions | `src/sui/sponsored.js` — customer signs, platform gas wallet pays (`setGasOwner` + dual signature) | "SPONSORED" row |
| Programmable Transaction Blocks | Every lifecycle op is a PTB (setup, commit, verify, settle compose `escrow` public fns) | whole flow |
| Gasless UX | `balance::send_funds` at gas price 0 — zero-SUI sender, USDC wallet→wallet | "GASLESS 0-gas" row |
| Fee transparency (judging: real workflow) | Buyer-signed `platformFee` on top of plan price, split settlement to provider + platform addresses | `Settled` events |

**Status: COMPLETE from the on-chain side.** Remaining risk is the joint live UX
(Person 1's dashboard riding these rails), not the rails.

### Track 02 — AI × SUI

> "Build AI applications using Sui for **ownership, identity, payments or on-chain
> execution**: agents, assistants, games and automation." Ideas list includes
> **agent-to-agent commerce**. Judging: "AI solves a real problem · **Sui is
> integral, not an add-on** · thoughtful UX · working live demo."

| Track asks | Our answer |
| --- | --- |
| AI application | Rescue Agent (Gonka multi-model consensus ranking) + 3 independent provider agents (A2A market). The AI solves a real problem: choosing/acquiring backup connectivity mid-incident. |
| Payments | Escrow locks plan+fee before activation; providers act because the money cannot run away (blueprint §4.3). |
| On-chain execution | `commit` (on-chain ed25519 verification of BOTH signatures) → `verify` (connection-log hash + penalty on-chain) → `settle` (three-way split by signature). |
| Ownership | Owned `AuthorityCap` scopes the platform's per-voucher spend limit (blueprint §8 "scoped authority"). |
| Identity | zkLogin = Person 1's frontend scope (boundary in §3 below); contracts unchanged. |
| Agent-to-agent commerce | Rescue Agent ↔ provider agents trade capacity; settlement is enforced by the chain, not by trust between agents. |
| "Sui is integral" | Without the escrow commitment the market cannot function: providers only activate because payment is locked; customers only accept activation because under-delivery is penalized on-chain (§4.3). |

**Status: architecture complete; the live AI↔Sui loop (P2 runtime → trust service)
is being wired now** — `src/sui/integration.js` + `npm run integrate:sui`, with
`SUI_INTEGRATION_MODE=full\|one-loop\|standalone` as the deadline-safe fallback
switch (see `person3-implementation-guide.md` §13 once written).

---

## 2. Why every project tx shows a SUI gas fee (and one transfer shows 0)

One-time explainer (asked 2026-08-31, screenshot of Suiscan history):

- **Every** Sui transaction costs gas in SUI — paid by the signer, or by the
  separate gas owner when sponsored. Contract calls (commit ≈ 0.0066, verify ≈
  0.0013, settle ≈ 0.0015–0.0028, refund ≈ 0.0012 SUI) are the platform's cost of
  running the escrow and cannot be zero. These are fractions of a cent.
- The **0-gas USDC transfer** in the screenshot is our own **gasless rail**
  (`src/sui/gasless.js`): `balance::send_funds` at gas price 0 lets a wallet holding
  ONLY USDC move value with zero SUI. That is the customer-facing UX win.
- Sponsored deposits are the second half of the same goal: a customer with zero SUI
  can still escrow (customer signs, platform pays gas).
- Design rule that follows: **customers never need SUI**; the platform/buyer
  operator keypair self-pays gas for lifecycle calls (cents per demo round).
- Per-tx cost is also why per-voucher NFT receipts were rejected (§4): every extra
  object is real gas on every real transaction.

## 3. zkLogin boundary (P1 ↔ P3)

- **Person 1** owns zkLogin in the real UI (frontend): Google/JWT login, ephemeral
  keypair + session, ZkLogin signature on transactions. Source: handoff 2026-08-30
  ("zkLogin real-UI = Person 1's scope").
- **Person 3's contract needs NOTHING new**: a zkLogin user still has an ephemeral
  ed25519 key whose signature satisfies the voucher checks (off-chain in
  `voucher.js`, on-chain in `escrow::commit`). The ZkLogin transaction signature
  itself is verified by Sui's runtime, not by our Move code.
- **Rails already fit zkLogin wallets**: they hold no SUI, so deposits go through
  the sponsored rail (built, proven) and pure transfers through the gasless rail.
- **Stand-ready clause:** if P1 ships a client, the sponsored deposit path takes a
  zkLogin sender signature instead of an ed25519 keypair — a small extension of
  `src/sui/sponsored.js`, done only when the client exists. Until then no work is
  scheduled on the payment side.

## 4. Deliberately NOT added (nothing here is track candy)

| Considered | Decision | Reason |
| --- | --- | --- |
| Per-voucher NFT receipts | Rejected (pre-date this doc) | Extra gas on every tx; no user need — voucher digest + `Committed`/`Verified`/`Settled` events already carry the evidence model (blueprint §12) |
| Walrus archive | **DONE 2026-08-31** — `npm run walrus:proof` | Real need: the connection log (penalty evidence) lived only in the platform's JSONL ledger; chain stores only its hash. Now the voucher + full log + settlement split are independently retrievable by blob ID (`sz4tjxunYifIVN327CFRlXTIdxVHtqKO1E2-0OHLJcM` on Walrus testnet, sha256 readback == archived) — closes blueprint §4.3's "customer can see exactly what was delivered at any moment". OFF by default (`WALRUS_ARCHIVE=true`), testnet-only, never fails the settlement. Track-02 helpful-feature listing is a bonus, not the reason. |
| On-chain ZK verification | Out of scope | Blueprint §7.3 spirit; Sui runtime already verifies zkLogin sigs |
| Live CAMARA calls | Out of scope (mock) | Blueprint §7.1 "CAMARA-like path + generic mock" |
| Mainnet anything | Forbidden | Hackathon rules: automatic disqualification |

## 5. Proof index

- README "Proof transactions" table — every use case, once, with digests.
- `npm run harness:sui` — 13/13 checks (own escrow + ledger; report in
  `events/reliability-report.md`).
- `npm test` (83 offline) + `sui move test` (19) — always-green gates.
- Integrated-loop proof (Item 2): digest row appended to README when proven.
