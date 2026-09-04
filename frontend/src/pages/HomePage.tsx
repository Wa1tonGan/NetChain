import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { ESCROW_DEPLOY } from "../services/live";
import ProtectionModal from "../components/ProtectionModal";
import TopUpModal from "../components/TopUpModal";

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
  const s = useAppStore();
  const state = s.protectionState;
  const isDegraded = state === "attention" || state === "recovering" || s.capacity.primaryDown;
  const isRecovered = s.capacity.extra > 0;
  const [modalOpen, setModalOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const walletConnected = Boolean(s.zkLogin);

  const currentMbps = isDegraded && !isRecovered ? 0 : isRecovered ? s.capacity.current : s.capacity.primary;
  const latency = isDegraded && !isRecovered ? 142 : Math.round(s.netSample?.rttMs ?? 19);
  const loss = isDegraded && !isRecovered ? 4.2 : s.netSample?.lossPct ?? 0.0;

  const heroChip =
    isRecovered ? (
      <span className="chip good">
        <span className="dot" />
        Recovered · Backup active
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
      desc: "Queried 3 provider agents — 500 Mbps · 30 min · ≤ USDC 14.",
    },
    {
      time: "T+11.1s",
      title: "KilatLink FWA · offer selected",
      type: "ok",
      desc: "500 Mbps · 18 ms · USDC 12.60 · activation 8 s · 0% loss route.",
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
      desc: "Built the PTB, signed with its own keypair, locked USDC 12.60 — no human approval.",
    },
  ];

  return (
    <div>
      <div
        className="page-head"
        style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}
      >
        <div>
          <h2>Your network, right now</h2>
          <p>Live strength of the line you are paying for — protected by autonomous agents.</p>
        </div>
        <span className="chip live">
          <span className="dot" />
          MONITORING · 1s interval
        </span>
      </div>

      <div className="hero">
        <div className="card net-hero">
          <div className="net-status-row">
            {heroChip}
            {isRecovered && <span className="chip neutral" style={{ marginLeft: "auto" }}>Escrow settled</span>}
          </div>
          <div className="net-big">
            {currentMbps}
            <small> Mbps</small>
          </div>
          <div className="net-sub">
            {isRecovered
              ? `Primary fiber suppressed — you are running on a ${s.session?.agreed ?? s.capacity.extra} Mbps backup slice, bought and attached by your agent.`
              : isDegraded
              ? "Primary fiber suppressed — your RescueAgent is acquiring replacement capacity right now."
              : "Primary fiber link healthy. Agents are standing by on a 1-second monitoring interval."}
          </div>
          <div className="net-spark">
            <svg width="100%" height="64" viewBox="0 0 280 54" preserveAspectRatio="none">
              <line x1="0" x2="280" y1="10" y2="10" stroke="#e5e5ea" strokeDasharray="4 3" />
              <polyline
                fill="none"
                stroke="#0071e3"
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
              <text x="2" y="7" fontSize="8" fill="#aeaeb2">
                {isDegraded && !isRecovered ? "primary suppressed →" : "backup attached →"}
              </text>
            </svg>
            <div className="net-foot">
              <span>
                last 60s · <b>{isDegraded && !isRecovered ? 0 : 100}</b>% of expected strength
              </span>
              <span>
                next check <b>1s</b>
              </span>
            </div>
          </div>
        </div>

        <div className="net-side">
          <div className="tile-row">
            <div className="tile">
              <div className="k">Primary</div>
              <div className={`v ${isDegraded && !isRecovered ? "bad" : ""}`}>
                {isDegraded && !isRecovered ? "0 Mbps" : `${s.capacity.primary} Mbps`}
              </div>
              <div className="s">{isDegraded && !isRecovered ? "suppressed" : "fiber · nominal"}</div>
            </div>
            <div className="tile">
              <div className="k">Backup</div>
              <div className={`v ${isRecovered ? "good" : ""}`}>{isRecovered ? `+${s.capacity.extra}` : "—"}</div>
              <div className="s">{isRecovered ? "KilatLink FWA" : "standby"}</div>
            </div>
            <div className="tile">
              <div className="k">Latency</div>
              <div className={`v ${isDegraded && !isRecovered ? "bad" : ""}`}>{latency} ms</div>
              <div className="s">{isDegraded && !isRecovered ? "was 18 ms" : "rtt · live probe"}</div>
            </div>
            <div className="tile">
              <div className="k">Loss</div>
              <div className={`v ${isDegraded && !isRecovered ? "bad" : "good"}`}>{loss.toFixed(1)}%</div>
              <div className="s">last 5 probes</div>
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

      {/* Recovery controls */}
      <div className="card-title">Recovery controls</div>
      <div className="card">
        <div className="pad" style={{ display: "grid", gap: 8 }}>
          <button
            className="btn primary"
            onClick={() => s.startLiveRecovery("s2")}
            disabled={s.running}
            title="Broadcast your intent to the agent market and settle escrow on Sui"
          >
            Run recovery
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button className="btn subtle" onClick={s.resetSim} disabled={s.running}>
              Reset to normal link
            </button>
            <button
              className="btn subtle"
              onClick={() => setTopUpOpen(true)}
              disabled={!walletConnected}
              title={walletConnected ? "Add USDC to the escrow pool" : "Connect a wallet first"}
            >
              Top up pool
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".07em" }}>
              Escrow operator
            </span>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
              {ESCROW_DEPLOY.platformOperator.slice(0, 10)}…{ESCROW_DEPLOY.platformOperator.slice(-8)}
            </span>
            <a
              className="link-btn ghost"
              style={{ padding: "2px 8px", fontSize: 10.5, textDecoration: "none" }}
              href={`https://suiscan.xyz/testnet/account/${ESCROW_DEPLOY.platformOperator}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Suiscan ↗
            </a>
          </div>
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
              <div className="feed-desc">{log.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && <ProtectionModal onClose={() => setModalOpen(false)} />}
      {topUpOpen && s.zkLogin && (
        <TopUpModal session={s.zkLogin} onClose={() => setTopUpOpen(false)} />
      )}
    </div>
  );
}
