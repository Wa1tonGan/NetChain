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
   to them directly from the Vite dev origin.

   Provider brands come from the gateway's /readiness snapshot (the market
   re-dresses per request); the static BRANDS map is only a fallback. */

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

// Testnet escrow deployment (mirrors .sui/config.testnet.json — the browser
// builds its own deposit PTB against these shared objects).
export const ESCROW_DEPLOY = {
  packageId: "0x531c16cde1a45391ab90f21c9f1e3f06ae3d2965965caee5c3de608a5ed50170",
  escrowId: "0x9c4c5958a942daba695b1a6cfceeec7bf522ed25bc7d55fc5f4d2d828c2a6a63",
  usdcType: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  /** the AuthorityCap holder — signs commits (agent mode) + every settle */
  platformOperator: "0x016dcf7419dcd6561a7f00ad0a7487fa73a67e336f618d032078282722409e24",
} as const;

/** User-funded escrow: the buyer deposits USDC into the shared pool ONCE.
 *  The PTB is identical either way — only the SIGNATURE adapts to the login:
 *  wallet mode → the extension (Slush) signs; zk mode → the ephemeral key +
 *  zk proof signs (session must be fresh: proof usable, epoch not passed).
 *  Every later agent-signed commit draws from THAT pool, so the agent spends
 *  the USER'S money under the AuthorityCap's on-chain per-voucher limit. */
export async function depositToEscrowPool(
  session: import("./zklogin").ZkLoginSession,
  amountUsdc: number
): Promise<{ digest: string }> {
  const { Transaction } = await import("@mysten/sui/transactions");
  const tx = new Transaction();
  const usdc = ESCROW_DEPLOY.usdcType;
  // CoinWithBalance resolution needs the sender set at build time.
  tx.setSender(session.address);
  // Payment drawn from the payer's ADDRESS BALANCE — gasless top-ups land
  // there, so this works for wallets funded via /v1/fund too.
  const balance = tx.balance({ type: usdc, balance: Math.round(amountUsdc * 1_000_000) });
  const coin = tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [usdc],
    arguments: [balance],
  });
  tx.moveCall({
    target: `${ESCROW_DEPLOY.packageId}::escrow::deposit`,
    typeArguments: [usdc],
    arguments: [tx.object(ESCROW_DEPLOY.escrowId), coin],
  });

  const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");
  const client = new SuiJsonRpcClient({ url: "/suirpc", network: "testnet" });
  const built = await tx.build({ client });
  const base64 = btoa(String.fromCharCode(...new Uint8Array(built)));

  if (session.signingMode === "zk") {
    const { zkSignAndSubmit } = await import("./zklogin");
    return zkSignAndSubmit(session, base64);
  }

  const { connectSuiWallet, walletSignAndSubmit } = await import("./walletConnect");
  const wallet = await connectSuiWallet(session.address);
  return walletSignAndSubmit(wallet, base64);
}

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

// Fallback brands only; the live source of truth is the gateway /readiness
// snapshot refreshed into LIVE_BRANDS by refreshBrands().
export const BRANDS: Record<string, string> = {
  "PROVIDER-A": "NusaNet 5G",
  "PROVIDER-B": "KilatLink FWA",
  "PROVIDER-C": "OrbitSat GO",
};

const LIVE_BRANDS: Record<string, string> = {};
const LIVE_CATEGORIES: Record<string, string> = {};

