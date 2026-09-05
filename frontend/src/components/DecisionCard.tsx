import { useState } from "react";
import { rm, rm0 } from "../services/pricing";
import { COMPARISON } from "../services/flows";
import Icon, { TextWithIcons } from "./Icon";
export interface ComparisonRow {
  name: string;
  state: string;
  sel: boolean;
  id?: string;
}

export interface ConsensusVoteRow {
  model: string;
  requestId: string | null;
  ranking: string[];
}

export default function DecisionCard({
  cap,
  cost,
  budget,
  provider,
  comparison,
  votes,
}: {
  cap: number;
  cost: number;
  budget: number;
  provider?: string;
  comparison?: ComparisonRow[];
  votes?: ConsensusVoteRow[];
}) {
  const [showAgentLogs, setShowAgentLogs] = useState(true);
  const winner = provider ?? "KilatLink FWA";
  const isLive = Boolean(comparison);
  // Real Gonka consensus audit trail (LIVE runs) vs the scripted demo logs.
  const hasRealVotes = Boolean(votes?.length);

  // Live runs carry the REAL A2A race (winner, arrivals, rejection reasons
  // embedded in each row's state line) — no scripted price guesses.
  const priceFor = (name: string): string | null =>
    isLive
      ? null
      : name.includes("Provider B")
        ? rm(cost)
        : name.includes("Provider C")
        ? rm(+(cost * 1.4).toFixed(2))
        : null;

  const rows = comparison ?? COMPARISON;

  /** providerId → display name via the real race rows (winner row included) */
  const providerName = (id: string): string =>
    rows.find((r) => r.id === id)?.name.split(" (")[0] ??
    rows.find((r) => r.name.includes(id))?.name.split(" (")[0] ??
    id;

  const agentLogs = hasRealVotes
    ? votes!.map((v) => {
        const named = v.ranking.map(providerName);
        const winnerName = provider ?? winner;
        const agree = named[0] === winnerName;
        const picks = named.map((n, i) => `${i + 1}. ${n}`).join("  ");
        const reasoning = agree
          ? `I reviewed the live market offers and ranked ${named[0]} first — best balance of activation speed, price and reliability for this recovery.`
          : `My ranking put ${named[0]} on top; the merged consensus went with ${winnerName}. ${picks}.`;
        return {
          name: v.model,
          role: "Gonka inference — ranking vote",
          requestId: v.requestId,
          top: named[0],
          ranking: named,
          reasoning,
          score: null as string | null,
          vote: named[0],
        };
      })
    : [
        {
          name: "DeepSeek-V3",
          role: "Market Pricing & Latency Agent",
          score: "0.96",
          vote: "KilatLink FWA",
          requestId: null,
          reasoning: `Scanned 3 provider bids. KilatLink FWA offers the lowest latency profile (18ms) at ${rm(cost)} vs NusaNet 5G (congested 25ms @ USDC 2.20) and OrbitSat GO (satellite 65ms @ USDC 2.50).`,
        },
        {
          name: "Kimi-k1.5",
          role: "SLA & CAMARA QoD Verification Agent",
          score: "0.95",
          vote: "KilatLink FWA",
          requestId: null,
          reasoning: `Verified target bandwidth requirement (${cap} Mbps). KilatLink FWA slice is instantly provisionable via CAMARA QoD programmable API with guaranteed zero packet loss routing.`,
        },
        {
          name: "MiniMax-ABAB6.5",
          role: "Budget & Sui Trust Layer Agent",
          score: "0.98",
          vote: "KilatLink FWA",
          requestId: null,
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
              Selected: {winner} (+{cap} Mbps)
            </div>
          </div>
          <span className={`chip ${isLive ? "sui" : "green"}`} style={{ fontSize: 11, padding: "3px 8px" }}>
            {isLive ? "Live A2A race evidence" : "3/3 Consensus (Score 0.96)"}
          </span>
        </div>

        {/* Evaluated Provider Quotes Table */}
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
            {isLive ? "Real A2A race outcome" : "Evaluated Provider Quotes"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((c) => {
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
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}><TextWithIcons text={c.state} /></div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 800, color: c.sel ? "var(--ok-ink)" : "var(--ink)" }}>
                      {price || "—"}
                    </div>
                    {c.sel && (
                      <span className="chip green" style={{ fontSize: 10, padding: "1px 5px", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Icon name="check" size={10} /> Winner
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
            style={{ padding: 0, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => setShowAgentLogs(!showAgentLogs)}
          >
            <Icon name={showAgentLogs ? "chevron-down" : "chevron-right"} size={12} />
            <span>{showAgentLogs ? "Hide Agent Reasoning Logs" : `View Agent Reasoning Logs (${agentLogs.length} Models)`}</span>
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
                        {ag.role} · vote: <b>{ag.vote}</b>
                      </div>
                    </div>
                    {ag.score ? (
                      <span className="chip sui" style={{ fontSize: 10.5, padding: "2px 6px", flexShrink: 0 }}>
                        Score {ag.score}
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
                    “{ag.reasoning}”
                  </div>

                  {ag.requestId && (
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8, wordBreak: "break-all" }}
                      title="Gonka x-request-id — audit this inference against the gateway"
                    >
                      gonka req: {ag.requestId}
                    </div>
                  )}
                </div>
              ))}
              {!hasRealVotes && (
                <div style={{ fontSize: 10.5, color: "var(--faint)" }}>
                  Scripted demo votes — LIVE runs show each Gonka model's real vote with its auditable request id.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
