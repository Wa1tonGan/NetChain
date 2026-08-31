import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";

export default function ProfilePage() {
  const s = useAppStore();
  const navigate = useNavigate();
  return (
    <div className="cols">
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.01em", paddingTop: 6 }}>Profile</h1>
        <div className="card">
          <div className="row">
            <div className="act-ic ok" style={{ fontSize: 17 }}>📱</div>
            <div className="grow">
              <div className="t">{s.deviceName}</div>
              <div className="s">{s.service}</div>
            </div>
            <span className="chip green"><span className="dot" />Connected</span>
          </div>
          <div className="row">
            <span className="grow k">Auto recovery</span>
            <span className={`v ${s.auto ? "ok" : ""}`}>{s.auto ? "ON" : "OFF"}</span>
          </div>
          <div className="row"><span className="grow k">Charges</span><span className="v">per transaction</span></div>
        </div>
        <p className="note">
          NetChain is an autonomous connectivity recovery platform: it finds and activates temporary capacity when your
          connection fails or falls short.
        </p>
      </div>

      <div>
        <div className="card-title" style={{ marginTop: 16 }}>Preferences</div>
        <div className="card">
          <div className="row">
            <span className="grow">
              <span className="t">Notifications</span>
              <div className="s">Alert me when NetChain acts</div>
            </span>
            <label className="switch">
              <input type="checkbox" checked={s.notif} onChange={(e) => s.setNotif(e.target.checked)} aria-label="Notifications" />
              <i />
            </label>
          </div>
          <button className="row" onClick={() => navigate("/protection")}>
            <span className="grow">
              <span className="t">Protection settings</span>
              <div className="s">Limits, speed & duration</div>
            </span>
            <span style={{ color: "var(--faint)" }}>›</span>
          </button>
        </div>

        <div className="card-title">About</div>
        <div className="card">
          <div className="row"><span className="grow k">Version</span><span className="v">Hackathon build</span></div>
          <button className="row" onClick={() => navigate("/dev")}>
            <span className="grow">
              <span className="t">Demo simulator</span>
              <div className="s">Development only — trigger scenarios</div>
            </span>
            <span style={{ color: "var(--faint)" }}>›</span>
          </button>
        </div>
      </div>
    </div>
  );
}