export async function refreshBrands(): Promise<void> {
  try {
    const res = await fetch(`${GATEWAY_URL}/readiness`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return;
    const body = (await res.json()) as {
      providers?: { providerId: string; brand?: string; category?: string }[];
    };
    for (const p of body.providers ?? []) {
      if (p.providerId && p.brand) LIVE_BRANDS[p.providerId] = p.brand;
      if (p.providerId && p.category) LIVE_CATEGORIES[p.providerId] = p.category;
    }
  } catch {
    /* gateway offline — fallback brands remain */
  }
}

export const brand = (providerId: string): string =>
  LIVE_BRANDS[providerId] ?? BRANDS[providerId] ?? providerId;

/** Provider category from the gateway readiness snapshot (e.g. "Fixed
 *  Wireless Access") — labels the bid card tag; undefined before readiness. */
export const categoryOf = (providerId: string): string | undefined =>
  LIVE_CATEGORIES[providerId];

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
  /** arrival/rejection events carry the incident-seeded persona brand so
   *  every card labels the provider identically */
  brand?: string;
  attempt?: number;
  receivedAtMs?: number;
  pitch?: string;
  reason?: string;
  detail?: string;
  atMs?: number;
  incidentId?: string;
  /** arrival events carry the signed offer's headline numbers (real bid cards) */
  capacityMbps?: number;
  price?: number;
  currency?: string;
  latencyMs?: number;
  packetLossPercent?: number;
  reliabilityScore?: number;
  expectedActivationTimeMs?: number;
  /** SELECTED events carry the Gonka consensus audit trail (Transparency UI) */
  votes?: ConsensusVote[];
  [k: string]: unknown;
}

export interface ConsensusVote {
  model: string;
  requestId: string | null;
  ranking: string[];
  /** the model's own one-sentence rationale for the top pick (optional) */
  reason?: string | null;
}

export interface SelectedOffer {
  incidentId: string;
  selectedProvider: {
    providerId: string;
    brand: string;
    capacityMbps: number;
    price: number;
    latencyMs?: number;
    packetLossPercent?: number;
    reliabilityScore?: number;
    expectedActivationTimeMs?: number;
  };
  agreement: {
    planPrice: number;
    platformFee: number;
    amount: number;
    providerAmount: number;
    durationMinutes: number;
    nonce: string;
    currency?: string;
  };
  activation?: {
    status?: string;
    recoveredCapacityMbps?: number;
    confirmedAtMs?: number;
  };
  timing?: {
    tDetect?: number;
    tDecide?: number;
    tActivate?: number;
    tRecover?: number;
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

/** Truth Agent audit delivered on the CLAIM_VERIFIED ledger row. */
export interface ClaimAuditModel {
  model: string;
  ok: boolean;
  verdict?: string | null;
  score?: number | null;
  requestId: string | null;
  reasoning?: string | null;
  error?: string | null;
}

export interface ClaimAudit {
  claimRunId: string | null;
  status: "COMPLETED" | "FAILED" | "TIMEOUT" | string;
  verdict?: string | null;
  score?: number | null;
  confidenceBand?: [number, number] | null;
  agree?: string | null;
  models: ClaimAuditModel[];
  durationMs?: number | null;
  error?: string | null;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // A hung chain submission must not wedge the run machine forever — the
    // trust ledger is idempotent by nonce, so a retry after this timeout is
    // safe (duplicate commits are blocked server-side).
    signal: AbortSignal.timeout(90_000),
  });
  const json = await res.json().catch(() => ({}));
  // Trust/zkLogin servers answer failures with {code, message}; other
  // services may use {error}. Show whichever carries the reason.
  const e = json as { error?: string; message?: string; code?: string };
  if (!res.ok) {
    throw new Error(e.message ?? e.error ?? `${url} → ${res.status}`);
  }
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

/** Cheap gateway liveness probe — gates backend-first recovery routing. */
export async function gatewayHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = (await res.json()) as { healthy?: boolean };
    return body.healthy !== false;
  } catch {
    return false;
  }
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

/** zkLogin buyer-direct commit:
    1. build-only voucher validation + unsigned commit_as_buyer PTB (the
       payment Coin is drawn from the buyer's address balance, keyed by the
       buyerAddress we send),
    2. the BROWSER zk-signs it (ephemeral key + proof — no server key),
    3. confirm the on-chain digest into the ledger. */
