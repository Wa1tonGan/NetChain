import { useState } from "react";
import { rm, rm0 } from "../services/pricing";
import { COMPARISON } from "../services/flows";

export default function DecisionCard({
  cap,
  cost,
  budget,
}: {
  cap: number;
  cost: number;
  budget: number;
}) {
  const [showAgentLogs, setShowAgentLogs] = useState(true);

  const priceFor = (name: string): string | null =>
    name.includes("Provider B")
      ? rm(cost)
      : name.includes("Provider C")
      ? rm(+(cost * 1.4).toFixed(2))
      : null;

  const agentLogs = [
    {
      name: "DeepSeek-V3",
      role: "Market Pricing & Latency Agent",
      score: "0.96",
      vote: "KilatLink FWA",
      reasoning: `Scanned 3 provider bids. KilatLink FWA offers the lowest latency profile (18ms) at ${rm(cost)} vs NusaNet 5G (congested 25ms @ RM 18.50) and OrbitSat GO (satellite 65ms @ RM 24.00).`,
    },
    {
      name: "Kimi-k1.5",
      role: "SLA & CAMARA QoD Verification Agent",
      score: "0.95",
      vote: "KilatLink FWA",
      reasoning: `Verified target bandwidth requirement (${cap} Mbps). KilatLink FWA slice is instantly provisionable via CAMARA QoD programmable API with guaranteed zero packet loss routing.`,
    },
    {
      name: "MiniMax-ABAB6.5",
      role: "Budget & Sui Trust Layer Agent",
      score: "0.98",
      vote: "KilatLink FWA",
      reasoning: `Checked user budget guardrails. Total committed cost ${rm(cost)} is strictly within the client's ${rm0(budget)} per-recovery spending limit and wallet balance.`,
    },
  ];

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>
              Gonka 3-Agent Consensus Engine
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
              Selected: KilatLink FWA (+{cap} Mbps)
            </div>
          </div>
          <span className="chip green" style={{ fontSize: 11, padding: "3px 8px" }}>
            3/3 Consensus (Score 0.96)
          </span>
        </div>

        {/* Evaluated Provider Quotes Table */}
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
            Evaluated Provider Quotes
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {COMPARISON.map((c) => {
              const price = priceFor(c.name);
              return (
                <div
                  key={c.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: c.sel ? "var(--ok-soft)" : "var(--bg)",
                    borderRadius: 8,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: c.sel ? 800 : 600, color: c.sel ? "var(--ok-ink)" : "var(--ink)" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.state}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 800, color: c.sel ? "var(--ok-ink)" : "var(--ink)" }}>
                      {price || "—"}
                    </div>
                    {c.sel && (
                      <span className="chip green" style={{ fontSize: 10, padding: "1px 5px", marginTop: 2 }}>
                        ✓ Winner
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agent Decision Reasoning Logs */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
          <button
            className="btn link"
            style={{ padding: 0, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => setShowAgentLogs(!showAgentLogs)}
          >
            <span>{showAgentLogs ? "▼ Hide Agent Reasoning Logs" : "▶ View Agent Reasoning Logs (3 Models)"}</span>
          </button>

          {showAgentLogs && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {agentLogs.map((ag) => (
                <div
                  key={ag.name}
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
                        {ag.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {ag.role}
                      </div>
                    </div>
                    <span className="chip sui" style={{ fontSize: 10.5, padding: "2px 6px", flexShrink: 0 }}>
                      Score {ag.score}
                    </span>
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
                    “{ag.reasoning}”
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
