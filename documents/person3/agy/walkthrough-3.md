# Diagnosis & Resolution: zkLogin Signature Rejection (`Signature is not valid: General .`)

## Root Cause Identified

When you clicked **Run Live**, the transaction build succeeded on the trust server (`POST /v1/commit` returned `200 OK` with `BUILD_OK`), but submission to Sui testnet rejected the signature with:
```
Reason: Escrow commit failed: Invalid user signature: Signature is not valid: Signature is not valid: General .
```

### Why Did This Happen?
1. **Official Mysten RPC Deprecated JSON-RPC:**
   `https://fullnode.testnet.sui.io:443` dropped JSON-RPC support, returning:
   ```json
   { "error": { "message": "Method not found. JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL endpoints." } }
   ```
2. **Epoch Dropped to 0 → Fallback to 1000:**
   Because the official fullnode rejected the `suix_getLatestSuiSystemState` JSON-RPC call, `/api/zklogin/epoch` returned `{ epoch: 0 }`. The frontend then fell back to `1000`.
3. **zk Proof Generated for Expired Epoch (1005 < 1211):**
   The ephemeral key and Google OAuth nonce were generated with `maxEpoch = 1000 + 5 = 1005`. However, **the live Sui testnet is currently at epoch 1211**!
4. **On-Chain Groth16 Rejection:**
   When Sui testnet validators received the transaction, `max_epoch (1005) < current_epoch (1211)`. The Groth16 proof verification circuit on Sui rejected the signature with `General cryptographic error: Groth16 proof verify failed` (truncated in the UI as `Signature is not valid: General .`).

---

## Fixes Implemented

1. **Fixed Bridge Epoch Query to Working RPC:**
   - In [`src/zklogin/server.js`](file:///c:/repository/NetChain/src/zklogin/server.js), updated `/api/zklogin/epoch` to query `https://sui-testnet-rpc.publicnode.com` (which reliably responds with live testnet state) and default to `1211` on network hiccups.
2. **Dynamic Epoch & Safe Buffer in Frontend:**
   - In [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts), updated `fetchCurrentEpoch()` to query `/api/zklogin/epoch` and `/suirpc`, with a fallback to `1211`.
   - Increased epoch delta to `10` so `maxEpoch` will be `1211 + 10 = 1221`, giving ample validity buffer.
3. **Official `ZkLoginSigner` Integration:**
   - In [`frontend/src/services/zklogin.ts`](file:///c:/repository/NetChain/frontend/src/services/zklogin.ts), integrated Mysten's official `ZkLoginSigner`.
   - `ZkLoginSigner` verifies in its constructor that `derivedAddress === session.address` and produces a compliant signed transaction bundle.
4. **Zero UI Touch:**
   - As requested, no `.tsx` components or pages were touched (Person 1's UI work is intact).

---

## Instructions for You to Test

1. **Restart your zkLogin server in PowerShell (Pwsh 3):**
   In the PowerShell window running `npm run zklogin:server`:
   - Press `Ctrl + C`
   - Run:
     ```powershell
     npm run zklogin:server
     ```
2. **Get a Fresh zkLogin Session:**
   - In your browser, go to your Account / Profile and click **Log Out** (or clear site storage).
   - Click **Continue with Google** and sign in.
   - *This will generate an ephemeral key and ZK proof with `maxEpoch = 1221` (valid for the current testnet epoch 1211).*
3. **Run Live on Dev Page:**
   - Go to `http://localhost:5173/#/dev`.
   - Select Scenario 2 (or your preferred scenario).
   - Click **Run Live**.
