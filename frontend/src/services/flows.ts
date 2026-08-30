import type { Outcome, RecoveryKind } from "./types";

/* Recovery flow definitions.
   Every recovery pauses at the "sms" phase and waits for the user's
   reply (duration + budget); variants auto-send a reply so states can
   be demonstrated hands-free. Phase offsets are absolute milliseconds
   from the start of the current scheduling segment. */

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
  ["activating", 5300],
  ["verifying", 7300],
  ["restored", 9300],
];

export interface Flow {
  key: RecoveryKind;
  outcome: Outcome;
  autoSend?: string;
  phases: Phase[];
}

export const FLOWS: Record<RecoveryKind, Flow> = {
  main: { key: "main", outcome: "ok", phases: [...PRE_SMS, ...POST_SMS] },
  auto: { key: "auto", outcome: "ok", autoSend: "30 min, RM 14", phases: [...PRE_SMS, ...POST_SMS] },
  live: {
    // Live backend mode: only the pre-SMS phases are timed locally — after
    // the user's SMS reply the real gateway + trust SSE events drive the
    // machine (see services/live.ts). No post-SMS timers.
    key: "live",
    outcome: "ok",
    phases: [...PRE_SMS],
  },
  under: {
    key: "under", outcome: "under", autoSend: "30 min, RM 14",
    phases: [...PRE_SMS, ...POST_SMS],
  },
  failed: {
    key: "failed", outcome: "failed", autoSend: "30 min, RM 14",
    phases: [
      ...PRE_SMS,
      ["request_detected", 2800],
      ["provider_selected", 4300],
      ["activating", 5300],
      ["failed", 7300],
    ],
  },
};

export const STEP_LABELS = [
  "Problem detected",
  "Protection engaged",
  "Finding extra capacity",
  "Reply with duration & budget",
  "Request detected",
  "Activating",
  "Verifying",
  "Connection restored",
] as const;

export const EVENT_LABELS: Record<string, string> = {
  detected: "Problem detected",
  protecting: "Protection engaged",
  searching: "Capacity shortage detected",
  sms: "Recovery request sent",
  request_detected: "Request detected",
  provider_selected: "Provider found",
  activating: "Capacity activated",
  verifying: "Connection verified",
  restored: "Connection restored",
  failed: "Activation failed",
  noop: "No recovery needed",
};

export const STEP_INDEX: Record<string, number> = {
  detected: 0,
  protecting: 1,
  searching: 2,
  sms: 3,
  request_detected: 4,
  provider_selected: 5,
  activating: 5,
  verifying: 6,
  restored: 7,
  failed: 5,
};

/** Provider comparison evidence shown on the incident receipt. */
export const COMPARISON = [
  { name: "Provider A", state: "No response", sel: false },
  { name: "Provider B", state: "Available now · fastest path", sel: true },
  { name: "Provider C", state: "Available · slower activation", sel: false },
];
