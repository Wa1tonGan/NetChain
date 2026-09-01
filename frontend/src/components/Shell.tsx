import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";

const NAV_DESKTOP = [
  { to: "/home", label: "Dashboard" },
  { to: "/services", label: "Enterprise QoS" },
  { to: "/activity", label: "Activity Log" },
] as const;

const NAV_MOBILE = [
  { to: "/home", label: "Home", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /> },
  { to: "/services", label: "Enterprise", icon: <><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="M3 12l9 5 9-5" /></> },
  { to: "/activity", label: "Activity", icon: <path d="M3 12h4l2.5-6.5 5 13L17 12h4" /> },
  { to: "/profile", label: "Profile", icon: <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20.5c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4" /></> },
] as const;

const navIcon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

export function StateChip() {
  const protectionState = useAppStore((s) => s.protectionState);
  const map = {
    protected: { cls: "green", label: "Protected", dot: "protected" },
    recovering: { cls: "blue", label: "Recovering", dot: "recovering" },
    attention: { cls: "amber", label: "Attention", dot: "attention" },
  }[protectionState];
  return (
    <span className={`chip ${map.cls}`} aria-live="polite">
      <span className={`dot ${map.dot}`} />
      {map.label}
    </span>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const balance = useAppStore((s) => s.balance);
  const zkLogin = useAppStore((s) => s.zkLogin);
  const isWalletConfigured = Boolean(zkLogin);

  return (
    <div className="app-col">
      {/* Desktop Topbar */}
      <header className="topnav">
        <Link to="/home" className="logo">
          <span className="dot">●</span> NetChain
        </Link>

        <nav className="links" aria-label="Main Navigation">
          {NAV_DESKTOP.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "on" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="topnav-actions">
          <StateChip />

          {/* Single Unified User & Wallet Pill */}
          <Link to="/profile" className="user-pill" aria-label="Profile and Wallet">
            <span className="user-pill-avatar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
              </svg>
            </span>
            <span style={{ color: isWalletConfigured ? "var(--ink)" : "var(--accent)" }}>
              {isWalletConfigured ? rm(balance) : "Connect Wallet"}
            </span>
          </Link>
        </div>
      </header>

      {/* Mobile Topbar */}
      <div className="topbar">
        <Link to="/home" className="logo">
          <span className="dot">●</span> NetChain
        </Link>
        <span className="grow" />
        <StateChip />
        <Link to="/profile" className="user-pill" style={{ padding: "4px 10px 4px 6px" }}>
          <span className="user-pill-avatar" style={{ width: 20, height: 20 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
            </svg>
          </span>
          <span style={{ fontSize: 12 }}>{isWalletConfigured ? rm(balance) : "Wallet"}</span>
        </Link>
      </div>

      <main className="content full">{children}</main>

      {/* Mobile Bottom Navigation */}
      <nav className="bottomnav" aria-label="Main Navigation">
        {NAV_MOBILE.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "on" : "")}>
            {navIcon(n.icon)}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
