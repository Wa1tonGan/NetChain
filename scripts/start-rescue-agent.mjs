// One-command startup for the Network Rescue Agent (Person 2's core service).
//
//   node scripts/start-rescue-agent.mjs
//
// Reads .env for the Gonka ranking config and the optional Person 3 ack URL,
// binds the gateway port from .env (GATEWAY_PORT, default 8082).
//
//   POST /v1/recovery   body: a RecoveryIntent (Person 1's contract) or
//                       {"intent": {...}}
//   GET  /v1/recovery/:incidentId
//   GET  /readiness     cached agent cards + live provider health
//   GET  /health

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createRescueAgent } from "../src/agents/rescueAgent.js";
import { providerProfileSchema } from "../src/a2a/schemas/providerProfile.js";
import { loadProviderProfiles, loadStaticProfiles } from "../src/a2a/dynamicProviders.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(path.join(projectRoot, ".env"));
} catch {
  console.log("[rescue-agent] no .env found — running without Gonka config");
}

const PROVIDER_IDS = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"];

// Dynamic market: same shared snapshot the provider agents read, so both
// sides quote the same personas for this run (see src/a2a/dynamicProviders.js).
const { profiles: dynamicProfiles } = loadProviderProfiles(projectRoot, {
  seed: process.env.PROVIDER_SEED
});

const providers = PROVIDER_IDS.map((providerId) =>
  providerProfileSchema.parse(dynamicProfiles[providerId])
);

for (const provider of providers) {
  console.log(`[rescue-agent] market: ${provider.providerId} = ${provider.brand} (${provider.category})`);
}

const buyerPrivateKeyPem = readFileSync(
  path.join(projectRoot, "fixtures", "keys", "buyer.private.pem"),
  "utf8"
);

const gonkaConfigured = Boolean(process.env.GONKA_API_KEY && process.env.GONKA_BASE_URL);
console.log(
  `[rescue-agent] Gonka ranking: ${gonkaConfigured ? `enabled (${process.env.GONKA_MODELS})` : "disabled — deterministic ranking only"}`
);

const agent = createRescueAgent({
  providers,
  // Identity-stable base profiles: per-incident personas are derived from
  // these (seeded by incidentId) — same derivation the provider agents run.
  baseProviders: loadStaticProfiles(projectRoot),
  buyerPrivateKeyPem,
  person3: { ackUrl: process.env.PERSON3_ACK_URL ?? "" },
  logger: (level, message) => console[level === "warn" ? "warn" : "log"](`[rescue-agent] ${message}`)
});

const port = await agent.listen(Number(process.env.GATEWAY_PORT ?? 8082));
console.log(`[rescue-agent] listening on http://127.0.0.1:${port}`);
console.log(`[rescue-agent] POST /v1/recovery with a RecoveryIntent, e.g.:
  curl -s -X POST http://127.0.0.1:${port}/v1/recovery \\
    -H 'content-type: application/json' \\
    -d @scenarios/s2-primary-down-backup-insufficient.json`);

process.on("SIGINT", async () => {
  await agent.close();
  process.exit(0);
});
