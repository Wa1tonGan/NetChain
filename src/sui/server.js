// Optional HTTP face of the trust service (blueprint component view).
// The CLI + file flow is the primary demo path; this server exists so
// Person 2's runtime can POST Selected Offers and Person 1's dashboard can
// consume live events without tailing files.
//   npm run trust:server   # port 8200 (P2 reserved 8101–8103)
// Routes: POST /v1/commit · POST /v1/verify · POST /v1/activation ·
//         GET /v1/status/:incident · GET /v1/events (SSE)
// SUI_INTEGRATION_MODE=full also starts the P2 gateway poller
// (src/sui/integration.js) — every resolved incident is committed, verified
// and settled automatically.
import { createServer } from "node:http";
import { statSync, openSync, readSync, readFileSync, existsSync } from "node:fs";
import { TrustService } from "./service.js";
import { integrationMode, startPolling } from "./integration.js";
import { createDemoOffer } from "./demoOffer.js";

const PORT = Number(process.env.TRUST_PORT ?? 8200);

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function startServer({ service = new TrustService(), port = PORT, mode = integrationMode() } = {}) {
  const sseClients = new Set();
  let lastSeq = 0;

  // Full integration mode: automatically pull + settle every incident the
  // Rescue Agent resolves (SUI_P2_URL). one-loop is driven by
  // scripts/integrate-sui.mjs; standalone starts no poller.
  let stopPolling = null;
  if (mode === "full") {
    stopPolling = startPolling(service, { log: (level, msg) => console[level === "warn" ? "warn" : "log"](msg) });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    // Browser clients (dashboard chain feed, zkLogin commit) call cross-origin
    // from the Vite dev origin — same CORS contract as the P2 gateway.
    res.setHeader("access-control-allow-origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      res.end();
      return;
    }
    try {
      if (req.method === "POST" && url.pathname === "/v1/commit") {
        const selected = JSON.parse(await readBody(req));
        // submit:false → zkLogin buyer-direct path: validate + build the
        // unsigned commit_as_buyer PTB for the browser to zk-sign.
        if (selected.submit === false) {
          return json(res, 200, await service.buildCommitForZkLogin(selected));
        }
        return json(res, 200, await service.commit(selected));
      }
      if (req.method === "POST" && url.pathname === "/v1/demo/commit") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const selected = createDemoOffer({
          incidentId: body.incidentId,
          price: body.price ?? 1.8,
          capacityMbps: body.capacityMbps ?? 500,
          rootDir: process.cwd()
        });
        const commitRes = await service.commit(selected);
        return json(res, 200, { ...commitRes, selectedOffer: selected });
      }
      if (req.method === "POST" && url.pathname === "/v1/commit/confirm") {
        return json(res, 200, await service.confirmZkCommit(JSON.parse(await readBody(req))));
      }
      // Cold-start funding: the platform (setup authority, PLATFORM_SECRET)
      // tops up a zkLogin user's wallet — stablecoin + gas — so the buyer can
      // pay for their own commit_as_buyer. Platform-key gated; no buyer key.
      if (req.method === "POST" && url.pathname === "/v1/fund") {
        const body = JSON.parse(await readBody(req));
        if (!service.fundUser) {
          return json(res, 501, { error: "funding not configured (set PLATFORM_SECRET + run sui:setup)" });
        }
        return json(res, 200, await service.fundUser(body));
      }
      if (req.method === "POST" && url.pathname === "/v1/activation") {
        return json(res, 200, await service.activation(JSON.parse(await readBody(req))));
      }
      if (req.method === "POST" && url.pathname === "/v1/demo/settle") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const settleRes = await service.activation({
          incidentId: body.incidentId,
          status: "AVAILABLE",
          recoveredCapacityMbps: body.recoveredCapacityMbps ?? 500
        });
        return json(res, 200, settleRes);
      }
      // Permissionless post-expiry reclaim (escrow::reclaim returns the
      // locked funds to the commitment's buyer regardless of caller).
      if (req.method === "POST" && url.pathname === "/v1/reclaim") {
        const { nonce } = JSON.parse(await readBody(req));
        if (!nonce) return json(res, 422, { code: "NONCE_REQUIRED", message: "nonce is required" });
        return json(res, 200, await service.reclaim(nonce));
      }
      if (req.method === "POST" && url.pathname === "/v1/verify") {
        // Verification Agent intake (blueprint §4.3): a real session monitor
        // posts { incidentId, promisedCapacity, deliveredSamples, … } and the
        // verdict (connection-log hash + penalty) is committed on-chain.
        const body = JSON.parse(await readBody(req));
        const { incidentId, ...delivery } = body;
        if (!incidentId) return json(res, 422, { code: "VOUCHER_INVALID", message: "incidentId is required" });
        return json(res, 200, await service.verifyDelivery(incidentId, delivery));
      }
      if (req.method === "GET" && url.pathname.startsWith("/v1/status/")) {
        return json(res, 200, service.status(url.pathname.split("/").pop()));
      }
      // Recent ledger rows — dashboards seed their Sui Trust Ledger view on
      // load; the SSE stream at /v1/events then carries the live tail.
      if (req.method === "GET" && url.pathname === "/v1/events/recent") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 30), 200);
        return json(res, 200, { events: service.ledger.recent(limit) });
      }
      if (req.method === "GET" && url.pathname === "/v1/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, err.code ? 422 : 500, { code: err.code ?? "INTERNAL", message: err.message });
    }
  });

  // Tail the ledger → SSE broadcast.
  const ledgerPath = service.ledger.path;
  if (existsSync(ledgerPath)) {
    lastSeq = service.ledger.rebuild();
  }
  setInterval(() => {
    try {
      if (!existsSync(ledgerPath)) return;
      const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.seq > lastSeq) {
          lastSeq = event.seq;
          for (const client of sseClients) {
            client.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        }
      }
    } catch {
      // torn tail write — retry next tick
    }
  }, 500);

  server.listen(port, () =>
    console.log(`[trust-server] listening on :${port} (SSE at /v1/events, integration mode: ${mode}${stopPolling ? " — P2 poller live" : ""})`)
  );
  return { server, stopPolling };
}

// Auto-start when run directly: node src/sui/server.js
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  startServer();
}