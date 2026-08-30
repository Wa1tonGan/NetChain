/* Live backend adapter — connects the UI to the REAL Person 2 + Person 3
   stack instead of the scripted simulation:
     Person 2 gateway  POST /recovery/intents, SSE /incidents/:id/events,
                       GET  /incidents/:id/result      (default :8082)
     Person 3 trust    POST /v1/commit, POST /v1/activation,
                       SSE  /v1/events                 (default :8200)

   Flow: user SMS reply (duration + budget) → RecoveryIntent POSTed to the
   gateway → gateway SSE drives the phase machine → the Selected Offer is
   committed on Sui via the trust server → AVAILABLE settles → SETTLED
   finishes the recovery. Both servers send CORS * so the browser can talk
   to them directly from the Vite dev origin. */

import s0 from "../../../scenarios/s0-normal.json";
import s1 from "../../../scenarios/s1-primary-down-backup-sufficient.json";
import s2 from "../../../scenarios/s2-primary-down-backup-insufficient.json";
import s3 from "../../../scenarios/s3-high-latency.json";
import s4 from "../../../scenarios/s4-packet-loss.json";
import s5 from "../../../scenarios/s5-demand-surge.json";
import s6 from "../../../scenarios/s6-medical-emergency.json";
import s7 from "../../../scenarios/s7-disaster.json";
import s8 from "../../../scenarios/s8-individual-priority-queue.json";

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:8082";
export const TRUST_URL = import.meta.env.VITE_TRUST_URL ?? "http://127.0.0.1:8200";

/* ---------------- scenarios (Person 1's RecoveryIntent files) ------------- */

export interface ScenarioEntry {
  key: string;
  label: string;
  intent: Record<string, unknown>;
}

export const SCENARIOS: ScenarioEntry[] = [
  { key: "s0", label: "S0 · Normal — no recovery needed", intent: s0 },
  { key: "s1", label: "S1 · Primary down — backup sufficient", intent: s1 },
  { key: "s2", label: "S2 · Primary down — backup insufficient", intent: s2 },
  { key: "s3", label: "S3 · High latency", intent: s3 },
  { key: "s4", label: "S4 · Packet loss", intent: s4 },
  { key: "s5", label: "S5 · Demand surge", intent: s5 },
  { key: "s6", label: "S6 · Medical emergency", intent: s6 },
  { key: "s7", label: "S7 · Disaster (P0 failover)", intent: s7 },
  { key: "s8", label: "S8 · Individual priority queue", intent: s8 },
];

export function getScenario(key: string): Record<string, unknown> {
  return SCENARIOS.find((s) => s.key === key)?.intent ?? s2;
}

/** Shortfall the intent asks the market to cover (0 = healthy day). */
export function scenarioShortage(intent: Record<string, unknown>): number {
  const req = intent.requirements as { recoveryCapacityNeededMbps?: number } | undefined;
  return req?.recoveryCapacityNeededMbps ?? 0;
}

/* ---------------- provider branding + plain-language reasons -------------- */

export const BRANDS: Record<string, string> = {
  "PROVIDER-A": "NusaNet 5G",
  "PROVIDER-B": "KilatLink FWA",
  "PROVIDER-C": "OrbitSat GO",
};

export const brand = (providerId: string): string => BRANDS[providerId] ?? providerId;

const REASON_LABELS: Record<string, string> = {
  ACTIVATION_TOO_SLOW: "too slow to activate",
  INSUFFICIENT_CAPACITY: "not enough capacity",
  INSUFFICIENT_DURATION: "can't cover the requested duration",
  LATENCY_EXCEEDED: "latency too high",
  PACKET_LOSS_EXCEEDED: "packet loss too high",
  RELIABILITY_BELOW_MINIMUM: "not reliable enough",
  BUDGET_EXCEEDED: "over budget",
  RESPONSE_TIMEOUT: "no answer before the deadline",
  PROVIDER_UNAVAILABLE: "provider is down",
  SUPERSEDED_BY_FIRST_VIABLE: "viable, but a faster offer won the P0 race",
  RANKED_BELOW: "viable, but ranked lower",
  TAMPERED_OFFER: "failed the signature check",
  OFFER_INVALID: "offer failed validation",
  ACTIVATION_FAILED: "activation failed",
  OFFER_EXPIRED: "offer expired",
};

export const reasonLabel = (code: string): string => REASON_LABELS[code] ?? code.toLowerCase();

/* ---------------- gateway + trust API types (loose, display-only) --------- */

