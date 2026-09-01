import { create } from "zustand";
import {
  adjustPlan,
  calcSplitSettlement,
  costOf,
  DEMAND_MBPS,
  parseSms,
  rm,
  rm0,
  UNDER_DELIVERY_RATIO,
} from "../services/pricing";
import { EVENT_LABELS, FLOWS } from "../services/flows";
import { daysAgo, fmtClock } from "../services/format";
import { startConnectivity, setMockDownlink, setMockFailure, type NetworkSample } from "../services/connectivity";
import type { ZkLoginSession } from "../services/zklogin";
import type {
  ActivityItem,
  Capacity,
  Incident,
  Payment,
  ProtectionState,
  RecoveryKind,
  RecoveryRecord,
  ServiceItem,
  Session,
  VerificationSample,
} from "../services/types";

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
  zkLogin: ZkLoginSession | null;

  // network
  capacity: Capacity;
  demand: number;

  // money & trust layer
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

  // device connectivity
  netSample: NetworkSample | null;
  outageSource: "real" | "simulated" | null;
  mockProbeOutage: boolean;
  mockWeakSignal: boolean;

  // history
  activity: ActivityItem[];
  payments: Payment[];
  records: Record<string, RecoveryRecord>;
  disclosures: Record<string, boolean>;

  // enterprise services
  services: ServiceItem[];
  serviceSeq: number;

  // actions — settings
  setAuto: (v: boolean) => void;
  setMaxPerRecovery: (v: number) => void;
  setMonthlyLimit: (v: number) => void;
  setNotif: (v: boolean) => void;
  addFunds: (v: number) => void;
  disclose: (key: string) => void;
  setZkLogin: (session: ZkLoginSession | null) => void;

  // actions — enterprise services
  saveService: (svc: Omit<ServiceItem, "id">, editId?: string) => void;
  removeService: (id: string) => void;

  // actions — recovery
  startRecovery: (kind: RecoveryKind, customShortage?: number) => void;
  runScenario: (scenarioId: "S1" | "S2" | "S3" | "S4" | "S5" | "S6") => void;
  sendSms: (text: string, opts?: { auto?: boolean }) => void;
  dismissOverlay: () => void;
  resetSim: () => void;
  addCheck: () => void;
  startConnectivityWatcher: () => void;
  toggleMockOutage: () => void;
  toggleMockWeakSignal: () => void;
}

const seedActivity: ActivityItem[] = [
  {
    id: "a-seed-2",
    ts: daysAgo(1, 9, 14),
    type: "check",
    title: "Network check",
    sub: "Connection healthy",
    note: "No action required",
  },
  {
    id: "a-seed-1",
    ts: daysAgo(4, 16, 40),
    type: "failed",
    title: "Primary connection failed",
    sub: "Switched to KilatLink FWA",
    note: "Sui escrow settled",
  },
];

const seedServices: ServiceItem[] = [
  { id: "svc-1", name: "CCTV / Security", prio: "P1", minSpeed: 100 },
  { id: "svc-2", name: "Payments / POS", prio: "P1", minSpeed: 100 },
  { id: "svc-3", name: "Live Broadcast", prio: "P2", minSpeed: 300 },
  { id: "svc-4", name: "Operations VPN", prio: "P3", minSpeed: 50 },
  { id: "svc-5", name: "Guest Wi-Fi", prio: "P5", minSpeed: 250 },
];

