import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { fetchEscrowPoolBalance } from "../services/wallet";
import { ESCROW_DEPLOY } from "../services/live";
import { useChainBalance } from "../hooks/useChainBalance";
import ProtectionModal from "../components/ProtectionModal";
import WalletConnectModal from "../components/WalletConnectModal";
import TopUpModal from "../components/TopUpModal";
import TransactionHistory from "../components/TransactionHistory";
import Icon from "../components/Icon";
export default function ProfilePage() {
  const s = useAppStore();
  const navigate = useNavigate();
  const [protectionModalOpen, setProtectionModalOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedCoinType, setSelectedCoinType] = useState<string | null>(null);
  const [poolBalance, setPoolBalance] = useState<number | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const isWalletConfigured = Boolean(s.zkLogin);

  // Shared escrow pool: agent-mode commits draw from it. Shared (not per-user)
  // in this deployment — with a single user it IS the user's prepaid balance.
  // Visible only after login — the balance belongs to the connected wallet.
  useEffect(() => {
    if (!isWalletConfigured) {
      setPoolBalance(null);
      return;
    }
    let alive = true;
    const tick = () => {
      void fetchEscrowPoolBalance().then((v) => alive && setPoolBalance(v));
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isWalletConfigured, topUpOpen]);

  const walletAddress = s.zkLogin?.address ?? s.walletAddr;
  const chain = useChainBalance();

  // Spending display currency: whatever the wallet holds, USDC/SUI first.
  const selectableAssets = chain?.assets ?? [];
  const selectedAsset =
    selectableAssets.find((a) => a.coinType === selectedCoinType) ??
    selectableAssets.find((a) => a.label === "USDC") ??
    selectableAssets[0] ??
    null;

  // "This month" = real recovery SPEND from the payments ledger (this calendar
  // month); top-up deposits are money-in and excluded.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthNet = s.payments
    .filter((p) => p.ts >= monthStart.getTime() && p.kind !== "topup")
    .reduce((sum, p) => sum + (p.amount - (p.refund ?? 0)), 0);
  const monthCount = s.payments.filter((p) => p.ts >= monthStart.getTime() && p.kind !== "topup").length;

  function handleLogOut() {
    s.setZkLogin(null);
    navigate("/login");
  }

  function copyAddress() {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const walletSourceLabel = s.zkLogin?.name
    ? s.zkLogin.name
    : s.zkLogin?.iss === "sui-extension" || s.zkLogin?.iss === "sui-standard" || s.zkLogin?.iss === "sui-wallet"
      ? "Sui Wallet Extension"
      : s.zkLogin?.iss === "custom-key"
        ? "Custom Sui Account"
        : "Sui zkLogin (Google)";

  const balanceLine = chain?.online
    ? selectedAsset
      ? `${selectedAsset.total.toLocaleString(undefined, { maximumFractionDigits: selectedAsset.label === "SUI" ? 3 : 2 })} ${selectedAsset.label}`
      : "0.00"
    : "—";

  const recoveries = s.activity.filter((a) => a.recordId).slice(0, 3);

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <div className="page-head">
        <h2>Profile</h2>
        <p>Your identity, wallet and the authority you granted the agents.</p>
      </div>

      <div className="prof-grid">
        {/* Identity */}
        <div className="pcard">
          <div className="id-row">
            <div className="avatar">
              {s.zkLogin?.name ? s.zkLogin.name.charAt(0).toUpperCase() : "N"}
            </div>
            <div className="grow">
              <div className="id-name">{s.zkLogin?.name ?? (isWalletConfigured ? "Connected Sui User" : "Guest")}</div>
              <div className="id-mail">{s.zkLogin?.email ?? (isWalletConfigured ? "Sui Testnet Identity" : "No wallet connected")}</div>
            </div>
            {isWalletConfigured ? (
              <button className="link-btn ghost" style={{ marginLeft: "auto" }} onClick={handleLogOut}>
                Log out
              </button>
            ) : (
              <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => setWalletModalOpen(true)}>
                Connect
              </button>
            )}
          </div>
          <div className="id-chips">
            {s.zkLogin?.signingMode === "zk" ? (
              <span className="act-ref green" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Icon name="check" size={11} /> zkLogin self-custody
              </span>
            ) : s.zkLogin?.signingMode === "custodial-fallback" ? (
              <span className="act-ref amber">custodial fallback</span>
            ) : isWalletConfigured ? (
              <span className="act-ref green" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Icon name="check" size={11} /> {walletSourceLabel}
              </span>
            ) : (
              <span className="act-ref">no wallet</span>
            )}
            <span className="act-ref">{s.deviceName} · eSIM</span>
          </div>
          <div className="addr-row">
            <span className="mono">{walletAddress}</span>
            <button className="copy" onClick={copyAddress}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* Wallet */}
        <div className="pcard">
          <div className="pcard-title">Wallet</div>
          <div className="pcard-sub">Spending balance for autonomous recovery</div>
          <div className="pay-amount" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span>{isWalletConfigured ? balanceLine : "—"}</span>
            {chain?.online && selectableAssets.length > 0 && (
              <select
                className="input"
                style={{ width: "auto", padding: "2px 8px", fontSize: 12 }}
                value={selectedAsset?.coinType ?? ""}
                onChange={(e) => setSelectedCoinType(e.target.value)}
                aria-label="Balance currency"
              >
                {selectableAssets.map((a) => (
                  <option key={a.coinType} value={a.coinType}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="pay-meta">
            {chain?.online ? "Live from Sui testnet" : isWalletConfigured ? "Chain unreachable" : "Connect a wallet to fund escrow"}
          </div>
          <div className="kv-p" style={{ marginTop: 8 }}>
            <span className="k">This month</span>
            <span className="v">
              {monthCount > 0 ? `${rm(monthNet)} · ${monthCount} recovery${monthCount > 1 ? "s" : ""}` : "no recovery spend yet"}
            </span>
          </div>
          <div className="kv-p">
            <span className="k">Auto-pay cap</span>
            <span className="v">{rm(s.maxPerRecovery)} / incident</span>
          </div>
          <div className="txd-link" style={{ justifyContent: "flex-start", marginTop: 12 }}>
            <button className="link-btn" onClick={() => setWalletModalOpen(true)}>
              {isWalletConfigured ? "Switch wallet" : "Connect wallet"}
            </button>
          </div>
        </div>

        {/* Escrow pool — visible only after login (the balance belongs to
            the connected wallet); guests see nothing here */}
        {isWalletConfigured && (
        <div className="pcard span2" style={{ border: "1px solid var(--blue-soft)", boxShadow: "0 1px 10px rgba(0,113,227,.08)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                  Escrow pool
                </span>
                <span className="chip green" style={{ fontSize: 9.5, padding: "1px 8px" }}>
                  <span className="dot" /> on-chain
                </span>
                {poolBalance != null && poolBalance < 1 && (
                  <span className="chip amber" style={{ fontSize: 9.5, padding: "1px 8px" }}>
                    low
                  </span>
                )}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: "-.02em",
                  marginTop: 4,
                  color: poolBalance != null && poolBalance < 1 ? "var(--amber-ink)" : "var(--ink)",
                }}
              >
                {poolBalance == null ? "…" : `USDC ${poolBalance.toFixed(2)}`}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Prepaid balance your RescueAgent spends autonomously — every commit draws from here under the on-chain
                per-incident cap.
              </div>
              {poolBalance != null && poolBalance < 1 && (
                <div style={{ fontSize: 11.5, color: "var(--amber-ink)", marginTop: 4 }}>
                  Nearly empty — agent commits will fail until you top up.
                </div>
              )}
            </div>
            {isWalletConfigured && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <button className="btn primary" style={{ padding: "9px 18px" }} onClick={() => setTopUpOpen(true)}>
                  Top up
                </button>
                <span style={{ fontSize: 10.5, color: "var(--faint)" }}>one Slush signature</span>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Agent authority */}
        <div className="pcard">
          <div className="pcard-title">Agent authority</div>
          <div className="pcard-sub">What your agent may do without asking</div>
          <div className="addr-row" style={{ marginTop: 12 }}>
            <span className="mono">keypair&nbsp; rescue.ed25519</span>
            <span className="act-ref green" style={{ marginLeft: "auto" }}>
              active
            </span>
          </div>
          <div className="kv-p">
            <span className="k">Auto-pay cap</span>
            <span className="v">{rm(s.maxPerRecovery)} / incident</span>
          </div>
          <div className="kv-p">
            <span className="k">Gas</span>
            <span className="v">sponsored by platform</span>
          </div>
          <div className="kv-p">
            <span className="k">Auto-recovery</span>
            <label className="switch">
              <input type="checkbox" checked={s.auto} onChange={(e) => s.setAuto(e.target.checked)} aria-label="Auto recovery" />
              <i />
            </label>
          </div>
          <div className="txd-link" style={{ justifyContent: "flex-start", marginTop: 12 }}>
            <button className="link-btn ghost" onClick={() => setProtectionModalOpen(true)}>
              Protection &amp; limits
            </button>
          </div>
        </div>

        {/* Protection */}
        <div className="pcard">
          <div className="pcard-title">Protection</div>
          <div className="pcard-sub">When the agents are allowed to act</div>
          <div className="kv-p" style={{ marginTop: 6 }}>
            <span className="k">Act below signal</span>
            <span className="v">{s.autoBelow} Mbps</span>
          </div>
          <div className="kv-p">
            <span className="k">Max duration</span>
            <span className="v">{s.maxDuration} min</span>
          </div>
          <div className="kv-p">
            <span className="k">SMS degradation alerts</span>
            <label className="switch">
              <input type="checkbox" checked={s.notif} onChange={(e) => s.setNotif(e.target.checked)} aria-label="Notifications" />
              <i />
            </label>
          </div>
          <div className="txd-link" style={{ justifyContent: "flex-start", marginTop: 12 }}>
            <button className="link-btn ghost" onClick={() => navigate("/dev")}>
              Scenario matrix (S1–S6)
            </button>
          </div>
        </div>

        {/* Recent recoveries */}
        <div className="pcard span2">
          <div className="pcard-title">Recent recoveries</div>
          <div className="pcard-sub">Last autonomous incidents on this line</div>
          <div style={{ marginTop: 8 }}>
            {recoveries.length ? (
              recoveries.map((a) => (
                <button
                  key={a.id}
                  className="rec-row"
                  style={{ width: "100%", border: 0, background: "transparent", font: "inherit", textAlign: "left", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                  onClick={() => a.recordId && navigate("/activity/" + a.recordId)}
                >
                  <span className={`txd-check${a.type === "failed" ? "" : ""}`} style={{ ...(a.type === "failed" ? { background: "var(--amber-soft)", color: "var(--amber-ink)" } : undefined), display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {a.type === "failed" ? <Icon name="warning" size={12} /> : <Icon name="check" size={12} />}
                  </span>
                  <div className="grow">
                    <div className="rec-id">
                      {a.recordId ?? a.id} · {a.title}
                    </div>
                    <div className="rec-sub">{a.sub}</div>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.cost != null && a.cost > 0 ? rm(a.cost) : a.note}</div>
                    <div className="rec-sub" style={{ color: a.type === "failed" ? "var(--amber-ink)" : "var(--green-ink)", fontWeight: 600 }}>
                      {a.type === "failed" ? "REFUND" : <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>OK <Icon name="check" size={11} /></span>}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rec-row">
                <span className="txd-check" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={12} /></span>
                <div>
                  <div className="rec-id">No recoveries yet</div>
                  <div className="rec-sub">Payment is only charged after verified delivery.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Transaction history — fetched LIVE from the Sui testnet for the
            connected address; survives refreshes and browsers */}
        {isWalletConfigured && (
          <div className="pcard span2">
            <div className="pcard-title">Transaction history</div>
            <div className="pcard-sub">
              Live on-chain history for your address — top-ups, commits, settlements and refunds, with direct verification on SuiVision or Suiscan
            </div>
            <div style={{ marginTop: 8 }}>
              <TransactionHistory collapsible />
            </div>
          </div>
        )}

        {/* Purchased network offers — the agent-signed purchases, user-owned */}
        {isWalletConfigured && (
          <div className="pcard span2">
            <div className="pcard-title">Purchased network offers</div>
            <div className="pcard-sub">
              Network capacity offers your agent bought for you — every purchase and settlement on-chain, one click from SuiVision or Suiscan
            </div>
            <div style={{ marginTop: 8 }}>
              <TransactionHistory ownerAddress={ESCROW_DEPLOY.platformOperator} mode="purchase" collapsible />
            </div>
          </div>
        )}
      </div>

      {protectionModalOpen && <ProtectionModal onClose={() => setProtectionModalOpen(false)} />}
      {walletModalOpen && <WalletConnectModal onClose={() => setWalletModalOpen(false)} />}
      {topUpOpen && s.zkLogin && (
        <TopUpModal session={s.zkLogin} onClose={() => setTopUpOpen(false)} />
      )}
    </div>
  );
}
