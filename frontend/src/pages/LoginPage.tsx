import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { beginZkLogin } from "../services/zklogin";

export default function LoginPage() {
  const navigate = useNavigate();
  const zkLogin = useAppStore((s) => s.zkLogin);
  const setZkLogin = useAppStore((s) => s.setZkLogin);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGoogleLogin() {
    setLoginError(null);
    setLoading(true);
    try {
      await beginZkLogin("/home");
    } catch (error) {
      setLoading(false);
      setLoginError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleConnectExtension() {
    const demoExtensionAddr = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    setZkLogin({
      address: demoExtensionAddr,
      name: "Sui Wallet User",
      email: null,
      sub: demoExtensionAddr,
      iss: "sui-standard",
      aud: "sui-extension",
    });
    navigate("/home");
  }

  function handleGuestLogin() {
    navigate("/home");
  }

  function handleSignOut() {
    setZkLogin(null);
  }

  return (
    <div
      style={{
        minHeight: "80vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 0,
          boxShadow: "var(--shadow)",
        }}
      >
        <div className="pad" style={{ padding: "32px 28px", textAlign: "center" }}>
          {/* Logo */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 22, fontWeight: 800 }}>
            <span className="dot" style={{ background: "var(--accent)" }} /> NetChain
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6 }}>
            Autonomous Connectivity Resilience Layer
          </p>

          <div style={{ margin: "28px 0 24px", borderTop: "1px solid var(--line-soft)" }} />

          {zkLogin ? (
            <div>
              <span className="chip green">
                <span className="dot" /> Connected to Sui
              </span>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{zkLogin.name ?? "Sui User"}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{zkLogin.email ?? "Sui Testnet Identity"}</div>
              </div>

              <div
                style={{
                  background: "var(--bg)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginTop: 16,
                  textAlign: "left",
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                  Active Sui Address
                </div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginTop: 3, wordBreak: "break-all" }}>
                  {zkLogin.address}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 24 }}>
                <button className="btn primary" onClick={() => navigate("/home")}>
                  Go to Dashboard →
                </button>
                <button className="btn subtle" onClick={handleSignOut}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Connect your Sui Account</div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
                Link your Google account with Sui zkLogin or connect your Sui wallet for pre-funded escrow.
              </p>

              {loginError && (
                <div className="money-state" style={{ marginBottom: 16, textAlign: "left" }}>
                  {loginError}
                </div>
              )}

              <div style={{ display: "grid", gap: 10 }}>
                <button
                  className="btn primary"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: "12px 16px",
                  }}
                  onClick={handleGoogleLogin}
                  disabled={loading}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="#ffffff"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#ffffff"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#ffffff"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#ffffff"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{loading ? "Redirecting to Google…" : "Continue with Google (zkLogin)"}</span>
                </button>

                <button className="btn subtle" onClick={handleConnectExtension}>
                  💧 Connect Sui Wallet (Extension)
                </button>

                <button className="btn subtle" onClick={handleGuestLogin}>
                  Continue as Demo Guest
                </button>
              </div>

              <div style={{ marginTop: 22, fontSize: 11.5, color: "var(--faint)" }}>
                Secured by Sui Trust Layer · Zero-Knowledge Authentication
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