function getStoredZkLogin(): ZkLoginSession | null {
  try {
    const raw = localStorage.getItem("netchain_zklogin");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const initialZkLogin = getStoredZkLogin();

export const useAppStore = create<AppState>((set, get) => ({
  service: "Autonomous Mobile / eSIM",
  deviceName: "Pixel 9 Pro",
  auto: true,
  autoBelow: 14,
  maxPerRecovery: 20,
  monthlyLimit: 100,
  minSpeed: 100,
  maxDuration: 60,
  balance: 65,
  notif: true,
  walletAddr: initialZkLogin?.address ?? "0x71F3a9B2c44E5d16820cCb7713a2fF0e999A82C5512",
  zkLogin: initialZkLogin,

  capacity: { primary: DEMAND_MBPS, current: DEMAND_MBPS, extra: 0, primaryDown: false },
  demand: DEMAND_MBPS,

  month: { usage: 12.6, fees: 0.63 },
  locked: 0,
  recoverySeq: 1023,

  incident: null,
  running: false,
  overlayDismissed: false,
  protectionState: "protected",
  session: null,
  sessionExpired: false,

  netSample: null,
  outageSource: null,
  mockProbeOutage: false,
  mockWeakSignal: false,

  activity: seedActivity,
  payments: [],
  records: {},
  disclosures: {},

  services: seedServices,
  serviceSeq: 6,

  // ----- settings -----
  setAuto: (v) => set({ auto: v }),
  setMaxPerRecovery: (v) => set({ maxPerRecovery: v }),
  setMonthlyLimit: (v) => set({ monthlyLimit: v }),
  setNotif: (v) => set({ notif: v }),
  addFunds: (v) => set((s) => ({ balance: +(s.balance + v).toFixed(2) })),
  disclose: (key) => set((s) => ({ disclosures: { ...s.disclosures, [key]: !s.disclosures[key] } })),
  setZkLogin: (session) => {
    try {
      if (session) {
        localStorage.setItem("netchain_zklogin", JSON.stringify(session));
      } else {
        localStorage.removeItem("netchain_zklogin");
      }
    } catch {}
    set({
      zkLogin: session,
      walletAddr: session ? session.address : "0x71F3a9B2c44E5d16820cCb7713a2fF0e999A82C5512",
    });
  },

  // ----- enterprise services -----
  saveService: (svc, editId) =>
    set((s) => ({
      services: editId
        ? s.services.map((x) => (x.id === editId ? { ...x, ...svc } : x))
        : [...s.services, { ...svc, id: "svc-" + s.serviceSeq }],
      serviceSeq: editId ? s.serviceSeq : s.serviceSeq + 1,
    })),
  removeService: (id) =>
    set((s) => ({
      services: s.services.filter((x) => x.id !== id),
    })),

  // ----- recovery -----
  startRecovery: (kind, customShortage) => {
    if (get().running) return;
    clearMachine();
    const flow = FLOWS[kind];
    const st = get();
    const shortage = customShortage ?? st.demand;

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
      required: shortage,
      available: 0,
      shortage,
    };

    set({ incident: inc, recoverySeq: seq, outageSource: st.outageSource ?? "simulated" });
    scheduleFrom(1);
  },

  runScenario: (scenarioId) => {
    const st = get();
    if (st.running) return;

    if (scenarioId === "S1") {
      get().startRecovery("auto", 300);
    } else if (scenarioId === "S2") {
      get().startRecovery("auto", 500);
    } else if (scenarioId === "S3") {
      get().startRecovery("auto", 250);
    } else if (scenarioId === "S4") {
      get().startRecovery("main", 500);
    } else if (scenarioId === "S5") {
      get().startRecovery("auto", 500);
    } else {
      get().startRecovery("auto", 500);
    }
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
          `Intent accepted — ${inc.shortage} Mbps · ${plan.min} min · ${rm(plan.cost)}` +
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
        startedAt: now - inc.elapsedBase * 1000,
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
      outageSource: null,
    });
  },

  startConnectivityWatcher: () => {
    startConnectivity({
      onSample: (sample) => {
        set({ netSample: sample });
        handleRealNetworkTransition();
      },
      onOutage: () => handleRealNetworkTransition(),
      onRestore: () => handleRealNetworkTransition(),
    });
  },

  toggleMockOutage: () => {
    const next = !get().mockProbeOutage;
    set({ mockProbeOutage: next });
    setMockFailure(next);
  },

  toggleMockWeakSignal: () => {
    const next = !get().mockWeakSignal;
    set({ mockWeakSignal: next });
    setMockDownlink(next ? 20 : null);
  },

  addCheck: () =>
    set((s) => ({
      activity: [
        {
          id: "chk-" + Date.now(),
          ts: Date.now(),
          type: "check",
          title: "Network check",
          sub: "Connection healthy",
          note: "No action required",
        },
        ...s.activity,
      ],
    })),
}));

