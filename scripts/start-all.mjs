// One command to bring up the whole Person 2 workstream:
//   node scripts/start-all.mjs [--down=PROVIDER-B] [--mode=PROVIDER-A:fail_activation]
//
// Starts the three provider agents (8101–8103) and the Rescue Agent gateway
// (GATEWAY_PORT, default 8082). Failure-mode flags are forwarded to the
// provider agents for the "kill a provider live" demo beat.
//
// Every launch rolls a fresh dynamic provider market (random brands +
// characteristics, stable ids/keys) so each demo run quotes a different
// trio; set PROVIDER_SEED to pin the roll for rehearsals.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeDynamicProviderSnapshot } from "../src/a2a/dynamicProviders.js";
import { providerProfileSchema } from "../src/a2a/schemas/providerProfile.js";
import { readFileSync } from "node:fs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(projectRoot, ".env"));
} catch {}
const forwardArgs = process.argv.slice(2);

// Roll the market once, before any child process starts, so the provider
// agents and the rescue agent quote the same personas.
const baseProfilesByFile = Object.fromEntries(
  ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"].map((providerId) => [
    providerId,
    JSON.parse(
      readFileSync(
        path.join(projectRoot, "fixtures", "providers", `${providerId.toLowerCase()}.json`),
        "utf8"
      )
    )
  ])
);

const personas = writeDynamicProviderSnapshot(projectRoot, baseProfilesByFile, {
  seed: process.env.PROVIDER_SEED
});

for (const [providerId, persona] of Object.entries(personas)) {
  const p = providerProfileSchema.parse(persona);
  console.log(
    `[market] ${providerId} → ${p.brand} (${p.category}) — cap ${p.policy.maxCapacityMbps}Mbps, ` +
      `${p.performance.latencyMs}ms RTT, ${p.performance.reliabilityScore} reliability, ` +
      `base ${p.policy.baseFee} ${p.policy.currency}`
  );
}

const children = [];

function run(name, script, args) {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", path.join(projectRoot, script), ...args],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    child.kill("SIGINT");
  }

  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("provider-agents", "scripts/start-provider-agents.mjs", forwardArgs);
run("rescue-agent", "scripts/start-rescue-agent.mjs", []);
run("claim-agent", "src/a2a/claimAgent.js", []);

console.log("NetChain agent market running. Ctrl+C to stop everything.");
