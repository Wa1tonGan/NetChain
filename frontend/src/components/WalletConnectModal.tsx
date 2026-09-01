import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { beginZkLogin } from "../services/zklogin";

export default function WalletConnectModal({ onClose }: { onClose: () => void }) {
  const s = useAppStore();
  const [customAddr, setCustomAddr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingZk, setLoadingZk] = useState(false);

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
    const win = window as unknown as { suiWallet?: { requestPermissions: () => Promise<string[]>; getAccounts: () => Promise<string[]> } };
    if (win.suiWallet) {
      try {
        await win.suiWallet.requestPermissions();
        const accounts = await win.suiWallet.getAccounts();
        if (accounts && accounts[0]) {
          s.setZkLogin({
            address: accounts[0],
            name: "Sui Wallet User",
            email: null,
            sub: accounts[0],
            iss: "sui-extension",
            aud: "sui-wallet",
          });
          onClose();
          return;
        }
      } catch (err) {
        setError("Could not connect to Sui Wallet extension: " + (err instanceof Error ? err.message : String(err)));
        return;
      }
    }
    const demoExtensionAddr = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    s.setZkLogin({
      address: demoExtensionAddr,
      name: "Sui Wallet (Standard)",
      email: null,
      sub: demoExtensionAddr,
      iss: "sui-standard",
      aud: "sui-extension",
    });
    onClose();
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
          <button className="btn link" onClick={onClose} style={{ fontSize: 18, padding: 0 }}>
            ✕
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
          {/* Option 1: Google zkLogin */}
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

          {/* Option 2: Browser Wallet Extension */}
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
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>Connect Sui Wallet (Extension)</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Connect browser extension or standard Sui wallet
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
