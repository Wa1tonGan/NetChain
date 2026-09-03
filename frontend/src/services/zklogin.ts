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
 */
export async function beginZkLogin(redirectPath = "/wallet"): Promise<void> {
  // Dynamic import keeps @mysten/sui out of the initial bundle.
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
  const { generateNonce, generateRandomness } = await import("@mysten/sui/zklogin");

  const ephemeral = new Ed25519Keypair();
  const maxEpoch = Number(import.meta.env.VITE_ZK_MAX_EPOCH ?? 10);
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
  const stored = raw ? (JSON.parse(raw) as { pubKey: string; secret: string; maxEpoch: number; randomness: string }) : null;

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

  const res = await fetch("/api/zklogin/prove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `prover → ${res.status}`);
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

  const [{ Ed25519Keypair }, { getZkLoginSignature, genAddressSeed }, { SuiJsonRpcClient }] =
    await Promise.all([
      import("@mysten/sui/keypairs/ed25519"),
      import("@mysten/sui/zklogin"),
      import("@mysten/sui/jsonRpc"),
    ]);

  const ephemeral = Ed25519Keypair.fromSecretKey(secret);
  const signed = await ephemeral.signTransaction(
    new Uint8Array(atob(txBytesBase64).split("").map((c) => c.charCodeAt(0)))
  );

  // The prover returns { proof: { proofPoints, issBase64Details, headerBase64 },
  // addressSeed } — flattened into the SDK's ZkLoginSignatureInputs.
  const proof = session.proof as {
    proof: {
      proofPoints: { a: string[]; b: string[][]; c: string[] };
      issBase64Details: { value: string; indexMod4: number };
      headerBase64: string;
    };
    addressSeed?: string;
  };

  const zkLoginSignature = getZkLoginSignature({
    inputs: {
      proofPoints: proof.proof.proofPoints,
      issBase64Details: proof.proof.issBase64Details,
      headerBase64: proof.proof.headerBase64,
      addressSeed: proof.addressSeed ?? String(genAddressSeed(BigInt(session.salt ?? "0"), "sub", session.sub, session.aud)),
    },
    maxEpoch: session.maxEpoch ?? maxEpoch,
    userSignature: signed.signature,
  });

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
