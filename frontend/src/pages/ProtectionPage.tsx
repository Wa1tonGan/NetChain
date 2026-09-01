import { useAppStore } from "../store/useAppStore";
import { rm, rm0 } from "../services/pricing";

export default function ProtectionPage() {
  const s = useAppStore();

  const perRecoveryOptions = [10, 20, 50];
  const monthlyOptions = [50, 100, 200];

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Protection Settings</h1>
      <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
        NetChain automatically acquires replacement bandwidth when your line degrades, strictly within your budget limits.
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        {/* Auto Recovery Switch */}
        <div className="row">
          <span className="grow">
            <span className="t">Auto-Recovery</span>
            <div className="s">Acquire backup capacity automatically upon shortfall</div>
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={s.auto}
              onChange={(e) => s.setAuto(e.target.checked)}
              aria-label="Auto-recovery"
            />
            <i />
          </label>
        </div>

        {/* Max Per Recovery */}
        <div className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
            <span className="k">Max Budget Per Recovery</span>
            <span className="v">{rm0(s.maxPerRecovery)}</span>
          </div>
          <div className="seg">
            {perRecoveryOptions.map((opt) => (
              <button
                key={opt}
                className={s.maxPerRecovery === opt ? "on" : ""}
                onClick={() => s.setMaxPerRecovery(opt)}
              >
                {rm0(opt)}
              </button>
            ))}
          </div>
        </div>

        {/* Monthly Limit */}
        <div className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
            <span className="k">Monthly Recovery Limit</span>
            <span className="v">{rm0(s.monthlyLimit)}</span>
          </div>
          <div className="seg">
            {monthlyOptions.map((opt) => (
              <button
                key={opt}
                className={s.monthlyLimit === opt ? "on" : ""}
                onClick={() => s.setMonthlyLimit(opt)}
              >
                {rm0(opt)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Clean Pricing Card */}
      <div className="card-title">How Pricing Works</div>
      <div className="card">
        <div className="stat-line">
          <span className="k">Charging Model</span>
          <span className="v">Pay-as-you-go per recovery</span>
        </div>
        <div className="stat-line">
          <span className="k">Platform Fee</span>
          <span className="v">5% (Min {rm(0.3)}) on plan price</span>
        </div>
        <div className="stat-line">
          <span className="k">Failed Activation</span>
          <span className="v ok">100% Automatic Refund</span>
        </div>
        <div className="stat-line">
          <span className="k">Under-Delivery</span>
          <span className="v ok">Penalty refund credited back</span>
        </div>
      </div>

      <p className="note">
        No lock-in plans or monthly subscriptions. You only pay when a recovery actually occurs and passes SLA delivery.
      </p>
    </div>
  );
}
