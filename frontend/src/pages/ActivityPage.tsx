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
  const chainRows = useAppStore((s) => s.chainRows);

  const sorted = [...activity].sort((a, b) => b.ts - a.ts);
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const a of sorted) {
    const label = dayLabel(a.ts);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(a);
    else groups.push({ label, items: [a] });
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingTop: 6 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Autonomous Activity Ledger</h1>
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
            Immutable audit trail of network probe events, Gonka decisions, CAMARA activations, and Sui split
            settlements.
          </p>
        </div>
      </div>

      {/* On-chain ledger rows (trust server SSE — real tx digests) */}
      {chainRows.length > 0 && (
        <>
          <div className="act-date" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Sui Trust Ledger
            <span className="chip sui" style={{ fontSize: 10 }}>live</span>
          </div>
          <div className="card">
            {chainRows.slice(0, 12).map((row, i) => (
              <div key={(row.seq ?? 0) + "-" + i} className="row">
                <div className="grow">
                  <div className="t" style={{ fontSize: 13 }}>{row.label ?? row.type}</div>
                  <div className="s mono" style={{ fontSize: 11 }}>
                    {row.incidentId ?? "—"} · nonce {row.nonce ?? "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {row.txDigest ? (
                    <a
                      className="s mono"
                      style={{ color: "var(--sui)", fontWeight: 700, textDecoration: "none" }}
                      href={`https://suiscan.xyz/testnet/tx/${row.txDigest}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.txDigest.slice(0, 10)}… ↗
                    </a>
                  ) : (
                    <span className="s">no digest</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

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
                  {a.time && <div className="s mono" style={{ color: "var(--ink)", fontWeight: 700 }}>{a.time}</div>}
                  <div className="s" style={{ fontWeight: 600 }}>
                    {a.cost != null && a.cost > 0 ? rm(a.cost) : a.note}
                  </div>
                </div>
                {a.recordId && <span style={{ color: "var(--faint)", fontSize: 18, marginLeft: 4 }}>›</span>}
              </>
            );
            return a.recordId ? (
              <button
                key={a.id}
                className="card row act-item"
                style={{ width: "100%", cursor: "pointer", textAlign: "left" }}
                onClick={() => navigate("/activity/" + a.recordId)}
              >
                {inner}
              </button>
            ) : (
              <div key={a.id} className="card">
                <div className="row">{inner}</div>
              </div>
            );
          })}
        </div>
      ))}
      <p className="note">
        Click any recovery incident to inspect cryptographic signatures, Time-to-Recovery breakdown, and SuiScan testnet
        explorer verification proofs.
      </p>
    </div>
  );
}

export function ActivityDateMeta(ts: number) {
  return fmtDate(ts);
}
