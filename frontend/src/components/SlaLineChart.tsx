import { useState } from "react";
import { StrengthBars } from "./RecoveryOverlay";
import Icon from "./Icon";
export interface SlaPoint {
  timeLabel: string;
  minOffset: number;
  mbps: number;
  latencyMs: number;
  packetLoss: number;
  passed: boolean;
}

export function generateSlaPoints(durationMin: number, agreedMbps: number, outcome: string): SlaPoint[] {
  const count = Math.max(6, Math.min(12, Math.round(durationMin / 5) + 1));
  const points: SlaPoint[] = [];

  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1);
    const minOffset = +(ratio * durationMin).toFixed(1);
    const timeLabel = minOffset === 0 ? "Start (00m)" : `${minOffset}m`;

    let mult = 1.0;
    if (outcome === "under") {
      mult = 0.86 + Math.sin(i * 1.5) * 0.03;
    } else {
      mult = 0.98 + ((Math.sin(i * 1.8) + 1) / 2) * 0.04;
      // Pitch specific: Deliberate dips to trigger SLA flags
      if (i === 3) mult = 0.82; // Significant dip at 15m
      if (i === 5) mult = 0.88; // Slight dip at 25m
    }

    const mbps = +(agreedMbps * mult).toFixed(1);
    const passed = mbps >= agreedMbps * 0.95;
    const latencyMs = Math.round((passed ? 17 : 45) + Math.sin(i * 1.2) * 3);
    const packetLoss = outcome === "under" ? 1.8 : passed ? 0.0 : 1.2;

    points.push({
      timeLabel,
      minOffset,
      mbps,
      latencyMs,
      packetLoss,
      passed,
    });
  }

  return points;
}

