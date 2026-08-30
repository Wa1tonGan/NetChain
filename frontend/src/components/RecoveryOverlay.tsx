import { useEffect, useState } from "react";
import { useAppStore, elapsedSecAt } from "../store/useAppStore";
import { rm, PLATFORM_FEE } from "../services/pricing";
import { STEP_INDEX, STEP_LABELS } from "../services/flows";
import type { Incident } from "../services/types";
import DecisionCard from "./DecisionCard";

/* Live recovery overlay: pipeline + timer on one side; SMS thread,
   purchase approval, decision evidence and money state on the other.
   Wide two-panel layout on desktop, bottom sheet on mobile. */

export function StrengthBars({ filled, cls }: { filled: number; cls?: string }) {
  return (
    <span className={`strength ${cls ?? ""}`} role="img" aria-label={`${filled} of 4 signal bars`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= filled ? "on" : ""} />
      ))}
    </span>
  );
}

function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [active]);
}

function Thread({ incident }: { incident: Incident }) {
  return (
    <div className="thread" aria-label="Recovery SMS thread">
      {incident.thread.map((b, i) => (
        <div key={i} className={`bubble ${b.from}`}>
          {b.auto && <span className="auto-tag">auto reply</span>}
          {b.text}
        </div>
      ))}
    </div>
  );
}

