import { useAppStore } from "../store/useAppStore";
import { rm, rm0 } from "../services/pricing";

export default function ProtectionPage() {
  const s = useAppStore();
  return (
    <div className="cols">
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.01em", paddingTop: 6 }}>Protection</h1>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
          You're in control. NetChain only spends what you allow.
        </p>

        <div className="card">
          <div className="row">
            <span className="grow">
              <span className="t">Auto recovery</span>
              <div className="s">Restore connectivity automatically, within your limits</div>
            </span>
            <label className="switch">
              <input type="checkbox" checked={s.auto} onChange={(e) => s.setAuto(e.target.checked)} aria-label="Auto recovery" />
              <i />
            </label>
          </div>
          <div className="row"><span className="grow k">Maximum per recovery</span><span className="v">{rm0(s.maxPerRecovery)}</span></div>
          <div className="row"><span className="grow k">Monthly recovery limit</span><span className="v">{rm0(s.monthlyLimit)}</span></div>
          <div className="row"><span className="grow k">Minimum acceptable speed</span><span className="v">{s.minSpeed} Mbps</span></div>
          <div className="row"><span className="grow k">Maximum recovery duration</span><span className="v">{s.maxDuration} min</span></div>
        </div>
        <p className="note">
          In plain words: NetChain may spend up to {rm0(s.maxPerRecovery)} per recovery, at most {rm0(s.monthlyLimit)} a
          month, for at least {s.minSpeed} Mbps.
        </p>
      </div>

      <div>
        <div className="card-title" style={{ marginTop: 16 }}>How pricing works</div>
        <div className="card">
          <div className="pad">
            <div style={{ fontWeight: 800, fontSize: 15 }}>Pay per recovery — no plans</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4, lineHeight: 1.6 }}>
              Every recovery is a one-off purchase sized to your shortage. You approve it by SMS with a duration and
              budget, and you're charged only after the delivered strength is verified.
            </div>
          </div>
          <div className="stat-line"><span className="k">Provider price</span><span className="v">by capacity × duration</span></div>
          <div className="stat-line"><span className="k">NetChain fee</span><span className="v">{rm(0.3)} per transaction</span></div>
          <div className="stat-line"><span className="k">Failed recovery</span><span className="v ok">full refund</span></div>
          <div className="stat-line"><span className="k">Under-delivery</span><span className="v ok">automatic penalty refund</span></div>
        </div>
        <p className="note">
          Live SLA checks run for the whole purchased duration. If the provider drops below the agreed strength,
          penalties and refunds are applied automatically — you can follow every check in the session card and receipt.
        </p>
      </div>
    </div>
  );
}
