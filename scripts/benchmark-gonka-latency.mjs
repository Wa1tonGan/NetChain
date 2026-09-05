// Benchmark 3-model parallel latency and consensus ranking against Gonka Router
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankWithConsensus, parseConfig } from "../src/a2a/gonkaRanker.js";

const config = parseConfig();

if (!config.apiKey) {
  console.error("Missing GONKA_API_KEY in environment");
  process.exit(1);
}

console.log(`=== Gonka Router Multi-Model Latency Benchmark ===`);
console.log(`Base URL    : ${config.baseUrl}`);
console.log(`Models      : ${config.models.join(", ")}`);
console.log(`Max Tokens  : ${config.maxTokens}`);
console.log(`Budget (ms) : ${config.budgetMs}\n`);

const offerA = JSON.parse(readFileSync("fixtures/offers/s2-provider-a-offer.json", "utf8"));
const offerB = JSON.parse(readFileSync("fixtures/offers/s2-provider-b-offer.json", "utf8"));

const viableArrivals = [
  { offer: offerA, receivedAtMs: 100 },
  { offer: offerB, receivedAtMs: 200 }
];

const request = {
  requestedCapacityMbps: 200,
  requiredProfile: { maxLatencyMs: 80, maxPacketLossPercent: 2, minReliability: 0.99 },
  maxBudget: 5,
  targetActivationTimeMs: 5000,
  durationMinutes: 60,
  emergencyOverride: false
};

// 1. Run live rankWithConsensus with timing diagnostics
console.log("1. Running rankWithConsensus with real S2 viable offers...");
const logs = [];
const logger = (level, msg) => {
  logs.push({ level, msg });
  console.log(`  [${level}] ${msg}`);
};

const t0 = Date.now();
const consensus = await rankWithConsensus(viableArrivals, request, { logger });
const wallMs = Date.now() - t0;

console.log(`\nConsensus result in ${(wallMs / 1000).toFixed(2)}s (${wallMs}ms):`);
console.log(JSON.stringify(consensus, null, 2));

assert.ok(consensus !== null, "rankWithConsensus must return a valid consensus object");
assert.ok(Array.isArray(consensus.ranking) && consensus.ranking.length > 0, "Consensus must have a valid ranking");
assert.ok(Array.isArray(consensus.votes) && consensus.votes.length > 0, "Consensus must include model votes");
assert.ok(wallMs <= config.budgetMs + 500, `Total consensus wall time ${wallMs}ms exceeded budget ${config.budgetMs}ms`);

console.log("\n-> Consensus ranking assertion PASSED!\n");

// 2. Direct parallel model query benchmark
console.log("2. Running direct parallel 3-model latency benchmark (8.0s timeout)...");

const prompt = {
  system:
    "You rank connectivity recovery offers for a resilience exchange. " +
    "All offers are already viable. Rank them best-first balancing " +
    "activation speed, price and reliability. Be direct and concise: keep " +
    "internal reasoning under 2 sentences. Answer with ONLY a JSON " +
    'object of the form {"ranking":["<providerId>", ...]} using exactly ' +
    "the given providerIds, no prose.",
  user: JSON.stringify({
    offers: [
      { providerId: offerA.providerId, price: offerA.price, capacityMbps: offerA.capacityMbps, expectedActivationTimeMs: offerA.expectedActivationTimeMs, reliabilityScore: offerA.reliabilityScore },
      { providerId: offerB.providerId, price: offerB.price, capacityMbps: offerB.capacityMbps, expectedActivationTimeMs: offerB.expectedActivationTimeMs, reliabilityScore: offerB.reliabilityScore }
    ]
  })
};

const t1 = Date.now();
const modelResults = await Promise.all(
  config.models.map(async (model) => {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
          temperature: 0,
          max_tokens: config.maxTokens
        }),
        signal: controller.signal
      });
      const durMs = Date.now() - start;
      const body = await res.json();
      return { model, status: res.status, durMs, body, timedOut: false };
    } catch (err) {
      const durMs = Date.now() - start;
      return { model, status: 0, durMs, error: err.name, timedOut: true };
    } finally {
      clearTimeout(timeout);
    }
  })
);

const parallelWallMs = Date.now() - t1;
console.log(`\n=== 3-Model Parallel Benchmark Summary (Total: ${(parallelWallMs / 1000).toFixed(2)}s) ===\n`);

let successfulResponses = 0;

for (const r of modelResults) {
  const choice = r.body?.choices?.[0];
  const finishReason = choice?.finish_reason ?? (r.timedOut ? "timeout" : "error");
  const content = choice?.message?.content ?? "";
  const tokens = r.body?.usage?.completion_tokens ?? 0;

  console.log(`Model: ${r.model}`);
  console.log(`  - HTTP Status   : ${r.status}`);
  console.log(`  - Latency       : ${(r.durMs / 1000).toFixed(2)}s (${r.durMs}ms)`);
  console.log(`  - Finish Reason : ${finishReason}`);
  console.log(`  - Tokens        : ${tokens}`);
  if (content) {
    console.log(`  - Content Preview: ${content.replace(/\n/g, " ").slice(0, 120)}...`);
  }
  console.log();

  if (r.status === 200) {
    successfulResponses++;
  }
}

assert.ok(successfulResponses > 0, "At least one model must return HTTP 200 within budget");
assert.ok(parallelWallMs <= 8500, `Parallel benchmark wall time ${(parallelWallMs / 1000).toFixed(2)}s exceeded 8.0s threshold`);

console.log(`\nALL BENCHMARKS COMPLETED SUCCESSFULLY!`);
