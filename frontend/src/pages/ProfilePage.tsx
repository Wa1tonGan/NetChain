import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { clearEphemeralBundle } from "../services/zklogin";
import { useChainBalance } from "../hooks/useChainBalance";
import ProtectionModal from "../components/ProtectionModal";
import WalletConnectModal from "../components/WalletConnectModal";

export default function ProfilePage() {
  const s = useAppStore();
  const navigate = useNavigate();
  const [protectionModalOpen, setProtectionModalOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Which balance the card headline shows; "auto" prefers the escrow
  // stablecoin, then SUI gas.
  const [currency, setCurrency] = useState<"auto" | "sui" | "stable">("auto");

  const walletAddress = s.zkLogin?.address ?? s.walletAddr;
  const isWalletConfigured = Boolean(s.zkLogin);
  const chain = useChainBalance();

  function handleLogOut() {
    // Clear the session AND the ephemeral signing key (both storages) so a
    // stale key can never survive into the next login.
    clearEphemeralBundle();
    s.setZkLogin(null);
    navigate("/login");
  }

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
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Profile & Settings</h1>
      <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 4 }}>
        Manage your authenticated identity, Sui escrow balance, and network protection settings.
      </p>

      <div className="cols" style={{ marginTop: 16 }}>
        <div>
          {/* Account Profile Card */}
          <div className="card">
            <div className="pad">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "var(--accent-soft)",
                    color: "var(--accent-ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 800,
                  }}
                >
                  {s.zkLogin?.name ? (
                    s.zkLogin.name.charAt(0).toUpperCase()
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
                    </svg>
                  )}
                </div>

                <div className="grow">
                  <div style={{ fontWeight: 800, fontSize: 16 }}>
                    {s.zkLogin?.name ?? (isWalletConfigured ? "Connected Sui User" : "Unconnected Guest")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    {s.zkLogin?.email ?? (isWalletConfigured ? "Sui Testnet Identity" : "No Wallet Connected")}
                  </div>
                </div>

                {isWalletConfigured ? (
                  <button
                    className="btn sm subtle"
                    onClick={handleLogOut}
                    title="Disconnect / Log Out"
                    aria-label="Disconnect"
                    style={{
                      width: 34,
                      height: 34,
                      padding: 0,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted)",
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </button>
                ) : (
                  <button className="btn sm primary" onClick={() => setWalletModalOpen(true)}>
                    Connect
                  </button>
                )}
              </div>
            </div>

            <div className="row">
              <span className="grow k">Connected Device</span>
              <span className="v">{s.deviceName}</span>
            </div>
            <div className="row">
              <span className="grow k">Monitoring Agent</span>
              <span className="v ok">Active & Watching</span>
            </div>
          </div>

          {/* Preferences & Protection Trigger */}
          <div className="card-title">Network Protection</div>
          <div className="card">
            <button className="row" onClick={() => setProtectionModalOpen(true)}>
              <span className="grow">
                <span className="t">Protection & Spending Limits</span>
                <div className="s">
                  Auto-recovery is {s.auto ? `ON · Capped at USDC ${s.monthlyLimit}/mo` : "OFF"}
                </div>
              </span>
              <span style={{ color: "var(--faint)", fontSize: 18 }}>›</span>
            </button>

            <div className="row">
              <span className="grow">
                <span className="t">SMS Degradation Alerts</span>
                <div className="s">Receive recovery prompts when line degrades</div>
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={s.notif}
                  onChange={(e) => s.setNotif(e.target.checked)}
                  aria-label="Notifications"
                />
                <i />
              </label>
            </div>
          </div>

          {/* Demo Utilities */}
          <div className="card-title">Simulation Tools</div>
          <div className="card">
            <button className="row" onClick={() => navigate("/dev")}>
              <span className="grow">
                <span className="t">Hackathon Scenario Matrix</span>
                <div className="s">Launch S1–S6 recovery simulation tests</div>
              </span>
              <span className="chip sui">Open Matrix ›</span>
            </button>
          </div>
        </div>

        <div>
          {/* Embedded Wallet & Escrow Section */}
          <div className="card-title" style={{ marginTop: 0 }}>Sui Wallet & Trust Layer</div>

          {!isWalletConfigured ? (
            /* Unconfigured Wallet UI State */
            <div className="card" style={{ border: "2px dashed var(--line)", background: "#fffdfa", textAlign: "center" }}>
              <div className="pad" style={{ padding: "32px 24px" }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Sui Wallet Not Configured</div>
                <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: "42ch", margin: "6px auto 20px" }}>
                  Connect your Google account via zkLogin or connect a Sui wallet to lock zero-latency escrow during outages.
                </p>
                <button
                  className="btn primary"
                  style={{ maxWidth: 220, margin: "0 auto" }}
                  onClick={() => setWalletModalOpen(true)}
                >
                  Connect Sui Wallet
                </button>
              </div>
            </div>
          ) : (
            /* Configured Wallet State */
            <>
              {/* Balance Card */}
              <div className="card">
                <div className="pad">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>
                      {chain?.online ? "On-Chain Escrow Balance" : "Sui Wallet Balance"}
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

                  {/* Currency selector — which balance the headline shows.
                      Only rendered while the chain read succeeds. */}
                  {chain?.online && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {([
                        { key: "auto", label: "Auto" },
                        { key: "sui", label: "SUI" },
                        ...(chain.stable
                          ? [{ key: "stable" as const, label: chain.stable.label }]
                          : []),
                      ] as { key: "auto" | "sui" | "stable"; label: string }[])
                        .map((opt) => {
                          const active = currency === opt.key;
                          return (
                            <button
                              key={opt.key}
                              onClick={() => setCurrency(opt.key)}
                              aria-pressed={active}
                              style={{
                                fontSize: 11.5,
                                fontWeight: 800,
                                padding: "3px 10px",
                                borderRadius: 999,
                                cursor: "pointer",
                                border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                                background: active ? "var(--accent-soft)" : "transparent",
                                color: active ? "var(--accent-ink)" : "var(--muted)",
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                    </div>
                  )}

                  {(() => {
                    if (!chain?.online) {
                      return (
                        <>
                          <div className="big-num" style={{ marginTop: 4 }}>
                            —
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                            Chain unreachable — balance unavailable
                          </div>
                        </>
                      );
                    }
                    const resolved =
                      currency === "auto" ? (chain.stable ? "stable" : "sui") : currency;
                    if (resolved === "stable" && chain.stable) {
                      return (
                        <>
                          <div className="big-num" style={{ marginTop: 4 }}>
                            {chain.stable.total.toFixed(2)} {chain.stable.label}
                          </div>
                          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                            Live from Sui testnet · gas {chain.sui.total.toFixed(3)} SUI
                          </div>
                        </>
                      );
                    }
                    return (
                      <>
                        <div className="big-num" style={{ marginTop: 4 }}>
                          {chain.sui.total.toFixed(3)} SUI
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                          Live from Sui testnet
                          {chain.stable
                            ? ` · ${chain.stable.total.toFixed(2)} ${chain.stable.label}`
                            : ""}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Connected Sui Identity */}
              <div className="card">
                <div className="row">
                  <div className="grow">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="t">{walletSourceLabel}</span>
                      {s.zkLogin?.signingMode === "zk" ? (
                        <span className="chip sui" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                          <span className="dot" /> zk-signing (self-custody)
                        </span>
                      ) : s.zkLogin?.signingMode === "custodial-fallback" ? (
                        <span className="chip amber" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                          <span className="dot" /> custodial fallback
                        </span>
                      ) : (
                        <span className="chip green" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                          <span className="dot" /> Sui Testnet
                        </span>
                      )}
                    </div>
                    <div className="s mono" style={{ wordBreak: "break-all", fontSize: 12, marginTop: 3 }}>
                      {walletAddress.slice(0, 14)}…{walletAddress.slice(-10)}
                    </div>
                  </div>
                  <button
                    className="btn subtle sm"
                    style={{
                      width: 30,
                      height: 30,
                      padding: 0,
                      borderRadius: 6,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: copied ? "var(--ok)" : "var(--muted)",
                    }}
                    onClick={copyAddress}
                    title={copied ? "Copied!" : "Copy address"}
                  >
                    {copied ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="stat-line">
                  <span className="k">Escrow Lock State</span>
                  <span className="v ok">{s.locked > 0 ? `Locked ${rm(s.locked)}` : "Standby (Ready)"}</span>
                </div>
                <div className="row" style={{ padding: "8px 18px", borderTop: "1px solid var(--line-soft)" }}>
                  <button className="btn link sm" style={{ padding: 0 }} onClick={() => setWalletModalOpen(true)}>
                    ⚙ Switch or Re-configure Wallet
                  </button>
                </div>
              </div>

              {/* Recent Settlements History */}
              <div className="card-title">Settlement Receipts ({s.payments.length})</div>
              {s.payments.length ? (
                <div className="card" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {s.payments.map((p) => (
                    <div key={p.id} className="row">
                      <div className="grow">
                        <div className="t">{p.label}</div>
                        <div className="s">{p.provider} · {p.cap}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="v">{rm(p.amount)}</div>
                        <div
                          className="s"
                          style={{ color: p.refund ? "var(--warn)" : "var(--ok)", fontWeight: 700 }}
                        >
                          {p.refund ? `Refunded ${rm(p.refund)}` : "Settled ✓"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card">
                  <div className="row">
                    <span className="s">No transactions yet. Payment is only charged after verified delivery.</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {protectionModalOpen && <ProtectionModal onClose={() => setProtectionModalOpen(false)} />}
      {walletModalOpen && <WalletConnectModal onClose={() => setWalletModalOpen(false)} />}
    </div>
  );
}
