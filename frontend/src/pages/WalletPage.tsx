import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { chainBalanceText, useChainBalance } from "../hooks/useChainBalance";
import WalletConnectModal from "../components/WalletConnectModal";
import TransactionHistory from "../components/TransactionHistory";

export default function WalletPage() {
  const s = useAppStore();
  const walletAddress = s.zkLogin?.address ?? s.walletAddr;
  const [copied, setCopied] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const chain = useChainBalance();

  function copyAddress() {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const walletSourceLabel = s.zkLogin?.iss === "sui-extension" || s.zkLogin?.iss === "sui-standard"
    ? "Sui Wallet Extension"
    : s.zkLogin?.iss === "custom-key"
    ? "Custom Sui Account"
    : "Sui zkLogin (Google)";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Wallet & Escrow</h1>
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
            Pre-funded balance used to lock Sui escrow during emergency connectivity recovery.
          </p>
        </div>
        <button className="btn sm subtle" onClick={() => setConnectModalOpen(true)}>
          ⚙ Configure Wallet
        </button>
      </div>

      {/* Balance Card */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>
              Sui Wallet Balance
            </div>
            {chain?.online ? (
              <span className="chip sui" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                <span className="dot" /> on-chain
              </span>
            ) : (
              <span className="chip amber" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                <span className="dot" /> offline
              </span>
            )}
          </div>
          <div className="big-num" style={{ marginTop: 4 }}>
            {chainBalanceText(chain)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
            {chain?.online
              ? `Live from Sui testnet · gas ${chain.sui.total.toFixed(3)} SUI`
              : "Chain unreachable — balance unavailable"}
          </div>
        </div>
      </div>

      {/* Sui Identity */}
      <div className="card-title">Sui Trust Layer Account</div>
      <div className="card">
        <div className="row">
          <div className="grow">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="t">{walletSourceLabel}</span>
              <span className="chip green" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                <span className="dot" /> Sui Testnet
              </span>
            </div>
            <div className="s mono" style={{ wordBreak: "break-all", fontSize: 12, marginTop: 3 }}>
              {walletAddress.slice(0, 14)}…{walletAddress.slice(-10)}
            </div>
          </div>
          <button className="btn sm subtle" onClick={copyAddress}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="stat-line">
          <span className="k">Escrow Status</span>
          <span className="v ok">{s.locked > 0 ? `Locked ${rm(s.locked)}` : "Ready / Standby"}</span>
        </div>
      </div>

      {/* Recent Activity */}
      <TransactionHistory title={`Recent Settlements (${s.payments.length})`} />

      {connectModalOpen && <WalletConnectModal onClose={() => setConnectModalOpen(false)} />}
    </div>
  );
}
