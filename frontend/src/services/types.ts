/* Domain types shared across the app. These mirror what the backend
   will eventually expose (Person 2's gateway + Person 3's trust layer),
   so the mock adapter can be swapped for real API/SSE adapters later. */

export type ProtectionState = "protected" | "recovering" | "attention";

export type RecoveryKind = "main" | "auto" | "under" | "failed";

export type Outcome = "ok" | "under" | "failed";

export interface SmsBubble {
  from: "net" | "user" | "sys" | "err";
  text: string;
  /** set when auto recovery sent this on the user's behalf */
  auto?: boolean;
}

/** The user's SMS reply: duration + budget, priced into a plan. */
export interface RecoveryRequest {
  min: number;
  budget: number;
  cost: number;
  adjusted: boolean;
  text: string;
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
  /** phase the machine pauses at, waiting for the user's SMS reply */
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

/** One live SLA verification sample during a purchased plan. */
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

/** Live temporary-capacity session after a successful recovery. */
export interface Session {
  id: string;
  start: number;
  min: number;
  /** delivered baseline (equals `agreed` for a healthy provider) */
  mbps: number;
  /** what the provider agreed to deliver for the whole duration */
  agreed: number;
  cost: number;
  ended: boolean;
  checks: VerificationState;
  log: VerificationSample[];
}

export interface Capacity {
  primary: number;
  current: number;
  extra: number;
  primaryDown: boolean;
}