export async function zkCommitSelected(
  selected: SelectedOffer,
  session: import("./zklogin").ZkLoginSession
): Promise<{ status: string; txDigest?: string }> {
  const build = (await postJson(`${TRUST_URL}/v1/commit`, {
    ...selected,
    submit: false,
    buyerAddress: session.address,
  })) as { status: string; duplicate?: boolean; txBytes?: string; txDigest?: string };

  if (build.duplicate || !build.txBytes) {
    return { status: build.status ?? "DUPLICATE", txDigest: build.txDigest };
  }

  const { zkSignAndSubmit } = await import("./zklogin");
  const { digest } = await zkSignAndSubmit(session, build.txBytes);

  const confirmed = (await postJson(`${TRUST_URL}/v1/commit/confirm`, {
    incidentId: selected.incidentId,
    nonce: selected.agreement.nonce,
    txDigest: digest,
    voucher: null,
  })) as { status: string };

  return { status: confirmed.status, txDigest: digest };
}

/** Extension-wallet commit (Slush & any Sui-standard wallet): same build-only
 *  endpoint, but the buyerAddress is the wallet's address and the EXTENSION
 *  signs the PTB with its own key + gas — no zk proof, no server key. */
export async function walletCommitSelected(
  selected: SelectedOffer,
  buyerAddress: string
): Promise<{ digest: string }> {
  await ensureWalletFunded(buyerAddress);

  const build = (await postJson(`${TRUST_URL}/v1/commit`, {
    ...selected,
    submit: false,
    buyerAddress,
  })) as { status: string; duplicate?: boolean; txBytes?: string };

  if (build.duplicate) return { digest: "" };

  const { connectSuiWallet, walletSignAndSubmit } = await import("./walletConnect");
  const wallet = await connectSuiWallet(buyerAddress);
  const { digest } = await walletSignAndSubmit(wallet, build.txBytes as string);

  await postJson(`${TRUST_URL}/v1/commit/confirm`, {
    incidentId: selected.incidentId,
    nonce: selected.agreement.nonce,
    txDigest: digest,
    voucher: null,
  });

  return { digest };
}

/** Cold-start funding: a freshly connected wallet holds none of the escrow's
 *  stablecoin (and maybe no SUI gas). The platform tops it up via
 *  POST /v1/fund so the buyer can pay their own commit_as_buyer. Skipped
 *  when the wallet already holds enough. */
async function ensureWalletFunded(address: string): Promise<void> {
  const { fetchChainBalance } = await import("./wallet");
  const bal = await fetchChainBalance(address);
  if (!bal.online) return; // chain read failed — let the commit attempt surface it
  const needStable = (bal.stable?.total ?? 0) < 15; // one commit ≈ 12–14 USDC
  const needGas = bal.sui.total < 0.01;
  if (!needStable && !needGas) return;
  await postJson(`${TRUST_URL}/v1/fund`, {
    address,
    stableBase: needStable ? 20_000_000 : 0, // 20 USDC (6 decimals)
    suiMist: needGas ? 50_000_000 : 0, // 0.05 SUI gas
  });
}

export async function reportActivation(incidentId: string, status: "AVAILABLE" | "FAILED"): Promise<unknown> {
  return postJson(`${TRUST_URL}/v1/activation`, { incidentId, status });
}

/** Permissionless post-expiry reclaim: returns the locked escrow to the
 *  commitment's buyer. Used when a commit landed on-chain but the flow died
 *  before settlement ("chain offline" incidents). */
export async function reclaimEscrow(nonce: string): Promise<{ status: string; txDigest?: string }> {
  return postJson(`${TRUST_URL}/v1/reclaim`, { nonce }) as Promise<{ status: string; txDigest?: string }>;
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
  // Ledger amounts are BASE units (USDC = 6 decimals) — convert for display.
  const rmv = (n: number | undefined): string => "USDC " + ((n ?? 0) / 1_000_000).toFixed(2);
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
    case "CLAIM_VERIFIED": {
      const audit = d as unknown as ClaimAudit;
      if (audit.status === "COMPLETED") {
        return `🧠 Truth Agent audit — ${audit.score ?? "?"}/100 ${audit.verdict ?? ""} (${audit.agree ?? "?"} models agree)`;
      }
      return `🧠 Truth Agent audit unavailable (${String(audit.status).toLowerCase()})`;
    }
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
