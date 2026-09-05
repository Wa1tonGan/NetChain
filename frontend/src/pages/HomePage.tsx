import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { rm, DEMAND_MBPS } from "../services/pricing";
import ProtectionModal from "../components/ProtectionModal";
import TopUpModal from "../components/TopUpModal";
import { TextWithIcons } from "../components/Icon";
import { DUMMY_USERS, type DummyUser } from "../data/dummyUsers";
import type { RunBid, RunLogEntry } from "../services/types";

function useTicker(active: boolean, ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

function SessionCard() {
  const session = useAppStore((s) => s.session)!;
  useTicker(true);

  const remainMin = session.min - (Date.now() - session.start) / 1000;
  const totSec = Math.max(0, remainMin * 60);
  const mm = Math.floor(totSec / 60);
  const ss = Math.floor(totSec % 60);
  const below = session.log.filter((x) => !x.ok).length;

  return (
    <div className="session-card">
      <div className="head">
        <div>
          <div className="panel-title">Backup session</div>
          <div className="wal-sub">
            KilatLink FWA · {session.agreed} Mbps · {session.min} min
          </div>
        </div>
        <span className="chip good" style={{ marginLeft: "auto" }}>
          <span className="dot" />
          SLA OK
        </span>
      </div>
      <div className="kv">
        <span className="k">Expires in</span>
        <span className="v mono" style={{ fontSize: 13 }}>
          {mm}:{String(ss).padStart(2, "0")}
        </span>
      </div>
      <div className="kv">
        <span className="k">Paid by agent</span>
        <span className="v">{rm(session.cost)}</span>
      </div>
      <div className="kv">
        <span className="k">Deal details</span>
        <span className="v">
          <Link to="/activity" className="link-btn ghost" style={{ padding: "5px 13px", fontSize: 11 }}>
            Open transaction ↓
          </Link>
        </span>
      </div>
      <div className="net-foot" style={{ marginTop: 8 }}>
        <span>
          last {session.min}m · <b>{below}</b> samples below 95%
        </span>
        <span>
          next check <b>1s</b>
        </span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { userId } = useParams<{ userId?: string }>();
  const user: DummyUser = DUMMY_USERS.find((u) => u.id === userId) ?? DUMMY_USERS[0];

  const s = useAppStore();
  const state = s.protectionState;
  const isStoreDegraded = state === "attention" || state === "recovering" || s.capacity.primaryDown;
  const isRecovered =
    s.capacity.extra > 0 ||
    Boolean(s.session && !s.session.ended) ||
    s.incident?.result?.state === "Settled" ||
    (s.incident?.status === "restored" && Boolean(s.incident?.result));
  const [modalOpen, setModalOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  // --- Relocation Simulation (User 1: KL -> Penang) ---
  const isSimulationUser = Boolean(user.isSimulationUser || user.id === "user-1");
  const [hasRelocated, setHasRelocated] = useState(false);
  const [relocating, setRelocating] = useState(false);
  /** The relocated link's degraded downlink — the simulation input that the
   *  recovery intent is built from (15 Mbps measured after the move). */
  const RELOCATED_MBPS = 15;

  const activeLocation = hasRelocated
    ? { city: "George Town", state: "Penang" }
    : { city: user.city, state: user.state };

  const handleRunSimulation = () => {
    if (s.running) return;
    s.resetSim();
    setRelocating(true);
    setHasRelocated(true);

    // Update location to Penang & drop speed to the degraded downlink, then
    // trigger recovery (backend-first inside the store; sim if gateway down).
    // The ask is 200 Mbps — the market's always-coverable floor (rolled
    // provider tiers quote 200–500 Mbps) and scenario S2's real shortfall.
    setTimeout(() => {
      setRelocating(false);
      s.startRecovery("auto", 200, {
        degradedMbps: RELOCATED_MBPS,
        subject: "George Town, Penang",
        customerId: user.id,
      });
    }, 650);
  };

  const handleReset = () => {
    s.resetSim();
    setHasRelocated(false);
    setRelocating(false);
  };

  // Determine current metrics based on simulation vs store vs static user data
  const runLog = s.runLog;
  const winnerBid = runLog.find((e): e is RunBid => e.kind === "bid" && Boolean(e.winner));
  const lastTelemetry = [...runLog]
    .reverse()
    .find((e): e is Extract<RunLogEntry, { kind: "telemetry" }> => e.kind === "telemetry");
  const restoredMbps = s.capacity.extra || lastTelemetry?.deliveredMbps || user.speedMbps;
  const backupBrand = winnerBid?.brand ?? s.incident?.req?.provider ?? "backup link";

  let currentMbps: number;
  let latency: number;
  let loss: number;
  let isDegraded: boolean;

  if (isRecovered) {
    currentMbps = restoredMbps;
    latency = lastTelemetry?.latencyMs ?? winnerBid?.latencyMs ?? user.latencyMs;
    loss = lastTelemetry?.packetLossPercent ?? 0;
    isDegraded = false;
  } else if (hasRelocated) {
    currentMbps = RELOCATED_MBPS;
    latency = 142;
    loss = 4.2;
    isDegraded = true;
  } else if (isStoreDegraded) {
    currentMbps = 0;
    latency = 142;
    loss = 4.2;
    isDegraded = true;
  } else {
    currentMbps = user.speedMbps;
    latency = user.latencyMs;
    loss = user.packetLossPct;
    isDegraded = user.status === "low";
  }

  const heroChip =
    isRecovered ? (
      <span className="chip good">
        <span className="dot" />
        Good · Protected (Escrow Settled)
      </span>
    ) : isDegraded ? (
      <span className="chip amber">
        <span className="dot" />
        Primary suppressed
      </span>
    ) : (
      <span className="chip good">
        <span className="dot" />
        Connected · protected
      </span>
    );

  // Dynamic Discovery & Multi-Agent Interaction Log.
  // An active incident → the REAL SSE narration (thread bubbles); otherwise
  // the scripted showcase entries.
  const incident = s.incident;
  const liveLogs = incident
    ? incident.thread.slice(-8).map((b, i) => ({
        time: "T+" + ((Date.now() - incident.startedAt) / 1000).toFixed(1) + "s",
        title: b.from === "user" ? "Subscriber Intent (SMS)" : b.from === "net" ? "Edge Watcher" : "Agent Market",
        type: b.from === "user" ? "sui" : b.text.startsWith("✗") || b.text.startsWith("⚠️") ? "warn" : "ok",
        desc: b.text,
        key: "live-" + i,
      }))
    : null;
  const interactionLogs = liveLogs ?? [
    {
      time: "T+0.4s",
      title: "RescueAgent · detected outage",
      type: "warn",
      desc: "Uplink 0 Mbps · 500 Mbps shortfall · P1 services at risk. Protection rule P1 fired: restore within 15 s or escalate.",
    },
    {
      time: "T+7.2s",
      title: "RescueAgent · A2A broadcast",
      type: "sui",
      desc: "Queried 3 provider agents — 500 Mbps · ≤ USDC 2.00.",
    },
    {
      time: "T+11.1s",
      title: "KilatLink FWA · offer selected",
      type: "ok",
      desc: "500 Mbps · 18 ms · USDC 1.80 · activation 8 s · 0% loss route.",
    },
    {
      time: "T+12.9s",
      title: "3 voting agents · deal approved",
      type: "ok",
      desc: "Unanimous 3/3 — pricing, SLA and budget agents countersigned.",
    },
    {
      time: "T+20.2s",
      title: "RescueAgent · signed & paid",
      type: "sui",
      desc: "Built the PTB, signed with its own keypair, locked USDC 1.80 — no human approval.",
    },
  ];

  return (
    <div>
      {/* Back to User List Navigation */}
      <div style={{ marginBottom: 14 }}>
        <Link
          to="/home"
          className="link-btn ghost"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            padding: "5px 12px",
            borderRadius: 16,
            textDecoration: "none",
            color: "var(--ink-2)",
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          <span>←</span>
          <span>Back to All Subscribers</span>
        </Link>
      </div>

      {/* Page Header with Subscriber Info & Location Label */}
      <div
        className="page-head"
        style={{ display: "flex", alignItems: "flex-start", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2>{user.name}'s Network</h2>
            <span
              className="chip neutral"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: "3px 10px",
                background: "var(--panel)",
                border: "1px solid var(--line)",
              }}
            >
              📍 {activeLocation.city}, {activeLocation.state}
            </span>
          </div>
          <p style={{ marginTop: 4 }}>
            <b>Location:</b> {activeLocation.city}, {activeLocation.state} · <b>Device:</b> {user.device} · <b>ISP:</b> {hasRelocated ? "Penang Wireless / FWA" : user.isp}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="chip live">
            <span className="dot" />
            MONITORING · 1s interval
          </span>
          {hasRelocated && (
            <button
              type="button"
              className="btn sm subtle"
              onClick={handleReset}
              disabled={s.running}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 16 }}
              title="Reset location to Kuala Lumpur"
            >
              ↺ Reset to Kuala Lumpur
            </button>
          )}
        </div>
      </div>

      <div className="hero">
        <div className="card net-hero">
          <div className="net-status-row">
            {heroChip}
            <span className="chip neutral" style={{ fontSize: 11, fontWeight: 700 }}>
              📍 {activeLocation.city}, {activeLocation.state}
            </span>
            {isRecovered && (
              <span className="chip good" style={{ marginLeft: "auto", fontWeight: 700 }}>
                <span className="dot" /> Escrow Settled
              </span>
            )}
          </div>
          <div className="net-big" style={{ color: isRecovered ? "var(--green-ink)" : undefined }}>
            {currentMbps}
            <small> Mbps</small>
          </div>
          <div className="net-sub">
            {isRecovered
              ? `Network restored to healthy state — +${restoredMbps} Mbps backup active (${backupBrand}), escrow settled autonomously on Sui.`
              : isDegraded
              ? "Primary fiber suppressed — your RescueAgent is acquiring replacement capacity right now."
              : "Primary fiber link healthy. Agents are standing by on a 1-second monitoring interval."}
          </div>
          <div className="net-spark">
            <svg width="100%" height="64" viewBox="0 0 280 54" preserveAspectRatio="none">
              <line x1="0" x2="280" y1="10" y2="10" stroke="#e5e5ea" strokeDasharray="4 3" />
              <polyline
                fill="none"
                stroke={isRecovered ? "#34c759" : "#0071e3"}
                strokeWidth="2"
                strokeLinejoin="round"
                points={
                  isDegraded && !isRecovered
                    ? "0,10 20,12 40,40 60,46 90,47 130,47 170,47 210,47 250,47 280,47"
                    : "0,46 18,44 36,20 54,17 90,16 130,16 170,15 210,16 250,15 280,16"
                }
              />
              <g fill="#34c759">
                {isDegraded && !isRecovered ? (
                  <circle cx="10" cy="10" r="2.6" />
                ) : (
                  <>
                    <circle cx="54" cy="17" r="2.6" />
                    <circle cx="120" cy="16" r="2.6" />
                    <circle cx="190" cy="16" r="2.6" />
                    <circle cx="280" cy="16" r="2.6" />
                  </>
                )}
              </g>
              <text x="2" y="7" fontSize="8" fill={isRecovered ? "#34c759" : "#aeaeb2"}>
                {isDegraded && !isRecovered ? "primary suppressed →" : "link healthy · good →"}
              </text>
            </svg>
            <div className="net-foot">
              <span>
                last 60s · <b>{isDegraded && !isRecovered ? 0 : 100}</b>% of expected strength
              </span>
              <span>
                status · <b>{isRecovered ? "Good (Escrow Settled)" : isDegraded ? "Degraded" : "Nominal"}</b>
              </span>
            </div>
          </div>
        </div>

        <div className="net-side">
          <div className="tile-row">
            <div className="tile">
              <div className="k">Primary</div>
              <div className={`v ${isDegraded && !isRecovered ? "bad" : "good"}`}>
                {isDegraded && !isRecovered ? "0 Mbps" : `${s.capacity.primary || DEMAND_MBPS} Mbps`}
              </div>
              <div className="s">{isDegraded && !isRecovered ? "suppressed" : "fiber · nominal"}</div>
            </div>
            <div className="tile">
              <div className="k">Backup</div>
              <div className={`v ${isRecovered ? "good" : ""}`}>{isRecovered ? `+${restoredMbps} Mbps` : "—"}</div>
              <div className="s">{isRecovered ? `${backupBrand} · active` : "standby"}</div>
            </div>
            <div className="tile">
              <div className="k">Latency</div>
              <div className={`v ${isDegraded && !isRecovered ? "bad" : "good"}`}>{latency} ms</div>
              <div className="s">{isDegraded && !isRecovered ? "was 18 ms" : "18 ms · nominal"}</div>
            </div>
            <div className="tile">
              <div className="k">Loss</div>
              <div className={`v ${isDegraded && !isRecovered ? "bad" : "good"}`}>{loss.toFixed(1)}%</div>
              <div className="s">{isRecovered ? "0.0% · nominal" : "last 5 probes"}</div>
            </div>
          </div>
          {s.session && !s.session.ended ? (
            <SessionCard />
          ) : (
            <div className="session-card">
              <div className="head">
                <div>
                  <div className="panel-title">No active recovery</div>
                  <div className="wal-sub">Escrow standby · agents watching</div>
                </div>
                <span className="chip neutral" style={{ marginLeft: "auto" }}>
                  <span className="dot" />
                  Idle
                </span>
              </div>
              <div className="kv">
                <span className="k">Monthly spending limit</span>
                <span className="v">USDC {s.monthlyLimit.toFixed(2)}</span>
              </div>
              <div className="kv">
                <span className="k">Auto-pay cap</span>
                <span className="v">USDC {s.maxPerRecovery.toFixed(2)} / incident</span>
              </div>
              <div className="txd-link" style={{ justifyContent: "flex-start", marginTop: 10 }}>
                <button
                  className="link-btn ghost"
                  style={{ padding: "5px 13px", fontSize: 11 }}
                  onClick={() => setModalOpen(true)}
                >
                  Configure protection
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent interaction feed */}
      <div className="card-title">
        Agent activity
        {liveLogs && (
          <span className="chip good" style={{ marginLeft: 8, fontSize: 10 }}>
            <span className="dot" />
            live
          </span>
        )}
      </div>
      <div className="interaction-feed">
        {(incident ? interactionLogs : interactionLogs.slice(0, 4)).map((log, i) => (
          <div key={(log as { key?: string }).key ?? i} className="feed-item">
            <span className={`feed-dot ${log.type}`} />
            <div className="feed-content">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="feed-title">{log.title}</span>
                <span className="feed-time">{log.time}</span>
              </div>
              <div className="feed-desc"><TextWithIcons text={log.desc} /></div>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && <ProtectionModal onClose={() => setModalOpen(false)} />}
      {topUpOpen && s.zkLogin && (
        <TopUpModal session={s.zkLogin} onClose={() => setTopUpOpen(false)} />
      )}

      {/* Bottom-left Run Simulation Button for User 1 */}
      {isSimulationUser && (
        <div style={{ position: "fixed", left: 24, bottom: 84, zIndex: 45 }}>
          <button
            className="btn primary"
            onClick={handleRunSimulation}
            disabled={s.running || relocating}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "11px 20px",
              borderRadius: 26,
              background: "linear-gradient(135deg, #0071e3, #0056b3)",
              boxShadow: "0 6px 20px rgba(0, 113, 227, 0.4)",
              fontSize: 13.5,
              fontWeight: 700,
              color: "#ffffff",
              border: "none",
              cursor: s.running || relocating ? "not-allowed" : "pointer",
            }}
          >
            <span style={{ fontSize: 16 }}>📍</span>
            <span>
              {relocating
                ? "Switching to Penang..."
                : s.running
                ? "Autonomous Recovery Active..."
                : hasRelocated
                ? "Re-Run Relocation (KL → Penang)"
                : "Run Simulation (Relocate KL → Penang)"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
