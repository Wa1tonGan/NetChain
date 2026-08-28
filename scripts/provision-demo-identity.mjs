// One-time provisioning for the demo provider market:
//   1. generates an ed25519 keypair per provider + one buyer keypair
//   2. writes the three provider profiles (fixtures/providers/*.json) with
//      the public keys embedded, so any verifier can validate offers offline
//
// Re-running regenerates keys, so all offer/selected fixtures must be
// regenerated afterwards: node scripts/generate-fixtures.mjs
//
// The keys are throwaway demo material committed for the hackathon — never
// reuse them for anything real.

import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keysDirectory = path.join(projectRoot, "fixtures", "keys");
const providersDirectory = path.join(projectRoot, "fixtures", "providers");

const HEALTH_CHECK_AT = "2026-08-29T08:00:00Z";

const providers = [
  {
    providerId: "PROVIDER-A",
    brand: "NusaNet 5G",
    category: "TELCO_5G_QOD",
    description:
      "Fictional Malaysian telco exposing CAMARA-style 5G Quality-on-Demand sessions for prioritised app flows. Big capacity and excellent reliability, but the standard CAMARA session setup is slow unless the P0 fast lane is pre-authorised.",
    agentCard: {
      name: "nusanet-5g-agent",
      version: "0.1.0",
      protocol: "REST/JSON (A2A-semantic)",
      endpoint: "http://127.0.0.1:8101",
      capabilities: ["qod_session_create", "capacity_burst", "p0_fast_lane"],
      healthy: true,
      credentialsReady: true,
      lastHealthCheckAt: HEALTH_CHECK_AT
    },
    policy: {
      maxCapacityMbps: 400,
      baseFee: 20,
      pricePer100MbpsPerHour: 15,
      currency: "MYR"
    },
    performance: {
      latencyMs: 30,
      packetLossPercent: 0.3,
      reliabilityScore: 0.9995
    },
    activation: {
      standard: { class: "MEDIUM", timeMs: 8000 },
      p0FastLane: { class: "FAST", timeMs: 1500 }
    }
  },
  {
    providerId: "PROVIDER-B",
    brand: "KilatLink FWA",
    category: "FWA_BURST",
    description:
      "Fictional fixed-wireless access operator selling quickly activatable burst capacity over pre-connected FWA links. The value pick: fast activation and dependable reliability at a fair price.",
    agentCard: {
      name: "kilatlink-fwa-agent",
      version: "0.1.0",
      protocol: "REST/JSON (A2A-semantic)",
      endpoint: "http://127.0.0.1:8102",
      capabilities: ["capacity_burst", "fast_activation"],
      healthy: true,
      credentialsReady: true,
      lastHealthCheckAt: HEALTH_CHECK_AT
    },
    policy: {
      maxCapacityMbps: 300,
      baseFee: 15,
      pricePer100MbpsPerHour: 15,
      currency: "MYR"
    },
    performance: {
      latencyMs: 35,
      packetLossPercent: 0.5,
      reliabilityScore: 0.999
    },
    activation: {
      standard: { class: "FAST", timeMs: 1500 },
      p0FastLane: { class: "FAST", timeMs: 1000 }
    }
  },
  {
    providerId: "PROVIDER-C",
    brand: "OrbitSat GO",
    category: "LEO_SATELLITE",
    description:
      "Fictional LEO satellite backhaul provider for disaster recovery where terrestrial capacity is gone. Wide coverage and instant pointing, but limited capacity and high latency rule it out for demanding city links.",
    agentCard: {
      name: "orbitsat-go-agent",
      version: "0.1.0",
      protocol: "REST/JSON (A2A-semantic)",
      endpoint: "http://127.0.0.1:8103",
      capabilities: ["disaster_recovery", "wide_coverage", "instant_activation"],
      healthy: true,
      credentialsReady: true,
      lastHealthCheckAt: HEALTH_CHECK_AT
    },
    policy: {
      maxCapacityMbps: 150,
      baseFee: 10,
      pricePer100MbpsPerHour: 14,
      currency: "MYR"
    },
    performance: {
      latencyMs: 120,
      packetLossPercent: 1.2,
      reliabilityScore: 0.98
    },
    activation: {
      standard: { class: "FAST", timeMs: 2000 },
      p0FastLane: { class: "INSTANT", timeMs: 500 }
    }
  }
];

mkdirSync(keysDirectory, { recursive: true });
mkdirSync(providersDirectory, { recursive: true });

function keyPaths(name) {
  return {
    privatePath: path.join(keysDirectory, `${name}.private.pem`),
    publicPath: path.join(keysDirectory, `${name}.public.pem`)
  };
}

for (const provider of providers) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = `${provider.providerId.toLowerCase()}-demo`;
  const { privatePath, publicPath } = keyPaths(provider.providerId.toLowerCase());

  writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));

  const profile = {
    ...provider,
    publicKey: {
      algorithm: "ed25519",
      keyId,
      value: publicKey.export({ type: "spki", format: "pem" }).trim()
    }
  };

  writeFileSync(
    path.join(providersDirectory, `${provider.providerId.toLowerCase()}.json`),
    `${JSON.stringify(profile, null, 2)}\n`
  );
}

// Buyer key: the Rescue Agent signs the agreement side of the voucher.
const buyer = generateKeyPairSync("ed25519");
writeFileSync(
  keyPaths("buyer").privatePath,
  buyer.privateKey.export({ type: "pkcs8", format: "pem" })
);
writeFileSync(
  keyPaths("buyer").publicPath,
  buyer.publicKey.export({ type: "spki", format: "pem" })
);

console.log(`Provisioned ${providers.length} provider identities + buyer key in fixtures/`);
