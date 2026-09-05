import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { fmtDate } from "../services/format";
import { rm } from "../services/pricing";
import { reclaimEscrow } from "../services/live";
import SlaLineChart from "../components/SlaLineChart";
import DecisionCard from "../components/DecisionCard";
import ClaimAuditCard from "../components/ClaimAuditCard";
import AgentSteps, { stepsForStage } from "../components/AgentSteps";
import Icon from "../components/Icon";
import { getExplorerTxUrl, getExplorerName } from "../services/explorer";
function Stage({
  kicker,
  name,
  digest,
  amount,
  amountSub,
  amountCls,
  status,
  statusCls,
  dot,
  defaultOpen,
  children,
}: {
  kicker: string;
  name: string;
  digest?: string;
  amount: string;
  amountSub?: string;
  amountCls?: string;
  status: string;
  statusCls?: string;
  dot?: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className={`stage${open ? " open" : ""}`}>
      <div className={`stage-dot${dot ? " " + dot : ""}`}>{dot === "pen" ? <Icon name="warning" size={11} /> : dot === "ref" ? <Icon name="refund" size={11} /> : <Icon name="check" size={11} />}</div>
      <div className="stage-card">
        <button className="stage-head" onClick={() => setOpen(!open)}>
          <div>
            <div className="stage-kicker">{kicker}</div>
            <div className="stage-name">{name}</div>
            {digest && <div className="stage-digest mono">{digest}</div>}
          </div>
          <div className="stage-amt">
            <div className={`a${amountCls ? " " + amountCls : ""}`}>{amount}</div>
            {amountSub && <div className="s">{amountSub}</div>}
          </div>
          <span className="txd-status" style={statusCls ? { color: statusCls, background: "transparent", border: "1px solid currentColor" } : undefined}>
            {status}
          </span>
          <span className="stage-caret">›</span>
        </button>
        {open && <div className="stage-body">{children}</div>}
      </div>
    </div>
  );
}

