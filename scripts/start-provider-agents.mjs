// One-command startup for the three independently deployed provider agents
// (blueprint §8.2: each workstream ships a one-command startup).
//
//   node scripts/start-provider-agents.mjs
//   node scripts/start-provider-agents.mjs --down=PROVIDER-B
//   node scripts/start-provider-agents.mjs --mode=PROVIDER-B:unresponsive
//
// Each agent binds the endpoint reserved in its profile's agentCard
// (8101/8102/8103). Failure modes can also be flipped live during the demo:
//   curl -X POST http://127.0.0.1:8102/admin/mode -d '{"mode":"down"}'

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProviderAgent, loadProviderIdentity } from "../src/agents/providerAgent.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER_IDS = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"];
const MODE_VALUES = ["healthy", "down", "unresponsive", "slow"];

function parseFailureArgs(argv) {
  const modes = new Map(PROVIDER_IDS.map((id) => [id, "healthy"]));

  for (const arg of argv) {
    const downMatch = arg.match(/^--down=(.+)$/);
    const modeMatch = arg.match(/^--mode=([^:]+):(.+)$/);

    if (downMatch) {
      modes.set(downMatch[1].toUpperCase(), "down");
    } else if (modeMatch) {
      const providerId = modeMatch[1].toUpperCase();
      const mode = modeMatch[2];

      if (!modes.has(providerId) || !MODE_VALUES.includes(mode)) {
        throw new Error(`bad --mode argument: ${arg}`);
      }

      modes.set(providerId, mode);
    }
  }

  return modes;
}

const modes = parseFailureArgs(process.argv.slice(2));

// Provider-side Gonka pitch enrichment (best-effort, windowed by the bid
// deadline); absent config = deterministic offers only.
const gonka =
  process.env.GONKA_API_KEY && process.env.GONKA_BASE_URL && process.env.GONKA_MODEL
    ? {
        baseUrl: process.env.GONKA_BASE_URL,
        apiKey: process.env.GONKA_API_KEY,
        model: process.env.GONKA_MODEL,
        fetchImpl: fetch
      }
    : undefined;

console.log(
  `[provider] Gonka pitch enrichment: ${gonka ? `enabled (${gonka.model})` : "disabled"}`
);

const agents = [];

for (const providerId of PROVIDER_IDS) {
  const { profile, privateKeyPem } = loadProviderIdentity(
    path.join(projectRoot, "fixtures", "providers", `${providerId.toLowerCase()}.json`),
    path.join(projectRoot, "fixtures", "keys", `${providerId.toLowerCase()}.private.pem`)
  );
  const agent = createProviderAgent({
    profile,
    privateKeyPem,
    gonka,
    logger: (level, message) => console[level === "warn" ? "warn" : "log"](`[provider:${providerId}] ${message}`)
  });
  const port = await agent.listen(profile.agentCard.endpoint.match(/:(\d+)$/)?.[1] ?? 0);
  agent.setFailureMode(modes.get(providerId) ?? "healthy");

  agents.push(agent);
  console.log(
    `[provider] ${providerId} (${profile.brand}) on :${port} — mode ${agent.failureMode}`
  );
}

console.log("All provider agents running. Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await Promise.all(agents.map((agent) => agent.close()));
  process.exit(0);
});
