// NetChain zkLogin bridge.
//
// Two signing modes:
//   ZK_SIGNING=true (default intent): the browser generates an ephemeral
//     keypair, sends its pubkey + maxEpoch to /authorize; Google's OIDC
//     `nonce` binds the zk proof to that key. /callback returns salt +
//     idToken so the browser can request the zk proof at /prove and sign
//     transactions locally (non-custodial; the bridge never holds the key).
//   ZK_SIGNING=false (fallback): the bridge derives a per-session keypair
//     server-side (HMAC(sub) — never persisted to disk) and signs on the
//     user's behalf. Clearly labeled "custodial fallback" in the UI.
//
// Endpoints:
//   GET  /api/zklogin/authorize?redirect=/wallet&ephemeralPubKey=..&maxEpoch=..&network=..
//                                  -> { url }
//   GET  /api/zklogin/callback?code=...&state=... -> zkLogin session
//   POST /api/zklogin/prove     { jwt } -> { proof, issMaxEpoch } (Sui prover proxy)
//   POST /api/zklogin/session   { sub } -> custodial fallback session key
//   GET  /api/zklogin/health                   -> { ok, zkSigning }

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { jwtToAddress } from "@mysten/sui/zklogin";

const PORT = Number(process.env.ZKL_PORT ?? 8787);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:5173/zklogin";
const ALLOWED_ORIGIN = process.env.ZKL_ALLOWED_ORIGIN ?? "http://localhost:5173";
const DEFAULT_SALT_SEED = "6e6574636861696e2d7a6b6c6f67696e"; // "netchain-zklogin"

const exchangedCodes = new Map();

function decodeJwtPayload(token) {
  const part = token.split(".")[1];
  if (!part) throw new Error("Invalid JWT: missing payload");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
}

function stateSecret() {
  return process.env.ZKL_STATE_SECRET || process.env.ZKL_SALT_MASTER_SEED || DEFAULT_SALT_SEED;
}

function signState(payload) {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

function deriveSalt(claims) {
  let seedHex = process.env.ZKL_SALT_MASTER_SEED ?? DEFAULT_SALT_SEED;
  if (!/^[0-9a-f]+$/i.test(seedHex)) {
    seedHex = Buffer.from(seedHex, "utf8").toString("hex");
  }

  const ikm = Buffer.from(seedHex, "hex");
  const info = Buffer.from(`${claims.iss}\u0000${claims.aud}\u0000${claims.sub}`);
  const digest = createHmac("sha256", ikm).update(info).digest();
  const bytes = digest.subarray(0, 16);

  let salt = 0n;
  for (const byte of bytes) {
    salt = (salt << 8n) | BigInt(byte);
  }
  return salt.toString();
}

function cors(response) {
  response.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(response, status, payload) {
  cors(response);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readUrl(url) {
  return new URL(url, `http://${process.env.ZKL_HOST ?? "127.0.0.1"}`);
}

function createState(redirectPath, zk) {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      redirect: redirectPath || "/wallet",
      nonce,
      exp: Date.now() + 10 * 60 * 1000,
      // zk-login flow bindings (absent in the custodial fallback flow)
      ephemeralPubKey: zk?.ephemeralPubKey ?? null,
      maxEpoch: zk?.maxEpoch ?? null,
    })
  ).toString("base64url");

  return `${payload}.${signState(payload)}`;
}

function consumeState(state) {
  const [payload, signature] = String(state ?? "").split(".");
  if (!payload || !signature) {
    throw new Error("Invalid or expired OAuth state");
  }

  const expected = Buffer.from(signState(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid or expired OAuth state");
  }

  const record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!record.exp || Date.now() > record.exp) {
    throw new Error("OAuth state expired");
  }

  return record;
}

async function exchangeCodeForIdToken(code) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured");
  }

  if (exchangedCodes.has(code)) {
    return exchangedCodes.get(code);
  }

  const exchange = (async () => {
    let response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Could not reach Google token endpoint. Check the zklogin server's network and logs.");
    }

    const payload = await response.json();
    if (!response.ok || !payload.id_token) {
      const detail = `${payload.error ?? "unknown_error"}: ${payload.error_description ?? payload.error ?? ""}`;
      console.error("[zklogin] Google token exchange failed:", detail);
      throw new Error(`Google token exchange failed: ${detail}`);
    }

    return payload.id_token;
  })();

  exchangedCodes.set(code, exchange);
  return exchange;
}

async function handleAuthorize(url, response) {
  const redirectPath = url.searchParams.get("redirect") || "/wallet";
  const ephemeralPubKey = url.searchParams.get("ephemeralPubKey");
  const maxEpoch = url.searchParams.get("maxEpoch");
  const zkSigning = process.env.ZK_SIGNING !== "false";
  const state = createState(redirectPath, { ephemeralPubKey, maxEpoch: maxEpoch ? Number(maxEpoch) : null });
  console.log("[zklogin] authorize requested:", { redirect: redirectPath, zk: Boolean(ephemeralPubKey && maxEpoch) });

  if (!CLIENT_ID) {
    sendJson(response, 400, {
      error: "GOOGLE_CLIENT_ID is not configured on the zkLogin server",
    });
    return;
  }

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", CLIENT_ID);
  googleUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("access_type", "online");
  googleUrl.searchParams.set("prompt", "select_account");
  // Nonce binding for the zk proof (JWT claim): the browser computes the Sui
  // nonce — poseidon(extendedEphemeralPubKey, maxEpoch, jwtRandomness) — and
  // it MUST be issued verbatim inside the id_token, or the prover rejects the
  // proof and every login silently degrades to the custodial fallback.
  const nonce = url.searchParams.get("nonce");
  if (nonce) {
    googleUrl.searchParams.set("nonce", nonce);
  }

  sendJson(response, 200, { url: googleUrl.toString(), zkSigning });
}

