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
  proof?: unknown;
  signingMode?: "zk" | "custodial-fallback";
  // custodial fallback wallet address (differs from the zkLogin address)
  fallbackAddress?: string;
}

const EPHEMERAL_KEY = "netchain_zk_ephemeral_v1";

/** Current Sui epoch via the /suirpc proxy (Vite → publicnode testnet).
    Throws when the chain is unreachable — minting a session without a valid
    maxEpoch can never produce a working proof, so fail loudly instead. */
async function fetchCurrentEpoch(): Promise<number> {
  const res = await fetch("/suirpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getLatestSuiSystemState", params: [] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`could not read Sui epoch (suirpc → ${res.status}) — chain unreachable, login cannot mint a valid zk session`);
  const body = await res.json();
  const epoch = Number(body?.result?.epoch);
  if (!Number.isFinite(epoch)) throw new Error("could not read Sui epoch from suirpc — unexpected response");
  return epoch;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Start the Google zkLogin flow. In zk mode the ephemeral keypair is created
 * FIRST and bound into the OAuth nonce, so the issued id_token can only ever
 * produce a proof for this session's key.
 *
 * maxEpoch MUST be a future epoch (integration guide Step 1:
 * current epoch + offset) — a hardcoded small number expires immediately and
 * the prover / validators reject the session.
 */
let loginInFlight = false;
export async function beginZkLogin(redirectPath = "/wallet"): Promise<void> {
  // Each invocation mints a FRESH keypair and overwrites the tab's stored
  // bundle — a double-click (or two tabs) orphans the first Google flow and
  // its JWT can never prove. Ignore re-entrant calls; success navigates away.
  if (loginInFlight) return;
  loginInFlight = true;
  try {
    await beginZkLoginInner(redirectPath);
  } catch (error) {
    // Failure stays on this page (no redirect) — allow a retry.
    loginInFlight = false;
    throw error;
  }
  // Success navigates away — the flag intentionally stays set.
}

async function beginZkLoginInner(redirectPath: string): Promise<void> {
  // Dynamic import keeps @mysten/sui out of the initial bundle.
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const { generateNonce, generateRandomness } = await import("@mysten/sui/zklogin");

  const currentEpoch = await fetchCurrentEpoch();
  const offset = Number(import.meta.env.VITE_ZK_MAX_EPOCH ?? 10);
  const maxEpoch = currentEpoch + offset;
  const ephemeral = new Ed25519Keypair();
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);

  // Survive the Google redirect.
  sessionStorage.setItem(
    EPHEMERAL_KEY,
    JSON.stringify({
      secret: ephemeral.getSecretKey(),
      pubKey: ephemeral.getPublicKey(),
      maxEpoch,
      randomness,
      nonce,
    })
  );

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
  return session;
}

/** Ask the bridge's prover proxy for the groth16 zk proof. The Mysten prover
    validates the request against the OAuth nonce — poseidon(extended
    ephemeral pubkey, maxEpoch, jwtRandomness) — so the full ephemeral bundle
    must ride along, not just the JWT. */
