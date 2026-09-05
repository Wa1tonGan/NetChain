import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { beginZkLogin } from "../services/zklogin";
import { connectSuiWallet, isSuiWalletAvailable } from "../services/walletConnect";
import Icon from "./Icon";
export default function WalletConnectModal({ onClose }: { onClose: () => void }) {
  const s = useAppStore();
  const [customAddr, setCustomAddr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingZk, setLoadingZk] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);

  async function handleGoogleZkLogin() {
    setLoadingZk(true);
    setError(null);
    try {
      await beginZkLogin("/profile");
    } catch (err) {
      setLoadingZk(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleConnectExtension() {
    setError(null);
    setLoadingWallet(true);
    try {
      const wallet = await connectSuiWallet();
      s.setZkLogin({
        address: wallet.address,
        name: wallet.name || "Sui Wallet",
        email: null,
        sub: wallet.address,
        iss: "sui-wallet",
        aud: "sui-extension",
        signingMode: "wallet",
      });
      onClose();
    } catch (err) {
      setError("Could not connect to the wallet extension: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoadingWallet(false);
    }
  }

  function handleSaveCustomAddr(e: React.FormEvent) {
    e.preventDefault();
    const addr = customAddr.trim();
    if (!addr.startsWith("0x") || addr.length < 10) {
      setError("Please enter a valid Sui address starting with 0x (e.g. 0x71f3a9b...)");
      return;
    }
    s.setZkLogin({
      address: addr,
      name: "Custom Sui Account",
      email: null,
      sub: addr,
      iss: "custom-key",
      aud: "custom-sui",
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h3>Configure Sui Wallet</h3>
          <button className="btn link" onClick={onClose} aria-label="Close" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
          Choose how your device authenticates and locks autonomous escrow on Sui.
        </p>

        {error && (
          <div className="money-state" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {/* Option 1: Browser Wallet Extension (real connect) */}
          <button
            className="btn subtle"
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              textAlign: "left",
              border: "1px solid var(--line)",
            }}
            onClick={handleConnectExtension}
            disabled={loadingWallet}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>Connect Slush / Sui Wallet</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {isSuiWalletAvailable()
                  ? "Extension detected — the wallet signs every escrow commit itself"
                  : "No extension found — install Slush (slush.app) first"}
              </div>
            </div>
            <span style={{ fontSize: 18, color: "var(--faint)" }}>{loadingWallet ? "…" : "›"}</span>
          </button>

          {/* Option 2: Google zkLogin */}
          <button
            className="btn subtle"
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              textAlign: "left",
              border: "1px solid var(--line)",
            }}
            onClick={handleGoogleZkLogin}
            disabled={loadingZk}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>Google zkLogin (Zero-Knowledge)</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Instant login without seed phrase · Sui testnet address derived automatically
              </div>
            </div>
            <span style={{ fontSize: 18, color: "var(--faint)" }}>›</span>
          </button>

          {/* Option 3: Manual Address */}
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "12px 14px",
              marginTop: 4,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>
              Custom Sui Address
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
              Paste your own Sui Testnet address for enterprise escrow
            </div>
            <form onSubmit={handleSaveCustomAddr} style={{ display: "flex", gap: 6 }}>
              <input
                className="input mono"
                style={{ fontSize: 12 }}
                placeholder="0x..."
                value={customAddr}
                onChange={(e) => setCustomAddr(e.target.value)}
              />
              <button type="submit" className="btn primary sm" style={{ width: "auto" }}>
                Set
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