async function handleCallback(url, response) {
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    console.log("[zklogin] callback requested:", { hasCode: Boolean(code), hasState: Boolean(state) });

    if (!code || !state) {
      throw new Error("Missing OAuth code or state");
    }

    const record = consumeState(state);
    const idToken = await exchangeCodeForIdToken(code);
    const claims = decodeJwtPayload(idToken);
    const salt = deriveSalt(claims);
    const address = jwtToAddress(idToken, BigInt(salt), false);

    console.log("[zklogin] login successful:", { address, email: claims.email ?? null });
    sendJson(response, 200, {
      address,
      email: claims.email ?? null,
      name: claims.name ?? null,
      sub: claims.sub,
      iss: claims.iss,
      aud: claims.aud,
      redirect: record.redirect,
      // zk signing needs these three client-side; the idToken is the proof
      // input, not a long-lived secret (aud-bound, short-lived).
      salt,
      idToken,
      maxEpoch: record.maxEpoch ?? null,
      ephemeralPubKey: record.ephemeralPubKey ?? null,
    });
  } catch (error) {
    console.error("[zklogin] callback error:", error instanceof Error ? error.message : error);
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    cors(response);
    response.writeHead(204);
    response.end();
    return;
  }

  const url = readUrl(request.url ?? "/");

  if (url.pathname === "/api/zklogin/health") {
    sendJson(response, 200, {
      ok: true,
      zkSigning: process.env.ZK_SIGNING !== "false",
      proverConfigured: Boolean(process.env.ZK_PROVER_URL),
    });
    return;
  }

  // zk proof proxy: forwards the short-lived idToken to the Sui prover
  // service and returns the groth16 proof for local signing. The bridge
  // stores nothing — the proof goes straight back to the browser.
  if (request.method === "POST" && url.pathname === "/api/zklogin/prove") {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", async () => {
      try {
        const { jwt, salt, extendedEphemeralPublicKey, maxEpoch, jwtRandomness, keyClaimName } =
          JSON.parse(raw || "{}");
        if (!jwt) throw new Error("jwt required");
        const proverUrl = process.env.ZK_PROVER_URL ?? "https://prover-dev.mystenlabs.com/v1";
        // Debug the exact outbound bundle MINUS secrets (no JWT/salt): a
        // nonce mismatch means the prover hashed different inputs than the
        // authorize step used — this shows what actually left the bridge,
        // including JS types (a numeric-vs-string maxEpoch is a classic).
        console.debug(
          "[zklogin] prove outbound:",
          JSON.stringify({
            extPK: typeof extendedEphemeralPublicKey === "string" ? `${extendedEphemeralPublicKey.slice(0, 8)}…len${extendedEphemeralPublicKey.length}` : typeof extendedEphemeralPublicKey,
            maxEpoch, maxEpochType: typeof maxEpoch,
            jwtRandomness: typeof jwtRandomness === "string" ? `…${String(jwtRandomness).slice(-6)} len${String(jwtRandomness).length}` : typeof jwtRandomness,
            keyClaimName, hasJwt: Boolean(jwt), hasSalt: Boolean(salt),
          })
        );
        const proverRes = await fetch(proverUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The prover validates the OAuth nonce against the full ephemeral
          // bundle — forwarding only {jwt, salt} fails its input validation.
          body: JSON.stringify({
            jwt,
            salt,
            extendedEphemeralPublicKey,
            maxEpoch,
            jwtRandomness,
            keyClaimName: keyClaimName ?? "sub"
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const payload = await proverRes.json();
        if (!proverRes.ok) {
          // Log the rejection server-side (status + message only — never the
          // JWT/salt) so a failed login is diagnosable from the bridge
          // terminal, not just the browser console.
          console.error(
            "[zklogin] prover rejected proof request:",
            proverRes.status,
            typeof payload?.message === "string" ? payload.message.slice(0, 300) : JSON.stringify(payload ?? {}).slice(0, 300)
          );
        }
        sendJson(response, proverRes.ok ? 200 : 502, payload);
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }

  // Custodial fallback (ZK_SIGNING=false or prover outage): derive a
  // per-session keypair from HMAC(stateSecret, sub). Never persisted; the
  // same user maps to the same key for this bridge's lifetime. The UI must
  // label this mode — it is the demo continuity path, not the real thing.
  if (request.method === "POST" && url.pathname === "/api/zklogin/session") {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", async () => {
      try {
        const { sub, address } = JSON.parse(raw || "{}");
        if (!sub) throw new Error("sub required");
        const seed = createHmac("sha256", stateSecret()).update(`session:${sub}`).digest();
        const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
        const keypair = Ed25519Keypair.fromSecretKey(seed);
        sendJson(response, 200, {
          mode: "custodial-fallback",
          address: keypair.toSuiAddress(),
          boundToZkAddress: address ?? null,
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/zklogin/authorize") {
    await handleAuthorize(url, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/zklogin/callback") {
    await handleCallback(url, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[zklogin-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[zklogin-server] prover: ${process.env.ZK_PROVER_URL ?? "https://prover-dev.mystenlabs.com/v1 (default v1!)"}`);
});
