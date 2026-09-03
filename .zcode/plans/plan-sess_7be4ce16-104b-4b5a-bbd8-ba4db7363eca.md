## Goal

Make provider quotes reflect a **live market** (capacity/price drift in real time) instead of today's always-max-capacity fixed formula. No LLM — a deterministic time-based simulation (smooth waves per provider), because offers are signed contracts on the escrow path and must stay instant + reproducible. Gonka stays where it is (ranking + pitch only).

## What changes

1. **New `src/a2a/marketState.js`** — pure function `marketStateAt(providerId, nowMs)`:
   - `availabilityFactor` (sine wave, per-provider phase/period ~7–13 min) → available capacity = 75–100% of `maxCapacityMbps`
   - `rateFactor` (~85–115% of `pricePer100MbpsPerHour`) → surge pricing
   - State is quantized to ~5-second buckets: same bucket = same state (A2A retry-safe), time moves → market moves.

2. **`src/agents/providerAgent.js`** — `buildOfferDraft` uses the market state:
   - `capacityMbps = floor(max × availabilityFactor)`
   - `available: false` when capacity < requested (refuses like a real congested operator, instead of quoting short)
   - price = `baseFee + marketRate × (capacity/100) × hours`

3. **Fixture scripts stay deterministic** — `generate-fixtures.mjs` / `sui-fixtures.mjs` pass their pinned clock (`DEMO_EPOCH_MS` / `SUI_FIXTURE_EPOCH_MS`) into `marketStateAt`, and I tune the wave phases so the pinned epoch lands at factor 1.0 for all three providers → regenerated fixtures are **byte-identical** to today's (Person 3's S2 = KilatLink 300 Mbps / 60 MYR acceptance numbers unchanged). Verified by `git diff` after regen.

4. **Docs + tests** — `person2-a2a-contract.md` §2 note (quotes are time-sensitive; providers may refuse when congested; retry-safety unchanged). New runtime tests: same requestId → identical signed offer; state differs across time buckets; congested agent refuses.

## What you'll see

Same scenario run a few minutes apart → different capacity/price quotes in the UI thread; budgets in the mid-range now genuinely bite (winner may be rejected as over budget or congested). Selection policy and failover logic unchanged.

## Verification

`npm test` all green + `git diff` clean after fixture regen + live browser check (two runs, different quotes). Commit on the current branch.