
## Note to Person 2 (fixtures policy, 2026-08-30)

`fixtures/sui/` is NO LONGER committed — those files are per-run regenerated
with a 5-minute TTL (expiry is inside the buyer-signed payload), so every
merge produced conflict noise. The single source of truth is
`scripts/sui-fixtures.mjs` (re-runs your pipeline with a live clock); demo,
harness and tests regenerate automatically. Your `fixtures/selected/` and
`fixtures/providers/` remain committed as the contract inputs. Testnet
fixtures are price-scaled (`SUI_TESTNET_PRICE_SCALE`) and USD-denominated.
