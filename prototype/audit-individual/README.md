# NetChain Individual Prototype Audit

Date: 2026-08-30

Scope: onboarding, protected home, wallet, live recovery, recovery result,
activity history, and incident receipt in `prototype/individual.html`.

## Overall verdict

The prototype has a strong consumer-facing foundation. It is calm, visually
consistent, and explains autonomous recovery without overwhelming users with
blockchain terminology. The live recovery overlay and completed-recovery
summary are the strongest parts.

The largest product gap is evidence timing. Provider choice, wallet/escrow
state, and network delivery evidence become visible only after recovery, while
users need reassurance during the purchase and throughout the temporary plan.

## Captured flow

1. `01-welcome.png` — welcome and product promise — healthy.
2. `02-plan.png` — plan selection — needs clearer differences and pricing.
3. Service selection — interaction works visually, but rows are not semantic controls.
4. `03-preferences.png` — automatic spending and speed preferences — healthy,
   with an accessibility issue in the custom switch.
5. `04-balance.png` — recovery balance setup — healthy, but wallet identity is absent.
6. Onboarding completion — clear and reassuring.
7. `05-home.png` — protected home state — healthy and easy to scan.
8. `06-wallet.png` — wallet and budget — incomplete for the Sui trust story.
9. `07-recovery-live.png` — live recovery overlay — strong, but lacks live money,
   provider, and network-strength evidence.
10. `08-recovered.png` and `09-recovery-details.png` — recovery outcome — clear,
    but technical evidence is shallow.
11. `10-activity.png` and `11-incident-receipt.png` — history and receipt — strong
    cost split and timeline, but missing provider decision evidence and delivery chart.

## Highest-impact recommendations

1. Add a live session view during recovery: throughput, latency, packet loss,
   required capacity, purchased capacity, and remaining plan duration.
2. Show an agent purchase block during the transaction: provider, capacity,
   duration, provider price, platform fee, total, and a concise “why selected” list.
3. Upgrade Wallet to show connected Sui address, MYRC balance, available,
   locked, spent, authority limit, escrow readiness, and transaction links.
4. Label money states precisely: reserved/locked before activation, settled
   after verification, and refunded when activation fails.
5. Add provider comparison and selection evidence to the incident receipt.
6. Replace clickable `div` rows with buttons or links; keep checkboxes in the
   accessibility tree; make the recovery overlay a real modal with focus
   management and live status announcements.
7. Add enough bottom padding so fixed navigation never covers wallet or
   activity explanatory copy.

## Evidence limits

The audit used the 430px phone-first app surface in the in-app browser. It did
not verify screen-reader output, physical touch targets, reduced-motion
behavior, 320px reflow, browser zoom, or production backend latency.
