# Diagnosis & Fix Plan: zkLogin Escrow Commit & Testnet USDC Clean-Up

## 1. Problem Diagnosis

### 1.1 The Runtime Blocker: `'proofPoints' is undefined`
- **Error in UI**: `Reason: Escrow commit failed: Cannot read properties of undefined (reading 'proofPoints')` (from `DevPage` during "Run Live").
- **Root Cause**: In [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts#L223-L243), `zkSignAndSubmit` assumes the prover response is nested:
  ```ts
  const proof = session.proof as {
    proof: {
      proofPoints: { a: string[]; b: string[][]; c: string[] };
      issBase64Details: { value: string; indexMod4: number };
      headerBase64: string;
    };
    addressSeed?: string;
  };
  // Then accesses:
  inputs: {
    proofPoints: proof.proof.proofPoints, // <-- Crashes! proof.proof is undefined!
  ```
  However, Mysten Labs' official prover endpoint (`https://prover-dev.mystenlabs.com/v1`) returns `{ proofPoints, issBase64Details, headerBase64 }` directly at the top level of the JSON response.
  Because `proof.proof` was `undefined`, accessing `proof.proof.proofPoints` immediately threw `TypeError: Cannot read properties of undefined (reading 'proofPoints')`.

### 1.2 MYRC / Testnet Currency Inconsistency
- In [`scripts/sui-setup.mjs`](file:///c:/repository/NetChain/scripts/sui-setup.mjs#L61), a hardcoded log stated `"[setup] minting MYRC + funding escrow + creating AuthorityCap…"`, which is misleading on testnet where real Circle USDC is funded into the pool.
- Provider fixtures ([`provider-a.json`](file:///c:/repository/NetChain/fixtures/providers/provider-a.json), `provider-b.json`, `provider-c.json`) and [`dynamic.json`](file:///c:/repository/NetChain/fixtures/providers/dynamic.json) still carried `"currency": "MYR"`.
- When [`scripts/start-all.mjs`](file:///c:/repository/NetChain/scripts/start-all.mjs) was invoked via raw `node scripts/start-all.mjs`, it did not call `process.loadEnvFile()`. As a result, `process.env.SUI_NETWORK` was undefined in the parent runner, causing provider generation and `quoteAsset` to default to `localnet` / `MYR`.
- [`src/sui/client.js`](file:///c:/repository/NetChain/src/sui/client.js), [`src/sui/stablecoin.js`](file:///c:/repository/NetChain/src/sui/stablecoin.js), and [`src/a2a/quoteAsset.js`](file:///c:/repository/NetChain/src/a2a/quoteAsset.js) all defaulted their fallback networks to `"localnet"` instead of `"testnet"`.
- In [`frontend/src/services/wallet.ts`](file:///c:/repository/NetChain/frontend/src/services/wallet.ts#L23-L26), `STABLE_COINS` ordered `MYRC` ahead of `USDC`.

---

## 2. User Review Required

> [!IMPORTANT]
> **No UI components (.tsx) will be touched.** As requested (Person 3 role, Person 1 owns UI), we only touch service/logic files (`frontend/src/services/zklogin.ts`, `frontend/src/services/wallet.ts`), backend runtime modules (`src/sui/*`, `src/a2a/*`), scripts, and provider fixtures.
> No backend bash tests or transaction commands will be executed by the assistant; you will perform verification after completion.

---

## 3. Proposed Changes

### Component 1: zkLogin Client Service (`frontend/src/services/zklogin.ts`)

#### [MODIFY] [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts)
- Resiliently unpack `session.proof` to support both flat (standard Mysten prover payload) and nested (`proof.proof`) formats:
  ```ts
  const raw: any = session.proof;
  const inner = raw?.proof ?? raw;
  const proofPoints = inner?.proofPoints;
  const issBase64Details = inner?.issBase64Details;
  const headerBase64 = inner?.headerBase64;
  const addressSeed = raw?.addressSeed ?? inner?.addressSeed ?? (session.salt ? String(genAddressSeed(BigInt(session.salt), "sub", session.sub, session.aud)) : undefined);
  ```
- Validate that `proofPoints`, `issBase64Details`, and `headerBase64` exist, throwing a clear, descriptive error if any are missing.
- Pass the resolved fields safely to `getZkLoginSignature`.

---

### Component 2: Frontend Wallet Discovery (`frontend/src/services/wallet.ts`)

#### [MODIFY] [`frontend/src/services/wallet.ts`](file:///c:/repository/NetChain/frontend/src/services/wallet.ts)
- Prioritize `USDC` in `STABLE_COINS`:
  ```ts
  const STABLE_COINS = [
    { match: /::usdc::USDC$/i, label: "USDC", decimals: 6 },
    { match: /::myrc::MYRC$/i, label: "MYRC", decimals: 2 },
  ];
  ```

---

### Component 3: Default Network & Currency Configuration (All Testnet-First)

#### [MODIFY] [`src/sui/client.js`](file:///c:/repository/NetChain/src/sui/client.js)
- Change default network in `network()` to `process.env.SUI_NETWORK ?? "testnet"`.
- Clean up naming around `coinType(config)` to clearly reflect the active stablecoin type (`USDC` on testnet).

#### [MODIFY] [`src/sui/stablecoin.js`](file:///c:/repository/NetChain/src/sui/stablecoin.js)
- Change default parameter in `stablecoinConfig()` to `process.env.SUI_NETWORK ?? "testnet"`.

#### [MODIFY] [`src/a2a/quoteAsset.js`](file:///c:/repository/NetChain/src/a2a/quoteAsset.js)
- Ensure fallback network defaults to `testnet` and returns `currency: "USD"`.

#### [MODIFY] [`src/a2a/dynamicProviders.js`](file:///c:/repository/NetChain/src/a2a/dynamicProviders.js)
- Ensure generated dynamic personas set `currency` to `"USD"` (or the active stablecoin currency from `quoteAsset`), eliminating `"MYR"` quotes on testnet.

#### [MODIFY] [`fixtures/providers/provider-a.json`](file:///c:/repository/NetChain/fixtures/providers/provider-a.json), [`provider-b.json`](file:///c:/repository/NetChain/fixtures/providers/provider-b.json), [`provider-c.json`](file:///c:/repository/NetChain/fixtures/providers/provider-c.json), [`dynamic.json`](file:///c:/repository/NetChain/fixtures/providers/dynamic.json)
- Update base policy currency to `"USD"` across all three providers.

---

### Component 4: Runner & Setup Scripts

#### [MODIFY] [`scripts/start-all.mjs`](file:///c:/repository/NetChain/scripts/start-all.mjs)
- Add `try { process.loadEnvFile(); } catch {}` at line 1 so that running `node scripts/start-all.mjs` directly in PowerShell automatically loads `.env` (`SUI_NETWORK=testnet`, `GONKA_API_KEY`, etc.).

#### [MODIFY] [`scripts/sui-setup.mjs`](file:///c:/repository/NetChain/scripts/sui-setup.mjs)
- Fix log message at line 61 to dynamically say `[setup] funding ${config.stablecoin?.name ?? "USDC"} escrow + creating AuthorityCap…` instead of `minting MYRC`.

#### [MODIFY] [`package.json`](file:///c:/repository/NetChain/package.json)
- Add `"market": "node --env-file-if-exists=.env scripts/start-all.mjs"` script for convenient execution.

---

## 4. Verification Plan (To Be Run By You)

After changes are applied, you will run the demo steps in your 4 PowerShell terminals:

1. **Terminal 1 (Market)**:
   ```powershell
   node scripts/start-all.mjs
   ```
   *Expected*: Logs should display quotes in `USD` (e.g. `base 0.56 USD`), with Gonka ranking enabled.
2. **Terminal 2 (Trust Server)**:
   ```powershell
   npm run trust:server
   ```
   *Expected*: Listening on `:8200` with testnet USDC active.
3. **Terminal 3 (zkLogin Server)**:
   ```powershell
   npm run zklogin:server
   ```
4. **Terminal 4 (Frontend)**:
   ```powershell
   cd frontend; npm run dev
   ```
5. **Browser Execution**:
   - Navigate to `http://localhost:5173/#/dev`.
   - Select Scenario `S2 - Primary down - backup insufficient`.
   - Click **Run Live**.
   - Reply to the SMS prompt with duration & budget.
   - **Verification**:
     - Providers quote in USD/USDC.
     - Gonka Router consensus chooses the winning provider.
     - The browser zk-signs the `commit_as_buyer` transaction block without any `'proofPoints'` error.
     - USDC is locked from your zkLogin wallet into the shared Sui Escrow.
     - Activation succeeds (`AVAILABLE`).
     - Split settlement executes on Sui Testnet (provider paid, platform fee paid).
     - Full green success with transaction digests shown!
