import { create } from "zustand";
import {
  adjustPlan,
  costOf,
  DEMAND_MBPS,
  parseSms,
  rm,
  rm0,
  UNDER_DELIVERY_RATIO,
  PLATFORM_FEE,
} from "../services/pricing";
import { EVENT_LABELS, FLOWS } from "../services/flows";
import { daysAgo, fmtClock } from "../services/format";
import type {
  ActivityItem,
  Capacity,
  Incident,
  Payment,
  ProtectionState,
  RecoveryKind,
  RecoveryRecord,
  Session,
  VerificationSample,
} from "../services/types";

/* ================================================================
   App store (zustand). The recovery state machine lives at module
   level so its timers can advance state outside React's render
   cycle — the same shape the real backend's SSE events will drive.

   Model notes:
   - No onboarding: the app opens straight to a protected Home.
   - Individual users have NO backup network. When the primary line
     fails the full demand is short, and NetChain buys all of it.
   - No subscription plans: pay per transaction (provider price +
     a small platform fee), only after verified delivery.
   ================================================================ */

interface AppState {
  // account & preferences
  service: string;
  deviceName: string;
  auto: boolean;
  autoBelow: number;
  maxPerRecovery: number;
  monthlyLimit: number;
  minSpeed: number;
  maxDuration: number;
  balance: number;
  notif: boolean;
  walletAddr: string;

  // network
  capacity: Capacity;
  demand: number;

  // money
  month: { usage: number; fees: number };
  locked: number;
  recoverySeq: number;

  // live recovery
  incident: Incident | null;
  running: boolean;
  overlayDismissed: boolean;
  protectionState: ProtectionState;
  session: Session | null;
  sessionExpired: boolean;

  // history
  activity: ActivityItem[];
  payments: Payment[];
  records: Record<string, RecoveryRecord>;
  disclosures: Record<string, boolean>;

  // actions — settings
  setAuto: (v: boolean) => void;
  setNotif: (v: boolean) => void;
  addFunds: (v: number) => void;
  disclose: (key: string) => void;

  // actions — recovery
  startRecovery: (kind: RecoveryKind) => void;
  sendSms: (text: string, opts?: { auto?: boolean }) => void;
  dismissOverlay: () => void;
  resetSim: () => void;
  addCheck: () => void;
}

const seedActivity: ActivityItem[] = [
  { id: "a-seed-2", ts: daysAgo(1, 9, 14), type: "check",
    title: "Network check", sub: "Connection healthy", note: "No action required" },
  { id: "a-seed-1", ts: daysAgo(4, 16, 40), type: "failed",
    title: "Provider failed", sub: "Temporary capacity could not activate",
    note: "No charge — automatically refunded" },
];

