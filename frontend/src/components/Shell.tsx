import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";

const NAV = [
  { to: "/home", label: "Home", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /> },
  { to: "/protection", label: "Protection", icon: <><path d="M12 3l7 3v5.2c0 4.6-3 8.1-7 9.8-4-1.7-7-5.2-7-9.8V6z" /><path d="M9.2 12l2 2 3.6-4" /></> },
  { to: "/activity", label: "Activity", icon: <path d="M3 12h4l2.5-6.5 5 13L17 12h4" /> },
  { to: "/wallet", label: "Wallet", icon: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19" /></> },
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
      <span className="dot" style={{ background: "currentColor" }} />
      {map.label}
    </span>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const balance = useAppStore((s) => s.balance);
  return (
    <div className="app-col">
      <header className="topnav">
        <span className="logo"><span className="dot">·</span>NetChain</span>
        <nav className="links" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "on" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <StateChip />
        <span className="nav-balance">Balance <b>{rm(balance)}</b></span>
      </header>

      <div className="topbar">
        <span className="logo"><span className="dot">·</span>NetChain</span>
        <span className="grow" />
        <StateChip />
      </div>

      <div className="content full">{children}</div>

      <nav className="bottomnav" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "on" : "")}>
            {navIcon(n.icon)}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
