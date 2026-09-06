// Dynamic provider personas: every startup re-dresses the three provider
// slots with a fresh brand, category and characteristic spread so the A2A
// race looks like a real market (different winner, different quotes every
// run) instead of the same scripted trio.
//
// What MUST stay stable: providerId, the ed25519 keypair and keyId — Person
// 3's trust layer re-verifies every signed offer against the provider's
// pinned public key, so personas may never touch identity-critical fields.
//
// Reproducibility: set PROVIDER_SEED to pin the roll (rehearsals get the
// same market every time); unset = Math.random per startup.
//
// Shared state: the rescue agent and the provider agents run as separate
// processes and must quote the same market, so the personas are rolled once
// (by scripts/start-all.mjs, or the first process to start) and snapshotted
// to fixtures/providers/dynamic.json with a short TTL.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const SNAPSHOT_TTL_MS = 5 * 60_000;

const BRAND_STEMS = [
  "NusaNet", "FiberOne", "MaxiLink", "SkyRange", "MetroLink",
  "AxiomNet", "WaveNet", "TelePrima", "UrbanMesh", "NovaLink",
  "BinaFibre", "OrbitMy", "CeriaNet", "PantasLink", "RimbaNet"
];

// Fixed Malaysian telco identities per slot — the demo always races the same
// three operators. The category suffix still attaches per roll (e.g. "Maxis
// 5G", "Digi Fibre Air", "U Mobile Orbit") because slots keep shuffling
// tiers, so characteristics (capacity/price/latency) still vary every run.
const SLOT_BRANDS = {
  "PROVIDER-A": "Maxis",
  "PROVIDER-B": "Digi",
  "PROVIDER-C": "U Mobile"
};

const CATEGORY_DRESS = {
  TELCO_5G_QOD: {
    suffix: "5G",
    description:
      "{brand} runs CAMARA-style 5G Quality-on-Demand sessions for prioritised app flows. " + "{trait}",
    capabilities: ["qod_session_create", "capacity_burst", "p0_fast_lane"]
  },
  FWA_BURST: {
    suffix: "AirFibre",
    description:
      "{brand} delivers fixed-wireless access with burst capacity for event sites and hotspots. " + "{trait}",
    capabilities: ["fwa_session_create", "capacity_burst", "roaming_attach"]
  },
  LEO_SATELLITE: {
    suffix: "Orbit",
    description:
      "{brand} leases LEO satellite capacity for hard-to-reach sites with bonded terminal handover. " + "{trait}",
    capabilities: ["satellite_attach", "capacity_burst", "remote_site_link"]
  }
};

const TRAITS = [
  "Aggressive on price, tolerates a little extra latency to win the bid.",
  "Premium path: low jitter and high reliability, priced accordingly.",
  "Middle-of-the-market workhorse with predictable activation times.",
  "Capacity-first operator; bursts wide but budgets are tight for it.",
  "Fast-lane specialist — the P0 lane is pre-authorised around the clock."
];

// Three market slots so the race stays interesting: one premium, one
// balanced, one budget tier, shuffled across the provider slots each roll.
// Ranges are tuned against the scenario viability gates (offerEvaluator):
// activation ≤ ~5 s and a 60-min 200 Mbps quote under a 5 USDC budget must
// stay reachable by every tier in every roll — users offer small budgets
// (~5 USDC) and the market quotes affordable prices natively (no
// downstream scale-down; quoteAsset scale is 1).
const TIERS = [
  {
    key: "premium",
    category: "TELCO_5G_QOD",
    capacityMbps: [380, 500],
    baseFee: [0.4, 0.8],
    pricePer100MbpsPerHour: [0.5, 0.7],
    latencyMs: [16, 32],
    packetLossPercent: [0.05, 0.25],
    reliabilityScore: [0.994, 0.9999],
    activationStandardMs: [1800, 3500],
    activationP0Ms: [700, 1400]
  },
  {
    key: "balanced",
    category: "FWA_BURST",
    capacityMbps: [220, 340],
    baseFee: [0.3, 0.7],
    pricePer100MbpsPerHour: [0.5, 0.9],
    latencyMs: [26, 48],
    packetLossPercent: [0.15, 0.5],
    reliabilityScore: [0.992, 0.998],
    activationStandardMs: [2200, 4200],
    activationP0Ms: [1000, 2000]
  },
  {
    key: "budget",
    category: "LEO_SATELLITE",
    capacityMbps: [200, 320],
    baseFee: [0.2, 0.5],
    pricePer100MbpsPerHour: [0.4, 0.7],
    latencyMs: [38, 70],
    packetLossPercent: [0.3, 0.9],
    reliabilityScore: [0.99, 0.994],
    // Satellite occasionally breaches the 5 s activation gate — that is the
    // realistic "quoted but too slow" rejection story, not a dead market.
    activationStandardMs: [3000, 6500],
    activationP0Ms: [1500, 2800]
  }
];

function rngFrom(seed) {
  if (seed === undefined || seed === null || seed === "") {
    return Math.random;
  }
  return rngFromHash(hashSeed(String(seed)));
}

