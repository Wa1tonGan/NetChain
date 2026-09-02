// Live provider market polling for the ServicesPage market panel.
// Talks straight to the three provider agents (8101–8103) and the rescue
// gateway (8082) — all CORS-enabled. The market panel shows the CURRENT
// persona faces (agent-card reflects the most recently quoted incident).

export const GATEWAY_URL =
  (import.meta.env?.VITE_GATEWAY_URL as string | undefined) ?? "http://127.0.0.1:8082";

const PROVIDER_ENDPOINTS = [
  "http://127.0.0.1:8101",
  "http://127.0.0.1:8102",
  "http://127.0.0.1:8103",
];

export type FailureMode =
  | "healthy"
  | "down"
  | "unresponsive"
  | "slow"
  | "fail_activation"
  | "laggy";

export interface ProviderMarketEntry {
  providerId: string;
  endpoint: string;
  reachable: boolean;
  brand?: string;
  category?: string;
  agentName?: string;
  capabilities?: string[];
  healthy?: boolean;
  failureMode?: FailureMode;
  policy?: {
    maxCapacityMbps: number;
    baseFee: number;
    pricePer100MbpsPerHour: number;
    currency: string;
  };
}

export async function fetchProviderEntry(endpoint: string): Promise<ProviderMarketEntry> {
  const entry: ProviderMarketEntry = { providerId: endpoint, endpoint, reachable: false };

  try {
    const [cardRes, healthRes] = await Promise.all([
      fetch(`${endpoint}/agent-card`, { signal: AbortSignal.timeout(2500) }),
      fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2500) }),
    ]);

    if (!cardRes.ok && !healthRes.ok) {
      return entry;
    }

    entry.reachable = true;

    if (cardRes.ok) {
      const card = await cardRes.json();
      entry.providerId = card.providerId ?? entry.providerId;
      entry.brand = card.brand;
      entry.category = card.category;
      entry.agentName = card.name;
      entry.capabilities = card.capabilities;
    }

    if (healthRes.ok) {
      const health = await healthRes.json();
      entry.healthy = health.healthy;
      entry.failureMode = health.failureMode ?? "healthy";
    }
  } catch {
    // unreachable — keep the minimal entry
  }

  return entry;
}

export async function fetchMarket(): Promise<ProviderMarketEntry[]> {
  return Promise.all(PROVIDER_ENDPOINTS.map(fetchProviderEntry));
}

export async function setFailureMode(
  endpoint: string,
  mode: FailureMode
): Promise<{ ok: boolean; failureMode?: string }> {
  try {
    const res = await fetch(`${endpoint}/admin/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(2500),
    });

    if (!res.ok) {
      return { ok: false };
    }

    const body = await res.json();
    return { ok: true, failureMode: body.failureMode };
  } catch {
    return { ok: false };
  }
}

export interface ReadinessEntry {
  providerId: string;
  brand?: string;
  healthy?: boolean;
  policy?: { maxCapacityMbps: number; currency: string };
}

export interface ReadinessPayload {
  incidentId?: string | null;
  providers?: ReadinessEntry[];
}

export async function fetchReadiness(): Promise<ReadinessPayload | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/readiness`, { signal: AbortSignal.timeout(2500) });

    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch {
    return null;
  }
}
