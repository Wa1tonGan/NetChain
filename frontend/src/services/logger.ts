export interface WorkflowLogEntry {
  id: string;
  timestamp: string;
  step: string;
  level: "info" | "warn" | "error" | "success";
  data: Record<string, unknown>;
}

const STORAGE_KEY = "netchain_workflow_logs";
const MAX_LOGS = 200;

declare global {
  interface Window {
    __NETCHAIN_LOGS__?: WorkflowLogEntry[];
  }
}

export function getLogs(): WorkflowLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.__NETCHAIN_LOGS__ = [];
    window.dispatchEvent(new CustomEvent("netchain_log_cleared"));
  } catch {}
}

export function addWorkflowLog(
  step: string,
  data: Record<string, unknown> = {},
  level: "info" | "warn" | "error" | "success" = "info"
): WorkflowLogEntry {
  const entry: WorkflowLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    step,
    level,
    data,
  };

  // 1. Console with color
  const color =
    level === "error"
      ? "#ef4444"
      : level === "warn"
      ? "#f59e0b"
      : level === "success"
      ? "#10b981"
      : "#3b82f6";

  console.log(
    `%c[NetChain Workflow] %c${step}%c [${level.toUpperCase()}]`,
    "color: #8b5cf6; font-weight: bold;",
    `color: ${color}; font-weight: bold;`,
    "color: #9ca3af; font-size: 11px;",
    data
  );

  // 2. In-memory window ring
  if (!window.__NETCHAIN_LOGS__) {
    window.__NETCHAIN_LOGS__ = [];
  }
  window.__NETCHAIN_LOGS__.unshift(entry);
  if (window.__NETCHAIN_LOGS__.length > MAX_LOGS) {
    window.__NETCHAIN_LOGS__.pop();
  }

  // 3. LocalStorage persistence
  try {
    const existing = getLogs();
    existing.unshift(entry);
    if (existing.length > MAX_LOGS) existing.length = MAX_LOGS;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {}

  // 4. Dispatch event for live UI listeners
  try {
    window.dispatchEvent(new CustomEvent("netchain_log", { detail: entry }));
  } catch {}

  // 5. Send to backend zklogin server non-blocking
  try {
    fetch("/api/zklogin/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {});
  } catch {}

  return entry;
}
