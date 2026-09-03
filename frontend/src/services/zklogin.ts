/* zkLogin session for the browser.
 *
 * ZK mode (non-custodial): an ephemeral Ed25519 keypair lives in
 * sessionStorage for this tab; its pubkey is bound into Google's OIDC nonce,
 * and /api/zklogin/prove turns the short-lived idToken + salt into a groth16
 * proof. Transactions are signed locally (ephemeral key) and wrapped into a
 * zkLogin signature — the server never sees the user's key material.
 *
 * Fallback mode (custodial): when the prover is unreachable or
 * ZK_SIGNING=false, the bridge derives a per-session server key (HMAC(sub))
 * and signs for the user. The UI must label this "custodial fallback".
 */

export interface ZkLoginSession {
  address: string;
  email: string | null;
  name: string | null;
  sub: string;
  iss: string;
  aud: string;
  // zk signing bundle (absent in the custodial fallback session)
  salt?: string;
  idToken?: string;
  maxEpoch?: number | null;
  ephemeralPubKey?: string | null;
  proof?: unknown;
  signingMode?: "zk" | "custodial-fallback";
  // custodial fallback wallet address (differs from the zkLogin address)
  fallbackAddress?: string;
}

const EPHEMERAL_KEY = "netchain_zk_ephemeral_v1";
// Same-lifetime mirror of the ephemeral bundle: the zkLogin SESSION survives
// tab closes via localStorage, so the signing key must too — otherwise a
// restored session (new tab) looks logged in but cannot sign ("ephemeral key
// missing from this tab"). The key is short-lived (maxEpoch) demo material.
const EPHEMERAL_PERSIST_KEY = "netchain_zk_ephemeral_persist_v1";

function writeEphemeralBundle(bundle: {
  secret: string;
  pubKey: string;
  maxEpoch: number;
  randomness: string;
  nonce: string;
}): void {
  const json = JSON.stringify(bundle);
  sessionStorage.setItem(EPHEMERAL_KEY, json);
  try {
    localStorage.setItem(EPHEMERAL_PERSIST_KEY, json);
  } catch {}
}

function readEphemeralBundle(): { secret: string; pubKey: string; maxEpoch: number; randomness: string; nonce: string } | null {
  const sameTab = sessionStorage.getItem(EPHEMERAL_KEY);
  if (sameTab) return JSON.parse(sameTab);
  try {
    const persisted = localStorage.getItem(EPHEMERAL_PERSIST_KEY);
    return persisted ? JSON.parse(persisted) : null;
  } catch {
    return null;
  }
}

export function clearEphemeralBundle(): void {
  sessionStorage.removeItem(EPHEMERAL_KEY);
  try {
    localStorage.removeItem(EPHEMERAL_PERSIST_KEY);
  } catch {}
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

import { addWorkflowLog } from "./logger";

export async function fetchCurrentEpoch(): Promise<number> {
  // 1. Try bridge endpoint /api/zklogin/epoch
  try {
    const res = await fetch("/api/zklogin/epoch", { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const epoch = Number(data?.epoch);
      if (Number.isFinite(epoch) && epoch > 0) {
        addWorkflowLog("EPOCH_RESOLVED", { source: "/api/zklogin/epoch", epoch });
        return epoch;
      }
    }
  } catch {}

  // 2. Try Vite proxy /suirpc (JSON-RPC)
  try {
    const res = await fetch("/suirpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getLatestSuiSystemState", params: [] }),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      const epoch = Number(data?.result?.epoch);
      if (Number.isFinite(epoch) && epoch > 0) {
        addWorkflowLog("EPOCH_RESOLVED", { source: "/suirpc", epoch });
        return epoch;
      }
    }
  } catch {}

  // 3. Fallback to known live testnet epoch
  addWorkflowLog("EPOCH_FALLBACK", { epoch: 1211 }, "warn");
  return 1211;
}

/**
 * Start the Google zkLogin flow. In zk mode the ephemeral keypair is created
 * FIRST and bound into the OAuth nonce, so the issued id_token can only ever
 * produce a proof for this session's key.
 */
