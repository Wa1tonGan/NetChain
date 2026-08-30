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
  services/   types, pricing rules, flow definitions, formatting
  store/      zustand store + recovery state machine (module-level timers)
  components/ Shell (nav), RecoveryOverlay
  pages/      Onboarding, Home, Protection, Wallet, Activity, Receipt, Profile, Dev
  styles.css  design tokens ported 1:1 from the approved prototype
```

The mock data layer is isolated in `services/` + `store/` so it can later be
replaced with the real adapters (Person 2's gateway SSE + Person 3's trust
server at `:8200 /v1/events`) without touching the UI.
