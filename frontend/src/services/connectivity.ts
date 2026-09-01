/* Device connectivity detection — 3 best-effort layers:
   1. navigator.onLine + online/offline events        (all browsers, instant)
   2. Network Information API hints                   (Chromium: downlink/rtt)
   3. Active probes against Cloudflare's public speed endpoints
      (latency every ~10s, throughput every ~60s, CORS-enabled, no key)

   The service is UI-agnostic: it emits samples + outage/restore
   transitions; the store decides what they mean. */

export interface NetworkSample {
  at: number;
  online: boolean;
  rttMs: number | null;
  jitterMs: number | null;
  /** failure ratio of the last 5 latency probes */
  lossPct: number;
  /** best available estimate: measured throughput probe, else browser hint */
  downlinkMbps: number | null;
  /** last throughput-probe measurement, if any */
  measuredMbps: number | null;
  source: string;
}

export interface ConnectivityHandlers {
  onSample: (sample: NetworkSample) => void;
  /** fired once when the connection transitions to unusable */
  onOutage: () => void;
  /** fired once when the connection works again after an outage */
  onRestore: () => void;
}

const LATENCY_URL = "https://speed.cloudflare.com/__down?bytes=0";
const THROUGHPUT_URL = "https://speed.cloudflare.com/__down?bytes=1000000";
const LATENCY_INTERVAL_MS = 10_000;
const THROUGHPUT_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 6_000;
const THROUGHPUT_TIMEOUT_MS = 20_000;
/** 2 consecutive failed latency probes = connection unusable */
const FAILURES_FOR_OUTAGE = 2;

let latencyTimer: ReturnType<typeof setInterval> | null = null;
let throughputTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;
let mockFailure = false;
let mockDownlinkMbps: number | null = null;
let rttHistory: number[] = [];
let probeResults: boolean[] = []; // recent latency probe outcomes
let consecutiveFailures = 0;
let measuredMbps: number | null = null;
let handlers: ConnectivityHandlers | null = null;
let reportedOnline = true;

function timeoutSignal(ms: number): AbortSignal {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms);
  return ctl.signal;
}

function browserHints(): { downlinkMbps: number | null; rttMs: number | null } {
  const conn = (navigator as Navigator & { connection?: { downlink?: number; rtt?: number } }).connection;
  return {
    downlinkMbps: conn?.downlink ?? null,
    rttMs: conn?.rtt ?? null,
  };
}