export async function beginZkLogin(redirectPath = "/wallet"): Promise<void> {
  // Dynamic import keeps @mysten/sui out of the initial bundle.
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const { generateNonce, generateRandomness } = await import("@mysten/sui/zklogin");

  const ephemeral = new Ed25519Keypair();
  const currentEpoch = await fetchCurrentEpoch();
  const delta = Number(import.meta.env.VITE_ZK_MAX_EPOCH_DELTA ?? 10);
  const maxEpoch = currentEpoch + delta;
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);

  addWorkflowLog("ZK_LOGIN_BEGIN", {
    currentEpoch,
    maxEpoch,
    delta,
    ephemeralPubKey: ephemeral.getPublicKey().toSuiPublicKey(),
    nonce,
    redirectPath,
  });

  // Survive the Google redirect AND tab changes (localStorage mirror — the
  // session outlives this tab, so the signing key must too).
  writeEphemeralBundle({
    secret: ephemeral.getSecretKey(),
    pubKey: ephemeral.getPublicKey().toSuiPublicKey(),
    maxEpoch,
    randomness,
    nonce,
  });

  const url = new URL("/api/zklogin/authorize", window.location.origin);
  url.searchParams.set("redirect", redirectPath);
  url.searchParams.set("ephemeralPubKey", ephemeral.getPublicKey().toSuiPublicKey());
  url.searchParams.set("maxEpoch", String(maxEpoch));
  url.searchParams.set("nonce", nonce);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJson<{ url: string; zkSigning: boolean }>(response);

  // The bridge echoes the pubkey back into Google's OIDC `nonce` claim, so
  // clear the local snapshot only AFTER a successful round trip.
  window.location.assign(data.url);
}

/**
 * Finish the OAuth code exchange. Returns the identity plus the zk signing
 * bundle (salt + idToken + maxEpoch); the proof is fetched separately so a
 * prover outage can degrade gracefully to the custodial fallback.
 */
export async function completeZkLogin(code: string, state: string): Promise<ZkLoginSession> {
  const url = new URL("/api/zklogin/callback", window.location.origin);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  const session = await readJson<ZkLoginSession>(response);

  addWorkflowLog("ZK_LOGIN_COMPLETE", {
    address: session.address,
    email: session.email,
    sub: session.sub,
    iss: session.iss,
    aud: session.aud,
    maxEpoch: session.maxEpoch,
    hasIdToken: Boolean(session.idToken),
    hasSalt: Boolean(session.salt),
    ephemeralPubKey: session.ephemeralPubKey,
  }, "success");

  return session;
}

/** Ask the bridge's prover proxy for the groth16 zk proof. The Mysten prover
    validates the request against the OAuth nonce — poseidon(extended
    ephemeral pubkey, maxEpoch, jwtRandomness) — so the full ephemeral bundle
    must ride along, not just the JWT. */
export async function requestZkProof(session: ZkLoginSession): Promise<unknown> {
  const stored = readEphemeralBundle();

  const body: Record<string, unknown> = {
    jwt: session.idToken,
    salt: session.salt,
    maxEpoch: session.maxEpoch ?? stored?.maxEpoch,
    keyClaimName: "sub",
  };
  if (stored) {
    const [{ Ed25519Keypair }, { getExtendedEphemeralPublicKey }] = await Promise.all([
      import("@mysten/sui/keypairs/ed25519"),
      import("@mysten/sui/zklogin"),
    ]);
    const ephemeral = Ed25519Keypair.fromSecretKey(stored.secret);
    body.extendedEphemeralPublicKey = await getExtendedEphemeralPublicKey(ephemeral.getPublicKey());
    body.jwtRandomness = stored.randomness;
  }

  addWorkflowLog("ZK_PROOF_REQUEST", {
    maxEpoch: body.maxEpoch,
    hasExtendedEphemeralPublicKey: Boolean(body.extendedEphemeralPublicKey),
    hasJwtRandomness: Boolean(body.jwtRandomness),
    hasSalt: Boolean(body.salt),
    hasJwt: Boolean(body.jwt),
  });

  const res = await fetch("/api/zklogin/prove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // The prover puts the reason in `message` (e.g. JWTInvalid), the bridge
    // may wrap it in `error` — surface whichever carries the real reason.
    const e = err as { error?: string; message?: string };
    const message = e.error ?? e.message ?? `prover → ${res.status}`;
    addWorkflowLog("ZK_PROOF_ERROR", { status: res.status, error: message }, "error");
    throw new Error(String(message));
  }
  const proof = await res.json();
  const inner = (proof as any)?.proof ?? proof;
  addWorkflowLog("ZK_PROOF_SUCCESS", {
    proofStructure: Object.keys(proof || {}),
    hasProofPoints: Boolean(inner?.proofPoints),
    hasIssBase64Details: Boolean(inner?.issBase64Details),
    hasHeaderBase64: Boolean(inner?.headerBase64),
  }, "success");
  return proof;
}

