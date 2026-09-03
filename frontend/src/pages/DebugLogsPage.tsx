import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { getLogs, clearLogs, type WorkflowLogEntry } from "../services/logger";
import { fetchCurrentEpoch } from "../services/zklogin";

export default function DebugLogsPage() {
  const zkLogin = useAppStore((s) => s.zkLogin);
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [storedEphemeral, setStoredEphemeral] = useState<{
    pubKey?: string;
    maxEpoch?: number;
    nonce?: string;
  } | null>(null);

  function reload() {
    setLogs(getLogs());
    fetchCurrentEpoch().then(setCurrentEpoch).catch(() => {});
    try {
      const raw =
        sessionStorage.getItem("netchain_zklogin_ephemeral") ||
        localStorage.getItem("netchain_zklogin_ephemeral_persist");
      setStoredEphemeral(raw ? JSON.parse(raw) : null);
    } catch {}
  }

  useEffect(() => {
    reload();

    function onLog() {
      setLogs(getLogs());
    }
    function onClear() {
      setLogs([]);
    }

    window.addEventListener("netchain_log", onLog);
    window.addEventListener("netchain_log_cleared", onClear);
    const interval = setInterval(reload, 3000);

    return () => {
      window.removeEventListener("netchain_log", onLog);
      window.removeEventListener("netchain_log_cleared", onClear);
      clearInterval(interval);
    };
  }, []);

  function handleCopyAll() {
    navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const filteredLogs = logs.filter((item) => {
    if (filter !== "all" && item.level !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.step.toLowerCase().includes(q) ||
        JSON.stringify(item.data).toLowerCase().includes(q)
      );
    }
    return true;
  });

  const rawProof = zkLogin?.proof as any;
  const innerProof = rawProof?.proof ?? rawProof;
  const hasProofPoints = Boolean(innerProof?.proofPoints);
  const hasIssDetails = Boolean(innerProof?.issBase64Details);
  const hasHeader = Boolean(innerProof?.headerBase64);

  const isEpochValid =
    currentEpoch !== null &&
    storedEphemeral?.maxEpoch !== undefined &&
    storedEphemeral.maxEpoch > currentEpoch;

  const isKeyMatched =
    Boolean(storedEphemeral?.pubKey) &&
    Boolean(zkLogin?.ephemeralPubKey) &&
    storedEphemeral?.pubKey === zkLogin?.ephemeralPubKey;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#f3f4f6" }}>
            Workflow & zkLogin Diagnostics
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
            Real-time step-by-step diagnostic telemetry for zkLogin, Sui settlement, and Gonka router.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={reload}
            style={{
              padding: "8px 14px",
              background: "#1f2937",
              color: "#e5e7eb",
              border: "1px solid #374151",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Refresh
          </button>
          <button
            onClick={handleCopyAll}
            style={{
              padding: "8px 14px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {copied ? "Copied!" : "Copy All Logs JSON"}
          </button>
          <button
            onClick={clearLogs}
            style={{
              padding: "8px 14px",
              background: "#374151",
              color: "#f87171",
              border: "1px solid #4b5563",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Clear Logs
          </button>
        </div>
      </div>

      {/* State Inspector Card */}
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Live zkLogin Session Status
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ color: "#6b7280" }}>Buyer Address</div>
            <div style={{ color: "#e5e7eb", fontFamily: "monospace", wordBreak: "break-all" }}>
              {zkLogin?.address ?? "Not connected"}
            </div>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Signing Mode</div>
            <div style={{ color: zkLogin?.signingMode === "zk" ? "#10b981" : "#f59e0b", fontWeight: 600 }}>
              {zkLogin?.signingMode ?? "None"}
            </div>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Google Identity</div>
            <div style={{ color: "#e5e7eb" }}>
              {zkLogin?.email ? `${zkLogin.email} (${zkLogin.sub})` : "None"}
            </div>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Live Testnet Epoch</div>
            <div style={{ color: "#e5e7eb", fontWeight: 600 }}>
              {currentEpoch ?? "Fetching..."}
            </div>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Proof Max Epoch vs Current</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#e5e7eb", fontFamily: "monospace" }}>
                {storedEphemeral?.maxEpoch ?? "None"}
              </span>
              {storedEphemeral?.maxEpoch !== undefined && currentEpoch !== null && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: isEpochValid ? "#064e3b" : "#7f1d1d",
                    color: isEpochValid ? "#34d399" : "#f87171",
                    fontWeight: 600,
                  }}
                >
                  {isEpochValid ? `VALID (+${storedEphemeral.maxEpoch - currentEpoch})` : "EXPIRED"}
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Ephemeral Key Continuity</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#e5e7eb", fontFamily: "monospace", fontSize: 11 }}>
                {storedEphemeral?.pubKey ? storedEphemeral.pubKey.slice(0, 16) + "..." : "None"}
              </span>
              {storedEphemeral?.pubKey && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: isKeyMatched ? "#064e3b" : "#7f1d1d",
                    color: isKeyMatched ? "#34d399" : "#f87171",
                    fontWeight: 600,
                  }}
                >
                  {isKeyMatched ? "MATCH" : "MISMATCH / RE-LOGIN REQUIRED"}
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ color: "#6b7280" }}>Groth16 Proof Components</div>
            <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: hasProofPoints ? "#064e3b" : "#374151",
                  color: hasProofPoints ? "#34d399" : "#9ca3af",
                }}
              >
                points: {hasProofPoints ? "YES" : "NO"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: hasIssDetails ? "#064e3b" : "#374151",
                  color: hasIssDetails ? "#34d399" : "#9ca3af",
                }}
              >
                iss: {hasIssDetails ? "YES" : "NO"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: hasHeader ? "#064e3b" : "#374151",
                  color: hasHeader ? "#34d399" : "#9ca3af",
                }}
              >
                header: {hasHeader ? "YES" : "NO"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Filter by step name or payload content..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 12px",
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: 6,
            color: "#e5e7eb",
            fontSize: 13,
          }}
        />
        {(["all", "error", "warn", "success", "info"] as const).map((lvl) => (
          <button
            key={lvl}
            onClick={() => setFilter(lvl)}
            style={{
              padding: "8px 14px",
              background: filter === lvl ? "#374151" : "#111827",
              color:
                filter === lvl
                  ? "#fff"
                  : lvl === "error"
                  ? "#f87171"
                  : lvl === "warn"
                  ? "#fbbf24"
                  : lvl === "success"
                  ? "#34d399"
                  : "#9ca3af",
              border: `1px solid ${filter === lvl ? "#4b5563" : "#1f2937"}`,
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: filter === lvl ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {lvl}
          </button>
        ))}
      </div>

      {/* Logs Table */}
      <div
        style={{
          background: "#0d1117",
          border: "1px solid #21262d",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", color: "#6b7280", fontSize: 14 }}>
            No logs captured yet. Click <strong>Run Live</strong> or initiate a login to generate workflow logs.
          </div>
        ) : (
          <div>
            {filteredLogs.map((log) => {
              const badgeBg =
                log.level === "error"
                  ? "#7f1d1d"
                  : log.level === "warn"
                  ? "#78350f"
                  : log.level === "success"
                  ? "#064e3b"
                  : "#1e3a8a";
              const badgeColor =
                log.level === "error"
                  ? "#fca5a5"
                  : log.level === "warn"
                  ? "#fde68a"
                  : log.level === "success"
                  ? "#a7f3d0"
                  : "#bfdbfe";

              return (
                <div
                  key={log.id}
                  style={{
                    borderBottom: "1px solid #1f2937",
                    padding: "12px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        background: badgeBg,
                        color: badgeColor,
                      }}
                    >
                      {log.level.toUpperCase()}
                    </span>
                    <span style={{ color: "#f3f4f6", fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>
                      {log.step}
                    </span>
                    <span style={{ marginLeft: "auto", color: "#6b7280", fontSize: 11 }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: 4,
                      color: "#c9d1d9",
                      fontSize: 12,
                      overflowX: "auto",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {JSON.stringify(log.data, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
