import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { StrengthBars } from "../components/RecoveryOverlay";
import ProtectionModal from "../components/ProtectionModal";
import type { Session } from "../services/types";

function useTicker(active: boolean, ms = 300) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

function SimulatedTelemetryCard({
  isDegraded,
  isRecovered,
  extraMbps,
}: {
  isDegraded: boolean;
  isRecovered: boolean;
  extraMbps: number;
}) {
  useTicker(true, 1000);

  const downlink = isDegraded ? "0 Mbps" : isRecovered ? `1,000 Mbps (+${extraMbps}M)` : "1,000 Mbps";
  const latency = isDegraded ? "142 ms" : "18 ms";
  const jitter = isDegraded ? "28.4 ms" : "2.1 ms";
  const loss = isDegraded ? "4.2 %" : "0.0 %";

  const cell = (k: string, v: string, warn?: boolean) => (
    <div className="n">
      <div className="nk">{k}</div>
      <div className={`nv ${warn ? "bad" : ""}`} style={{ color: warn ? "var(--bad)" : undefined }}>
        {v}
      </div>
    </div>
  );

  return (
    <div className="card">
      <div className="pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 800, fontSize: 13.5 }}>Connection Telemetry (Simulated Link)</span>
          <span className={`chip ${!isDegraded ? "green" : "red"}`}>
            <span className="dot" /> {!isDegraded ? "Active · Stable" : "Degraded / Suppressed"}
          </span>
        </div>
        <div className="sess-grid" style={{ marginTop: 10 }}>
          {cell("Latency (RTT)", latency, isDegraded)}
          {cell("Jitter", jitter, isDegraded)}
          {cell("Packet Loss", loss, isDegraded)}
          {cell("Downlink Bandwidth", downlink, isDegraded)}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  useTicker(true);

  if (session.ended) {
    return (
      <div className="card">
        <div className="pad">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StrengthBars filled={0} cls="strength-2" />
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Recovery session ended</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{session.endNote ?? "Plan duration expired."}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const remainMin = session.min - (Date.now() - session.start) / 1000;
  const totSec = Math.max(0, remainMin * 60);
  const mm = Math.floor(totSec / 60);
  const ss = Math.floor(totSec % 60);
  const tput = (session.mbps - 1.4 + Math.random() * 3.2).toFixed(1);
  const lat = Math.round(18 + Math.random() * 4);

  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <div className="pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Active Autonomous Recovery Session</div>
            <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
              +{session.agreed} Mbps via KilatLink FWA · {session.min} min duration
            </div>
          </div>
          <span className="chip sui">Sui Escrow Locked</span>
        </div>

        <div className="sess-grid" style={{ marginTop: 12 }}>
          <div className="n">
            <div className="nk">Delivered Throughput</div>
            <div className="nv" style={{ color: "var(--ok)" }}>
              {tput} Mbps
            </div>
          </div>
          <div className="n">
            <div className="nk">Latency</div>
            <div className="nv">{lat} ms</div>
          </div>
        </div>

        <div className="sess-foot">
          <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Time remaining:</span>
          <span className="cd">
            {mm}:{String(ss).padStart(2, "0")}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: "auto" }}>{rm(session.cost)}</span>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const s = useAppStore();
  const state = s.protectionState;
  const isDegraded = state === "attention" || state === "recovering" || s.capacity.primaryDown;
  const isRecovered = s.capacity.extra > 0;
  const [modalOpen, setModalOpen] = useState(false);
  // LIVE = real A2A agents + Sui escrow (falls back to simulation when the
  // backend is down); SIM = scripted timers. Persists for the session.
  const [liveMode, setLiveMode] = useState(true);

  // Suppress strength to 1 bar or 0 bars when degraded, otherwise 4/4
  const signalFilled = isDegraded && !isRecovered ? 1 : 4;
  const signalCls = isDegraded && !isRecovered ? "strength-bad" : "";
  const signalLabel = isDegraded && !isRecovered ? "Suppressed / Weak" : "Excellent (1,000M Fiber)";

  const currentDisplayMbps = isDegraded && !isRecovered ? 0 : isRecovered ? s.capacity.current : 1000;

  const hero = {
    protected: { cls: "green", text: "Connection Protected" },
    recovering: { cls: "blue", text: "Acquiring Backup Capacity…" },
    attention: { cls: "amber", text: "Line Degradation Detected (Suppressed)" },
  }[state];

  // Dynamic Discovery & Multi-Agent Interaction Log.
  // Live mode with an active incident → the REAL SSE narration (thread
  // bubbles); otherwise the scripted showcase entries.
  const incident = s.incident;
  const liveLogs = liveMode && incident
    ? incident.thread.slice(-8).map((b, i) => ({
        time: "T+" + ((Date.now() - incident.startedAt) / 1000).toFixed(1) + "s",
        title:
          b.from === "user" ? "Subscriber Intent (SMS)" : b.from === "net" ? "Edge Watcher" : "Agent Market",
        type: b.from === "user" ? "sui" : b.text.startsWith("✗") || b.text.startsWith("⚠️") ? "warn" : "ok",
        desc: b.text,
        key: "live-" + i,
      }))
    : null;
  const interactionLogs = liveLogs ?? [
    {
      time: "T+0.0s",
      title: "Discovery Agent",
      type: "warn",
      desc: "Physical WAN degradation detected: latency surged to 142ms, packet loss reached 4.2%, 500 Mbps shortfall identified.",
    },
    {
      time: "T+1.2s",
      title: "A2A Broadcast Protocol",
      type: "sui",
      desc: "Broadcast parallel query to 3 nearby registered providers: NusaNet 5G, KilatLink FWA, and OrbitSat GO.",
    },
    {
      time: "T+2.0s",
      title: "Provider Quotes Received",
      type: "ok",
      desc: "KilatLink FWA (500M @ USDC 12.60, 18ms), NusaNet 5G (500M @ USDC 18.50, 25ms), OrbitSat GO (150M @ USDC 24.00, 65ms).",
    },
    {
      time: "T+2.6s",
      title: "SMS Reply Channel",
      type: "sui",
      desc: "Shortage prompt sent to subscriber. User approved: 30 min duration within USDC 14.00 budget.",
    },
    {
      time: "T+4.5s",
      title: "Gonka 3-Agent Consensus",
      type: "ok",
      desc: "DeepSeek-V3 + Kimi-k1.5 + MiniMax-ABAB6.5 reached 3/3 unanimous consensus selecting KilatLink FWA.",
    },
    {
      time: "T+5.5s",
      title: "Sui Escrow Dual-Sig Lock",
      type: "sui",
      desc: "Smart contract object locked on Sui Testnet: USDC 11.97 provider amount + USDC 0.63 platform fee.",
    },
    {
      time: "T+7.2s",
      title: "CAMARA QoD Path Active",
      type: "ok",
      desc: "Programmable high-speed slice established. Full 500 Mbps capacity verified and online.",
    },
  ];

  return (
    <div className="cols">
      <div>
        <div className="hero">
          <div className={`status ${hero.cls}`}>
            <span className={`dot ${state === "protected" ? "protected" : state}`} />
            {hero.text}
          </div>
          <h1>
            {currentDisplayMbps}
            <span className="u">Mbps</span>
          </h1>
          <div className="sub">
            {isRecovered
              ? `Running on autonomous backup capacity (+${s.capacity.extra} Mbps).`
              : isDegraded
              ? "Primary line suppressed. Autonomous rescue engine is resolving shortfall."
              : "Primary fiber link operating normally with autonomous SLA resilience."}
          </div>
        </div>

        {/* Shortfall Alert */}
        {state !== "protected" && (
          <div className="card" style={{ borderLeft: "4px solid var(--warn)", background: "#fffdfa" }}>
            <div className="pad">
              <div style={{ fontWeight: 800, fontSize: 15 }}>Connectivity Shortfall Detected</div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                Primary link degraded to 0 Mbps. Interactive SMS recovery protocol active.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className="btn primary"
                  onClick={() =>
                    liveMode ? s.startLiveRecovery("s2") : s.startRecovery("main")
                  }
                >
                  {liveMode
                    ? "Acquire Replacement Capacity (Live A2A + Sui)"
                    : "Acquire Replacement Capacity (Reply by SMS)"}
                </button>
                <button
                  className={`btn sm ${liveMode ? "subtle" : "primary"}`}
                  onClick={() => setLiveMode(!liveMode)}
                  title="Toggle between the live backend and the scripted simulation"
                >
                  {liveMode ? "● LIVE backend" : "○ SIM mode"}
                </button>
              </div>
            </div>
          </div>
        )}

        {state === "protected" && s.session && <SessionCard session={s.session} />}

        {/* Telemetry Card */}
        <div className="card-title">Live Link Telemetry</div>
        <SimulatedTelemetryCard
          isDegraded={isDegraded && !isRecovered}
          isRecovered={isRecovered}
          extraMbps={s.capacity.extra}
        />

        {/* Live Discovery & Agent Interaction Log on Dashboard */}
        <div className="card-title">
          Discovery &amp; Multi-Agent Interaction Log
          {liveLogs && <span className="chip green" style={{ marginLeft: 8, fontSize: 10 }}>live</span>}
        </div>
        <div className="interaction-feed">
          {(incident ? interactionLogs : interactionLogs.slice(0, 3)).map((log, i) => (
            <div key={(log as { key?: string }).key ?? i} className="feed-item">
              <span className={`feed-dot ${log.type}`} />
              <div className="feed-content">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="feed-title">{log.title}</span>
                  <span className="feed-time">{log.time}</span>
                </div>
                <div className="feed-desc">{log.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="card-title" style={{ marginTop: 8 }}>Status Overview</div>
        <div className="card">
          <div className="row">
            <span className="grow k">Primary Link</span>
            <span className={`v ${!isDegraded || isRecovered ? "ok" : "bad"}`}>
              {isDegraded && !isRecovered ? "Degraded / Suppressed" : "Connected (1,000 Mbps)"}
            </span>
          </div>
          <div className="row">
            <span className="grow k">Autonomous Protection</span>
            <span className="v ok">Active</span>
          </div>
          <div className="row">
            <span className="grow k">Signal Quality</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StrengthBars filled={signalFilled} cls={signalCls} />
              <span className={`v ${signalFilled >= 3 ? "ok" : "bad"}`}>{signalLabel}</span>
            </span>
          </div>
          <div className="row">
            <span className="grow k">Auto-Recovery</span>
            <span className={`v ${s.auto ? "ok" : ""}`}>{s.auto ? "ON" : "OFF"}</span>
          </div>
          {s.auto && (
            <div className="row">
              <span className="grow k">Monthly Spending Limit</span>
              <span className="v">USDC {s.monthlyLimit} / mo</span>
            </div>
          )}
        </div>

        {/* Simulation Actions */}
        <div className="card-title">Simulation Controls</div>
        <div className="card">
          <div className="pad" style={{ display: "grid", gap: 8 }}>
            <button
              className="btn primary"
              onClick={() => s.startRecovery("main")}
              disabled={s.running}
            >
              Suppress Link & Test Recovery (SMS Reply)
            </button>
            <button
              className="btn subtle"
              onClick={() => setModalOpen(true)}
            >
              Configure Protection Settings
            </button>
            <button
              className="btn subtle"
              onClick={s.resetSim}
            >
              Reset to Normal Link (1,000 Mbps)
            </button>
          </div>
        </div>
      </div>

      {modalOpen && <ProtectionModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