// xmur3 string hash → 32-bit seed for mulberry32 below.
export function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (const ch of text) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function rngFromHash(seedInt) {
  let a = seedInt;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function between(rng, [min, max]) {
  return min + rng() * (max - min);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Rolls a fresh market: { PROVIDER-A, PROVIDER-B, PROVIDER-C } each carrying
// one shuffled tier, a unique brand and rolled characteristics. Provider ids
// are iterated SORTED so every process deriving the same seed gets the same
// tier/brand assignment.
export function rollDynamicProviders(baseProfiles, { seed } = {}) {
  const rng = rngFrom(seed);
  const stems = [...BRAND_STEMS];
  const tiers = [...TIERS];

  // Fisher-Yates with the seeded rng so each roll is coherent.
  for (let i = tiers.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }

  const usedBrands = new Set();
  const personas = {};

  const ids = Object.keys(baseProfiles).sort();
  ids.forEach((providerId, index) => {
    const base = baseProfiles[providerId];
    const tier = tiers[index % tiers.length];
    const dress = CATEGORY_DRESS[tier.category];

    // Fixed identity when the slot has one; extra slots (none today) fall
    // back to an unused stem.
    const unusedStems = stems.filter((s) => !usedBrands.has(s));
    const stem =
      SLOT_BRANDS[providerId] ??
      (unusedStems.length > 0 ? pick(rng, unusedStems) : pick(rng, stems));
    usedBrands.add(stem);

    const brand = `${stem} ${dress.suffix}`;
    const trait = pick(rng, TRAITS);
    const capacityMbps = Math.round(between(rng, tier.capacityMbps));

    personas[providerId] = {
      ...base,
      brand,
      category: tier.category,
      description: dress.description
        .replaceAll("{brand}", brand)
        .replaceAll("{trait}", trait),
      agentCard: {
        ...base.agentCard,
        name: `${brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-agent`,
        capabilities: [...dress.capabilities]
      },
      policy: {
        maxCapacityMbps: capacityMbps,
        baseFee: round2(between(rng, tier.baseFee)),
        pricePer100MbpsPerHour: round2(between(rng, tier.pricePer100MbpsPerHour)),
        currency: base.policy.currency
      },
      performance: {
        latencyMs: Math.round(between(rng, tier.latencyMs)),
        packetLossPercent: round2(between(rng, tier.packetLossPercent)),
        reliabilityScore: round2(between(rng, tier.reliabilityScore))
      },
      activation: {
        standard: {
          ...base.activation.standard,
          timeMs: Math.round(between(rng, tier.activationStandardMs))
        },
        p0FastLane: {
          ...base.activation.p0FastLane,
          timeMs: Math.round(between(rng, tier.activationP0Ms))
        }
      }
    };
  });

  return { personas, seed: seed ?? null };
}

function snapshotPath(projectRoot) {
  return path.join(projectRoot, "fixtures", "providers", "dynamic.json");
}

// Writes the rolled market so sibling processes (provider agents + rescue
// agent) quote the same one. Returns the personas it wrote.
export function writeDynamicProviderSnapshot(projectRoot, baseProfilesByFile, { seed } = {}) {
  const { personas, seed: usedSeed } = rollDynamicProviders(baseProfilesByFile, { seed });
  const target = snapshotPath(projectRoot);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({ rolledAt: new Date().toISOString(), seed: usedSeed, personas }, null, 2)
  );

  return personas;
}

// Identity-stable base profiles (static fixtures): providerId, pinned keys,
// endpoints. Per-incident personas overlay everything else on top of these.
export function loadStaticProfiles(projectRoot) {
  return Object.fromEntries(
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
}

// Preferred loader for every entrypoint: use the shared dynamic snapshot if
// it is fresh (same market for all processes), else fall back to the static
// fixtures so single-script startups keep working unchanged.
export function loadProviderProfiles(projectRoot, { seed } = {}) {
  const staticProfiles = Object.fromEntries(
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

  const target = snapshotPath(projectRoot);

  if (existsSync(target)) {
    try {
      const snapshot = JSON.parse(readFileSync(target, "utf8"));

      if (Date.now() - Date.parse(snapshot.rolledAt) < SNAPSHOT_TTL_MS) {
        return { profiles: snapshot.personas, dynamic: true, seed: snapshot.seed };
      }
    } catch {
      // corrupt snapshot → re-roll below
    }
  }

  const { personas, seed: usedSeed } = rollDynamicProviders(staticProfiles, { seed });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({ rolledAt: new Date().toISOString(), seed: usedSeed, personas }, null, 2)
  );

  return { profiles: personas, dynamic: true, seed: usedSeed };
}

export function clearDynamicProviderSnapshot(projectRoot) {
  rmSync(snapshotPath(projectRoot), { force: true });
}

// Per-incident market: the persona roll is seeded by the incidentId, so the
// rescue agent and each provider agent derive the SAME personas for an
// incident independently (no wire change, no shared state), while every new
// incident faces a fresh brand/characteristic spread. Same incident retried
// → same market (matches the offer-cache repeat-safety semantics).
export function derivePersonasForIncident(baseProfiles, incidentId) {
  return rollDynamicProviders(baseProfiles, { seed: `incident:${incidentId}` }).personas;
}

// Extracts just the identity-stable parts of a persona (used to overlay the
// per-incident persona onto a base profile without touching pinned fields).
export function personaOverlay(persona) {
  return {
    brand: persona.brand,
    category: persona.category,
    description: persona.description,
    agentCardName: persona.agentCard.name,
    agentCardCapabilities: persona.agentCard.capabilities,
    policy: persona.policy,
    performance: persona.performance,
    activation: persona.activation
  };
}
