import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { GATEWAY_URL, SCENARIOS, TRUST_URL } from "../services/live";
import Icon from "../components/Icon";
function LiveBackendCard({ running }: { running: boolean }) {
  const startLiveRecovery = useAppStore((s) => s.startLiveRecovery);
  const [scenario, setScenario] = useState("s2");

  return (
    <div className="card highlight">
      <div className="pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="chip green">LIVE BACKEND — real agents + Sui escrow</span>
          <button
            className="btn sm primary"
            onClick={() => startLiveRecovery(scenario)}
            disabled={running}
          >
            Run live
          </button>
        </div>
        <div style={{ marginTop: 10 }}>
          <select
            className="input"
            style={{ width: "100%" }}
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            disabled={running}
          >
            {SCENARIOS.map((sc) => (
              <option key={sc.key} value={sc.key}>
                {sc.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.6 }}>
          The reply you type in the SMS sheet becomes a REAL <b>RecoveryIntent</b> broadcast to three
          A2A provider agents; the winner is committed on Sui and settled by the trust layer. Chain SSE
          narrates every ledger row in the thread.
          <br />
          Backend: gateway <span className="mono">{GATEWAY_URL}</span> · trust{" "}
          <span className="mono">{TRUST_URL}</span>
          <br />
          Start it with <span className="mono">node scripts/start-all.mjs</span> +{" "}
          <span className="mono">npm run trust:server</span>
        </div>
      </div>
    </div>
  );
}

export default function DevPage() {
  const s = useAppStore();

  const scenarios = [
    {
      id: "S1" as const,
      tag: "PRIMARY DEMO",
      tagCls: "green",
      title: "S1 — Backup Capacity Insufficient (Stadium NOC)",
      trigger: "Primary 1,000 Mbps fiber fails; backup has only 500 Mbps while critical demand is 700 Mbps.",
      action: "Protects P1 POS/CCTV → Throttles Guest Wi-Fi → Acquires 300 Mbps from KilatLink FWA via CAMARA QoD → Rebalances to 800 Mbps → Settles on Sui.",
      buttonText: "Run S1 (Primary)",
      btnClass: "primary",
    },
    {
      id: "S2" as const,
      tag: "EARLY WARNING",
      tagCls: "blue",
      title: "S2 — Proactive Link Degradation",
      trigger: "Primary link online but latency spikes to 140ms and packet loss reaches 4.2%.",
      action: "Watcher issues early warning → compares providers → switches critical flows before total link cut.",
      buttonText: "Run S2",
      btnClass: "subtle",
    },
    {
      id: "S3" as const,
      tag: "SURGE",
      tagCls: "blue",
      title: "S3 — Sudden Event Demand Surge",
      trigger: "Concert gate opening causes traffic demand to surge past 1,200 Mbps backhaul ceiling.",
      action: "Applies P1 queue rules → throttles non-essential spectator AR → activates temporary burst slice.",
      buttonText: "Run S3",
      btnClass: "subtle",
    },
    {
      id: "S4" as const,
      tag: "FIBER CUT",
      tagCls: "amber",
      title: "S4 — Physical Fiber Severance",
      trigger: "Backhoe physical cut severs primary WAN line.",
      action: "Autonomous failover kicks in → acquires replacement capacity from KilatLink FWA.",
      buttonText: "Run S4",
      btnClass: "subtle",
    },
    {
      id: "S5" as const,
      tag: "P0 SAFETY OVERRIDE",
      tagCls: "red",
      title: "S5 — Disaster / Life-Safety Override",
      trigger: "Multiple infrastructure paths degrade during emergency response.",
      action: "P0 Safety Override engages instantly — medical & emergency traffic pre-empts all paid commercial tiers.",
      buttonText: "Run S5",
      btnClass: "subtle",
    },
    {
      id: "S6" as const,
      tag: "PRIORITY QUEUE",
      tagCls: "blue",
      title: "S6 — Individual Priority Queue (VVIP vs Normal)",
      trigger: "Multiple individual recovery requests compete for limited temporary provider capacity.",
      action: "P0 override first, then VVIP (P1) → VIP (P2) → Normal (P3) deterministic queueing.",
      buttonText: "Run S6",
      btnClass: "subtle",
    },
  ];

  return (
    <div className="app-col">
      <div className="topbar full">
        <div className="logo">
          <span className="dot" /> NetChain
          <span className="tagline">Scenario Matrix</span>
        </div>
        <span className="chip sui">Hackathon Showcase</span>
        <span className="grow" />
        <a
          href="#/home"
          style={{
            color: "var(--accent)",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: 13.5,
          }}
        >
          ← Return to App
        </a>
      </div>

      <div className="content full">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", paddingTop: 4 }}>
              Hackathon Scenario Execution Matrix
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4, maxWidth: "70ch" }}>
              Executable demonstrations matching Blueprint Section 5. Run scenarios to test autonomous detection,
              traffic throttling, Gonka 3-model provider selection, CAMARA QoD activation, and Sui split settlement.
            </p>
          </div>
          <button className="btn sm subtle" onClick={s.resetSim}>
            Reset Simulator State
          </button>
        </div>

        <div className="cols wide-left" style={{ marginTop: 14 }}>
          {/* Scenario Cards */}
          <div>
            <LiveBackendCard running={s.running} />
            <div className="card-title" style={{ marginTop: 14 }}>
              Simulated demo stories (scripted timers)
            </div>
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {scenarios.map((sc) => (
                <div key={sc.id} className={`card ${sc.id === "S1" ? "highlight" : ""}`}>
                  <div className="pad">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span className={`chip ${sc.tagCls}`}>{sc.tag}</span>
                      <button
                        className={`btn sm ${sc.btnClass}`}
                        onClick={() => s.runScenario(sc.id)}
                        disabled={s.running}
                      >
                        {sc.buttonText}
                      </button>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, marginTop: 8 }}>{sc.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--bad)", marginTop: 4 }}>
                      <b>Trigger:</b> {sc.trigger}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                      <b>NetChain Response:</b> {sc.action}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fault Injector & Watcher Controls */}
          <div>
            <div className="card-title">Edge Fault Injection Utilities</div>
            <div className="card">
              <div className="row">
                <span className="grow">
                  <span className="t">Simulate Physical Outage</span>
                  <div className="s">
                    Forces device probes to fail — engages real watcher pipeline
                    {s.mockProbeOutage ? " · ACTIVE" : ""}
                  </div>
                </span>
                <button
                  className={`btn sm ${s.mockProbeOutage ? "primary" : ""}`}
                  onClick={s.toggleMockOutage}
                >
                  {s.mockProbeOutage ? "Restore Link" : "Break Link"}
                </button>
              </div>

              <div className="row">
                <span className="grow">
                  <span className="t">Simulate Weak Signal</span>
                  <div className="s">
                    Keeps probe online but limits downlink to 20 Mbps
                    {s.mockWeakSignal ? " · ACTIVE" : ""}
                  </div>
                </span>
                <button
                  className={`btn sm ${s.mockWeakSignal ? "primary" : ""}`}
                  onClick={s.toggleMockWeakSignal}
                >
                  {s.mockWeakSignal ? "Restore Signal" : "Weaken"}
                </button>
              </div>

              <div className="row">
                <span className="grow">
                  <span className="t">Provider Under-Delivery Demo</span>
                  <div className="s">Provider delivers 450/500M → 10% penalty refund settled</div>
                </span>
                <button className="btn sm" onClick={() => s.startRecovery("under")} disabled={s.running}>
                  Run
                </button>
              </div>

              <div className="row">
                <span className="grow">
                  <span className="t">Provider Activation Failure</span>
                  <div className="s">Activation timeout → 100% reservation refund with 0 fee</div>
                </span>
                <button className="btn sm" onClick={() => s.startRecovery("failed")} disabled={s.running}>
                  Run
                </button>
              </div>
            </div>

            <div className="card" style={{ background: "var(--bg-subtle)", marginTop: 14 }}>
              <div className="pad">
                <div style={{ fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="lightbulb" size={15} color="var(--amber-ink)" /> Judge Evaluation Notes
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>
                  • <b>Time-to-Recovery</b>: Measured live on every scenario.
                  <br />• <b>A2A Independence</b>: Parallel provider queries to NusaNet, KilatLink, and OrbitSat.
                  <br />• <b>Trust Layer</b>: Sui Escrow locks dual split before activation; releases on verified delivery.
                  <br />• <b>Deterministic QoS</b>: P0 emergency override never compromised by paid commercial tiers.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
