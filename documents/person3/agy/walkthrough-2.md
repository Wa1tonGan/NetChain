# Walkthrough: zkLogin 'proofPoints' Fix & Pure Testnet USDC Migration

We have completed the implementation step by step. No UI component files (`.tsx`) were modified, and all testnet references have been migrated exclusively to Circle USDC.

---

## Changes Implemented

### 1. zkLogin Proof Extraction Resiliency
- **File**: [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts)
- **Fix**: Replaced brittle `proof.proof.proofPoints` with resilient unpacking of `session.proof` that supports both top-level `{ proofPoints, issBase64Details, headerBase64 }` (from Mysten's prover) and nested `{ proof: { proofPoints, ... } }`. Added validation to ensure required fields are present before passing to `getZkLoginSignature`.

### 2. Frontend Wallet Stablecoin Alignment
- **File**: [`frontend/src/services/wallet.ts`](file:///c:/repository/NetChain/frontend/src/services/wallet.ts)
- **Fix**: Removed MYRC from `STABLE_COINS` discovery array. Circle USDC (`0xa1ec7fc...::usdc::USDC`, 6 decimals) is now the sole recognized stablecoin.

### 3. Backend Stablecoin Configuration
- **File**: [`src/sui/stablecoin.js`](file:///c:/repository/NetChain/src/sui/stablecoin.js)
- **Fix**: Updated `stablecoinConfig()` to default to `testnet` and return Circle USDC (`TESTNET_USDC`, 6 decimals, currency `"USD"`, name `"USDC"`) exclusively.
- **File**: [`src/sui/client.js`](file:///c:/repository/NetChain/src/sui/client.js)
- **Fix**:
  - `network()` now defaults to `process.env.SUI_NETWORK ?? "testnet"`.
  - `coinType()` now returns `TESTNET_USDC` directly.
  - Renamed internal `myrc` variables to `coinT` across `buildCommitAsBuyerTx`, `settleVoucher`, `refundVoucher`, `verifyDeliveryOnChain`, and `reclaimVoucher`.
  - Fixed `reclaimVoucher` which previously hardcoded `myrc::MYRC`.

### 4. Market Quotes in USD / USDC Only
- **File**: [`src/a2a/quoteAsset.js`](file:///c:/repository/NetChain/src/a2a/quoteAsset.js)
- **Fix**: `quoteAsset()` now always quotes in `"USD"` (USDC), eliminating localnet / MYR fallbacks.
- **File**: [`src/a2a/dynamicProviders.js`](file:///c:/repository/NetChain/src/a2a/dynamicProviders.js)
- **Fix**: Dynamic persona generator now sets `currency: "USD"` across all provider slots.
- **Files**:
  - [`fixtures/providers/provider-a.json`](file:///c:/repository/NetChain/fixtures/providers/provider-a.json)
  - [`fixtures/providers/provider-b.json`](file:///c:/repository/NetChain/fixtures/providers/provider-b.json)
  - [`fixtures/providers/provider-c.json`](file:///c:/repository/NetChain/fixtures/providers/provider-c.json)
  - [`fixtures/providers/dynamic.json`](file:///c:/repository/NetChain/fixtures/providers/dynamic.json)
- **Fix**: Updated base policy `currency` from `"MYR"` to `"USD"`.

### 5. Startup Script & Environment Loading
- **File**: [`scripts/start-all.mjs`](file:///c:/repository/NetChain/scripts/start-all.mjs)
- **Fix**: Added `try { process.loadEnvFile(path.join(projectRoot, ".env")); } catch {}` so that running `node scripts/start-all.mjs` directly in PowerShell loads `.env` before rolling dynamic provider personas.
- **File**: [`scripts/sui-setup.mjs`](file:///c:/repository/NetChain/scripts/sui-setup.mjs)
- **Fix**: Updated log output from `minting MYRC` to `funding USDC escrow + creating AuthorityCap…`.
- **File**: [`package.json`](file:///c:/repository/NetChain/package.json)
- **Fix**: Added `"market": "node --env-file-if-exists=.env scripts/start-all.mjs"`.

---

## Epoch 10 Expiration Fix (`ZKLogin expired at epoch 10`)

### Diagnosis
- **Error**: `Signature is not valid: ZKLogin expired at epoch 10, current epoch is ...`
- **Root Cause**: In [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts), `maxEpoch` was hardcoded as `VITE_ZK_MAX_EPOCH ?? 10`. On Sui testnet, the current epoch is hundreds of epochs past 10 (epochs increment daily). Sui validators check `epoch <= maxEpoch` and reject any signature where `maxEpoch` is in the past.
- **Fix**:
  1. Added `/api/zklogin/epoch` endpoint to [`src/zklogin/server.js`](file:///c:/repository/NetChain/src/zklogin/server.js) querying the live network epoch.
  2. In [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts), implemented `fetchCurrentEpoch()` to query the live epoch from the bridge and `/suirpc`, setting `maxEpoch = currentEpoch + 5` (~5 days of validity).

> [!IMPORTANT]
> **Action Required**: Because `maxEpoch` is cryptographically bound into Google's OAuth `nonce` at login, you must **log out in the UI and log in with Google again** so that your session is issued with the live testnet `maxEpoch`.

---

## Instructions for Testing (Your Terminals)

As requested, no backend bash tests were run by the assistant. You can restart your terminals and test the live end-to-end flow:

### 1. Terminal 1: Agent Market & Providers
```powershell
node scripts/start-all.mjs
# or: npm run market
```
*Verify*: The startup log should display all three providers quoting in `USD` (e.g. `base 0.56 USD`), with Gonka pitch enrichment and ranking enabled.

### 2. Terminal 2: Trust Server
```powershell
npm run trust:server
```

### 3. Terminal 3: zkLogin Server
```powershell
npm run zklogin:server
```

### 4. Terminal 4: Frontend
```powershell
cd frontend
npm run dev
```

### 5. In Browser
1. Go to `http://localhost:5173/#/dev`.
2. Select **S2 - Primary down - backup insufficient**.
3. Click **Run Live** and enter your duration (e.g. `60 min, USDC 5`).
4. **Expected**:
   - Provider Agents quote in USD/USDC.
   - Gonka Router consensus selects the optimal provider.
   - The browser signs the `commit_as_buyer` transaction using your Google zkLogin ephemeral key + proof (no `proofPoints` crash).
   - Your testnet USDC is locked into the shared Sui Escrow.
   - Provider activates (`AVAILABLE`).
   - Split settlement completes on Sui Testnet.
   - Success checkmarks appear with on-chain transaction digests.