export async function requestZkProof(session: ZkLoginSession): Promise<unknown> {
  const raw = sessionStorage.getItem(EPHEMERAL_KEY);
  const stored = raw ? (JSON.parse(raw) as { pubKey: string; secret: string; maxEpoch: number; randomness: string; nonce?: string }) : null;

  // The prover validates the OAuth nonce against the FULL ephemeral bundle.
  // If this tab lost the pre-redirect key (new tab, cleared storage), the
  // request would go out without extendedEphemeralPublicKey/jwtRandomness and
  // fail — say so directly instead of sending a doomed request.
  if (!stored) {
    throw new Error("ephemeral key missing from this tab (login started elsewhere?) — sign in again in this tab");
  }

  const body: Record<string, unknown> = {
    jwt: session.idToken,
    salt: session.salt,
    maxEpoch: session.maxEpoch ?? stored?.maxEpoch,
    keyClaimName: "sub",
  };
  {
    const [{ Ed25519Keypair }, { getExtendedEphemeralPublicKey, generateNonce, decodeJwt }] = await Promise.all([
      import("@mysten/sui/keypairs/ed25519"),
      import("@mysten/sui/zklogin"),
    ]);
    const ephemeral = Ed25519Keypair.fromSecretKey(stored.secret);
    // Fail fast on a stale/overwritten session: the bridge echoes the
    // authorize-time ephemeral pubkey. If this tab has since started ANOTHER
    // login (second click, another tab), the stored key no longer matches the
    // JWT's nonce and the prover WILL reject with "Nonce ... does not match".
    // Detect it here — before burning a prover round-trip — with an actionable
    // message instead of a cryptic 502.
    const expected = (session as { ephemeralPubKey?: string }).ephemeralPubKey;
    if (expected && ephemeral.getPublicKey().toSuiPublicKey() !== expected) {
      throw new Error(
        "login session mismatch — a newer sign-in overwrote this tab's key (double-click? another tab?). Sign out and sign in ONCE, then complete Google in the same tab"
      );
    }
    // Same-flow self-check (diagnostic, nonce claims only — no PII): recompute
    // the nonce from the stored bundle and compare it with the stored copy and
    // the JWT's claim. All three must agree; if they don't, the flow is mixed
    // across logins and the prover round-trip is doomed — say which link broke.
    try {
      const recomputed = generateNonce(ephemeral.getPublicKey(), stored.maxEpoch, stored.randomness);
      const jwtNonce = (decodeJwt(session.idToken ?? "") as { nonce?: string }).nonce;
      console.log("[zklogin] nonce audit", {
        storedVsRecomputed: stored.nonce === recomputed,
        storedVsJwt: stored.nonce === jwtNonce,
        maxEpoch: stored.maxEpoch,
      });
    } catch {
      /* audit is best-effort; the prover is authoritative */
    }
    body.extendedEphemeralPublicKey = await getExtendedEphemeralPublicKey(ephemeral.getPublicKey());
    body.jwtRandomness = stored.randomness;
  }

  const res = await fetch("/api/zklogin/prove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    // The bridge forwards the prover's raw payload, whose `error` field is
    // an OBJECT ({status, name}) — reading only it yields "[object Object]"
    // and hides the real reason. Prefer the prover's `message`, else dump.
    const err = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
    const detail =
      (typeof err?.error === "string" && err.error) ||
      (typeof err?.message === "string" && err.message) ||
      JSON.stringify(err ?? {}).slice(0, 500) ||
      `prover → ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
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
    throw new Error("no zk proof bundle — use the custodial path or re-login in zk mode");
  }

  const raw = sessionStorage.getItem(EPHEMERAL_KEY);
  if (!raw) {
    throw new Error("ephemeral key missing from this tab — re-login");
  }
  const { secret, maxEpoch } = JSON.parse(raw) as { secret: string; maxEpoch: number };

  const [{ Ed25519Keypair }, { getZkLoginSignature, genAddressSeed }, { SuiGrpcClient }, { SuiJsonRpcClient }] =
    await Promise.all([
      import("@mysten/sui/keypairs/ed25519"),
      import("@mysten/sui/zklogin"),
      import("@mysten/sui/grpc"),
      import("@mysten/sui/jsonRpc"),
    ]);

  const txBytes = new Uint8Array(atob(txBytesBase64).split("").map((c) => c.charCodeAt(0)));
  const ephemeral = Ed25519Keypair.fromSecretKey(secret);
  const signed = await ephemeral.signTransaction(txBytes);

  // Prover response shape differs by endpoint: prover-dev-v2 wraps the
  // components in { proof: {...}, addressSeed }, while prover-dev (v1)
  // returns them FLAT ({ proofPoints, issBase64Details, headerBase64, ...
  // }). Accept both — require the three proof components, derive addressSeed
  // locally when absent.
  const raw_proof = session.proof as {
    proofPoints?: { a: string[]; b: string[][]; c: string[] };
    issBase64Details?: { value: string; indexMod4: number };
    headerBase64?: string;
    addressSeed?: string;
    proof?: {
      proofPoints: { a: string[]; b: string[][]; c: string[] };
      issBase64Details: { value: string; indexMod4: number };
      headerBase64: string;
    };
  };
  const proofPoints = raw_proof.proofPoints ?? raw_proof.proof?.proofPoints;
  const issBase64Details = raw_proof.issBase64Details ?? raw_proof.proof?.issBase64Details;
  const headerBase64 = raw_proof.headerBase64 ?? raw_proof.proof?.headerBase64;
  if (!proofPoints || !issBase64Details || !headerBase64) {
    throw new Error(
      `prover returned an unexpected proof shape (keys: ${Object.keys(raw_proof ?? {}).join(",") || "none"}) — re-login once; if it persists, the prover endpoint is incompatible`
    );
  }

  const zkLoginSignature = getZkLoginSignature({
    inputs: {
      proofPoints,
      issBase64Details,
      headerBase64,
      addressSeed: raw_proof.addressSeed ?? String(genAddressSeed(BigInt(session.salt ?? "0"), "sub", session.sub, session.aud)),
    },
    maxEpoch: session.maxEpoch ?? maxEpoch,
    userSignature: signed.signature,
  });

  // Submit route: testnet's JSON-RPC and gRPC endpoints enforce DIFFERENT
  // zkLogin verifiers (MystenLabs/sui#18026 family) — v1-circuit proofs are
  // rejected by the JSON-RPC route ("Groth16 proof verify failed") while the
  // gRPC route accepts them. Submit via gRPC first (same-origin /suigrpc
  // proxy → official fullnode); fall back to JSON-RPC only on transport
  // failure, never on an authoritative on-chain rejection.
  const grpc = new SuiGrpcClient({ baseUrl: "/suigrpc", network: "testnet" });
  try {
    const result = await grpc.executeTransaction({
      transaction: txBytes,
      signatures: [zkLoginSignature],
      include: { effects: true, events: true },
    });
    // gRPC returns a tagged union: { $kind: "Transaction", Transaction } on
    // acceptance (effects may still carry success:false), or
    // { $kind: "FailedTransaction", FailedTransaction } on rejection.
    const accepted = result.$kind === "Transaction" ? result.Transaction : null;
    const failed = result.$kind === "FailedTransaction" ? result.FailedTransaction : null;
    const outcome = accepted ?? failed;
    if (!outcome || !outcome.effects?.status?.success) {
      const err = outcome?.effects?.status && !outcome.effects.status.success
        ? outcome.effects.status.error
        : `transaction rejected (${result.$kind})`;
      throw Object.assign(
        new Error(typeof err === "string" ? err : JSON.stringify(err ?? "transaction failed on-chain")),
        { __zkAuthoritative: true }
      );
    }
    return { digest: outcome.digest };
  } catch (error) {
    if (error && typeof error === "object" && "__zkAuthoritative" in error) throw error;
    console.warn("[zklogin] gRPC submit failed, retrying via JSON-RPC:", error instanceof Error ? error.message : String(error));
  }

  const client = new SuiJsonRpcClient({ url: "/suirpc", network: "testnet" });
  const result = await client.executeTransactionBlock({
    transactionBlock: txBytesBase64,
    signature: zkLoginSignature,
    options: { showEvents: true },
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(result.effects?.status?.error ?? "transaction failed on-chain");
  }
  return { digest: result.digest };
}
