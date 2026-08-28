import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assignPriority,
  orderServicesByPriority
} from "../src/policy/priorityController.js";
import { calculateRecoveryRequirements } from "../src/watcher/recoveryCalculations.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

async function loadScenario(fileName) {
  const contents = await readFile(
    path.join(projectRoot, "scenarios", fileName),
    "utf8"
  );

  return JSON.parse(contents);
}

const calculationCases = [
  ["s2-primary-down-backup-insufficient.json", 0],
  ["s3-high-latency.json", 0],
  ["s4-packet-loss.json", 0],
  ["s5-demand-surge.json", 150],
  ["s7-disaster.json", 0]
];

for (const [fileName, trafficReductionMbps] of calculationCases) {
  test(`${fileName} is produced by the watcher capacity calculation`, async () => {
    const scenario = await loadScenario(fileName);
    const calculated = calculateRecoveryRequirements({
      rawAvailableCapacityMbps:
        scenario.networkState.rawAvailableCapacityMbps,
      usableCapacityMbps: scenario.networkState.usableCapacityMbps,
      requiredCapacityMbps: scenario.networkState.requiredCapacityMbps,
      trafficReductionMbps
    });

    assert.deepEqual(calculated, {
      grossShortfallMbps: scenario.networkState.grossShortfallMbps,
      shortfallAfterTrafficProtectionMbps:
        scenario.networkState.shortfallAfterTrafficProtectionMbps,
      additionalCapacityNeededMbps:
        scenario.requirements.additionalCapacityNeededMbps,
      recoveryCapacityNeededMbps:
        scenario.requirements.recoveryCapacityNeededMbps
    });
  });
}

test("priority controller always places P0 ahead of paid tiers", async () => {
  const scenario = await loadScenario("s8-individual-priority-queue.json");
  const priority = assignPriority({
    detectedConditions: scenario.detectedConditions,
    affectedServices: scenario.affectedServices,
    commercialPriority: "P1"
  });
  const orderedServiceIds = orderServicesByPriority(
    scenario.affectedServices
  ).map((service) => service.serviceId);

  assert.deepEqual(priority, { level: "P0", emergencyOverride: true });
  assert.deepEqual(orderedServiceIds, [
    "P0_EMERGENCY",
    "VVIP_USER",
    "VIP_USER",
    "NORMAL_USER"
  ]);
});

test("commercial priority remains VVIP over VIP over Normal without P0", () => {
  const services = [
    { serviceId: "NORMAL_USER", priority: "P3" },
    { serviceId: "VIP_USER", priority: "P2" },
    { serviceId: "VVIP_USER", priority: "P1" }
  ];

  assert.deepEqual(
    orderServicesByPriority(services).map((service) => service.serviceId),
    ["VVIP_USER", "VIP_USER", "NORMAL_USER"]
  );
  assert.deepEqual(assignPriority({ affectedServices: services }), {
    level: "P1",
    emergencyOverride: false
  });
});
