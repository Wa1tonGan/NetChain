# Demo Video, PR & Rehearsal — Person 3 checklist (updated 2026-08-31)

Rule from the rules deck: **3–5 min demo video on YouTube/Loom, unlisted OK,
due with Devfolio by Sep 5, 23:59 MYT.** The live pitch (Sep 6, APU) is
5 min + 5 min Q&A, live demo required.

## 1. Shot list (README "Proof transactions" table is the source of truth)

Order tells the story: trust prepared → incident → AI chooses → chain proves →
evidence is public. Localnet for unlimited retakes; testnet digests as the
"this really happened" closer.

| # | Beat | How | What to show |
| --- | --- | --- | --- |
| 1 | Readiness (§4.1) | `SUI_NETWORK=testnet npm run sui:setup` (already green) | setup digest row: pool + authority in ONE PTB |
| 2 | Live AI↔Sui loop ⭐ NEW | terminal 1: `node scripts/start-provider-agents.mjs`; terminal 2: `node scripts/start-rescue-agent.mjs`; terminal 3: `npm run integrate:sui` | A2A provider race → SELECTED → COMMIT tx → VERIFY → SETTLED → P2 callback `SETTLED` |
| 3 | Duplicate safety | re-run `integrate:sui` with `SUI_P2_INCIDENT_ID=<same id>` | `nonce already SETTLED — no new transactions` |
| 4 | Full-battery reliability | `SUI_NETWORK=testnet npm run harness:sui` | 13/13 PASS scroll incl. penalty case |
| 5 | Gasless + sponsored | `npm run payments:sui` (testnet) | 0-gas sender row + sponsored deposit row |
| 6 | Public evidence ⭐ NEW | `WALRUS_ARCHIVE=true SUI_NETWORK=testnet npm run walrus:proof` | blob ID + sha256 match + walruscan.com link in browser |
| 7 | Closer | Suiscan on the README digests | real Circle USDC, real signatures, judge-verifiable |

Beat 2 is the headline (Track 02: AI × SUI live). Keep each clip ≤ 30 s;
assemble to 3–4 min with the narration script below.

## 2. 60-second narration skeleton (repeat/expand per beat)

1. "When the primary link fails, our exchange buys backup capacity from independent AI provider agents."
2. "The Rescue Agent races three providers in parallel — offers arrive signed."
3. "Watch the money: the buyer-signed voucher locks USDC in escrow ON Sui — providers act because the payment can't run away."
4. "Delivery is measured, hashed on-chain, and settled as a split: provider, platform fee — penalties enforced by the contract, not by trust."
5. "Every artifact is public: transaction digests on Suiscan, the full connection log on Walrus. Don't trust us — verify."
6. "It's real Circle USDC on Sui testnet. Re-running can't double-pay — the nonce blocks it."

## 3. PR herman→main (browser; no `gh` CLI)

URL: https://github.com/Wa1tonGan/NetChain/compare/main...herman

Title: `NetChain: Sui trust layer — escrow rails (Track 01) + live AI×SUI settlement (Track 02)`

Body checklist:
- BOTH tracks, one paragraph each (lift from `documents/person3/sui-tracks-status.md` §1).
- Proof: paste the README digest table (judges shouldn't have to run anything).
- "How to run": `npm install && npm test`, `npm run harness:sui`, `npm run integrate:sui`, `npm run walrus:proof`.
- Commit history tells the story (milestone commits, descriptive messages).
- Rules compliance line: testnet only, no mainnet (DQ rule), built during the hacking window.

## 4. Rehearsal (pitch day, Sep 6)

- [ ] Fresh machine run-through: `npm install && npm test` → all green.
- [ ] Localnet reset drill: `sui start --with-faucet --force-regenesis`, `rm .sui/config.localnet.json`, `npm run sui:setup` (validator OOM trap: restart + regenesis).
- [ ] Testnet rehearsal: fresh pool (`node -e` delete `escrowId/authorityId` from `.sui/config.testnet.json`, then `SUI_NETWORK=testnet npm run sui:setup`), then beats 2+4+6.
- [ ] `SUI_REUSE_POOL=1 npm run demo:sui` variant after a fresh setup (nonces are per-pool; never reuse a spent pool).
- [ ] Offline fallback if venue Wi-Fi dies: localnet demo + README digest table on screen.
- [ ] Q&A prep: gas model (see `sui-tracks-status.md` §2), zkLogin boundary (§3), why no NFT receipts (§4).

## 5. Devfolio submission package (due Sep 5, 23:59 MYT)

- [ ] Public repo + README (description, problem, blockchain, testnet addresses, setup, team) — README already has all sections.
- [ ] 3–5 min video (YouTube/Loom, unlisted fine).
- [ ] Declaration of every AI tool used.
- [ ] Track-specific answers for Sui Track 01 + Track 02 (source: `sui-tracks-status.md`).