function Composer({ shortage }: { shortage: number }) {
  const sendSms = useAppStore((s) => s.sendSms);
  const [value, setValue] = useState("");
  const price = (min: number) => +(shortage * min * 0.00084).toFixed(2);
  const chips = [15, 30, 60].map((m) => `${m} min, RM ${price(m) % 1 === 0 ? price(m).toFixed(0) : price(m).toFixed(2)}`);
  const send = () => {
    if (value.trim()) {
      sendSms(value.trim());
      setValue("");
    }
  };
  return (
    <>
      <div className="qchips">
        {chips.map((t) => (
          <button key={t} onClick={() => setValue(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="smsbar">
        <input
          value={value}
          placeholder="e.g. 30 min, RM 14"
          aria-label="Reply with duration and budget"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          autoFocus
        />
        <button className="btn primary" onClick={send}>
          Send
        </button>
      </div>
    </>
  );
}

function Purchase({ incident }: { incident: Incident }) {
  const r = incident.req;
  if (!r) return null;
  // live mode fills these from the real Selected Offer; simulation falls
  // back to the local pricing preview
  const provider = r.provider ?? "Provider B";
  const fee = r.platformFee ?? PLATFORM_FEE;
  const planPrice = r.planPrice ?? +(r.cost - PLATFORM_FEE).toFixed(2);
  const escrow = r.escrow ?? r.cost;
  return (
    <>
      <div className="purchase">
        <div className="ph">Purchase approved · {r.text}</div>
        <div className="pr"><span className="k">Provider</span><span className="v">{provider}</span></div>
        <div className="pr"><span className="k">Capacity</span><span className="v">{incident.shortage} Mbps</span></div>
        <div className="pr"><span className="k">Duration</span><span className="v">{r.min} min</span></div>
        <div className="pr"><span className="k">Provider price</span><span className="v">{rm(planPrice)}</span></div>
        <div className="pr"><span className="k">Platform fee</span><span className="v">{rm(fee)}</span></div>
        <div className="pr"><span className="k">Total escrowed</span><span className="v">{rm(escrow)}</span></div>
      </div>
      {incident.kind !== "live" && <DecisionCard cap={incident.shortage} cost={r.cost} budget={r.budget} />}
      <div className="money-state">
        🔒 {rm(escrow)} locked in escrow — released only after verification passes
      </div>
    </>
  );
}

function StepList({ incident }: { incident: Incident }) {
  const cur = STEP_INDEX[incident.status] ?? 0;
  return (
    <div className="steps" style={{ marginTop: 8 }}>
      {STEP_LABELS.map((label, i) => {
        let cls = i < cur ? "done" : i === cur ? "now" : "";
        if (incident.status === "failed" && i === 5) cls = "fail";
        return (
          <div key={label} className={`step ${cls}`}>
            <span className="ic" />
            {label}
          </div>
        );
      })}
    </div>
  );
}

export default function RecoveryOverlay({ incident }: { incident: Incident }) {
  const dismissOverlay = useAppStore((s) => s.dismissOverlay);
  const records = useAppStore((s) => s.records);
  const disclosures = useAppStore((s) => s.disclosures);
  const disclose = useAppStore((s) => s.disclose);
  const capacity = useAppStore((s) => s.capacity);
  const running = useAppStore((s) => s.running);

  useTicker(running || incident.status === "sms");

  // live healthy-day ending: the watcher said no purchase is needed
  if (incident.status === "noop") {
    return (
      <div className="overlay">
        <div className="sheet" role="dialog" aria-modal="true" aria-label="No recovery needed">
          <span className="chip green"><span className="dot" />ALL CLEAR</span>
          <h2>No recovery needed</h2>
          <p className="lede">
            The watcher checked your network and the existing links already cover the shortfall. The agent market was
            not asked to buy anything — nothing was locked and nothing was charged.
          </p>
          <div className="money-state ok">✓ No escrow, no purchase — healthy-day check complete</div>
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={dismissOverlay}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  if (incident.status === "restored") {
    const r = records[incident.id];
    if (!r) return null;
    const under = r.outcome === "under";
    const costHtml = r.refund ? (
      <>
        {rm(r.charged)}
        <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 700, display: "block" }}>
          {rm(r.refund)} refunded
        </span>
      </>
    ) : (
      rm(r.charged)
    );
    const capCharge = Math.max(0, +(r.charged - r.fee).toFixed(2));
    return (
      <div className="overlay">
        <div className="sheet wide" role="dialog" aria-modal="true" aria-label="Recovery complete">
          <div className="ov-main">
            {under ? (
              <span className="chip amber"><span className="dot" />RESTORED · PARTIAL REFUND</span>
            ) : (
              <span className="chip green"><span className="dot" />CONNECTION RESTORED</span>
            )}
            <h2>Connection restored</h2>
            <p className="lede">
              {under
                ? `The provider delivered ${r.delivered} of ${r.cap} Mbps. A penalty refund was settled automatically, and live checks keep watching the plan.`
                : "NetChain restored your connection with temporary capacity. Live checks will verify the agreed strength for the whole duration."}
            </p>
            <div className="result-grid">
              <div className="rg"><div className="rk">Recovered capacity</div><div className="rv ok">+{r.cap} Mbps</div></div>
              <div className="rg"><div className="rk">Current capacity</div><div className="rv">{capacity.current} Mbps</div></div>
              <div className="rg"><div className="rk">Recovery time</div><div className="rv">{r.time} sec</div></div>
              <div className="rg"><div className="rk">Cost</div><div className="rv" style={{ fontSize: 16 }}>{costHtml}</div></div>
            </div>
            <div className={`money-state ${under ? "" : "ok"}`} style={{ marginTop: 14 }}>
              {under
                ? `✓ ${rm(r.charged)} settled · ${rm(r.refund)} refunded — penalty applied for under-delivery`
                : `✓ ${rm(r.charged)} settled — released only after verified delivery`}
            </div>
            <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              Signal strength <StrengthBars filled={under ? 2 : 4} cls={under ? "strength-2" : ""} />
              <b style={{ color: "var(--ink)" }}>{under ? "Fair" : "Excellent"}</b> · Provider {r.provider} · {r.min}-minute plan
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <button className="btn primary" onClick={dismissOverlay}>Done</button>
              <button className="btn subtle" style={{ width: "auto" }} onClick={() => disclose("ov_" + incident.id)}>
                Details
              </button>
            </div>
          </div>
          <div className="ov-side">
            <div className="purchase" style={{ marginTop: 4 }}>
              <div className="ph">Purchase · from your SMS “{r.smsText}”</div>
              <div className="pr"><span className="k">Provider</span><span className="v">{r.provider}</span></div>
              <div className="pr"><span className="k">Capacity · duration</span><span className="v">{r.cap} Mbps · {r.min} min</span></div>
              <div className="pr"><span className="k">Provider price</span><span className="v">{rm(capCharge)}</span></div>
              <div className="pr"><span className="k">Platform fee</span><span className="v">{rm(r.fee)}</span></div>
              <div className="pr"><span className="k">Total</span><span className="v">{rm(r.cost)}</span></div>
            </div>
            <DecisionCard cap={r.cap} cost={r.cost} budget={r.budget} provider={r.provider} comparison={r.comparison} />
            {disclosures["ov_" + incident.id] ? (
              <div className="disc">
                <div className="tech">
                  <span className="k">Money state</span><span className="v">{r.state}</span>
                  <span className="k">Verification</span>
                  <span className="v">{under ? `Under-delivery — ${r.delivered}/${r.cap} Mbps` : "Passed"}</span>
                  <span className="k">Network</span><span className="v">Sui</span>
                  <span className="k">Transaction ID</span><span className="v">{r.tx}</span>
                  <span className="k">View</span>
                  <span className="v"><a className="txlink" href="https://suiscan.xyz/testnet" target="_blank" rel="noopener">SuiScan ↗</a></span>
                  <span className="k">Recovery</span><span className="v">#{r.id}</span>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <button className="btn link" style={{ paddingLeft: 0 }} onClick={() => disclose("ov_" + incident.id)}>
                  Transaction details
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (incident.status === "failed") {
    const r = records[incident.id];
    if (!r) return null;
    return (
      <div className="overlay">
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Recovery failed">
          <span className="chip red"><span className="dot" />RECOVERY FAILED</span>
          <h2>Extra capacity couldn't be added</h2>
          <p className="lede">
            The provider could not activate the temporary capacity. Your connection is still down — and you weren't
            charged.
          </p>
          <div className="result-grid">
            <div className="rg"><div className="rk">Your charge</div><div className="rv ok">{rm(0)}</div></div>
            <div className="rg"><div className="rk">Reservation</div><div className="rv" style={{ fontSize: 15 }}>
              {r.refund > 0 ? `${rm(r.refund)} refunded` : "Nothing locked"}
            </div></div>
            <div className="rg"><div className="rk">Available now</div><div className="rv">{capacity.current} Mbps</div></div>
            <div className="rg"><div className="rk">Recovery time</div><div className="rv">{r.time} sec</div></div>
          </div>
          <div className="money-state ok">
            {r.refund > 0
              ? `✓ ${rm(r.refund)} refunded — the locked amount returned to your balance automatically`
              : "✓ Nothing was charged — no escrow was committed"}
          </div>
          <p className="note">NetChain keeps watching. Send a new recovery request from Home anytime.</p>
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={dismissOverlay}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  // running (detected … verifying)
  const waiting = incident.status === "sms";
  const elapsed = elapsedSecAt(incident, Date.now()).toFixed(1);
  return (
    <div className="overlay">
      <div className="sheet wide" role="dialog" aria-modal="true" aria-label="Recovery in progress">
        <div className="ov-main">
          <span className="chip blue"><span className="dot" />RECOVERING</span>
          <h2>{waiting ? "Reply to approve your recovery" : "We're restoring your connection"}</h2>
          <p className="lede">
            {waiting
              ? `Your main connection is down and you're ${incident.shortage} Mbps short.`
              : "Handling your request automatically — no action needed."}
          </p>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 12 }}>
            <div className="timer">
              {elapsed}
              <span className="u">sec</span>
            </div>
          </div>
          <StepList incident={incident} />
        </div>
        <div className="ov-side">
          {waiting ? (
            <>
              <Thread incident={incident} />
              <Composer shortage={incident.shortage} />
              <p className="note" style={{ marginTop: 12 }}>
                Your reply approves this recovery up to the budget you send. Auto recovery can send it for you.
              </p>
            </>
          ) : incident.kind === "live" && !incident.req?.provider ? (
            <>
              <Thread incident={incident} />
              <div className="money-state">📡 Provider agents are quoting — ranking the signed offers…</div>
            </>
          ) : (
            <>
              <Thread incident={incident} />
              <Purchase incident={incident} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
