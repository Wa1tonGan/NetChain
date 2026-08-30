import { useAppStore } from "../store/useAppStore";

export default function DevPage() {
  const s = useAppStore();
  return (
    <div className="app-col">
      <div className="topbar full">
        <span className="logo"><span className="dot">·</span>NetChain</span>
        <span className="chip gray">dev</span>
        <span className="grow" />
        <a href="#/home" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700, fontSize: 14 }}>
          Back to app
        </a>
      </div>
      <div className="content full">
        <h1 style={{ fontSize: 24, fontWeight: 800, paddingTop: 6 }}>Recovery simulator</h1>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
          Development only. Every recovery waits for an SMS reply with duration + budget; the system detects the
          request, then acts.
        </p>

        <div className="cols" style={{ marginTop: 10 }}>
          <div>
            <div className="card-title" style={{ marginTop: 16 }}>Main demo story</div>
            <div className="card">
              <div className="row">
                <span className="grow">
                  <span className="t">You reply by SMS</span>
                  <div className="s">
                    Primary 500 fails → no backup → you send “30 min, RM 14” → buy 500 Mbps · verified · ~7 sec
                  </div>
                </span>
                <button className="btn sm primary" onClick={() => s.startRecovery("main")}>Run</button>
              </div>
              <div className="row">
                <span className="grow">
                  <span className="t">Auto recovery</span>
                  <div className="s">Same story — NetChain sends the reply for you</div>
                </span>
                <button className="btn sm" onClick={() => s.startRecovery("auto")}>Run</button>
              </div>
            </div>

            <div className="card-title">Other endings</div>
            <div className="card">
              <div className="row">
                <span className="grow">
                  <span className="t">Provider under-delivered</span>
                  <div className="s">Verified 450/500 Mbps → 10% penalty refund · live checks keep failing</div>
                </span>
                <button className="btn sm" onClick={() => s.startRecovery("under")}>Run</button>
              </div>
              <div className="row">
                <span className="grow">
                  <span className="t">Provider failed</span>
                  <div className="s">No charge — reservation refunded automatically</div>
                </span>
                <button className="btn sm" onClick={() => s.startRecovery("failed")}>Run</button>
              </div>
            </div>
          </div>

          <div>
            <div className="card-title" style={{ marginTop: 16 }}>Utilities</div>
            <div className="card">
              <div className="row">
                <span className="grow">
                  <span className="t">Add network check</span>
                  <div className="s">Adds a healthy activity entry</div>
                </span>
                <button className="btn sm" onClick={s.addCheck}>Add</button>
              </div>
              <div className="row">
                <span className="grow">
                  <span className="t">Reset to protected</span>
                  <div className="s">Clears the live incident & session</div>
                </span>
                <button className="btn sm" onClick={s.resetSim}>Reset</button>
              </div>
              <div className="row">
                <span className="grow">
                  <span className="t">Full reset</span>
                  <div className="s">Clear history and start fresh</div>
                </span>
                <button
                  className="btn sm"
                  onClick={() => {
                    location.hash = "#/home";
                    location.reload();
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
            <p className="note">
              The post-recovery session counts down and runs SLA checks at demo speed (×60). Timing and cost values are
              simulated and are not presented as guaranteed real-world recovery speeds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
