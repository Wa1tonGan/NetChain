import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DUMMY_USERS, type DummyUser } from "../data/dummyUsers";

export default function UserListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "good" | "low">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUsers = DUMMY_USERS.filter((user) => {
    if (filter === "good" && user.status !== "good") return false;
    if (filter === "low" && user.status !== "low") return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        user.name.toLowerCase().includes(q) ||
        user.city.toLowerCase().includes(q) ||
        user.state.toLowerCase().includes(q) ||
        user.isp.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const goodCount = DUMMY_USERS.filter((u) => u.status === "good").length;
  const lowCount = DUMMY_USERS.filter((u) => u.status === "low").length;

  // KPI descriptors derived from the actual subscriber data, not literals.
  const stateCount = new Set(DUMMY_USERS.map((u) => u.state)).size;
  const optimalFloor = Math.min(...DUMMY_USERS.filter((u) => u.status === "good").map((u) => u.speedMbps));
  const lowCeiling = Math.max(...DUMMY_USERS.filter((u) => u.status === "low").map((u) => u.speedMbps));

  return (
    <div>
      {/* Header */}
      <div
        className="page-head"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2>Subscriber Network Overview</h2>
          <p>
            Live network strength across Malaysia — click any subscriber to monitor line metrics and autonomous agent protection.
          </p>
        </div>
        <span className="chip live">
          <span className="dot" />
          {DUMMY_USERS.length} LINES MONITORED · MALAYSIA
        </span>
      </div>

      {/* Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            Total Subscribers
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4, letterSpacing: "-0.02em" }}>
            {DUMMY_USERS.length}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Across {stateCount} Malaysian States / Territories
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ok)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            Optimal Network
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--ok)", marginTop: 4, letterSpacing: "-0.02em" }}>
            {goodCount} <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>lines</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            ≥ {optimalFloor} Mbps · Latency &lt; 30 ms
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--warn-ink)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            Degraded / Low Network
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--warn-ink)", marginTop: 4, letterSpacing: "-0.02em" }}>
            {lowCount} <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>lines</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            &lt; {lowCeiling + 1} Mbps · Requires RescueAgent
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            Agent Protection
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent)", marginTop: 4, letterSpacing: "-0.02em" }}>
            100%
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Autonomous Sui Escrow Standby
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div
        className="card"
        style={{
          padding: "12px 16px",
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`btn sm ${filter === "all" ? "primary" : "subtle"}`}
            onClick={() => setFilter("all")}
            style={{ borderRadius: 20, padding: "5px 14px" }}
          >
            All Subscribers ({DUMMY_USERS.length})
          </button>
          <button
            type="button"
            className={`btn sm ${filter === "good" ? "primary" : "subtle"}`}
            onClick={() => setFilter("good")}
            style={{ borderRadius: 20, padding: "5px 14px" }}
          >
            Good Network ({goodCount})
          </button>
          <button
            type="button"
            className={`btn sm ${filter === "low" ? "primary" : "subtle"}`}
            onClick={() => setFilter("low")}
            style={{ borderRadius: 20, padding: "5px 14px" }}
          >
            Low Network ({lowCount})
          </button>
        </div>

        <div style={{ minWidth: 240, flex: "1 1 240px", maxWidth: 360 }}>
          <input
            className="input"
            style={{ width: "100%", borderRadius: 20, padding: "7px 14px", fontSize: 13 }}
            placeholder="Search subscriber, city, or state..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* User List Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {filteredUsers.map((user: DummyUser) => {
          const isGood = user.status === "good";
          const initials = user.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("");

          return (
            <div
              key={user.id}
              className="card subscriber-card"
              onClick={() => navigate(`/network/${user.id}`)}
              style={{
                padding: "18px 20px",
                cursor: "pointer",
                transition: "all 0.18s ease-in-out",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* User Identity & Status Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: isGood ? "var(--green-soft)" : "var(--amber-soft)",
                    color: isGood ? "var(--green-ink)" : "var(--amber-ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 15,
                    position: "relative",
                    flexShrink: 0,
                  }}
                >
                  {initials}
                  <span
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: isGood ? "var(--ok)" : "var(--warn)",
                      border: "2px solid #fff",
                    }}
                  />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{user.name}</span>
                    <span
                      className={`chip ${isGood ? "good" : "amber"}`}
                      style={{ fontSize: 10, padding: "2px 7px" }}
                    >
                      <span className="dot" />
                      {isGood ? "Good" : "Low"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {user.device} · {user.isp}
                  </div>
                </div>
              </div>

              {/* Prominent Malaysia Location Label */}
              <div
                style={{
                  marginTop: 14,
                  padding: "6px 10px",
                  background: "var(--bg)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--ink-2)",
                }}
              >
                <span style={{ fontSize: 13 }}>📍</span>
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>{user.city}</span>, {user.state}
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>Malaysia</span>
              </div>

              {/* Speed & Network Metrics */}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid var(--line)",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Current Downlink
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        color: isGood ? "var(--ink)" : "var(--bad-ink)",
                      }}
                    >
                      {user.speedMbps}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Mbps</span>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    RTT: <b>{user.latencyMs} ms</b>
                  </div>
                  <div style={{ fontSize: 11, color: user.packetLossPct > 1 ? "var(--bad-ink)" : "var(--muted)", marginTop: 2 }}>
                    Loss: <b>{user.packetLossPct.toFixed(1)}%</b>
                  </div>
                </div>
              </div>

              {/* Action Link Footer */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--accent)",
                }}
              >
                <span>Inspect Speed &amp; RescueAgent</span>
                <span style={{ fontSize: 14 }}>→</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