export const useAppStore = create<AppState>((set, get) => ({
  service: "Mobile / eSIM",
  deviceName: "My Phone",
  auto: true,
  autoBelow: 10,
  maxPerRecovery: 20,
  monthlyLimit: 50,
  minSpeed: 100,
  maxDuration: 60,
  balance: 50,
  notif: true,
  walletAddr: "0x71F3a9B2c44E5d16820cCb7713a2fF0e999A82C",

  capacity: { primary: DEMAND_MBPS, current: DEMAND_MBPS, extra: 0, primaryDown: false },
  demand: DEMAND_MBPS,

  month: { usage: 0, fees: 0 },
  locked: 0,
  recoverySeq: 1023,

  incident: null,
  running: false,
  overlayDismissed: false,
  protectionState: "protected",
  session: null,
  sessionExpired: false,

  activity: seedActivity,
  payments: [],
  records: {},
  disclosures: {},

  // ----- settings -----
  setAuto: (v) => set({ auto: v }),
  setNotif: (v) => set({ notif: v }),
  addFunds: (v) => set((s) => ({ balance: +(s.balance + v).toFixed(2) })),
  disclose: (key) => set((s) => ({ disclosures: { ...s.disclosures, [key]: !s.disclosures[key] } })),

  // ----- recovery -----
  startRecovery: (kind) => {
    if (get().running) return;
    clearMachine();
    const flow = FLOWS[kind];
    const st = get();
    set({
      running: true,
      overlayDismissed: false,
      protectionState: "recovering",
      sessionExpired: false,
      session: null,
      capacity: { ...st.capacity, current: 0, primaryDown: true, extra: 0 },
    });
    const seq = st.recoverySeq + 1;
    const inc: Incident = {
      id: "NC-" + seq,
      kind: flow.key,
      outcome: flow.outcome,
      pauseAt: "sms",
      autoSend: flow.autoSend ?? null,
      status: "detected",
      startedAt: Date.now(),
      elapsedBase: 0,
      pausedAt: null,
      events: [{ label: EVENT_LABELS.detected, at: Date.now() }],
      thread: [],
      result: null,
      req: null,
      sentAt: null,
      required: st.demand,
      available: 0, // no backup network for individual users
      shortage: st.demand,
    };
    set({ incident: inc, recoverySeq: seq });
    scheduleFrom(1); // phases[0] (detected) is already recorded
  },

  sendSms: (text, opts) => {
    const st = get();
    const inc = st.incident;
    if (!inc || inc.status !== "sms" || inc.pausedAt == null) return;

    const p = parseSms(text, st.autoBelow);
    if (!p) {
      set({
        incident: {
          ...inc,
          thread: [...inc.thread, { from: "err", text: `Couldn't read that. Try: “30 min, RM 14”.` }],
        },
      });
      return;
    }

    const plan = adjustPlan(p.min, p.budget, inc.shortage);
    const req = { ...plan, text, budget: p.budget };
    const now = Date.now();
    const thread = [
      ...inc.thread,
      { from: "user" as const, text, auto: opts?.auto },
      {
        from: "sys" as const,
        text:
          `Request detected — ${inc.shortage} Mbps · ${plan.min} min · ${rm(plan.cost)}` +
          (plan.adjusted
            ? ` (closest option within your ${rm0(p.budget)} budget)`
            : ` (within your ${rm0(p.budget)} budget ✓)`),
      },
    ];
    set({
      incident: {
        ...inc,
        thread,
        req,
        sentAt: now,
        pausedAt: null,
        startedAt: now - inc.elapsedBase * 1000, // timer continuity across the pause
      },
      locked: plan.cost,
    });
    const phases = FLOWS[inc.kind].phases;
    const idx = phases.findIndex(([s]) => s === inc.pauseAt);
    scheduleFrom(idx + 1);
  },

  dismissOverlay: () => set({ overlayDismissed: true }),

  resetSim: () => {
    clearMachine();
    const st = get();
    set({
      incident: null,
      running: false,
      overlayDismissed: false,
      protectionState: "protected",
      capacity: { ...st.capacity, current: st.capacity.primary, extra: 0, primaryDown: false },
      locked: 0,
      session: null,
      sessionExpired: false,
    });
  },

  addCheck: () =>
    set((s) => ({
      activity: [
        { id: "chk-" + Date.now(), ts: Date.now(), type: "check",
          title: "Network check", sub: "Connection healthy", note: "No action required" },
        ...s.activity,
      ],
    })),
}));

/* ---------------- recovery machine (module level) ---------------- */

let machineTimers: ReturnType<typeof setTimeout>[] = [];

function clearMachine() {
  machineTimers.forEach(clearTimeout);
  machineTimers = [];
}

/** Schedule remaining phases at their absolute offsets from the current point. */
function scheduleFrom(fromIdx: number) {
  const inc = useAppStore.getState().incident;
  if (!inc) return;
  const phases = FLOWS[inc.kind].phases;
  const base = fromIdx > 0 ? phases[fromIdx - 1][1] : 0;
  for (let i = fromIdx; i < phases.length; i++) {
    const [status, ms] = phases[i];
    if (status === inc.pauseAt) {
      machineTimers.push(setTimeout(() => pauseForSms(), ms - base));
      return;
    }
    machineTimers.push(setTimeout(() => advance(status), ms - base));
  }
}

