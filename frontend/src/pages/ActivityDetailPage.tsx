import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { fmtDate } from "../services/format";
import { rm } from "../services/pricing";
import SlaLineChart from "../components/SlaLineChart";
import DecisionCard from "../components/DecisionCard";

export default function ActivityDetailPage() {
  const { id } = useParams();
  const s = useAppStore();
  const a = s.activity.find((x) => x.id === id);
  const r = id ? s.records[id] : undefined;
  const [showDisc, setShowDisc] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!a || !r) {
    return (
      <div className="card">
        <div className="pad">Record not found.</div>
      </div>
    );
  }

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderCopyButton = (text: string, key: string) => {
    const isCopied = copiedKey === key;
    return (
      <button
        className="btn subtle sm"
        style={{
          width: 30,
          height: 30,
          padding: 0,
          flexShrink: 0,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: isCopied ? "var(--ok)" : "var(--muted)",
          transition: "all 0.15s ease",
        }}
        onClick={() => copyToClipboard(text, key)}
        title={isCopied ? "Copied to clipboard!" : "Copy address"}
        aria-label="Copy address"
      >
        {isCopied ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    );
  };

  const chip =
    r.outcome === "failed" ? (
      <span className="chip red">
        <span className="dot" />
        FAILED · REFUNDED
      </span>
    ) : r.outcome === "under" ? (
      <span className="chip amber">
        <span className="dot" />
        RECOVERED · PENALTY REFUND
      </span>
    ) : (
      <span className="chip green">
        <span className="dot" />
        RECOVERED & SETTLED
      </span>
    );

  const capCharge = Math.max(0, +(r.charged - r.fee).toFixed(2));

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <Link
        to="/activity"
        className="btn link"
        style={{ marginTop: 8, paddingLeft: 0, textDecoration: "none" }}
      >
        ← Back to Activity Ledger
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Recovery Incident #{r.id}</h1>
        {chip}
      </div>

      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
        {fmtDate(a.ts)} · {a.sub}
      </div>

      {/* Real-Time Line Graph & SLA Strength Tracker */}
      {r.outcome !== "failed" && (
        <div style={{ marginTop: 16 }}>
          <SlaLineChart durationMin={r.min} agreedMbps={r.cap} outcome={r.outcome} />
        </div>
      )}

      <div className="cols" style={{ marginTop: 16 }}>
        <div>
          {/* Incident Timeline */}
          <div className="card">
            <div className="pad">
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                Execution Timeline & Sui Events
              </div>
              {r.timeline.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "8px 0",
                    marginTop: i === 0 ? 8 : 4,
                    borderTop: i === 0 ? "none" : "1px solid var(--line-soft)",
                    alignItems: "center",
                  }}
                >
                  <span className="tl-time">{e.time.slice(0, 8)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key Metric Gauges */}
          <div className="result-grid" style={{ marginTop: 14 }}>
            <div className="rg">
              <div className="rk">Time-to-Recovery</div>
              <div className="rv ok">{r.time} sec</div>
            </div>
            <div className="rg">
              <div className="rk">{r.restored ? "Capacity Added" : "Capacity"}</div>
              <div className={`rv ${r.restored ? "ok" : ""}`}>{r.restored ? `+${r.cap} Mbps` : "—"}</div>
            </div>
            <div className="rg">
              <div className="rk">Total Settled</div>
              <div className="rv">
                {rm(r.charged)}
                {r.refund > 0 && r.outcome !== "failed" && (
                  <div style={{ fontSize: 11.5, color: "var(--warn)", fontWeight: 700 }}>
                    {rm(r.refund)} penalty refunded
                  </div>
                )}
              </div>
            </div>
            <div className="rg">
              <div className="rk">Selected Provider</div>
              <div className="rv" style={{ fontSize: 13.5 }}>
                {r.provider}
              </div>
            </div>
          </div>
        </div>

        <div>
          {/* Split Settlement Card with FIXED Cryptographic Proofs */}
          <div className="card">
            <div className="pad">
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                Sui Escrow Split Settlement
              </div>
              <div className="stat-line" style={{ padding: "10px 0" }}>
                <span className="k">Provider Amount</span>
                <span className="v">{rm(capCharge)}</span>
              </div>
              <div className="stat-line" style={{ padding: "10px 0" }}>
                <span className="k">Platform Fee (5%)</span>
                <span className="v">{rm(r.fee)}</span>
              </div>
              {r.refund > 0 && (
                <div className="stat-line" style={{ padding: "10px 0" }}>
                  <span className="k">Penalty Refunded</span>
                  <span className="v ok">− {rm(r.refund)}</span>
                </div>
              )}
              <div className="stat-line" style={{ padding: "10px 0" }}>
                <span className="k">Final Charged</span>
                <span className="v" style={{ fontWeight: 800 }}>
                  {rm(r.charged)}
                </span>
              </div>
              <div className="stat-line" style={{ padding: "10px 0" }}>
                <span className="k">Escrow State</span>
                <span className={`v ${r.outcome === "failed" ? "warnv" : "ok"}`}>{r.state}</span>
              </div>

              {/* Cryptographic Proofs Toggle */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}>
                <button
                  className="btn link"
                  style={{ padding: 0, fontSize: 12.5 }}
                  onClick={() => setShowDisc(!showDisc)}
                >
                  {showDisc ? "▼ Hide Cryptographic Proofs" : "▶ View Cryptographic Proofs"}
                </button>

                {showDisc && (
                  <div className="tech-box">
                    <div className="tech-item">
                      <span className="tk">Provider Sui Address</span>
                      <div className="tv">
                        <span>{r.providerAddr ?? "0x3b91a78824f923b01a88b1cc92487e419823ad760334"}</span>
                        {renderCopyButton(
                          r.providerAddr ?? "0x3b91a78824f923b01a88b1cc92487e419823ad760334",
                          "prov"
                        )}
                      </div>
                    </div>

                    <div className="tech-item">
                      <span className="tk">Platform Fee Recipient Address</span>
                      <div className="tv">
                        <span>{r.platformAddr ?? "0x71f3a9b2c44e5d16820ccb7713a2ff0e999a82c5512"}</span>
                        {renderCopyButton(
                          r.platformAddr ?? "0x71f3a9b2c44e5d16820ccb7713a2ff0e999a82c5512",
                          "plat"
                        )}
                      </div>
                    </div>

                    <div className="tech-item">
                      <span className="tk">Audit Log Hash (SHA-256)</span>
                      <div className="tv">
                        <span>{r.logHash ?? "0xab7999ade1e738c291884bb01"}</span>
                        {renderCopyButton(
                          r.logHash ?? "0xab7999ade1e738c291884bb01",
                          "hash"
                        )}
                      </div>
                    </div>

                    <div className="tech-item">
                      <span className="tk">Sui Transaction</span>
                      <div className="tv">
                        <a
                          className="txlink"
                          href="https://suiscan.xyz/testnet"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {r.tx} ↗ SuiScan
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Gonka Multi-Agent Consensus Decision Log */}
          {r.outcome !== "failed" && <DecisionCard cap={r.cap} cost={r.cost} budget={r.budget} />}
        </div>
      </div>
    </div>
  );
}
