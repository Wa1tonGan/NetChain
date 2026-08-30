import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { rm, rm0 } from "../services/pricing";
import { StrengthBars } from "../components/RecoveryOverlay";
import type { Session } from "../services/types";

/* Live temporary-capacity session card with SLA verification tracking.
   Countdown runs at demo speed (1 real second = 1 plan minute);
   throughput/latency/loss jitter like a real feed, and a verification
   check runs once per simulated minute against the agreed capacity. */

function useSessionTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
}

function signalFor(
  current: number,
  demand: number,
  primaryDown: boolean
): { filled: number; label: string; cls: string } {
  if (!primaryDown) return { filled: 4, label: "Excellent", cls: "" };
  if (current <= 0) return { filled: 0, label: "No signal", cls: "strength-2" };
  const ratio = current / demand;
  if (ratio >= 0.95) return { filled: 4, label: "Excellent", cls: "" };
  if (ratio >= 0.75) return { filled: 3, label: "Good", cls: "" };
  if (ratio >= 0.5) return { filled: 2, label: "Fair", cls: "strength-2" };
  return { filled: 1, label: "Poor", cls: "strength-2" };
}

function VerificationLog({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const healthy = session.mbps >= session.agreed;
  const avg = session.checks.total ? (session.checks.avgSum / session.checks.total).toFixed(1) : "—";

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>LIVE VERIFICATION</span>
        <span className={`chip ${session.checks.total > 0 && session.checks.passed === session.checks.total ? "green" : session.checks.total ? "amber" : "gray"}`}>
          {session.checks.total > 0
            ? `${session.checks.passed}/${session.checks.total} checks ${session.checks.passed === session.checks.total ? "within agreement" : "below agreement"}`
            : "starting checks…"}
        </span>
        <button className="btn link" style={{ marginLeft: "auto", fontSize: 12.5 }} onClick={() => setOpen(!open)}>
          {open ? "Hide log" : "Verification log"}
        </button>
      </div>
      {healthy ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
          Agreed {session.agreed} Mbps for the whole {session.min}-minute duration
          {session.checks.total > 0 && <> · average delivered <b style={{ color: "var(--ink)" }}>{avg} Mbps</b></>}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--warn)", fontWeight: 600, marginTop: 6 }}>
          Delivered {session.mbps} Mbps is below the agreed {session.agreed} Mbps — penalty refunds continue
          automatically for every failed check.
        </div>
      )}
      {open && (
        <div style={{ marginTop: 8 }}>
          {session.log.length === 0 && <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No samples yet…</div>}
          {session.log.map((s, i) => (
            <div key={s.at + "" + i} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "3px 0" }}>
              <span className="mono" style={{ color: "var(--faint)", width: 64 }}>
                {new Date(s.at).toLocaleTimeString("en-GB")}
              </span>
              <span className="mono" style={{ flex: 1 }}>{s.mbps} Mbps</span>
              <span style={{ color: s.ok ? "var(--ok)" : "var(--bad)", fontWeight: 700 }}>
                {s.ok ? "✓ within agreement" : "✕ below agreement"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  useSessionTicker(true);

  if (session.ended) {
    return (
      <div className="card">
        <div className="pad">
          <div className="sess-head">
            <StrengthBars filled={0} cls="strength-2" />
            <div className="grow">
              <div className="t">Temporary plan ended</div>
              <div className="s">The {session.min}-minute capacity plan expired.</div>
            </div>
          </div>
          {session.checks.total > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
              Final verification: {session.checks.passed}/{session.checks.total} checks within agreement · average{" "}
              {(session.checks.avgSum / session.checks.total).toFixed(1)} Mbps of {session.agreed} agreed.
            </div>
          )}
        </div>
      </div>
    );
  }

  const remainMin = session.min - (Date.now() - session.start) / 1000;
  const totSec = Math.max(0, remainMin * 60);
  const mm = Math.floor(totSec / 60);
  const ss = Math.floor(totSec % 60);
  const tput = (session.mbps - 1.4 + Math.random() * 3.2).toFixed(1);
  const lat = Math.round(36 + Math.random() * 8);
  const loss = (0.1 + Math.random() * 0.25).toFixed(1);
  const healthy = session.mbps >= session.agreed;

  return (
    <div className="card">
      <div className="pad">
        <div className="sess-head">
          <StrengthBars filled={healthy ? 4 : 2} cls={healthy ? "" : "strength-2"} />
          <div className="grow">
            <div className="t">Recovery session · {healthy ? "Excellent" : "Fair"}</div>
            <div className="s">{session.agreed} Mbps agreed plan · {session.min} min</div>
          </div>
        </div>
        <div className="sess-grid">
          <div className="n"><div className="nk">Throughput</div><div className="nv">{tput} Mbps</div></div>
          <div className="n"><div className="nk">Latency</div><div className="nv">{lat} ms</div></div>
          <div className="n"><div className="nk">Packet loss</div><div className="nv">{loss} %</div></div>
          <div className="n"><div className="nk">Agreed capacity</div><div className="nv">{session.agreed} Mbps</div></div>
        </div>
        <VerificationLog session={session} />
        <div className="sess-foot">
          <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Time remaining</span>
          <span className="cd">{mm}:{String(ss).padStart(2, "0")}</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{rm(session.cost)}</span>
          <span className="hint">demo speed ×60</span>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const s = useAppStore();
  const state = s.protectionState;
  const hero = {
    protected: { cls: "green", text: "CONNECTION PROTECTED" },
    recovering: { cls: "blue", text: "RECOVERING CONNECTION" },
    attention: { cls: "amber", text: "ATTENTION REQUIRED" },
  }[state];
  const heroSub = {
    protected: "If your connection fails or falls short, NetChain finds extra capacity — you just reply with a duration and budget.",
    recovering: "Handling your recovery request. No action needed.",
    attention: s.sessionExpired
      ? "Your temporary plan ended and the primary line is still down. Send a new recovery request."
      : "Recovery failed — you weren't charged. Your connection is still down.",
  }[state];

  const signal = signalFor(s.capacity.current, s.demand, s.capacity.primaryDown);

  const problem =
    state !== "protected" ? (
      <div className="card problem">
        <div className="pad">
          <h3>Connection problem detected</h3>
          <div className="d">
            Your main connection is unavailable
            {state === "attention"
              ? s.sessionExpired
                ? " and the temporary plan has expired"
                : " — the extra capacity could not be added"
              : ""}
            . NetChain can buy replacement capacity until your line is restored.
          </div>
          <div className="nums">
            <div className="n"><div className="nk">Available now</div><div className="nv">{s.capacity.current}</div></div>
            <div className="n"><div className="nk">Your demand</div><div className="nv">{s.demand}</div></div>
            <div className="n"><div className="nk">Shortage</div><div className="nv bad">{Math.max(0, s.demand - s.capacity.current)}</div></div>
          </div>
          {state === "attention" && (
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => s.startRecovery("main")}>New recovery request</button>
            </div>
          )}
        </div>
      </div>
    ) : null;

  return (
    <div className="cols">
      <div>
        <div className="hero">
          <div className={`status ${hero.cls}`}>
            <span className={`dot ${state === "protected" ? "protected" : state}`} />
            {hero.text}
          </div>
          <h1>
            {s.capacity.current}
            <span className="u">Mbps</span>
          </h1>
          <div className="sub">Current capacity · {heroSub}</div>
          {s.capacity.extra > 0 && state === "protected" && (
            <span className="pill-note">⚡ +{s.capacity.extra} Mbps temporary plan</span>
          )}
        </div>
        {problem}
        {state === "protected" && s.session && <SessionCard session={s.session} />}
      </div>

      <div>
        <div className="card-title" style={{ marginTop: 16 }}>Connection</div>
        <div className="card">
          <div className="row">
            <span className="grow k">Primary network</span>
            <span className={`v ${!s.capacity.primaryDown ? "ok" : ""}`}>{s.capacity.primaryDown ? "Down" : "Connected"}</span>
          </div>
          <div className="row"><span className="grow k">NetChain protection</span><span className="v ok">Active</span></div>
          <div className="row">
            <span className="grow k">Network strength</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StrengthBars filled={signal.filled} cls={signal.cls} />
              <span className={`v ${signal.filled >= 3 ? "ok" : ""}`}>{signal.label}</span>
            </span>
          </div>
          {state === "protected" && s.session && !s.session.ended && (
            <div className="row">
              <span className="grow k">Live verification</span>
              <span className="v ok">
                {s.session.checks.total > 0
                  ? `✓ ${s.session.checks.passed}/${s.session.checks.total} checks`
                  : "running…"}
              </span>
            </div>
          )}
        </div>

        <div className="card-title">Your protection</div>
        <div className="card">
          <div className="row"><span className="grow k">Auto recovery</span><span className={`v ${s.auto ? "ok" : ""}`}>{s.auto ? "ON" : "OFF"}</span></div>
          <div className="row"><span className="grow k">Charges</span><span className="v">per transaction · {rm(0.3)} fee</span></div>
          <div className="row">
            <span className="grow k">Recovery budget</span>
            <span className="v">
              {rm0(s.monthlyLimit)}
              <span style={{ color: "var(--muted)", fontWeight: 500 }}> / month</span>
            </span>
          </div>
        </div>
        <p className="note">No plans, no subscription — you pay per recovery, only after verified delivery. Emergency and life-safety traffic always has priority.</p>
      </div>
    </div>
  );
}