function advance(status: string) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || inc.result) return;

  useAppStore.setState({
    incident: {
      ...inc,
      status,
      events: [...inc.events, { label: EVENT_LABELS[status], at: Date.now() }],
    },
  });

  const cap = useAppStore.getState().capacity;
  if ((status === "verifying" || status === "restored") && inc.outcome !== "failed") {
    // purchased capacity replaces the failed primary line entirely
    const delivered = inc.outcome === "under" ? Math.round(inc.shortage * UNDER_DELIVERY_RATIO) : inc.shortage;
    useAppStore.setState({ capacity: { ...cap, current: delivered, extra: delivered } });
  }
  if (status === "restored") finishRecovery(inc.outcome === "under" ? "under" : "ok");
  if (status === "failed") {
    useAppStore.setState({ capacity: { ...cap, extra: 0, current: 0 } });
    finishRecovery("failed");
  }
}

function pauseForSms() {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc) return;
  const now = Date.now();
  useAppStore.setState({
    incident: {
      ...inc,
      status: "sms",
      pausedAt: now,
      elapsedBase: (now - inc.startedAt) / 1000,
      events: [...inc.events, { label: EVENT_LABELS.sms, at: now }],
      thread: [
        ...inc.thread,
        {
          from: "net",
          text:
            `Your connection is down and you need ${inc.shortage} Mbps. ` +
            `Reply with a duration and budget — e.g. “30 min, RM 14”.`,
        },
      ],
    },
  });
  if (inc.autoSend) {
    const reply = inc.autoSend;
    machineTimers.push(setTimeout(() => useAppStore.getState().sendSms(reply, { auto: true }), 1100));
  }
}

function finishRecovery(kind: "ok" | "under" | "failed") {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc) return;
  clearMachine();

  const time = +((Date.now() - (inc.sentAt || inc.startedAt)) / 1000).toFixed(1);
  const cost = inc.req ? inc.req.cost : costOf(inc.shortage, 30);
  const reqMin = inc.req?.min ?? 30;
  const delivered = kind === "under" ? Math.round(inc.shortage * UNDER_DELIVERY_RATIO) : kind === "ok" ? inc.shortage : 0;

  let charged = 0;
  let refund = 0;
  let fee = 0;
  let state = "";
  let actTitle = "";
  let actSub = "";
  let actNote = "";
  let session: Session | null = null;
  let protectionState: ProtectionState = "protected";
  let capacityPatch: Partial<Capacity> | null = null;

  if (kind === "ok") {
    charged = cost;
    fee = PLATFORM_FEE;
    state = "Settled";
    actTitle = "Recovery completed";
    actSub = "Primary connection failed";
    actNote = `+${inc.shortage} Mbps · ${reqMin} min`;
    session = makeSession(inc.id, reqMin, cost, inc.shortage, inc.shortage);
  } else if (kind === "under") {
    refund = +(cost * (1 - UNDER_DELIVERY_RATIO)).toFixed(2);
    charged = +(cost - refund).toFixed(2);
    fee = PLATFORM_FEE;
    state = "Refund issued";
    actTitle = "Recovery completed";
    actSub = "Provider under-delivered";
    actNote = `+${delivered} Mbps · ${rm(refund)} refunded`;
    // the plan keeps running at the under-delivered level; live checks stay failing
    session = makeSession(inc.id, reqMin, cost, delivered, inc.shortage);
  } else {
    refund = cost;
    state = "Refunded";
    actTitle = "Recovery failed";
    actSub = "Temporary capacity could not activate";
    actNote = "No charge — automatically refunded";
    protectionState = "attention";
    capacityPatch = { current: 0 };
  }

  const timeline = inc.events.map((e) => ({ time: fmtClock(e.at), label: e.label }));
  const tx = "0x" + Math.random().toString(16).slice(2, 6) + "…" + Math.random().toString(16).slice(2, 6);

  const record: RecoveryRecord = {
    id: inc.id,
    time,
    timeline,
    outcome: kind,
    provider: "Provider B",
    cap: inc.shortage,
    min: reqMin,
    smsText: inc.req?.text ?? "",
    budget: inc.req?.budget ?? 0,
    cost,
    charged,
    refund,
    fee,
    state,
    tx,
    restored: kind !== "failed",
    delivered,
  };

  const payments = [...st.payments];
  if (charged > 0 || refund > 0) {
    payments.unshift({
      id: inc.id,
      ts: Date.now(),
      label: "Temporary capacity",
      provider: "Provider B",
      cap: `+${inc.shortage} Mbps · ${reqMin} min`,
      amount: charged,
      refund: refund > 0 && kind !== "failed" ? refund : kind === "failed" ? cost : 0,
      refundNote: kind === "failed" ? "reservation refunded" : "",
      state,
    });
  }

  useAppStore.setState({
    running: false,
    locked: 0,
    session,
    protectionState,
    balance: Math.max(0, +(st.balance - charged).toFixed(2)),
    month: { usage: +(st.month.usage + charged).toFixed(2), fees: +(st.month.fees + fee).toFixed(2) },
    records: { ...st.records, [inc.id]: record },
    activity: [
      {
        id: inc.id, ts: Date.now(), type: kind === "failed" ? "failed" : "ok",
        title: actTitle, sub: actSub, note: actNote,
        time: time + " sec", cost: charged, recordId: inc.id,
      },
      ...st.activity,
    ],
    payments,
    incident: { ...inc, result: { time, charged, refund, state } },
    ...(capacityPatch ? { capacity: { ...st.capacity, ...capacityPatch } } : {}),
  });
}

