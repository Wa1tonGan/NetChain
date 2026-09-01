// NetChain Model A zkLogin bridge.
//
// The frontend uses this service only for Google OAuth and zkLogin address
// derivation. Sui transactions are still signed by the existing trust layer
// (server-side buyer key) — this is the custodial / relayer model.
//
// Endpoints:
//   GET  /api/zklogin/authorize?redirect=/wallet -> { url }
//   GET  /api/zklogin/callback?code=...&state=... -> zkLogin session
//   GET  /api/zklogin/health                   -> { ok: true }

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

function createState(redirectPath) {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      redirect: redirectPath || "/wallet",
      nonce,
      exp: Date.now() + 10 * 60 * 1000,
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
  const state = createState(redirectPath);
  console.log("[zklogin] authorize requested:", { redirect: redirectPath });

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

  sendJson(response, 200, { url: googleUrl.toString() });
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
    sendJson(response, 200, { ok: true });
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
