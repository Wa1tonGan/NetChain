import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { dayLabel, fmtDate } from "../services/format";
import { rm } from "../services/pricing";
import type { ActivityItem } from "../services/types";

function ActIcon({ type }: { type: ActivityItem["type"] }) {
  const [cls, glyph] = type === "ok" ? ["ok", "⚡"] : type === "failed" ? ["bad", "⚠"] : ["check", "✓"];
  return <div className={`act-ic ${cls}`}>{glyph}</div>;
}

export default function ActivityPage() {
  const navigate = useNavigate();
  const activity = useAppStore((s) => s.activity);

  const sorted = [...activity].sort((a, b) => b.ts - a.ts);
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const a of sorted) {
    const label = dayLabel(a.ts);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(a);
    else groups.push({ label, items: [a] });
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.01em", paddingTop: 6 }}>Activity</h1>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="act-date">{g.label}</div>
          {g.items.map((a) => {
            const inner = (
              <>
                <ActIcon type={a.type} />
                <div className="grow">
                  <div className="t">{a.title}</div>
                  <div className="s">{a.sub}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {a.time && <div className="s" style={{ color: "var(--ink)", fontWeight: 700 }}>{a.time}</div>}
                  <div className="s">{a.cost != null && a.cost > 0 ? rm(a.cost) : a.note}</div>
                </div>
                {a.recordId && <span style={{ color: "var(--faint)" }}>›</span>}
              </>
            );
            return a.recordId ? (
              <button key={a.id} className="card row act-item" onClick={() => navigate("/activity/" + a.recordId)}>
                {inner}
              </button>
            ) : (
              <div key={a.id} className="card"><div className="row">{inner}</div></div>
            );
          })}
        </div>
      ))}
      <p className="note">Activity shows what NetChain did on your behalf — recoveries, checks and refunds.</p>
    </div>
  );
}

export function ActivityDateMeta(ts: number) {
  return fmtDate(ts);
}
