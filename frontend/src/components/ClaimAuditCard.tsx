import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import type { ClaimAudit } from "../services/live";

/** Truth Agent SLA audit — multi-model consensus verification styled consistently with DecisionCard. */
export default function ClaimAuditCard({ audit }: { audit: ClaimAudit }) {
  const [showReasoningLogs, setShowReasoningLogs] = useState(true);
  const completed = audit.status === "COMPLETED";

  const models = audit.models ?? [];
  const modelCount = models.length;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="pad">
        {/* Card Header: Kicker + Title + Status Chip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>
              Truth Agent SLA Audit Engine
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
              {completed
                ? `SLA Verdict: ${audit.verdict ?? "VERIFIED"} (Truth Score ${audit.score ?? "?"}/100)`
                : `SLA Audit: ${audit.status}`}
            </div>
          </div>
          <span className={`chip ${completed ? "sui" : "amber"}`} style={{ fontSize: 11, padding: "3px 8px" }}>
            {completed
              ? audit.agree
                ? `${audit.agree} Consensus`
                : `${modelCount}/${modelCount} Consensus`
              : `Status: ${audit.status}`}
          </span>
        </div>

        {!completed && audit.error && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "var(--bg)",
              border: "1px solid var(--line-soft)",
              borderRadius: 8,
              fontSize: 11.5,
              color: "var(--muted)",
              wordBreak: "break-all",
            }}
          >
            Audit unavailable: {audit.error}
          </div>
        )}

        {/* Section 1: Evaluated Model Verdicts Table / List */}
        {completed && models.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              Independent Model SLA Evaluations
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {models.map((m) => {
                const isPositive = m.verdict === "TRUE" || m.verdict === "PARTLY_TRUE";
                return (
                  <div
                    key={m.model}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 10px",
                      background: "var(--bg)",
                      borderRadius: 8,
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                        {m.model}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        Verdict: <b style={{ color: isPositive ? "var(--ok-ink)" : "var(--muted)" }}>{m.ok ? m.verdict : "FAILED"}</b>
                        {m.score != null ? ` · Score ${m.score}/100` : ""}
                        {audit.confidenceBand ? ` · Band ${audit.confidenceBand[0]}–${audit.confidenceBand[1]}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontWeight: 800, color: isPositive ? "var(--ok-ink)" : "var(--ink)" }}>
                        {m.score != null ? `${m.score}` : "—"}
                      </div>
                      {m.ok ? (
                        <span className="chip green" style={{ fontSize: 10, padding: "1px 5px", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Icon name="check" size={10} /> Verified
                        </span>
                      ) : (
                        <span className="chip amber" style={{ fontSize: 10, padding: "1px 5px", marginTop: 2 }}>
                          Failed
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: Model Decision Reasoning Logs */}
        {completed && models.some((m) => m.reasoning) && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
            <button
              className="btn link"
              style={{ padding: 0, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => setShowReasoningLogs(!showReasoningLogs)}
            >
              <Icon name={showReasoningLogs ? "chevron-down" : "chevron-right"} size={12} />
              <span>
                {showReasoningLogs
                  ? "Hide Model Reasoning Logs"
                  : `View Model Reasoning Logs (${modelCount} Models)`}
              </span>
            </button>

            {showReasoningLogs && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {models.map((m) =>
                  m.ok && m.reasoning ? (
                    <div
                      key={m.model}
                      style={{
                        background: "var(--bg)",
                        border: "1px solid var(--line-soft)",
                        borderRadius: 10,
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 13, color: "var(--ink)" }}>
                            {m.model}
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            Gonka inference — SLA cross-verification · verdict: <b>{m.verdict}</b>
                          </div>
                        </div>
                        {m.score != null ? (
                          <span className="chip sui" style={{ fontSize: 10.5, padding: "2px 6px", flexShrink: 0 }}>
                            Score {m.score}
                          </span>
                        ) : (
                          <span className="chip good" style={{ fontSize: 10.5, padding: "2px 6px", flexShrink: 0 }}>
                            auditable
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: 12.5,
                          color: "#334155",
                          lineHeight: 1.5,
                          borderLeft: "3px solid var(--accent)",
                          paddingLeft: 10,
                          marginTop: 6,
                          fontStyle: "italic",
                        }}
                      >
                        “{m.reasoning}”
                      </div>

                      {m.requestId && (
                        <div
                          className="mono"
                          style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8, wordBreak: "break-all" }}
                          title="Gonka x-request-id — audit this inference against the gateway"
                        >
                          gonka req: {m.requestId}
                        </div>
                      )}
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer Deep Link */}
        {audit.claimRunId && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 10,
              borderTop: "1px solid var(--line-soft)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              fontSize: 11,
              color: "var(--faint)",
            }}
          >
            <span className="mono">
              run {audit.claimRunId}
              {typeof audit.durationMs === "number" ? ` · ${(audit.durationMs / 1000).toFixed(1)}s` : ""}
            </span>
            <Link
              to={`/truth?run=${audit.claimRunId}`}
              style={{
                color: "var(--muted)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontWeight: 600,
              }}
            >
              <span>View full trace on Truth Agent page</span>
              <span>→</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
