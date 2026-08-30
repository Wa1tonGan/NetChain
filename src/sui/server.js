// Optional HTTP face of the trust service (blueprint component view).
// The CLI + file flow is the primary demo path; this server exists so
// Person 2's runtime can POST Selected Offers and Person 1's dashboard can
// consume live events without tailing files.
//   npm run trust:server   # port 8200 (P2 reserved 8101–8103)
import { createServer } from "node:http";
import { statSync, openSync, readSync, readFileSync, existsSync } from "node:fs";
import { TrustService } from "./service.js";

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

export function startServer({ service = new TrustService(), port = PORT } = {}) {
  const sseClients = new Set();
  let lastSeq = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    try {
      if (req.method === "POST" && url.pathname === "/v1/commit") {
        const selected = JSON.parse(await readBody(req));
        return json(res, 200, await service.commit(selected));
      }
      if (req.method === "POST" && url.pathname === "/v1/activation") {
        return json(res, 200, await service.activation(JSON.parse(await readBody(req))));
      }
      if (req.method === "GET" && url.pathname.startsWith("/v1/status/")) {
        return json(res, 200, service.status(url.pathname.split("/").pop()));
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

  server.listen(port, () => console.log(`[trust-server] listening on :${port} (SSE at /v1/events)`));
  return server;
}

// Auto-start when run directly: node src/sui/server.js
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  startServer();
}