export default function SlaLineChart({
  durationMin,
  agreedMbps,
  outcome,
}: {
  durationMin: number;
  agreedMbps: number;
  outcome: string;
}) {
  const [points] = useState(() => generateSlaPoints(durationMin, agreedMbps, outcome));
  const [hoveredPoint, setHoveredPoint] = useState<SlaPoint | null>(null);
  const [zoomModalOpen, setZoomModalOpen] = useState(false);

  const avgMbps = +(points.reduce((a, b) => a + b.mbps, 0) / points.length).toFixed(1);
  const compliantCount = points.filter((p) => p.passed).length;
  const compliancePct = Math.round((compliantCount / points.length) * 100);
  const latestPoint = points[points.length - 1];

  // SVG Chart Geometry
  const width = 560;
  const height = 140;
  const paddingX = 36;
  const paddingY = 24;

  const minVal = Math.min(...points.map((p) => p.mbps), agreedMbps * 0.85);
  const maxVal = Math.max(...points.map((p) => p.mbps), agreedMbps * 1.1);

  const getX = (idx: number) => paddingX + (idx / (points.length - 1)) * (width - paddingX * 2);
  const getY = (val: number) => height - paddingY - ((val - minVal) / (maxVal - minVal)) * (height - paddingY * 2);

  // Generate smooth cubic bezier SVG path
  let pathD = `M ${getX(0)} ${getY(points[0].mbps)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const x0 = getX(i);
    const y0 = getY(points[i].mbps);
    const x1 = getX(i + 1);
    const y1 = getY(points[i + 1].mbps);
    const cx = (x0 + x1) / 2;
    pathD += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }

  const areaD = `${pathD} L ${getX(points.length - 1)} ${height - paddingY} L ${getX(0)} ${height - paddingY} Z`;

  const targetY = getY(agreedMbps * 0.95);

  return (
    <div className="sla-track-container" style={{ padding: "20px 22px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Real-Time SLA Throughput & Signal Strength Tracker
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>
              {latestPoint.mbps} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Mbps</span>
            </span>
            <StrengthBars filled={compliancePct >= 95 ? 4 : 2} cls={compliancePct >= 95 ? "" : "strength-2"} />
            <span className={`chip ${compliancePct >= 95 ? "green" : "amber"}`}>
              {compliancePct}% SLA Delivery
            </span>
          </div>
        </div>

        <button className="btn sm subtle" onClick={() => setZoomModalOpen(true)}>
          <Icon name="search" size={14} style={{ marginRight: 6 }} /> Zoom & Inspect Audit
        </button>
      </div>

      {/* SVG Line Graph */}
      <div style={{ position: "relative", marginTop: 14, width: "100%", overflow: "hidden" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <defs>
            <linearGradient id="slaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ok)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--ok)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* SLA Threshold Target Line */}
          <line
            x1={paddingX}
            y1={targetY}
            x2={width - paddingX}
            y2={targetY}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            strokeWidth="1.2"
          />
          <text
            x={width - paddingX - 4}
            y={targetY - 5}
            textAnchor="end"
            fill="#94a3b8"
            fontSize="9.5"
            fontFamily="JetBrains Mono, monospace"
          >
            SLA Target ({Math.round(agreedMbps * 0.95)} Mbps)
          </text>

          {/* Area Fill */}
          <path d={areaD} fill="url(#slaGrad)" />

          {/* Main Curve */}
          <path
            d={pathD}
            fill="none"
            stroke={outcome === "under" ? "var(--warn)" : "var(--ok)"}
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Interactive Checkpoint Dots */}
          {points.map((p, idx) => {
            const cx = getX(idx);
            const cy = getY(p.mbps);
            const isHovered = hoveredPoint?.minOffset === p.minOffset;
            return (
              <g
                key={idx}
                onMouseEnter={() => setHoveredPoint(p)}
                onMouseLeave={() => setHoveredPoint(null)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 6 : 4}
                  fill={p.passed ? "var(--ok)" : "var(--warn)"}
                  stroke="#ffffff"
                  strokeWidth="2"
                  style={{ transition: "all 0.15s ease" }}
                />
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {hoveredPoint && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 14,
              background: "rgba(15, 23, 42, 0.92)",
              color: "#ffffff",
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              boxShadow: "var(--shadow)",
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="clock" size={12} /> {hoveredPoint.timeLabel}: <strong>{hoveredPoint.mbps} Mbps</strong>
            </div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              Latency: {hoveredPoint.latencyMs}ms · {hoveredPoint.passed ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>SLA Pass <Icon name="check" size={11} /></span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Under tolerance <Icon name="warning" size={11} /></span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Metrics */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
        <div className="mono">00m (Start)</div>
        <div style={{ textAlign: "center" }}>
          Average: <strong style={{ color: "var(--ink)" }}>{avgMbps} Mbps</strong> · Latency: <strong style={{ color: "var(--ink)" }}>{latestPoint.latencyMs} ms</strong>
        </div>
        <div className="mono">{durationMin}m (End)</div>
      </div>

      {/* Zoom Modal */}
      {zoomModalOpen && (
        <div className="modal-backdrop" onClick={() => setZoomModalOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-head">
              <h3>SLA Network Strength Audit Inspection</h3>
              <button className="btn link" onClick={() => setZoomModalOpen(false)} aria-label="Close" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
                <Icon name="close" size={16} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
              Granular time-series audit proving delivery of purchased bandwidth over the {durationMin}-minute period.
            </p>

            <div style={{ background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.4 }}>
                <strong style={{ color: "#22c55e" }}>On-Chain Audit Anchored:</strong> This telemetry log is immutably stored on the <strong>Sui Walrus Decentralized Cache</strong> for transparent, trustless SLA settlement.
              </div>
            </div>

            <div className="result-grid" style={{ marginBottom: 20 }}>
              <div className="rg">
                <div className="rk">Committed Bandwidth</div>
                <div className="rv">{agreedMbps} Mbps</div>
              </div>
              <div className="rg">
                <div className="rk">Average Delivered</div>
                <div className="rv ok">{avgMbps} Mbps</div>
              </div>
              <div className="rg">
                <div className="rk">Delivery Compliance</div>
                <div className={`rv ${compliancePct >= 95 ? "ok" : "warn"}`}>{compliancePct}%</div>
              </div>
              <div className="rg">
                <div className="rk">Audit Verdict</div>
                <div className={`rv ${compliancePct >= 95 ? "ok" : "warn"}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {compliancePct >= 95 ? (
                    <>SLA Verified <Icon name="check" size={12} /></>
                  ) : (
                    <>Penalty Refund Triggered <Icon name="warning" size={12} /></>
                  )}
                </div>
              </div>
            </div>

            <div className="card-title">Checkpoint Telemetry Log</div>
            <div className="card" style={{ maxHeight: 240, overflowY: "auto", marginTop: 8 }}>
              {points.map((pt, i) => (
                <div key={i} className="row" style={{ padding: "8px 14px", borderLeft: pt.passed ? "none" : "3px solid var(--warn)" }}>
                  <span className="mono" style={{ width: 80, fontSize: 12, color: "var(--muted)" }}>
                    {pt.timeLabel}
                  </span>
                  <span className="grow mono" style={{ fontSize: 13, fontWeight: 700, color: pt.passed ? "var(--ink)" : "var(--warn)" }}>
                    {pt.mbps} Mbps
                  </span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--muted)", marginRight: 12 }}>
                    {pt.latencyMs} ms
                  </span>
                  <span className={`chip ${pt.passed ? "green" : "amber"}`} style={{ fontSize: 10.5, padding: "2px 6px" }}>
                    {pt.passed ? "Pass" : "SLA Breach"}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 22, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn primary" onClick={() => setZoomModalOpen(false)}>
                Close Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
