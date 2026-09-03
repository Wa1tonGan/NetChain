// Per-request dynamic personas: every incident faces a re-dressed provider
// market (brand/characteristics), while identity (providerId, keys, ports)
// stays pinned. Persona derivation is deterministic per incidentId, so the
// rescue agent and the provider agents must produce identical faces.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProviderAgent } from "../src/agents/providerAgent.js";
import { createRescueAgent } from "../src/agents/rescueAgent.js";
import {
  derivePersonasForIncident,
  loadStaticProfiles,
} from "../src/a2a/dynamicProviders.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER_IDS = ["PROVIDER-A", "PROVIDER-B", "PROVIDER-C"];

const SCENARIO_S2 = JSON.parse(
  await readFile(path.join(projectRoot, "scenarios/s2-primary-down-backup-insufficient.json"), "utf8")
);

async function startStack() {
  const baseProfiles = loadStaticProfiles(projectRoot);
  const agents = [];
  const providers = [];

  for (const providerId of PROVIDER_IDS) {
    const profile = structuredClone(baseProfiles[providerId]);
    const privateKeyPem = await readFile(
      path.join(projectRoot, "fixtures", "keys", `${providerId.toLowerCase()}.private.pem`),
      "utf8"
    );
    const agent = createProviderAgent({
      profile,
      privateKeyPem,
      baseProfiles,
      logger: () => {}
    });
    const port = await agent.listen(0);
    profile.agentCard.endpoint = `http://127.0.0.1:${port}`;
    agents.push(agent);
    providers.push(profile);
  }

  const buyerPrivateKeyPem = await readFile(
    path.join(projectRoot, "fixtures", "keys", "buyer.private.pem"),
    "utf8"
  );
  const rescue = createRescueAgent({
    providers,
    baseProviders: baseProfiles,
    buyerPrivateKeyPem,
    logger: () => {}
  });

  return {
    baseProfiles,
    rescue,
    cleanup: async () => {
      await Promise.all(agents.map((a) => a.close()));
      await rescue.close();
    }
  };
}

const intentFor = (incidentId) => ({
  ...structuredClone(SCENARIO_S2),
  incidentId
});

test("per-incident personas differ across incidents but match between agents", async () => {
  const { baseProfiles, rescue, cleanup } = await startStack();

  try {
    const envA = await rescue.processIntent(intentFor("INC-PERSONA-A"));
    const envB = await rescue.processIntent(intentFor("INC-PERSONA-B"));

    assert.equal(envA.status, "SELECTED");
    assert.equal(envB.status, "SELECTED");

    // Two incidents → two different markets (winner brand differs).
    assert.notEqual(
      envA.selectedOffer.selectedProvider.brand,
      envB.selectedOffer.selectedProvider.brand
    );

    // Rescue-side persona derivation matches the deterministic shared seed —
    // the winner's brand equals what any agent derives for that incident.
    const personasA = derivePersonasForIncident(baseProfiles, "INC-PERSONA-A");
    const winnerA = envA.selectedOffer.selectedProvider;
    assert.equal(winnerA.brand, personasA[winnerA.providerId].brand);

    // Retrying the SAME incident reuses the same market (cached envelope).
    const envA2 = await rescue.processIntent(intentFor("INC-PERSONA-A"));
    assert.equal(envA2.selectedOffer.selectedProvider.brand, winnerA.brand);
  } finally {
    await cleanup();
  }
});
