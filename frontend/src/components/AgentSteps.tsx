import { useState } from "react";
import type { RecoveryRecord } from "../services/types";
import { rm } from "../services/pricing";
import { TextWithIcons } from "./Icon";

/* The mockup's "Agent activity behind this stage" list — populated from the
   record's REAL timeline events (store: inc.events), never canned stories.
   Each stage gets the slice of the timeline that belongs to it, and each
   expandable "why" panel is derived from live record fields (comparison,
   nonce, delivered/​cap, settlement amounts). */

interface Step {
  label: string;
  time: string;
  at?: number;
}

export type StageId = "escrow" | "verify" | "settle";

/** Which stage of the deal-flow a timeline event belongs to. */
export function stageOfEvent(label: string): StageId {
  const l = label.toLowerCase();
  if (/restor|settl|refund|walrus|evidence|archiv|release/.test(l)) return "settle";
  if (/qod|activat|capacity|verif|deliver|probe|sla/.test(l)) return "verify";
  return "escrow"; // detect / protect / broadcast / sms / reply / consensus / escrow
}

export function stepsForStage(steps: Step[], stage: StageId): Step[] {
  return steps.filter((s) => stageOfEvent(s.label) === stage);
}

interface Actor {
  who: string;
  verb: string;
  av: string;
  color: string;
}

function actorFor(label: string, provider: string): Actor {
  const l = label.toLowerCase();
  // live quotes: "MaxiLink Orbit quoted in 2.3s — “pitch”"
  if (/ quoted in/.test(l)) {
    const who = label.replace(/^✗\s*/, "").split(/\s+quoted in/)[0].trim() || provider;
    return { who, verb: "offer received", av: who.charAt(0), color: "#10b981" };
  }
  // live rejections: "✗ MetroLink Orbit rejected: over budget"
  if (/rejected:/.test(l)) {
    const who = label.replace(/^✗\s*/, "").split(/\s+rejected:/)[0].trim() || provider;
    return { who, verb: "offer rejected", av: who.charAt(0), color: "#f59e0b" };
  }
  if (/sms|reply|parsed/.test(l)) return { who: "You", verb: "replied with intent", av: "Y", color: "#64748b" };
  if (/gateway accepted|agent market/.test(l)) return { who: "Agent market", verb: "accepted intent", av: "M", color: "#64748b" };
  if (/signing the escrow|wallet signing/.test(l)) return { who: "Sui escrow", verb: "signing & committing", av: "S", color: "#8b5cf6" };
  if (/agent-to-agent|paying from/.test(l)) return { who: "RescueAgent", verb: "paying from pool", av: "R", color: "#0ea5e9" };
  if (/gonka|consensus|vot|3-model|3 voting/.test(l)) return { who: "Voting agents", verb: "voted on the deal", av: "◆", color: "#8b5cf6" };
  if (/escrow|locked|commit|refund|release/.test(l)) return { who: "Sui escrow", verb: /refund/.test(l) ? "refunded the buyer" : /lock|commit/.test(l) ? "funds locked" : "released funds", av: "S", color: "#8b5cf6" };
  if (/qod|activat|capacity|live/.test(l)) return { who: provider, verb: "capacity live", av: provider.charAt(0), color: "#10b981" };
  if (/verif|deliver|probe|sla/.test(l)) return { who: "Verification agents", verb: "checked delivery", av: "V", color: "#8b5cf6" };
  if (/broadcast|quer/.test(l)) return { who: "RescueAgent", verb: "A2A broadcast", av: "R", color: "#0ea5e9" };
  if (/protect/.test(l)) return { who: "RescueAgent", verb: "protected critical traffic", av: "R", color: "#0ea5e9" };
  return { who: "RescueAgent", verb: "acted", av: "R", color: "#0ea5e9" };
}

