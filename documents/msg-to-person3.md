# Message to Person 3 — P4 integration contract (Option A decided)

> Copy-paste everything below the line.

---

**Subject: P4 integration contract — signature verification is off-chain (decided), 4 defaults to confirm**

Hey — my M1 contracts are done (`documents/person2-a2a-contract.md`, fixtures in `fixtures/selected/`). I'm starting Phase 4 now, so here is the integration contract for the Sui side. **Decision is made: we verify signatures off-chain.** Read the 4 defaults at the bottom and flag anything before Friday; silence = confirmed.

**What I hand you:**

- A `Selected Offer` per incident with **two ed25519 signatures**:
  1. `providerSignature` — the winning provider signs the offer payload (everything except the `signature` field itself)
  2. `buyerSignature` — my Rescue Agent signs `{ incidentId, selectedProvider, agreement }` (the deal terms you turn into the Sui commitment)
- Both signatures are over **canonical JSON** (recursively key-sorted, no whitespace), values are base64.
- Public keys are already distributed: embedded in `fixtures/providers/provider-*.json` (providers) and `fixtures/keys/buyer.public.pem` (buyer).

**The contract (Option A — off-chain verify, on-chain digest):**

1. **Your service verifies both signatures before touching Sui.** Use `src/a2a/signing.js` → `verifyOfferSignature(offer, providerPublicKeyPem)` and `verifyBuyerSignature(selectedOffer, buyerPublicKeyPem)`. ~10 lines of code, keys are already in the repo.
2. **You submit to Sui:** the voucher fields — `amount, currency, durationMinutes, nonce, expiry, buyer, provider` — **plus the sha256 hash of the canonical voucher** as the stored commitment.
3. **Settlement checks the hash** against the settled voucher, and the nonce guards against duplicates.
4. **The chain does NOT verify signatures.** Off-chain verification is an explicit, documented MVP design decision (stating it in the demo/pitch: "trust anchored off-chain, commitment and audit on-chain").

Why not on-chain in Move: our signatures cover canonical JSON, and re-implementing "recursively sort JSON keys + hash" inside Move is not realistic. Changing the signing payload to a Move-friendly format would break the finished M1 contract and fixtures — not worth it for an MVP.

**4 defaults (flag now if any is wrong; silence = confirmed):**

1. **Nonce de-dup:** same incident reuses the same nonce (`INC-S2:PROVIDER-B:001`); a fallback attempt increments the sequence (`...:002`). You de-dup commitments on nonce.
2. **Commitment payload:** voucher fields + both signatures + sha256 hash of the canonical voucher. If you need anything else, tell me before Friday.
3. **Delivery:** you pull the Selected Offer from `GET /incidents/:id/result` (I expose it; no push needed).
4. **Commitment-ack:** I wait max **1.5s** for your ack, then activate in parallel and mark the result `ESCROW_PENDING` (blueprint §6-E — activation must never block on chain). Settlement status updates come back via `POST /callbacks/settlement`.

Timeline: I start P4 today; integration test with your escrow lands mid-week.