/** Custodial fallback: server-side per-session key derived from the user id. */
export async function createFallbackSession(session: ZkLoginSession): Promise<ZkLoginSession> {
  const res = await fetch("/api/zklogin/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sub: session.sub, address: session.address }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return session;
  const body = await readJson<{ mode: string; address: string }>(res);
  return {
    ...session,
    signingMode: "custodial-fallback",
    fallbackAddress: body.address,
  };
}

/**
 * Sign the (base64) transaction bytes from the trust server's build-only
 * endpoint and submit them. ZK mode wraps the ephemeral signature in the
 * zkLogin proof; fallback mode can only read — the caller uses the server
 * custodial path instead when no proof bundle exists.
 */
export async function zkSignAndSubmit(
  session: ZkLoginSession,
  txBytesBase64: string
): Promise<{ digest: string }> {
  if (!session.proof || session.signingMode !== "zk") {
    addWorkflowLog("ZK_SIGN_ABORTED", { reason: "no zk proof bundle" }, "error");
    throw new Error("no zk proof bundle — use the custodial path or re-login in zk mode");
  }

  const stored = readEphemeralBundle();
  if (!stored?.secret) {
    addWorkflowLog("ZK_SIGN_ABORTED", { reason: "no ephemeral key in storage" }, "error");
    throw new Error(
      "no ephemeral signing key for this session — log out (Account tab) and log in with Google again to rebuild it"
    );
  }
  const { secret, maxEpoch } = stored as { secret: string; maxEpoch: number };

  const [
    { Ed25519Keypair },
    { ZkLoginSigner, getZkLoginSignature, genAddressSeed },
    { SuiJsonRpcClient },
    { fromBase64 },
  ] = await Promise.all([
    import("@mysten/sui/keypairs/ed25519"),
    import("@mysten/sui/zklogin"),
    import("@mysten/sui/jsonRpc"),
    import("@mysten/bcs"),
  ]);

  const ephemeral = Ed25519Keypair.fromSecretKey(secret);
  const txBytes = fromBase64(txBytesBase64);

  // The prover returns the groth16 inputs either nested under `proof` (dev
  // prover) or flattened at the top level (production prover). Unpack both —
  // a shape mismatch surfaces on-chain as "Groth16 proof verify failed".
  const raw: any = session.proof;
  const inner = raw?.proof ?? raw;
  const proofPoints = inner?.proofPoints;
  const issBase64Details = inner?.issBase64Details;
  const headerBase64 = inner?.headerBase64;
  const addressSeed =
    raw?.addressSeed ??
    inner?.addressSeed ??
    (session.salt ? String(genAddressSeed(BigInt(session.salt), "sub", session.sub, session.aud)) : undefined);

  if (!proofPoints || !issBase64Details || !headerBase64) {
    addWorkflowLog("ZK_SIGN_INVALID_PROOF", {
      hasProofPoints: Boolean(proofPoints),
      hasIssBase64Details: Boolean(issBase64Details),
      hasHeaderBase64: Boolean(headerBase64),
    }, "error");
    throw new Error(
      `invalid zk proof structure: proofPoints=${Boolean(proofPoints)}, issBase64Details=${Boolean(issBase64Details)}, headerBase64=${Boolean(headerBase64)}`
    );
  }

  if (!addressSeed) {
    addWorkflowLog("ZK_SIGN_MISSING_ADDRESS_SEED", {
      hasSalt: Boolean(session.salt),
      hasSub: Boolean(session.sub),
      hasAud: Boolean(session.aud),
    }, "error");
    throw new Error("Missing zkLogin addressSeed — salt, sub, or aud missing from session");
  }

  const effectiveMaxEpoch = Number(session.maxEpoch ?? maxEpoch);

  // Trace every input that goes into the zkLogin signature — the on-chain
  // Groth16 check compares these against the proof's PUBLIC inputs, so any
  // mismatch (esp. addressSeed, which encodes salt|sub|aud) fails with
  // "Groth16 proof verify failed". This log is the comparison baseline.
  addWorkflowLog("ZK_SIGN_INPUTS", {
    addressSeed,
    addressSeedLen: addressSeed?.length,
    maxEpoch: effectiveMaxEpoch,
    keyClaimName: "sub",
    sub: session.sub,
    aud: session.aud,
    iss: session.iss,
    saltLast4: session.salt ? session.salt.slice(-4) : null,
    proofPointCount: proofPoints?.a?.length,
  });

  addWorkflowLog("ZK_SIGN_PREPARE", {
    sessionAddress: session.address,
    ephemeralStoredPubKey: stored.pubKey,
    sessionEphemeralPubKey: session.ephemeralPubKey,
    ephemeralKeyMatch: stored.pubKey === session.ephemeralPubKey,
    sessionMaxEpoch: session.maxEpoch,
    storedMaxEpoch: stored.maxEpoch,
    effectiveMaxEpoch,
    addressSeed,
    txBytesLength: txBytes.length,
  });

  let zkLoginSignature: string;
  try {
    const signer = new ZkLoginSigner({
      ephemeralSigner: ephemeral,
      maxEpoch: effectiveMaxEpoch,
      inputs: {
        proofPoints,
        issBase64Details,
        headerBase64,
        addressSeed,
      },
      legacyAddress: false,
      address: session.address,
    });
    const derivedAddress = signer.getPublicKey().toSuiAddress();
    addWorkflowLog("ZK_SIGNER_VALIDATED", {
      derivedAddress,
      matchesSender: derivedAddress === session.address,
    }, "success");
    const signed = await signer.signTransaction(txBytes);
    zkLoginSignature = signed.signature;
  } catch (signerErr: any) {
    addWorkflowLog("ZK_SIGNER_VALIDATION_ERROR", {
      error: signerErr?.message ?? String(signerErr),
    }, "warn");
    const signed = await ephemeral.signTransaction(txBytes);
    zkLoginSignature = getZkLoginSignature({
      inputs: {
        proofPoints,
        issBase64Details,
        headerBase64,
        addressSeed,
      },
      maxEpoch: effectiveMaxEpoch,
      userSignature: signed.signature,
    });
  }

  addWorkflowLog("SUI_EXECUTE_TX_REQUEST", {
    rpcUrl: "/suirpc",
    txBytesLength: txBytesBase64.length,
    signatureLength: zkLoginSignature.length,
  });

  try {
    const client = new SuiJsonRpcClient({ url: "/suirpc", network: "testnet" });
    const result = await client.executeTransactionBlock({
      transactionBlock: txBytesBase64,
      signature: zkLoginSignature,
      options: { showEvents: true },
    });

    if (result.effects?.status?.status !== "success") {
      const errorMsg = result.effects?.status?.error ?? "transaction failed on-chain";
      addWorkflowLog("SUI_EXECUTE_TX_REJECTED", {
        status: result.effects?.status?.status,
        error: errorMsg,
        effects: result.effects,
      }, "error");
      throw new Error(errorMsg);
    }

    addWorkflowLog("SUI_EXECUTE_TX_SUCCESS", {
      digest: result.digest,
      status: result.effects?.status?.status,
    }, "success");

    return { digest: result.digest };
  } catch (rpcErr: any) {
    addWorkflowLog("SUI_EXECUTE_TX_ERROR", {
      message: rpcErr?.message ?? String(rpcErr),
      data: rpcErr?.data,
      code: rpcErr?.code,
    }, "error");
    throw rpcErr;
  }
}