/** Data-driven "why" note for a step — empty when nothing real backs it. */
function reasonFor(label: string, r: RecoveryRecord, providerNet: number): string {
  const l = label.toLowerCase();
  const rejected = (r.comparison ?? []).filter((c) => !c.sel && c.state);

  // live quote line: pitch is already in the label — reason = market context
  if (/ quoted in/.test(l)) {
    const rej = rejected.map((c) => `${c.name} — ${c.state}`).join(" · ");
    return rej
      ? `Parallel A2A quote — every independent offer gives the voting agents real market prices to reason over. Rejected so far: ${rej}.`
      : "Parallel A2A quote — independent offers give the voting agents real market prices to reason over.";
  }
  // live rejection line: pull the reason straight out of the label
  if (/rejected:/.test(l)) {
    const reason = label.split(/rejected:\s*/i)[1] ?? "";
    const detail = (r.comparison ?? []).find((c) => /rejected/i.test(c.state) && label.includes(c.name.split(" (")[0]))?.state;
    return `Ranked out by the market scan${reason ? ` — ${reason}` : ""}.${detail ? ` Recorded: ${detail}.` : ""}`;
  }
  // ledger rows carry the authoritative story
  if (/locked on sui|voucher verified/.test(l)) {
    return `Funds held by the Move contract at nonce ${r.nonce ?? "—"} — the provider cannot touch them until the SLA verdict is on-chain.`;
  }
  if (/settled:/.test(l)) {
    return `Contract released ${rm(r.charged)} — provider ${rm(providerNet)}, platform ${rm(r.fee)}. Nobody clicked "pay".`;
  }
  if (/reclaimed/.test(l)) {
    return "The commitment expired unsettled — permissionless reclaim returned the locked escrow to the buyer.";
  }
  if (/gonka|consensus|vot|selected/.test(l)) {
    const rej = rejected.map((c) => `${c.name} — ${c.state}`).join(" · ");
    return `Consensus selected ${r.provider}. ${rej ? `Rejected: ${rej}.` : ""}`;
  }
  if (/escrow|locked|commit/.test(l)) {
    return `Funds held by the Move contract at nonce ${r.nonce ?? "—"} — the provider cannot touch them until the SLA verdict is on-chain.`;
  }
  if (/refund/.test(l)) {
    return `The escrow refunded the full ${rm(r.charged)} — activation never succeeded, so nothing was charged.`;
  }
  if (/qod|activat|capacity/.test(l)) {
    return `Programmable capacity path attached and measured against the promised ${r.cap} Mbps floor.`;
  }
  if (/verif|deliver|probe|sla/.test(l)) {
    return `${r.delivered || r.cap} / ${r.cap} Mbps verified against the agreement — ${r.outcome === "under" ? "shortfall triggers a penalty" : "provider kept its promise"}.`;
  }
  if (/restor|settl|release/.test(l)) {
    return `Contract released ${rm(r.charged)} — provider ${rm(providerNet)}, platform ${rm(r.fee)}. Nobody clicked "pay".`;
  }
  if (/broadcast|quer/.test(l)) {
    return `Parallel A2A query — ${rejected.length + 1} independent quotes give the voting agents real market prices.`;
  }
  if (/sms|reply|parsed/.test(l)) {
    return `Your reply set the terms: ${r.min} min · ${rm(r.budget)} budget. Agents may only quote inside it.`;
  }
  if (/protect/.test(l)) {
    return "P1 services were steered onto the backup path while the agent shopped for replacement capacity.";
  }
  return "";
}

function avatar(step: Step, r: RecoveryRecord): Actor {
  return actorFor(step.label, r.provider);
}

function AgentSteps({ steps, r, providerNet }: { steps: Step[]; r: RecoveryRecord; providerNet: number }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (steps.length === 0) return null;
  const t0 = steps[0].at;
  return (
    <div className="asteps">
      <div className="asteps-label">Agent activity behind this stage</div>
      <div>
        {steps.map((s, i) => {
          const actor = avatar(s, r);
          const tPlus = s.at != null && t0 != null ? `T+${((s.at - t0) / 1000).toFixed(1)}s` : s.time;
          const reason = reasonFor(s.label, r, providerNet);
          const open = openIdx === i;
          return (
            <div className={`astep${open ? " open" : ""}`} key={i}>
              <button className="astep-row" onClick={() => setOpenIdx(open ? null : i)}>
                <span className="act-av" style={{ background: actor.color }}>
                  {actor.av}
                </span>
                <div className="astep-body">
                  <div className="astep-line1">
                    <span className="astep-who">{actor.who}</span>
                    <span className="astep-verb">{actor.verb}</span>
                    <span className="astep-t">{tPlus}</span>
                  </div>
                  <div className="astep-text"><TextWithIcons text={s.label} /></div>
                </div>
                <span className="astep-caret">›</span>
              </button>
              {open && reason && (
                <div className="reason">
                  <span className="r-tag">Why</span>
                  {reason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AgentSteps;
