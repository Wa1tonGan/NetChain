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
const workflowLogs = [];

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

  if (url.pathname === "/api/zklogin/epoch") {
    try {
      const res = await fetch("https://sui-testnet-rpc.publicnode.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getLatestSuiSystemState", params: [] }),
        signal: AbortSignal.timeout(6000),
      });
      const data = await res.json();
      const epoch = Number(data?.result?.epoch ?? 0);
      sendJson(response, 200, { epoch: epoch || 1211 });
    } catch (err) {
      sendJson(response, 200, { epoch: 1211 });
    }
    return;
  }

  if (url.pathname === "/api/zklogin/logs") {
    if (request.method === "DELETE") {
      workflowLogs.length = 0;
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 200, { logs: workflowLogs });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/zklogin/log") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        const item = JSON.parse(body || "{}");
        workflowLogs.unshift(item);
        if (workflowLogs.length > 200) workflowLogs.pop();
        const color =
          item.level === "error"
            ? "\x1b[31m"
            : item.level === "warn"
            ? "\x1b[33m"
            : item.level === "success"
            ? "\x1b[32m"
            : "\x1b[36m";
        console.log(
          `[wf-log] ${color}[${item.level?.toUpperCase() || "INFO"}]\x1b[0m \x1b[1m${item.step}\x1b[0m:`,
          item.data
        );
        sendJson(response, 200, { ok: true });
      } catch (err) {
        sendJson(response, 400, { error: String(err) });
      }
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
        // v2 testnet prover: testnet verifies zkLogin proofs with the v2
        // circuit (MystenLabs/sui#27115), so v1 proofs from prover-dev fail
        // on-chain with "Groth16 proof verify failed". prover.mystenlabs.com
        // (mainnet) additionally requires allowlisted client IDs (Enoki).
        const proverUrl = process.env.ZK_PROVER_URL ?? "https://prover-dev-v2.mystenlabs.com/v1";
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
        // Pass the prover's real reason through (it uses {name, message}) and
        // log it — a bare 502 hides whether it's a circuit, parse, or
        // availability problem. Successes pass through untouched.
        if (!proverRes.ok) {
          console.error("[zklogin] prover error:", proverRes.status, JSON.stringify(payload).slice(0, 300));
          sendJson(response, 502, {
            ...(payload ?? {}),
            error: payload?.message ?? payload?.error ?? `prover returned ${proverRes.status}`,
          });
          return;
        }
        sendJson(response, 200, payload);
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
});