export default function ActivityDetailPage() {
  const { id } = useParams();
  const s = useAppStore();
  const preferredExplorer = s.preferredExplorer;
  // by the plain incident id — match both.
  const a = s.activity.find((x) => x.id === id || x.recordId === id);
  const r = id ? s.records[id] : undefined;
  const gatewayId = r?.nonce?.split(":")[0];
  const audit = (gatewayId ? s.claimAudits[gatewayId] : undefined) ?? (id ? s.claimAudits[id] : undefined);
  const [showDisc, setShowDisc] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [reclaimState, setReclaimState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [reclaimTx, setReclaimTx] = useState<string | null>(null);

  if (!a || !r) {
    return (
      <div className="card">
        <div className="pad">Record not found.</div>
      </div>
    );
  }

  // A commit can land on-chain yet the flow die before settlement ("chain
  // offline") — the escrow stays locked past expiry until someone reclaims.
  // Permissionless: the platform key calls escrow::reclaim, funds return to
  // the buyer regardless of caller.
  const reclaimable = Boolean(r.nonce && r.commitTx) && /offline/i.test(r.state ?? "");

  async function handleReclaim() {
    if (!r?.nonce) return;
    setReclaimState("working");
    try {
      const res = await reclaimEscrow(r.nonce);
      setReclaimTx(res.txDigest ?? null);
      setReclaimState("done");
    } catch (err) {
      setReclaimState("error");
      setReclaimTx(err instanceof Error ? err.message : String(err));
    }
  }

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isFailed = r.outcome === "failed";
  const isPenalty = r.outcome === "under";
  const capCharge = Math.max(0, +(r.charged - r.fee).toFixed(2));
  const providerNet = isFailed ? 0 : Math.max(0, +(capCharge - r.refund).toFixed(2));
  const totalPct = capCharge > 0 ? Math.round((providerNet / capCharge) * 100) : 0;

  const chip = isFailed ? (
    <span className="chip blue">
      <span className="dot" />
      REFUNDED
    </span>
  ) : isPenalty ? (
    <span className="chip amber">
      <span className="dot" />
      PENALTY APPLIED
    </span>
  ) : (
    <span className="chip good">
      <span className="dot" />
      SETTLED
    </span>
  );

  const stampCls = isFailed ? "blue" : isPenalty ? "amber" : "";

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <Link to="/activity" className="btn link" style={{ marginTop: 8, paddingLeft: 0, textDecoration: "none" }}>
        ← Back to Incidents
      </Link>

      <div className="page-head" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Incident {r.id}</h2>
          {chip}
        </div>
        <p>
          {fmtDate(a.ts)} · {a.sub} · recovered by {r.provider}
        </p>
      </div>

      <div className="inc-layout" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div>
          {/* SLA chart for delivered sessions */}
          {!isFailed && (
            <div style={{ marginBottom: 16 }}>
              <SlaLineChart durationMin={r.min} agreedMbps={r.cap} outcome={r.outcome} />
            </div>
          )}

          {/* Stage 1 · Escrow */}
          <div className="deal-flow">
            <Stage
              kicker="Stage 1 · Escrow"
              name="Escrow Commit"
              digest={r.commitTx ? `tx ${r.commitTx.slice(0, 10)}…${r.commitTx.slice(-4)}` : `tx ${r.tx}`}
              amount={rm(r.charged)}
              amountSub="locked in escrow"
              status={r.commitTx ? "Finalized" : "Demo"}
              defaultOpen={!isFailed}
            >
              <div className="split-visual">
                <div className="split-bar">
                  <span className="prov" style={{ width: `${totalPct}%` }} />
                  <span className="plat" style={{ width: `${100 - totalPct}%` }} />
                </div>
                <div className="split-labels">
                  <span>
                    Provider <b>{rm(capCharge)}</b>
                  </span>
                  <span>
                    Platform <b>{rm(r.fee)}</b>
                  </span>
                </div>
              </div>
              {reclaimable && (
                <div style={{ padding: "0 20px 12px" }}>
                  <div
                    className="money-state"
                    style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                  >
                    <span style={{ flex: 1, minWidth: 200 }}>
                      Escrow locked on-chain but never settled (flow ended "chain offline"). Past expiry now — reclaim
                      returns {rm(r.charged)} to your wallet.
                    </span>
                    {reclaimState === "done" ? (
                      <span className="chip good">
                        <span className="dot" /> Reclaimed {reclaimTx ? `· tx ${reclaimTx.slice(0, 10)}…` : ""}
                      </span>
                    ) : (
                      <button className="link-btn" onClick={handleReclaim} disabled={reclaimState === "working"}>
                        {reclaimState === "working" ? "Reclaiming…" : <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="refund" size={12} /> Reclaim escrow</span>}
                      </button>
                    )}
                  </div>
                  {reclaimState === "error" && (
                    <div style={{ fontSize: 11.5, color: "var(--amber-ink)", marginTop: 6 }}>{reclaimTx}</div>
                  )}
                </div>
              )}
              {r.nonce && (
                <div style={{ padding: "0 20px 16px" }}>
                  <div className="txd-digest" style={{ marginTop: 0 }}>
                    <span className="mono">agreement nonce {r.nonce}</span>
                  </div>
                </div>
              )}
              <AgentSteps steps={stepsForStage(r.timeline, "escrow")} r={r} providerNet={providerNet} />
            </Stage>

            {/* Stage 2 · Verify (or Refund path) */}
            {isFailed ? (
              <Stage
                kicker="Stage 2 · Refund"
                name="Escrow Refund"
                amount={rm(r.charged)}
                amountSub="returned to buyer"
                amountCls=""
                status="REFUNDED"
                statusCls="var(--blue)"
                dot="ref"
                defaultOpen
              >
                <div className="receipt">
                  <div className="r-head">REFUND RECEIPT</div>
                  <div className="r-sub">released automatically by contract</div>
                  <div className="r-dash" />
                  <div className="r-line">
                    <span>Provider share</span>
                    <span>USDC 0.00</span>
                  </div>
                  <div className="r-line">
                    <span>Platform fee</span>
                    <span>USDC 0.00</span>
                  </div>
                  <div className="r-dash" />
                  <div className="r-line total">
                    <span>Returned to buyer</span>
                    <span>{rm(r.charged)}</span>
                  </div>
                  <div className="r-dash" />
                  <div className="r-line">
                    <span>Reason</span>
                    <span>activation failed</span>
                  </div>
                  <div className="r-line">
                    <span>tx</span>
                    <span>{r.commitTx ?? r.tx}</span>
                  </div>
                  <div className="r-stamp blue">REFUNDED · NO SERVICE CHARGED</div>
                  <div className="r-foot">
                    No ticket, no dispute, no waiting —
                    <br />
                    the escrow terms decided automatically.
                  </div>
                </div>
                <AgentSteps steps={stepsForStage(r.timeline, "settle")} r={r} providerNet={providerNet} />
              </Stage>
            ) : (
              <Stage
                kicker="Stage 2 · Verify"
                name={isPenalty ? "SLA Verification — Penalty" : "SLA Verification"}
                amount={isPenalty ? `${Math.round((r.delivered / r.cap) * 100)}%` : "OK"}
                amountSub={`${r.delivered || r.cap} / ${r.cap} Mbps`}
                amountCls={isPenalty ? "" : ""}
                status={isPenalty ? "PENALTY" : "PASS"}
                statusCls={isPenalty ? "var(--amber-ink)" : undefined}
                dot={isPenalty ? "pen" : undefined}
                defaultOpen={isPenalty}
              >
                <SlaLineChart durationMin={r.min} agreedMbps={r.cap} outcome={r.outcome} />
                <AgentSteps steps={stepsForStage(r.timeline, "verify")} r={r} providerNet={providerNet} />
              </Stage>
            )}

            {/* Stage 3 · Settle */}
            {!isFailed && (
              <Stage
                kicker="Stage 3 · Settle"
                name={isPenalty ? "Settlement (Penalty Applied)" : "Split Settlement"}
                amount={`${rm(providerNet)} + ${r.fee.toFixed(2)}`}
                amountSub="provider · platform"
                status="Finalized"
              >
                <div className="receipt">
                  <div className="r-head">SETTLEMENT RECEIPT</div>
                  <div className="r-sub">released automatically by contract</div>
                  <div className="r-dash" />
                  {isPenalty && (
                    <div className="r-line">
                      <span>SLA verdict</span>
                      <span>
                        {Math.round((r.delivered / r.cap) * 100)}% delivered · penalty applied
                      </span>
                    </div>
                  )}
                  <div className="r-line">
                    <span>Provider share (net)</span>
                    <span>{rm(providerNet)}</span>
                  </div>
                  {r.refund > 0 && (
                    <div className="r-line">
                      <span>Penalty → buyer</span>
                      <span>+ {rm(r.refund)}</span>
                    </div>
                  )}
                  <div className="r-line">
                    <span>Platform fee</span>
                    <span>{rm(r.fee)}</span>
                  </div>
                  <div className="r-dash" />
                  <div className="r-line total">
                    <span>Released from escrow</span>
                    <span>{rm(r.charged)}</span>
                  </div>
                  <div className="r-dash" />
                  <div className="r-line">
                    <span>tx</span>
                    <span>{r.commitTx ?? r.tx}</span>
                  </div>
                  <div className={`r-stamp${stampCls ? " " + stampCls : ""}`}>
                    {isPenalty ? "PENALTY APPLIED" : <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>AUTO-RELEASED <Icon name="check" size={12} /></span>}
                  </div>
                  <div className="r-foot">
                    Nobody clicked “pay” — the contract released funds
                    <br />
                    the moment the SLA verdict was on-chain.
                  </div>
                </div>
                <AgentSteps steps={stepsForStage(r.timeline, "settle")} r={r} providerNet={providerNet} />
              </Stage>
            )}
          </div>

          {/* Gonka multi-agent consensus */}
          {r.outcome !== "failed" && (
            <div style={{ marginTop: 18 }}>
              <DecisionCard cap={r.cap} cost={r.cost} budget={r.budget} provider={r.provider} comparison={r.comparison} votes={r.consensus} />
            </div>
          )}

          {/* Truth Agent audit (Gonka multi-model SLA verification) */}
          {audit && <ClaimAuditCard audit={audit} />}

          {/* Cryptographic proofs */}
          <div className="card" style={{ marginTop: 18 }}>
            <div className="pad">
              <button
                className="btn link"
                style={{ padding: 0, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}
                onClick={() => setShowDisc(!showDisc)}
              >
                <Icon name={showDisc ? "chevron-down" : "chevron-right"} size={12} />
                <span>{showDisc ? "Hide cryptographic proofs" : "View cryptographic proofs"}</span>
              </button>
              {showDisc && (
                <div className="tech-box">
                  <div className="tech-item">
                    <span className="tk">Provider Sui Address</span>
                    <div className="tv">
                      <span>{r.providerAddr ?? "0x3b91a78824f923b01a88b1cc92487e419823ad760334"}</span>
                      <button
                        style={{ border: 0, cursor: "pointer", background: "rgba(0,0,0,.05)", color: "var(--muted)", fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}
                        onClick={() => copyToClipboard(r.providerAddr ?? "0x3b91a78824f923b01a88b1cc92487e419823ad760334", "prov")}
                      >
                        {copiedKey === "prov" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div className="tech-item">
                    <span className="tk">Platform Fee Recipient Address</span>
                    <div className="tv">
                      <span>{r.platformAddr ?? "0x71f3a9b2c44e5d16820ccb7713a2ff0e999a82c5512"}</span>
                      <button
                        style={{ border: 0, cursor: "pointer", background: "rgba(0,0,0,.05)", color: "var(--muted)", fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}
                        onClick={() => copyToClipboard(r.platformAddr ?? "0x71f3a9b2c44e5d16820ccb7713a2ff0e999a82c5512", "plat")}
                      >
                        {copiedKey === "plat" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div className="tech-item">
                    <span className="tk">Audit Log Hash (SHA-256)</span>
                    <div className="tv">
                      <span>{r.logHash ?? "0xab7999ade1e738c291884bb01"}</span>
                      <button
                        style={{ border: 0, cursor: "pointer", background: "rgba(0,0,0,.05)", color: "var(--muted)", fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}
                        onClick={() => copyToClipboard(r.logHash ?? "0xab7999ade1e738c291884bb01", "hash")}
                      >
                        {copiedKey === "hash" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div className="tech-item">
                    <span className="tk">Sui Transaction {r.commitTx ? "(on-chain digest)" : "(demo)"}</span>
                    <div className="tv">
                      <a
                        className="txlink"
                        href={r.commitTx ? getExplorerTxUrl(r.commitTx, preferredExplorer) : (preferredExplorer === "suivision" ? "https://testnet.suivision.xyz" : "https://suiscan.xyz/testnet")}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                      >
                        <span>{r.commitTx ?? r.tx}</span>
                        <Icon name="external-link" size={11} />
                        <span>{getExplorerName(preferredExplorer)}</span>
                      </a>
                    </div>
                  </div>
                  {r.nonce && (
                    <div className="tech-item">
                      <span className="tk">Escrow Nonce (idempotency key)</span>
                      <div className="tv">
                        <span>{r.nonce}</span>
                        <button
                          style={{ border: 0, cursor: "pointer", background: "rgba(0,0,0,.05)", color: "var(--muted)", fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}
                          onClick={() => copyToClipboard(r.nonce!, "nonce")}
                        >
                          {copiedKey === "nonce" ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