export interface GatewayEvent {
  type: string;
  status?: string;
  providerId?: string;
  attempt?: number;
  receivedAtMs?: number;
  pitch?: string;
  reason?: string;
  detail?: string;
  atMs?: number;
  incidentId?: string;
  [k: string]: unknown;
}

export interface SelectedOffer {
  incidentId: string;
  selectedProvider: {
    providerId: string;
    brand: string;
    capacityMbps: number;
    price: number;
  };
  agreement: {
    planPrice: number;
    platformFee: number;
    amount: number;
    providerAmount: number;
    durationMinutes: number;
    nonce: string;
  };
  [k: string]: unknown;
}

export interface ChainRow {
  seq: number;
  type: string;
  incidentId?: string | null;
  nonce?: string | null;
  txDigest?: string | null;
  data?: {
    amount?: number;
    providerAmount?: number;
    platformFee?: number;
    penaltyAmount?: number;
    verdict?: string;
    idempotent?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${url} → ${res.status}`);
  return json;
}

export async function submitIntent(
  intent: Record<string, unknown>
): Promise<{ incidentId: string; duplicate?: boolean; status: string }> {
  return postJson(`${GATEWAY_URL}/recovery/intents`, intent) as Promise<{
    incidentId: string;
    duplicate?: boolean;
    status: string;
  }>;
}

/** The signed Selected Offer (409 until the market has decided). */
export async function fetchResult(incidentId: string): Promise<SelectedOffer | null> {
  const res = await fetch(`${GATEWAY_URL}/incidents/${encodeURIComponent(incidentId)}/result`);
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`result → ${res.status}`);
  return (await res.json()) as SelectedOffer;
}

export async function commitSelected(selected: SelectedOffer): Promise<{
  status: string;
  duplicate?: boolean;
  txDigest?: string;
}> {
  return postJson(`${TRUST_URL}/v1/commit`, selected) as Promise<{
    status: string;
    duplicate?: boolean;
    txDigest?: string;
  }>;
}

export async function reportActivation(incidentId: string, status: "AVAILABLE" | "FAILED"): Promise<unknown> {
  return postJson(`${TRUST_URL}/v1/activation`, { incidentId, status });
}

export function openIncidentStream(incidentId: string, onEvent: (ev: GatewayEvent) => void): () => void {
  const es = new EventSource(`${GATEWAY_URL}/incidents/${encodeURIComponent(incidentId)}/events`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as GatewayEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => es.close();
}

export function openChainStream(onRow: (row: ChainRow) => void): () => void {
  const es = new EventSource(`${TRUST_URL}/v1/events`);
  es.onmessage = (m) => {
    try {
      onRow(JSON.parse(m.data) as ChainRow);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => es.close();
}

/** One plain-language sentence per trust-layer ledger row — the "chain
    thinking" the user sees in the SMS thread. No raw JSON anywhere. */
export function chainRowLabel(row: ChainRow): string {
  const d = row.data ?? {};
  const tx = row.txDigest ? ` · tx ${row.txDigest.slice(0, 10)}…` : "";
  const rmv = (n: number | undefined): string => "RM " + (n ?? 0).toFixed(2);
  switch (row.type) {
    case "VERIFIED":
      return "🧾 Voucher verified — both signatures valid, nonce reserved";
    case "COMMITTED":
      return d.idempotent
        ? "♻️ Replay — this commitment was already on-chain"
        : `🔗 ${rmv(d.amount)} locked on Sui${tx}`;
    case "SETTLED":
      return `💸 Settled: ${rmv((d.providerAmount ?? 0) - (d.penaltyAmount ?? 0))} → provider · ${rmv(d.platformFee)} → platform${tx}`;
    case "REFUNDED":
      return `↩️ Refunded — the locked escrow returned to your balance${tx}`;
    case "RECLAIMED":
      return `↩️ Escrow reclaimed after expiry${tx}`;
    case "DELIVERY_VERIFIED":
      return `🕵️ Delivery check: ${d.verdict ?? "OK"}` +
        (d.penaltyAmount ? ` · penalty ${rmv(d.penaltyAmount)} refunded` : "") + tx;
    case "DUPLICATE_BLOCKED":
      return "♻️ Replay blocked — this deal was already committed";
    case "VERIFICATION_FAILED":
      return `⚠️ Sui verification failed: ${String((d as { message?: string }).message ?? "").slice(0, 60)}`;
    case "CALLBACK_SENT":
      return "📞 Result pushed back to the agent market";
    case "CALLBACK_FAILED":
      return "⚠️ Couldn't reach the agent market callback";
    default:
      return `🔗 ${row.type}`;
  }
}
