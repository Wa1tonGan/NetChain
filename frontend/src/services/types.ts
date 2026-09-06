/* Domain types shared across the app. */

export type ProtectionState = "protected" | "recovering" | "attention";

export type RecoveryKind = "main" | "auto" | "under" | "failed" | "live";

export type Outcome = "ok" | "under" | "failed";

export interface SmsBubble {
  from: "net" | "user" | "sys" | "err";
  text: string;
  auto?: boolean;
}

export interface RecoveryRequest {
  min: number;
  budget: number;
  cost: number;
  adjusted: boolean;
  text: string;
  // live-mode additions (real Selected Offer values replace local estimates)
  provider?: string;
  planPrice?: number;
  platformFee?: number;
  escrow?: number;
  nonce?: string;
}

export interface IncidentEvent {
  label: string;
  at: number;
}

export interface IncidentResult {
  time: number;
  charged: number;
  refund: number;
  state: string;
  tx?: string;
  commitTx?: string;
  walrusBlobId?: string;
}

export interface Incident {
  id: string;
  kind: RecoveryKind;
  outcome: Outcome;
  pauseAt: string;
  autoSend: string | null;
  status: string;
  startedAt: number;
  elapsedBase: number;
  pausedAt: number | null;
  events: IncidentEvent[];
  thread: SmsBubble[];
  result: IncidentResult | null;
  req: RecoveryRequest | null;
  sentAt: number | null;
  required: number;
  available: number;
  shortage: number;
  scenarioKey?: string;
  commitTxDigest?: string;
  settleTxDigest?: string;
  walrusBlobId?: string;
  /** live-run context: gateway-side incident id + the degradation the run
   *  responds to (drives the modal's alert card and audit lookup) */
  gatewayIncidentId?: string;
  degradedMbps?: number | null;
  subject?: string;
  customerId?: string;
}

export interface RecoveryRecord {
  id: string;
  time: number;
  timeline: { time: string; label: string; at?: number }[];
  outcome: Outcome;
  provider: string;
  cap: number;
  min: number;
  smsText: string;
  budget: number;
  cost: number;
  charged: number;
  refund: number;
  fee: number;
  state: string;
  tx: string;
  restored: boolean;
  delivered: number;
  providerAddr?: string;
  platformAddr?: string;
  logHash?: string;
  // live-mode additions
  nonce?: string;
  commitTx?: string;
  walrusBlobId?: string;
  comparison?: { name: string; state: string; sel: boolean; id?: string }[];
  /** Gonka consensus audit trail — one vote per model, each with the
   *  x-request-id needed to audit the inference against the gateway */
  consensus?: { model: string; requestId: string | null; ranking: string[] }[];
}

export interface Payment {
  id: string;
  ts: number;
  label: string;
  provider: string;
  cap: string;
  amount: number;
  refund: number;
  refundNote: string;
  state: string;
  /** real settle digest for LIVE runs — links the row to Suiscan */
  txDigest?: string;
  /** Walrus evidence blob ID */
  walrusBlobId?: string;
  /** top-up rows are deposits (money IN), excluded from spend totals */
  kind?: "recovery" | "topup";
}

export interface ActivityItem {
  id: string;
  ts: number;
  type: "ok" | "check" | "failed";
  title: string;
  sub: string;
  note: string;
  time?: string;
  cost?: number;
  recordId?: string;
}

export interface VerificationSample {
  at: number;
  mbps: number;
  ok: boolean;
}

export interface VerificationState {
  total: number;
  passed: number;
  avgSum: number;
  last: VerificationSample | null;
}

export interface Session {
  id: string;
  start: number;
  min: number;
  mbps: number;
  agreed: number;
  cost: number;
  ended: boolean;
  checks: VerificationState;
  log: VerificationSample[];
  endNote?: string;
}

export interface Capacity {
  primary: number;
  current: number;
  extra: number;
  primaryDown: boolean;
}

/* ---------- run transcript (recovery modal) ----------
   One entry per real run event; the RecoveryOverlay renders these 1:1.
   Live runs append entries as gateway/trust events arrive; the simulated
   fallback machine appends the same shapes from its own data. */

export interface RunEntryBase {
  id: string;
  at: number;
}

export interface RunAlert extends RunEntryBase {
  kind: "alert";
  subject?: string;
  degradedMbps: number | null;
  requiredMbps: number;
  budgetUsdc: number;
  priority?: string;
}

export interface RunIntent extends RunEntryBase {
  kind: "intent";
  text: string;
  capacityMbps: number;
  budgetUsdc: number;
  durationMinutes: number;
  gatewayIncidentId?: string;
  preAuthorized: boolean;
}

export interface RunBid extends RunEntryBase {
  kind: "bid";
  providerId: string;
  brand: string;
  category?: string;
  pitch?: string;
  quotedInMs?: number;
  capacityMbps?: number;
  priceUsdc?: number;
  currency?: string;
  latencyMs?: number;
  packetLossPercent?: number;
  reliabilityScore?: number;
  expectedActivationTimeMs?: number;
  winner?: boolean;
  rejectedReason?: string;
  rejectedDetail?: string;
}

export interface RunConsensusVote {
  model: string;
  requestId: string | null;
  ranking: string[];
  /** the model's own rationale for the top pick (when the vote carries one) */
  reason?: string | null;
}

export interface RunConsensus extends RunEntryBase {
  kind: "consensus";
  round: number;
  winnerProviderId: string;
  brands: Record<string, string>;
  votes: RunConsensusVote[];
}

export interface RunEscrow extends RunEntryBase {
  kind: "escrow";
  amountUsdc: number;
  currency: string;
  escrowId?: string;
  txDigest?: string;
  providerBrand: string;
  agentSigned: boolean;
}

export interface RunTelemetry extends RunEntryBase {
  kind: "telemetry";
  deliveredMbps: number | null;
  promisedMbps: number | null;
  latencyMs?: number | null;
  packetLossPercent?: number | null;
  walrusBlobId?: string | null;
  verdict?: string | null;
}

export type RunLogEntry =
  | RunAlert
  | RunIntent
  | RunBid
  | RunConsensus
  | RunEscrow
  | RunTelemetry;
