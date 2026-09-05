import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { fetchEscrowPoolBalance } from "../services/wallet";

const NAV = [
  {
    to: "/home",
    label: "Network",
    icon: (
      <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16" />
    ),
  },
  {
    to: "/activity",
    label: "Incidents",
    icon: (
      <>
        <path d="M7 7h10M17 7l-3-3M17 7l-3 3" />
        <path d="M17 17H7M7 17l3 3M7 17l3-3" />
      </>
    ),
  },
  {
    to: "/services",
    label: "Services",
    icon: (
      <>
        <path d="M12 3 3 8l9 5 9-5-9-5z" />
        <path d="M3 12l9 5 9-5" />
      </>
    ),
  },
  {
    to: "/truth",
    label: "Truth",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </>
    ),
  },
  {
    to: "/profile",
    label: "Profile",
    icon: (
      <>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.8 20c.9-3.4 3.8-5.2 7.2-5.2s6.3 1.8 7.2 5.2" />
      </>
    ),
  },
] as const;

const navIcon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

function StateChip() {
  const protectionState = useAppStore((s) => s.protectionState);
  const map = {
    protected: { cls: "good", label: "Protected" },
    recovering: { cls: "live", label: "Recovering" },
    attention: { cls: "amber", label: "Attention" },
  }[protectionState];
  return (
    <span className={`chip ${map.cls}`} aria-live="polite">
      <span className="dot" />
      {map.label}
    </span>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const zkLogin = useAppStore((s) => s.zkLogin);
  const isWalletConfigured = Boolean(zkLogin);
  const incidentCount = useAppStore((s) => s.activity.filter((a) => a.recordId).length);
  const location = useLocation();

  // Dock pill = the escrow pool (the prepaid balance agents actually spend),
  // not the raw wallet — that's the number that matters during a demo.
  const [pool, setPool] = useState<number | null>(null);
  useEffect(() => {
    if (!isWalletConfigured) {
      setPool(null);
      return;
    }
    let alive = true;
    const tick = () => {
      void fetchEscrowPoolBalance().then((v) => alive && setPool(v));
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isWalletConfigured, zkLogin?.address]);

  const balanceLabel = isWalletConfigured ? (pool == null ? "…" : `USDC ${pool.toFixed(2)}`) : "Connect";

  return (
    <div className="app-col">
      <main className="content full">{children}</main>

      {/* Floating dock navbar */}
      <nav className="dock" aria-label="Main Navigation">
        <NavLink to="/home" className="brand-mark" aria-label="NetChain home">
          N
        </NavLink>
        <div className="nav-links">
          {NAV.map((n) => {
            const isHomeActive =
              n.to === "/home" &&
              (location.pathname === "/home" ||
                location.pathname.startsWith("/network") ||
                location.pathname.startsWith("/user"));

            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `nav-item${isActive || isHomeActive ? " on" : ""}`}
              >
                {navIcon(n.icon)}
                <span className="nav-label">{n.label}</span>
                {n.to === "/activity" && incidentCount > 0 && <span className="n-badge">{incidentCount}</span>}
              </NavLink>
            );
          })}
        </div>
        <div className="dock-sep" />
        <div className="dock-right">
          <span className="hide-sm">
            <StateChip />
          </span>
          <NavLink to="/profile" className="nav-item" aria-label="Wallet and profile" title="Wallet">
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {balanceLabel}
            </span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
