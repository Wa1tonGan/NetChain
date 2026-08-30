# Message to Person 2 — P3 trust layer reply (your 4 defaults answered, decision upgraded)

> Copy-paste everything below the line. Full technical detail lives in
> `person3-trust-contract.md` — this is the reply to `msg-to-person3.md`.

---

**Subject: Re: P4 integration contract — trust layer is live, your Option A is now the fast-fail step, all 4 defaults adopted (2 with upgrades)**

Hey — my Sui trust layer is done and green (13/13 Move tests, 8/8 harness
checks, one-command demo). Read the decision point first; it changes your
pitch line, not your code.

**Decision: signatures verify ON-CHAIN, and I didn't touch your M1 work.**

Your premise — *"re-implementing recursively-sort-JSON-keys+hash inside Move
is not realistic"* — is right but moot: Sui Move ships a native
`ed25519_verify`. I pass your **canonical JSON bytes unchanged** as
`vector<u8>` args and the Move `commit` verifies BOTH signatures before
locking funds, storing `blake2b256(buyer canonical bytes)` as the digest.
No JSON parsing in Move, no change to your signing format, fixtures, or
`src/a2a/signing.js`. Your step 1 (off-chain verify via `signing.js`) is
implemented verbatim as the fast-fail front door. Pitch line upgrade:
**"the chain checks both signatures before any fund moves."**

**Your 4 defaults — all answered:**

1. **Nonce de-dup** — adopted, hardened. Service registry blocks duplicates
   pre-chain (zero tx); the chain no-ops byte-identical replays
   (`Committed{idempotent:true}`) and **aborts `NONCE_REPLAY` on
   same-nonce/different-bytes** — a forged replay can't slip through a
   service restart. Your `:001`/`:002` sequencing works as-is.
2. **Commitment payload** — adopted with one swap: the digest is
   `blake2b256` (Sui-native) instead of sha256. Everything else is your
   shape: voucher fields + both signatures + digest, and the full
   msg/sig/pubkey triples so the chain re-verifies rather than trusting the
   service.
3. **Pull delivery** — implemented. `commitFromUrl(url)` fetches your
   `GET /incidents/:id/result` and accepts the body as `selectedOffer`, or
   `{result: {selectedOffer}}`, or the Selected Offer itself. Until your
   runtime is up, file/fixtures delivery is primary — same code path after
   `buildVoucher`.
4. **1.5 s ack + `ESCROW_PENDING` + settlement callback** — adopted
   exactly. Commit returns the tx digest right after broadcast; activation
   proceeds in parallel. Every `SETTLED`/`REFUNDED`/`RECLAIMED` is POSTed
   to your callback as:
   `{"incidentId", "status", "nonce", "txDigest", "ts"}`.
   Set the URL as `p2CallbackUrl` in `.sui/config.<network>.json` (one
   field; absent = callback disabled). Fire-and-forget: a callback failure
   never fails a settlement.

**What I hand you** (details in `person3-trust-contract.md` — don't
duplicate, read it): voucher construction table from your Selected Offer
schema, Move error codes 1–9, event ledger JSONL schema your dashboard can
tail today (`events/reliability-events.jsonl`), and my HTTP service on
port 8200 (`POST /v1/commit`, `POST /v1/activation`,
`GET /v1/status/:incidentId`, `GET /v1/events` SSE) when you want push
instead of files.

**Two things I need from you:**

1. **Demo script step 11 — "B down → C" is impossible with honest numbers.**
   Provider C is 150 Mbps; S2 needs 200 and S7 needs 300, so C is never
   viable there — and when C *is* viable it outranks B on price. What's
   proven instead: **S7: A commits → A fails → B takes over** (B was
   `SUPERSEDED_BY_FIRST_VIABLE`, still viable) plus **S2: FAILED →
   automatic on-chain refund**. Adopt the A→B wording; it also matches the
   §6.1 KPI table.
2. **Fixture freshness:** your generator bakes
   `DEMO_EPOCH_MS = 2026-08-29T12:00Z`, so your committed fixtures are
   expired on-chain by demo time (expiry sits inside the buyer-signed
   payload — can't patch). `scripts/sui-fixtures.mjs` re-runs YOUR pipeline
   with a live clock — same deterministic nonces, fresh signatures — and
   writes to `fixtures/sui/`. Use that for anything touching chain; your
   committed fixtures stay untouched.

**Verify me in two commands** (localnet):
`npm run demo:sui` — every beat on-chain: dual-sig commit, duplicate
blocked, settle, FAILED→refund, fallback→settle, TTR printout.
`npm run harness:sui` — 8-check reliability battery →
`reliability-report.md`.

Status: localnet proven end-to-end; testnet pending faucet funding, then
the same two commands run with `SUI_NETWORK=testnet`. Mid-week
integration test stands — your `GET /incidents/:id/result` + my callback
URL are the only two wires.
