import { useAppStore } from "../store/useAppStore";
import { rm, rm0 } from "../services/pricing";
import Icon from "./Icon";
export default function ProtectionModal({ onClose }: { onClose: () => void }) {
  const s = useAppStore();

  const perRecoveryOptions = [10, 20, 50];
  const monthlyOptions = [50, 100, 200];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Protection Settings</h3>
          <button className="btn link" onClick={onClose} aria-label="Close" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {/* Auto Recovery Switch */}
          <div className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <span className="grow">
              <span className="t" style={{ fontSize: 14 }}>Auto-Recovery</span>
              <div className="s">Restore connection automatically upon failure</div>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={s.auto}
                onChange={(e) => s.setAuto(e.target.checked)}
                aria-label="Auto recovery"
              />
              <i />
            </label>
          </div>

          {/* Budget Limits — ONLY SHOWN IF AUTO-RECOVERY IS ON */}
          {s.auto && (
            <>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
                    Max Budget Per Recovery
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{rm0(s.maxPerRecovery)}</span>
                </div>
                <div className="seg">
                  {perRecoveryOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={s.maxPerRecovery === opt ? "on" : ""}
                      onClick={() => s.setMaxPerRecovery(opt)}
                    >
                      {rm0(opt)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
                    Monthly Recovery Limit
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{rm0(s.monthlyLimit)}</span>
                </div>
                <div className="seg">
                  {monthlyOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={s.monthlyLimit === opt ? "on" : ""}
                      onClick={() => s.setMonthlyLimit(opt)}
                    >
                      {rm0(opt)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Pricing Summary */}
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 10,
              padding: "10px 12px",
              marginTop: 4,
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.6,
            }}
          >
            <div>• Pay-as-you-go: Charged only when recovery is verified.</div>
            <div>• Platform Fee: 5% (Min {rm(0.30)}) on quoted plan price.</div>
            <div>• 100% refund if provider fails to activate.</div>
          </div>

          <div style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
