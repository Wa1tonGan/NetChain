// Time-to-Recovery instrumentation (blueprint §6.1 / Person 3 M4–M5).
// Aggregates per-incident KPIs from the Selected Offer's timing block
// (t_detect, t_decide) plus the runtime's activation events (t_activate,
// t_recover), and renders the reliability report (JSON + markdown).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const STATUS_ORDER = ["COMMITTED", "SETTLED", "REFUNDED", "RECLAIMED"];

/**
 * @param {object} selectedOffer - Selected Offer fixture (timing: tDetect/tDecide)
 * @param {object} runtimeTiming - { tActivateMs?, tRecoverMs?, outcome? }
 *   stamped by the harness/service when activation and verification complete.
 */
export function incidentKpis(selectedOffer, runtimeTiming = {}) {
  const { tDetect, tDecide } = selectedOffer.timing;
  const tDetectMs = tDetect;
  const tDecideMs = runtimeTiming.tDecideMs ?? tDecide;
  const tActivateMs = runtimeTiming.tActivateMs ?? null;
  const tRecoverMs = runtimeTiming.tRecoverMs ?? null;
  return {
    incidentId: selectedOffer.incidentId,
    selectionMode: selectedOffer.selectionMode,
    provider: selectedOffer.selectedProvider.providerId,
    amount: selectedOffer.agreement.amount,
    currency: selectedOffer.agreement.currency,
    outcome: runtimeTiming.outcome ?? "INCOMPLETE",
    timeToDetect: 0, // reference point
    timeToDecisionMs: tDecideMs - tDetectMs,
    timeToActivationMs: tActivateMs === null ? null : tActivateMs - tDetectMs,
    timeToRecoveryMs: tRecoverMs === null ? null : tRecoverMs - tDetectMs
  };
}

/** Aggregate a harness battery into the blueprint §6.1 KPI summary. */
export function summarize(results) {
  const incidents = results.filter((r) => r.kind === "INCIDENT");
  const checks = results.filter((r) => r.kind === "CHECK");
  const completed = incidents.filter((i) => i.kpis.timeToRecoveryMs !== null);
  const successful = incidents.filter((i) => i.kpis.outcome === "RECOVERED");
  const ttrs = completed.map((i) => i.kpis.timeToRecoveryMs);
  const duplicateAttempts = checks.filter((c) => c.name.includes("duplicate"));
  return {
    generatedAt: new Date().toISOString(),
    incidentsTotal: incidents.length,
    recoveriesSuccessful: successful.length,
    recoverySuccessRate: incidents.length ? successful.length / incidents.length : 0,
    timeToRecovery: ttrs.length
      ? { minMs: Math.min(...ttrs), maxMs: Math.max(...ttrs), avgMs: Math.round(ttrs.reduce((a, b) => a + b, 0) / ttrs.length) }
      : null,
    duplicateSafety: {
      duplicateAttempts: duplicateAttempts.length,
      allBlocked: duplicateAttempts.every((c) => c.passed)
    },
    checks: checks.map((c) => ({ name: c.name, passed: c.passed, detail: c.detail ?? null }))
  };
}

export function renderMarkdown(summary) {
  const lines = [
    "# NetChain Reliability Report (Person 3)",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "| KPI | Value |",
    "| --- | --- |",
    `| Incidents run | ${summary.incidentsTotal} |`,
    `| Recovery success rate | ${(summary.recoverySuccessRate * 100).toFixed(0)}% |`,
    `| End-to-end Time-to-Recovery | ${summary.timeToRecovery ? `${summary.timeToRecovery.minMs}–${summary.timeToRecovery.maxMs} ms (avg ${summary.timeToRecovery.avgMs})` : "n/a"} |`,
    `| Duplicate-safety | ${summary.duplicateSafety.allBlocked ? "all duplicate attempts blocked" : "FAILURE — see checks"} |`,
    "",
    "## Checks",
    "",
    ...summary.checks.map((c) => `- [${c.passed ? "x" : " "}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
    ""
  ];
  return lines.join("\n");
}

export function writeReport(summary, outDir = "events") {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "reliability-report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(outDir, "reliability-report.md"), renderMarkdown(summary));
  return {
    json: path.join(outDir, "reliability-report.json"),
    md: path.join(outDir, "reliability-report.md")
  };
}
