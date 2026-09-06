import type { Outcome, RecoveryKind } from "./types";

export interface ProviderQuote {
  id: string;
  name: string;
  type: string;
  capacityMbps: number;
  latencyMs: number;
  cost: number;
  state: string;
  selected: boolean;
  score: number;
  camaraQod: boolean;
}

export type Phase = [status: string, ms: number];

const PRE_SMS: Phase[] = [
  ["detected", 0],
  ["protecting", 600],
  ["searching", 1400],
  ["sms", 2400],
];

const POST_SMS: Phase[] = [
  ["request_detected", 2800],
  ["provider_selected", 4300],
  ["escrow_locked", 5300],
  ["activating", 10000],
  ["verifying", 12000],
  ["restored", 14200],
];

export interface Flow {
  key: RecoveryKind;
  outcome: Outcome;
  phases: Phase[];
}

export const FLOWS: Record<RecoveryKind, Flow> = {
  main: { key: "main", outcome: "ok", phases: [...PRE_SMS, ...POST_SMS] },
  auto: { key: "auto", outcome: "ok", phases: [...PRE_SMS, ...POST_SMS] },
  under: { key: "under", outcome: "under", phases: [...PRE_SMS, ...POST_SMS] },
  failed: {
    key: "failed",
    outcome: "failed",
    phases: [
      ...PRE_SMS,
      ["request_detected", 2800],
      ["provider_selected", 4300],
      ["escrow_locked", 5300],
      ["activating", 9500],
      ["failed", 11200],
    ],
  },
  // Live mode: the auto-dispatched reply hands control to the REAL backend —
  // the gateway SSE stream drives every post-reply phase (no scripted timers).
  live: { key: "live", outcome: "ok", phases: [...PRE_SMS] },
};

export const STEP_LABELS = [
  "Problem detected",
  "Critical traffic protected",
  "A2A parallel provider query",
  "Reply with duration & budget",
  "Gonka 3-model consensus",
  "Sui Escrow funds locked",
  "CAMARA QoD path activated",
  "SLA verification & settlement",
] as const;

export const EVENT_LABELS: Record<string, string> = {
  detected: "Problem detected",
  protecting: "Critical traffic protected",
  searching: "A2A query broadcast to 3 providers",
  sms: "Degradation SMS sent to client",
  request_detected: "Client SMS reply parsed",
  provider_selected: "Gonka selected Digi Fibre Air",
  escrow_locked: "Sui escrow locked (plan + platform fee)",
  activating: "CAMARA QoD session active",
  verifying: "Bandwidth & latency verified",
  restored: "Connection restored & settled",
  failed: "Provider activation failed — funds refunded",
  noop: "No recovery needed",
};

export const STEP_INDEX: Record<string, number> = {
  detected: 0,
  protecting: 1,
  searching: 2,
  sms: 3,
  request_detected: 4,
  provider_selected: 4,
  escrow_locked: 5,
  activating: 6,
  verifying: 7,
  restored: 7,
  failed: 6,
};

export const BLUEPRINT_PROVIDERS: ProviderQuote[] = [
  {
    id: "PROV-A",
    name: "Provider A (Maxis 5G)",
    type: "5G Slice (CAMARA QoD)",
    capacityMbps: 500,
    latencyMs: 25,
    cost: 2.2,
    state: "High Latency / Congested",
    selected: false,
    score: 0.68,
    camaraQod: true,
  },
  {
    id: "PROV-B",
    name: "Provider B (Digi Fibre Air)",
    type: "Fixed Wireless Access",
    capacityMbps: 300,
    latencyMs: 18,
    cost: 1.8,
    state: "Available now · fastest path",
    selected: true,
    score: 0.96,
    camaraQod: true,
  },
  {
    id: "PROV-C",
    name: "Provider C (U Mobile Orbit)",
    type: "LEO Satellite",
    capacityMbps: 150,
    latencyMs: 65,
    cost: 2.5,
    state: "Available · higher latency",
    selected: false,
    score: 0.74,
    camaraQod: false,
  },
];

export const COMPARISON: { name: string; state: string; sel: boolean; id?: string }[] = [
  { name: "Provider A (Maxis 5G)", state: "Congested / High Latency", sel: false },
  { name: "Provider B (Digi Fibre Air)", state: "Available now · fastest path", sel: true },
  { name: "Provider C (U Mobile Orbit)", state: "Available · slower activation", sel: false },
];