async function latencyProbe(): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${LATENCY_URL}&t=${Date.now()}`, {
      cache: "no-store",
      signal: timeoutSignal(PROBE_TIMEOUT_MS),
    });
    await res.arrayBuffer();
    if (!res.ok) return null;
    return performance.now() - t0;
  } catch {
    return null;
  }
}

async function throughputProbe(): Promise<number | null> {
  try {
    const t0 = performance.now();
    const res = await fetch(`${THROUGHPUT_URL}&t=${Date.now()}`, {
      cache: "no-store",
      signal: timeoutSignal(THROUGHPUT_TIMEOUT_MS),
    });
    const buf = await res.arrayBuffer();
    const secs = (performance.now() - t0) / 1000;
    if (!res.ok || secs <= 0 || buf.byteLength === 0) return null;
    return (buf.byteLength * 8) / 1e6 / secs; // Mbps
  } catch {
    return null;
  }
}

function summarize(): NetworkSample {
  const hint = browserHints();
  const lastRtt = rttHistory.length ? rttHistory[rttHistory.length - 1] : null;
  const jitter =
    rttHistory.length >= 2
      ? rttHistory.slice(-5).reduce((acc, r, i, arr) => (i === 0 ? 0 : acc + Math.abs(r - arr[i - 1])), 0) /
        Math.min(5, rttHistory.length - 1)
      : null;
  const recent = probeResults.slice(-5);
  const lossPct = recent.length ? +((recent.filter((ok) => !ok).length / recent.length) * 100).toFixed(0) : 0;

  const online = !mockFailure && navigator.onLine !== false && consecutiveFailures < FAILURES_FOR_OUTAGE;
  const downlink =
    mockDownlinkMbps ?? measuredMbps ?? (online ? hint.downlinkMbps : null);

  return {
    at: Date.now(),
    online,
    rttMs: mockFailure ? null : lastRtt ?? (online ? hint.rttMs : null),
    jitterMs: mockFailure ? null : jitter,
    lossPct: mockFailure ? 100 : lossPct,
    downlinkMbps: mockFailure ? null : downlink,
    measuredMbps: mockFailure ? null : measuredMbps,
    source: mockFailure
      ? "simulated outage"
      : mockDownlinkMbps != null
        ? "simulated weak signal"
      : measuredMbps != null
        ? "cloudflare probe"
        : hint.downlinkMbps != null
          ? "browser hints"
          : online
            ? "probe latency only"
            : "unreachable",
  };
}

function emit() {
  if (!handlers) return;
  const sample = summarize();
  if (sample.online !== reportedOnline) {
    reportedOnline = sample.online;
    sample.online ? handlers.onRestore() : handlers.onOutage();
  }
  handlers.onSample(sample);
}

async function runLatencyProbe() {
  if (probing || !handlers) return;
  probing = true;
  try {
    if (mockFailure || navigator.onLine === false) {
      consecutiveFailures = Math.max(consecutiveFailures + 1, FAILURES_FOR_OUTAGE);
      probeResults.push(false);
    } else {
      const rtt = await latencyProbe();
      if (rtt != null) {
        consecutiveFailures = 0;
        rttHistory.push(rtt);
        if (rttHistory.length > 10) rttHistory.shift();
        probeResults.push(true);
      } else {
        consecutiveFailures += 1;
        probeResults.push(false);
      }
    }
    if (probeResults.length > 10) probeResults = probeResults.slice(-10);
    emit();
  } finally {
    probing = false;
  }
}

async function runThroughputProbe() {
  if (probing || mockFailure || navigator.onLine === false || !handlers) return;
  probing = true;
  try {
    // pre-warm the connection so the measurement isn't all TLS handshake
    const warm = await latencyProbe();
    if (warm == null) return;
    const mbps = await throughputProbe();
    if (mbps != null) {
      measuredMbps = +mbps.toFixed(1);
      emit();
    }
  } finally {
    probing = false;
  }
}

/** Start watching; safe to call once at app boot. */
export function startConnectivity(h: ConnectivityHandlers) {
  if (handlers) return;
  handlers = h;
  window.addEventListener("online", () => {
    consecutiveFailures = 0;
    emit();
  });
  window.addEventListener("offline", () => {
    consecutiveFailures = Math.max(consecutiveFailures + 1, FAILURES_FOR_OUTAGE);
    emit();
  });
  const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
  conn?.addEventListener?.("change", emit);

  void runLatencyProbe();
  void runThroughputProbe();
  latencyTimer = setInterval(() => void runLatencyProbe(), LATENCY_INTERVAL_MS);
  throughputTimer = setInterval(() => void runThroughputProbe(), THROUGHPUT_INTERVAL_MS);
}

export function stopConnectivity() {
  if (latencyTimer) clearInterval(latencyTimer);
  if (throughputTimer) clearInterval(throughputTimer);
  latencyTimer = throughputTimer = null;
  handlers = null;
}

/** Dev/stage toggle: pretend the probe can't reach the network. */
export function setMockFailure(v: boolean) {
  mockFailure = v;
  if (v) {
    consecutiveFailures = Math.max(consecutiveFailures + 1, FAILURES_FOR_OUTAGE);
  } else {
    consecutiveFailures = 0;
  }
  emit();
}

/** Dev/stage toggle: keep the link online but force a weak downlink estimate. */
export function setMockDownlink(v: number | null) {
  mockDownlinkMbps = v;
  emit();
}
