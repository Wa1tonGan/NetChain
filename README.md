# .NetChain

Autonomous Connectivity Resilience Exchange — hackathon MVP. See
[documents/blueprint.md](documents/blueprint.md) for the product blueprint and
[documents/person2-a2a-contract.md](documents/person2-a2a-contract.md) for the
Person 2 (agent market) integration contract.

## Quickstart (Person 2 agent market)

```bash
npm install
node scripts/start-all.mjs        # 3 provider agents (8101–8103) + rescue gateway (8082)

# trigger the S1/S2 stadium scenario through the full pipeline:
curl -s -X POST http://127.0.0.1:8082/recovery/intents \
  -H 'content-type: application/json' \
  -d @scenarios/s2-primary-down-backup-insufficient.json

# watch the provider race / decisions live (SSE):
curl -N http://127.0.0.1:8082/incidents/INC-S2/events

# pull the signed Selected Offer (Person 3's input):
curl -s http://127.0.0.1:8082/incidents/INC-S2/result

# kill a provider live and re-run — the fallback demo:
curl -X POST http://127.0.0.1:8102/admin/mode -d '{"mode":"down"}'
```

```bash
npm test                          # all 50 tests
npm run generate:fixtures         # regenerate signed fixtures for Person 3
```

Gonka ranking/pitch enrichment is read from `.env` (see `.env.example`
naming); without a key everything runs on the deterministic path.
