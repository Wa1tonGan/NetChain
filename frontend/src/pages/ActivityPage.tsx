import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { fmtDate } from "../services/format";
import SlaLineChart from "../components/SlaLineChart";
import DecisionCard from "../components/DecisionCard";
import AgentSteps, { stepsForStage } from "../components/AgentSteps";
import type { ActivityItem, RecoveryRecord } from "../services/types";

function outcomeChip(outcome: ActivityItem["type"]) {
  if (outcome === "failed") return <span className="inc-chip ref">REFUNDED</span>;
  if (outcome === "check") return <span className="inc-chip ok">HEALTHY</span>;
  return <span className="inc-chip ok">SETTLED</span>;
}

/* ---------- inline incident flow (prototype: stages in the right pane) ---- */

function Stage({
  kicker,
  name,
  digest,
  amount,
  amountSub,
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
  status: string;
  statusCls?: string;
  dot?: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className={`stage${open ? " open" : ""}`}>
      <div className={`stage-dot${dot ? " " + dot : ""}`}>{dot === "pen" ? "!" : dot === "ref" ? "↩" : "✓"}</div>
      <div className="stage-card">
        <button className="stage-head" onClick={() => setOpen(!open)}>
          <div>
            <div className="stage-kicker">{kicker}</div>
            <div className="stage-name">{name}</div>
            {digest && <div className="stage-digest mono">{digest}</div>}
          </div>
          <div className="stage-amt">
            <div className="a">{amount}</div>
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

function IncidentFlow({ record }: { record: RecoveryRecord }) {
  const r = record;
  const isFailed = r.outcome === "failed";
  const isPenalty = r.outcome === "under";
  const capCharge = Math.max(0, +(r.charged - r.fee).toFixed(2));
  const providerNet = isFailed ? 0 : Math.max(0, +(capCharge - r.refund).toFixed(2));
  const totalPct = capCharge > 0 ? Math.round((providerNet / capCharge) * 100) : 0;

  return (
    <div>
      {!isFailed && (
        <div style={{ marginBottom: 16 }}>
          <SlaLineChart durationMin={r.min} agreedMbps={r.cap} outcome={r.outcome} />
        </div>
      )}

      <div className="deal-flow">
        {/* Stage 1 · Escrow */}
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
                <span>Returned to buyer</span>
                <span>{rm(r.charged)}</span>
              </div>
              <div className="r-dash" />
              <div className="r-line">
                <span>Reason</span>
                <span>activation failed</span>
              </div>
              <div className="r-stamp blue">REFUNDED · NO SERVICE CHARGED</div>
            </div>
            <AgentSteps steps={stepsForStage(r.timeline, "settle")} r={r} providerNet={providerNet} />
          </Stage>
        ) : (
          <Stage
            kicker="Stage 2 · Verify"
            name={isPenalty ? "SLA Verification — Penalty" : "SLA Verification"}
            amount={isPenalty ? `${Math.round((r.delivered / r.cap) * 100)}%` : "OK"}
            amountSub={`${r.delivered || r.cap} / ${r.cap} Mbps`}
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
                  <span>{Math.round((r.delivered / r.cap) * 100)}% delivered · penalty applied</span>
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
              <div className={`r-stamp${isPenalty ? " amber" : ""}`}>
                {isPenalty ? "PENALTY APPLIED" : "AUTO-RELEASED ✓"}
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
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function ActivityPage() {
  const activity = useAppStore((s) => s.activity);
  const records = useAppStore((s) => s.records);

  const sorted = [...activity].sort((a, b) => b.ts - a.ts);
  const withRecords = sorted.filter((a) => a.recordId && records[a.recordId]);
  const [selectedId, setSelectedId] = useState<string | null>(withRecords[0]?.recordId ?? null);

  const selected = selectedId ? records[selectedId] : undefined;
  const selectedItem = selectedId ? activity.find((a) => a.recordId === selectedId) : undefined;

  return (
    <div>
      <div className="page-head">
        <h2>Incidents</h2>
        <p>
          Every autonomous recovery on this line — escrow → verify → settle.
          <br />
          Pick an incident on the left; the full stage flow opens on the right.
        </p>
      </div>

      <div className="inc-layout">
        {/* Sidebar of recent incidents (sticky) */}
        <div className="inc-side">
          <div className="inc-side-label">Incidents</div>
          {sorted.slice(0, 8).map((a) => (
            <button
              key={a.id}
              className={`inc-item${(selectedId ?? withRecords[0]?.recordId) === a.recordId ? " sel" : ""}`}
              onClick={() => a.recordId && setSelectedId(a.recordId)}
            >
              <span className="inc-top">
                <span className="inc-id">{a.recordId ?? a.id.replace(/^a-/, "NC-")}</span>
                {outcomeChip(a.type)}
              </span>
              <span className="inc-title">{a.title}</span>
              <span className="inc-meta">
                {a.sub} · {a.cost != null && a.cost > 0 ? rm(a.cost) : a.note}
              </span>
            </button>
          ))}
          {sorted.length === 0 && <div className="inc-meta" style={{ padding: "4px" }}>No incidents yet.</div>}
        </div>

        {/* Main: the selected incident's full stage flow (prototype style) */}
        <div className="inc-main">
          {selected && selectedItem ? (
            <>
              <div className="page-head" style={{ marginBottom: 14, marginTop: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 22 }}>Incident {selected.id}</h2>
                  {outcomeChip(selectedItem.type)}
                </div>
                <p style={{ margin: 0 }}>
                  {fmtDate(selectedItem.ts)} · {selectedItem.sub} · recovered by {selected.provider}
                </p>
              </div>
              <IncidentFlow record={selected} />
            </>
          ) : (
            <div className="card">
              <div className="pad" style={{ color: "var(--muted)", fontSize: 13 }}>
                Pick an incident on the left to inspect its escrow → verify → settle flow, agent log and cryptographic
                proofs.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