/* ---------------- real-network watcher ---------------- */
function handleRealNetworkTransition() {
  const st = useAppStore.getState();
  const sample = st.netSample;
  if (!sample) return;

  if (!sample.online) {
    if (st.outageSource !== null || st.running || st.protectionState !== "protected") return;
    const patch: Partial<AppState> = {
      outageSource: "real",
      capacity: { ...st.capacity, primaryDown: true, current: 0, extra: 0 },
    };
    if (st.session && !st.session.ended) {
      patch.session = { ...st.session, ended: true, endNote: "Connection lost — send a new recovery request." };
    }
    useAppStore.setState(patch);
    if (st.auto) {
      useAppStore.getState().startRecovery("main");
    } else {
      useAppStore.setState({ protectionState: "attention" });
    }
    return;
  }

  if (sample.online && st.mockWeakSignal && sample.downlinkMbps != null && sample.downlinkMbps < st.demand) {
    if (st.outageSource !== null || st.running || st.protectionState !== "protected") return;
    const patch: Partial<AppState> = {
      outageSource: "real",
      capacity: { ...st.capacity, primaryDown: true, current: sample.downlinkMbps, extra: 0 },
    };
    if (st.session && !st.session.ended) {
      patch.session = { ...st.session, ended: true, endNote: "Signal too weak — send a new recovery request." };
    }
    useAppStore.setState(patch);
    if (st.auto) {
      useAppStore.getState().startRecovery("main");
    } else {
      useAppStore.setState({ protectionState: "attention" });
    }
    return;
  }

  if (
    sample.online &&
    !st.mockWeakSignal &&
    st.outageSource === "real" &&
    !st.running &&
    st.protectionState === "protected" &&
    st.capacity.primaryDown
  ) {
    const patch: Partial<AppState> = {
      outageSource: null,
      capacity: { ...st.capacity, primaryDown: false, current: st.capacity.primary, extra: 0 },
    };
    if (st.session && !st.session.ended) {
      patch.session = { ...st.session, ended: true, endNote: "Primary connection restored." };
    }
    useAppStore.setState(patch);
  }
}

/* ---------------- recovery machine (module level) ---------------- */
let machineTimers: ReturnType<typeof setTimeout>[] = [];

function clearMachine() {
  machineTimers.forEach(clearTimeout);
  machineTimers = [];
}

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
      events: [...inc.events, { label: EVENT_LABELS[status] || status, at: Date.now() }],
    },
  });

  const cap = useAppStore.getState().capacity;
  if ((status === "verifying" || status === "restored") && inc.outcome !== "failed") {
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
            `Line degraded · Shortage: ${inc.shortage} Mbps. ` +
            `Reply with duration & budget — e.g. “30 min, RM 14”.`,
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
  const delivered =
    kind === "under" ? Math.round(inc.shortage * UNDER_DELIVERY_RATIO) : kind === "ok" ? inc.shortage : 0;

  const split = calcSplitSettlement(cost);
  let charged = 0;
  let refund = 0;
  let fee = split.platformFee;
  let state = "";
  let actTitle = "";
  let actSub = "";
  let actNote = "";
  let session: Session | null = null;
  let protectionState: ProtectionState = "protected";
  let capacityPatch: Partial<Capacity> | null = null;

  if (kind === "ok") {
    charged = cost;
    state = "Settled";
    actTitle = "Recovery completed";
    actSub = "KilatLink FWA active";
    actNote = `+${inc.shortage} Mbps · ${reqMin} min`;
    session = makeSession(inc.id, reqMin, cost, inc.shortage, inc.shortage);
  } else if (kind === "under") {
    refund = +(cost * (1 - UNDER_DELIVERY_RATIO)).toFixed(2);
    charged = +(cost - refund).toFixed(2);
    state = "Refund issued";
    actTitle = "Recovery completed";
    actSub = "Provider under-delivered";
    actNote = `+${delivered} Mbps · ${rm(refund)} refunded`;
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
  const logHash = "0x" + Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);

  const record: RecoveryRecord = {
    id: inc.id,
    time,
    timeline,
    outcome: kind,
    provider: "KilatLink FWA",
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
    providerAddr: split.providerAddress,
    platformAddr: split.platformAddress,
    logHash,
  };

  const payments = [...st.payments];
  if (charged > 0 || refund > 0) {
    payments.unshift({
      id: inc.id,
      ts: Date.now(),
      label: "Autonomous recovery",
      provider: "KilatLink FWA",
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
        id: inc.id,
        ts: Date.now(),
        type: kind === "failed" ? "failed" : "ok",
        title: actTitle,
        sub: actSub,
        note: actNote,
        time: time + " sec",
        cost: charged,
        recordId: inc.id,
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

/* ---------------- live SLA verification ---------------- */
setInterval(() => {
  const st = useAppStore.getState();
  const s = st.session;
  if (!s || s.ended) return;

  const remainMin = s.min - (Date.now() - s.start) / 1000;
  if (remainMin <= 0) {
    endSession();
    return;
  }

  const jitter = (Math.random() - 0.4) * 6;
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

export function elapsedSecAt(inc: Incident, now: number): number {
  if (inc.result) return inc.result.time;
  if (inc.pausedAt != null) return inc.elapsedBase;
  return Math.min((now - inc.startedAt) / 1000, 99);
}
