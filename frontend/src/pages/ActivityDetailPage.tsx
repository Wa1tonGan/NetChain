import { Link, useParams } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { fmtDate } from "../services/format";
import { rm, rm0 } from "../services/pricing";
import { StrengthBars } from "../components/RecoveryOverlay";
import DecisionCard from "../components/DecisionCard";

export default function ActivityDetailPage() {
  const { id } = useParams();
  const s = useAppStore();
  const a = s.activity.find((x) => x.id === id);
  const r = id ? s.records[id] : undefined;
  const showDisc = id ? !!s.disclosures["rec_" + id] : false;
  const liveSession = s.session && s.session.id === id ? s.session : undefined;

  if (!a || !r) {
    return <div className="card"><div className="pad">Record not found.</div></div>;
  }

  const chip =
    r.outcome === "failed" ? (
      <span className="chip red"><span className="dot" />FAILED</span>
    ) : r.outcome === "under" ? (
      <span className="chip amber"><span className="dot" />RECOVERED · PARTIAL REFUND</span>
    ) : (
      <span className="chip green"><span className="dot" />RECOVERED</span>
    );
  const capCharge = Math.max(0, +(r.charged - r.fee).toFixed(2));

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Link to="/activity" className="btn link" style={{ marginTop: 10, paddingLeft: 0, textDecoration: "none" }}>
        ← Activity
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em" }}>Recovery #{r.id}</h1>
        {chip}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
        {fmtDate(a.ts)} · {a.sub}
      </div>

      <div className="cols" style={{ marginTop: 6 }}>
        <div>
          <div className="card">
            <div className="pad">
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em" }}>TIMELINE</div>
              {r.timeline.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", gap: 10, padding: "5px 0",
                    marginTop: i === 0 ? 6 : 5,
                    borderTop: i === 0 ? "none" : "1px solid var(--line-soft)",
                  }}
                >
                  <span className="tl-time">{e.time.slice(0, 8)}</span>
                  <span style={{ fontSize: 13.5 }}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="result-grid" style={{ marginTop: 14 }}>
            <div className="rg"><div className="rk">Recovery time</div><div className="rv">{r.time} sec</div></div>
            <div className="rg">
              <div className="rk">{r.restored ? "Capacity added" : "Capacity"}</div>
              <div className={`rv ${r.restored ? "ok" : ""}`}>{r.restored ? `+${r.cap} Mbps` : "—"}</div>
            </div>
            <div className="rg">
              <div className="rk">Cost</div>
              <div className="rv">
                {rm(r.charged)}
                {r.refund > 0 && r.outcome !== "failed" && (
                  <div style={{ fontSize: 11.5, color: "var(--warn)", fontWeight: 600 }}>{rm(r.refund)} refunded</div>
                )}
              </div>
            </div>
            <div className="rg"><div className="rk">Provider</div><div className="rv" style={{ fontSize: 14.5 }}>{r.provider}</div></div>
          </div>

          {r.outcome !== "failed" && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="pad">
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em" }}>DELIVERY</div>
                <div className="stat-line" style={{ padding: "12px 0" }}>
                  <span className="k">Delivered at activation</span>
                  <span className={`v ${r.outcome === "under" ? "warnv" : "ok"}`}>{r.delivered} / {r.cap} Mbps</span>
                </div>
                <div className="stat-line" style={{ padding: "12px 0" }}>
                  <span className="k">Signal strength</span>
                  <span className="v" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <StrengthBars filled={r.outcome === "under" ? 2 : 4} cls={r.outcome === "under" ? "strength-2" : ""} />
                    {r.outcome === "under" ? "Fair" : "Excellent"}
                  </span>
                </div>
                <div className="stat-line" style={{ padding: "12px 0" }}>
                  <span className="k">Verification</span>
                  <span className={`v ${r.outcome === "under" ? "warnv" : "ok"}`}>
                    {r.outcome === "under" ? "Under-delivery — penalty applied" : "Passed"}
                  </span>
                </div>
                {liveSession && (
                  <>
                    <div className="stat-line" style={{ padding: "12px 0" }}>
                      <span className="k">Live SLA checks</span>
                      <span className={`v ${liveSession.checks.passed === liveSession.checks.total ? "ok" : "warnv"}`}>
                        {liveSession.checks.total > 0
                          ? `${liveSession.checks.passed}/${liveSession.checks.total} within agreement`
                          : "running…"}
                      </span>
                    </div>
                    {liveSession.checks.total > 0 && (
                      <div className="stat-line" style={{ padding: "12px 0" }}>
                        <span className="k">Average delivered</span>
                        <span className={`v ${liveSession.checks.passed === liveSession.checks.total ? "ok" : "warnv"}`}>
                          {(liveSession.checks.avgSum / liveSession.checks.total).toFixed(1)} / {liveSession.agreed} Mbps
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="pad">
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em" }}>YOUR REQUEST</div>
              <div style={{ marginTop: 8, fontSize: 13.5 }}>“{r.smsText}”</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                → {r.cap} Mbps · {r.min} min · budget {rm0(r.budget)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="pad">
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", letterSpacing: ".05em" }}>PAYMENT</div>
              <div className="stat-line" style={{ padding: "12px 0" }}>
                <span className="k">Capacity charge</span><span className="v">{rm(capCharge)}</span>
              </div>
              <div className="stat-line" style={{ padding: "12px 0" }}>
                <span className="k">Platform fee</span><span className="v">{rm(r.fee)}</span>
              </div>
              {r.refund > 0 && (
                <div className="stat-line" style={{ padding: "12px 0" }}>
                  <span className="k">Refunded to you</span><span className="v ok">− {rm(r.refund)}</span>
                </div>
              )}
              <div className="stat-line" style={{ padding: "12px 0" }}>
                <span className="k">Total charged</span><span className="v">{rm(r.charged)}</span>
              </div>
              <div className="stat-line" style={{ padding: "12px 0" }}>
                <span className="k">Money state</span>
                <span className={`v ${r.outcome === "failed" ? "warnv" : "ok"}`}>{r.state}</span>
              </div>
              <button className="btn link" style={{ paddingLeft: 0 }} onClick={() => s.disclose("rec_" + r.id)}>
                Transaction details
              </button>
              {showDisc && (
                <div className="disc">
                  <div className="tech">
                    <span className="k">Payment status</span><span className="v">{r.state}</span>
                    <span className="k">Network</span><span className="v">Sui</span>
                    <span className="k">Verification</span>
                    <span className="v">
                      {r.outcome === "under"
                        ? "Under-delivery — penalty applied"
                        : r.outcome === "failed"
                          ? "Failed — refunded"
                          : "Passed"}
                    </span>
                    <span className="k">Transaction ID</span><span className="v">{r.tx}</span>
                    <span className="k">View</span>
                    <span className="v">
                      <a className="txlink" href="https://suiscan.xyz/testnet" target="_blank" rel="noopener">SuiScan ↗</a>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {r.outcome !== "failed" && <DecisionCard cap={r.cap} cost={r.cost} budget={r.budget} />}
        </div>
      </div>
    </div>
  );
}