function makeSession(id: string, min: number, cost: number, mbps: number, agreed: number): Session {
  return {
    id,
    start: Date.now(),
    min,
    mbps,
    agreed,
    cost,
    ended: false,
    checks: { total: 0, passed: 0, avgSum: 0, last: null },
    log: [],
  };
}

/* ---------------- live SLA verification (demo speed ×60) ----------------
   While a purchased plan runs, delivered throughput is checked once per
   simulated minute against the agreed capacity. Samples are kept in a
   rolling log so the user can track the whole duration. */

setInterval(() => {
  const st = useAppStore.getState();
  const s = st.session;
  if (!s || s.ended) return;

  const remainMin = s.min - (Date.now() - s.start) / 1000;
  if (remainMin <= 0) {
    endSession();
    return;
  }

  // one verification per tick
  const jitter = (Math.random() - 0.4) * 6; // −2.4 … +3.6 Mbps
  const sample: VerificationSample = {
    at: Date.now(),
    mbps: Math.max(0, +(s.mbps + jitter).toFixed(1)),
    ok: false,
  };
  sample.ok = sample.mbps >= s.agreed * 0.95;
  const checks = {
    total: s.checks.total + 1,
    passed: s.checks.passed + (sample.ok ? 1 : 0),
    avgSum: s.checks.avgSum + sample.mbps,
    last: sample,
  };
  useAppStore.setState({ session: { ...s, checks, log: [sample, ...s.log].slice(0, 6) } });
}, 1000);

function endSession() {
  const st = useAppStore.getState();
  const s = st.session;
  if (!s || s.ended) return;
  useAppStore.setState({
    session: { ...s, ended: true },
    sessionExpired: true,
    protectionState: "attention",
    capacity: { ...st.capacity, current: 0, extra: 0 },
  });
}

/** Elapsed recovery seconds for the live timer display. */
export function elapsedSecAt(inc: Incident, now: number): number {
  if (inc.result) return inc.result.time;
  if (inc.pausedAt != null) return inc.elapsedBase;
  return Math.min((now - inc.startedAt) / 1000, 99);
}
