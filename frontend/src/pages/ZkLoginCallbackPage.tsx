import { useEffect, useState } from "react";
import { completeZkLogin } from "../services/zklogin";
import { useAppStore } from "../store/useAppStore";

let exchangeStarted = false;

export default function ZkLoginCallbackPage() {
  const setZkLogin = useAppStore((s) => s.setZkLogin);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      setError("Missing OAuth code or state.");
      return;
    }

    if (exchangeStarted) return;
    exchangeStarted = true;

    completeZkLogin(code, state)
      .then((session) => {
        setZkLogin(session);
        window.location.replace("/#/home");
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [setZkLogin]);

  return (
    <div className="card" style={{ maxWidth: 480, margin: "60px auto" }}>
      <div className="pad" style={{ textAlign: "center", padding: 28 }}>
        {error ? (
          <>
            <div className="chip red"><span className="dot" />Sign-in failed</div>
            <p className="lede" style={{ marginTop: 14 }}>{error}</p>
            <button
              className="btn primary"
              style={{ marginTop: 18 }}
              onClick={() => window.location.replace("/#/login")}
            >
              Back to Sign In
            </button>
          </>
        ) : (
          <>
            <div className="chip blue"><span className="dot" />Connecting zkLogin</div>
            <p className="lede" style={{ marginTop: 14 }}>Deriving your Sui address…</p>
          </>
        )}
      </div>
    </div>
  );
}
