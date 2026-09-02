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
}

export interface RecoveryRecord {
  id: string;
  time: number;
  timeline: { time: string; label: string }[];
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
  comparison?: { name: string; state: string; sel: boolean }[];
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

export type Priority = "P1" | "P2" | "P3" | "P4" | "P5";

export interface ServiceItem {
  id: string;
  name: string;
  prio: Priority;
  minSpeed: number;
}
