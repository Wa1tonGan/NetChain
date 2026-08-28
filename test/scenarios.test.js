import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  priorityValues,
  validateRecoveryIntent
} from "../src/schemas/recoveryIntent.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const scenariosDirectory = path.join(projectRoot, "scenarios");
const scenarioFileNames = (await readdir(scenariosDirectory))
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();

async function loadScenario(fileName) {
  const contents = await readFile(
    path.join(scenariosDirectory, fileName),
    "utf8"
  );

  return JSON.parse(contents);
}

function containsProviderSelectionField(value) {
  if (Array.isArray(value)) {
    return value.some(containsProviderSelectionField);
  }

  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase();
    const selectsProvider =
      normalizedKey === "providerid" ||
      normalizedKey === "preferredprovider" ||
      normalizedKey === "selectedprovider" ||
      normalizedKey === "providerselection";

    return selectsProvider || containsProviderSelectionField(nestedValue);
  });
}

test("all nine scenario fixtures conform to the RecoveryIntent contract", async () => {
  assert.equal(scenarioFileNames.length, 9);

  for (const fileName of scenarioFileNames) {
    const scenario = await loadScenario(fileName);
    assert.doesNotThrow(
      () => validateRecoveryIntent(scenario),
      `${fileName} must satisfy the RecoveryIntent schema`
    );
  }
});

test("fixtures contain facts and requirements, never provider selection", async () => {
  for (const fileName of scenarioFileNames) {
    const scenario = await loadScenario(fileName);
    assert.equal(
      containsProviderSelectionField(scenario),
      false,
      `${fileName} must not select a provider`
    );
  }
});

test("S0 is healthy and requires no action", async () => {
  const scenario = await loadScenario("s0-normal.json");
  assert.deepEqual(scenario.detectedConditions, []);
  assert.equal(scenario.trigger.severity, "info");
  assert.equal(scenario.recoveryDecision, "NO_EXTERNAL_RECOVERY_NEEDED");
  assert.equal(scenario.requestedAction, "NO_ACTION");
});

test("S1 retains the link failure even though backup capacity is sufficient", async () => {
  const scenario = await loadScenario(
    "s1-primary-down-backup-sufficient.json"
  );
  assert.deepEqual(scenario.detectedConditions, ["LINK_FAILURE"]);
  assert.deepEqual(scenario.networkState.activeLinkIds, ["WAN-B"]);
  assert.deepEqual(scenario.networkState.unavailableLinkIds, ["WAN-A"]);
  assert.equal(scenario.recoveryDecision, "NO_EXTERNAL_RECOVERY_NEEDED");
});

test("S2 exposes the 200 Mbps shortfall and affected services", async () => {
  const scenario = await loadScenario(
    "s2-primary-down-backup-insufficient.json"
  );
  assert.deepEqual(scenario.detectedConditions, [
    "LINK_FAILURE",
    "CAPACITY_SHORTFALL"
  ]);
  assert.equal(scenario.networkState.grossShortfallMbps, 200);
  assert.equal(scenario.networkState.shortfallAfterTrafficProtectionMbps, 200);
  assert.equal(scenario.requirements.recoveryCapacityNeededMbps, 200);
  assert.equal(
    scenario.affectedServices.reduce(
      (total, service) => total + service.deficitMbps,
      0
    ),
    200
  );
});

test("S3 distinguishes raw capacity from latency-valid recovery capacity", async () => {
  const scenario = await loadScenario("s3-high-latency.json");
  assert.equal(scenario.networkState.rawAvailableCapacityMbps, 1000);
  assert.equal(scenario.networkState.usableCapacityMbps, 0);
  assert.equal(scenario.requirements.additionalCapacityNeededMbps, 0);
  assert.equal(scenario.requirements.recoveryCapacityNeededMbps, 300);
  assert.equal(scenario.requestedAction, "FIND_LOWER_LATENCY_PATH");
});

test("S4 specifies packet-loss constraints and traffic to reroute", async () => {
  const scenario = await loadScenario("s4-packet-loss.json");
  assert.equal(scenario.requirements.maximumPacketLossPercent, 2);
  assert.equal(scenario.requirements.recoveryCapacityNeededMbps, 400);
  assert.equal(scenario.requestedAction, "FIND_LOWER_PACKET_LOSS_PATH");
});

test("S5 protects traffic before requesting burst capacity", async () => {
  const scenario = await loadScenario("s5-demand-surge.json");
  assert.equal(scenario.networkState.grossShortfallMbps, 350);
  assert.equal(scenario.networkState.shortfallAfterTrafficProtectionMbps, 200);
  assert.equal(scenario.requirements.additionalCapacityNeededMbps, 200);
  assert.equal(scenario.requestedAction, "ACQUIRE_BURST_CAPACITY");
});

test("S6 protects P0 medical traffic without unnecessary purchasing", async () => {
  const scenario = await loadScenario("s6-medical-emergency.json");
  assert.equal(scenario.priority.level, "P0");
  assert.equal(scenario.priority.emergencyOverride, true);
  assert.equal(scenario.recoveryDecision, "NO_EXTERNAL_RECOVERY_NEEDED");
  assert.equal(scenario.requestedAction, "PROTECT_EXISTING_CAPACITY");
});

test("S7 rejects the degraded backup for P0 service requirements", async () => {
  const scenario = await loadScenario("s7-disaster.json");
  assert.equal(scenario.networkState.rawAvailableCapacityMbps, 120);
  assert.equal(scenario.networkState.usableCapacityMbps, 0);
  assert.equal(scenario.networkState.grossShortfallMbps, 180);
  assert.equal(scenario.networkState.shortfallAfterTrafficProtectionMbps, 300);
  assert.equal(scenario.requirements.additionalCapacityNeededMbps, 180);
  assert.equal(scenario.requirements.recoveryCapacityNeededMbps, 300);
});

test("S8 always orders P0 ahead of VVIP, VIP, and Normal", async () => {
  const scenario = await loadScenario("s8-individual-priority-queue.json");
  const serviceOrder = scenario.affectedServices.map(
    (service) => service.serviceId
  );
  const priorityOrder = scenario.affectedServices.map((service) =>
    priorityValues.indexOf(service.priority)
  );

  assert.deepEqual(serviceOrder, [
    "P0_EMERGENCY",
    "VVIP_USER",
    "VIP_USER",
    "NORMAL_USER"
  ]);
  assert.deepEqual(priorityOrder, [0, 1, 2, 3]);
  assert.equal(scenario.priority.emergencyOverride, true);
});
