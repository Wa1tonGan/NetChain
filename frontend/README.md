# NetChain — Individual Frontend

The real implementation of the approved individual-user-interface design
(`prototype/individual.html`). React + TypeScript + Vite + Zustand.

## Run

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

Other commands:

```bash
npm run build      # typecheck + production build → dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

## Demo walkthrough

1. First run shows the 6-step onboarding (plan → service → preferences → balance).
2. Open **Profile → Demo simulator** (or `#/dev`) and **Run** the main story.
3. When the SMS thread appears, reply free-text (e.g. `45 min, RM 10`) or tap a
   quick-reply chip — duration and budget are priced live (RM 0.00084 per Mbps
   per minute; plans snap to 15-minute steps within your budget).
4. Watch the pipeline → purchase approval → escrow lock → verified settlement.
5. Home then shows the live recovery session (signal strength, throughput,
   latency, loss, countdown at ×60 demo speed). Wallet shows the Sui trust
   layer and payment states; Activity keeps the full receipt with the provider
   comparison.

Variants: **Auto** (NetChain sends the SMS for you), **Under-delivery**
(10% penalty refund), **Provider failed** (full reservation refund).

## Structure

```
src/
  services/   types, pricing rules, flow definitions, formatting, live adapter
  store/      zustand store + recovery state machine (module-level timers)
  components/ Shell (nav), RecoveryOverlay
  pages/      Onboarding, Home, Protection, Wallet, Activity, Receipt, Profile, Dev
  styles.css  design tokens ported 1:1 from the approved prototype
```

## Live mode (real agents + Sui escrow) — WIRED

The **Demo simulator** (`#/dev`) has a *Live backend* card that runs a real
scenario through the wired pipeline instead of the scripted simulation:

- Your SMS reply becomes the intent's `constraints.durationMinutes` +
  `maxBudget` → `POST :8082/recovery/intents`
- Gateway SSE (`/incidents/:id/events`) drives the phase machine: QUERYING →
  SELECTED → ACTIVATING → AVAILABLE, with each arrival/rejection narrated in
  the SMS thread in plain language
- On SELECTED the signed Selected Offer is pulled from
  `GET /incidents/:id/result` — the purchase card shows the REAL provider,
  plan price, platform fee and escrow total from the signed agreement
- The artifact is committed on Sui via `POST :8200/v1/commit`, `AVAILABLE`
  releases the escrow via `POST /v1/activation`, and chain SSE
  (`/v1/events`) narrates VERIFIED → COMMITTED → SETTLED / REFUNDED
- Without the trust service the recovery still completes and is honestly
  marked "chain offline"; `S0`-style scenarios (no external recovery needed)
  end in a zero-charge "All clear" sheet

To run: `node scripts/start-all.mjs` (agent market) + `npm run trust:server`
(Sui escrow — needs `sui start` / testnet + `npm run sui:setup` first), then
`npm run dev` → `#/dev` → pick a scenario → **Run live**.

Override endpoints with `VITE_GATEWAY_URL` / `VITE_TRUST_URL` if the servers
run elsewhere.

The remaining simulated pieces (per design): wallet balance/top-up
(frontend-local), the SMS channel, provider activation (CAMARA-shaped mock),
and the four scripted demo stories (auto / under-delivery / provider-failed /
main) — those keep working as hands-free fallbacks.
