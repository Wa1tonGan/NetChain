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
import {
  brand as liveBrand,
  chainRowLabel,
  commitSelected,
  fetchResult,
  getScenario,
  openChainStream,
  openIncidentStream,
  reasonLabel,
  refreshBrands,
  reportActivation,
  scenarioShortage,
  submitIntent,
  zkCommitSelected,
  TRUST_URL,
  GATEWAY_URL,
  type ChainRow,
  type ClaimAudit,
  type ConsensusVote,
  type GatewayEvent,
  type SelectedOffer,
} from "../services/live";
import { walletCommitSelected } from "../services/live";
import type { ExplorerType } from "../services/explorer";
// Latest trust-layer ledger rows (real Sui tx digests) for the Activity feed.
// Kept small; the chain SSE reconnects with backoff and tolerates downtime.
let chainClosers: (() => void)[] = [];

/** Ingest a CLAIM_VERIFIED ledger row into claimAudits (cap 20, newest kept). */
function ingestClaimAudit(row: ChainRow) {
  if (row.type !== "CLAIM_VERIFIED" || !row.incidentId) return;
  const st = useAppStore.getState();
  const next: Record<string, ClaimAudit> = { ...st.claimAudits };
  const entries = Object.entries(next);
  if (entries.length >= 20 && !(row.incidentId in next)) {
    // drop the oldest entry (insertion order) to make room
    delete next[entries[0][0]];
  }
  next[row.incidentId] = (row.data ?? {}) as unknown as ClaimAudit;
  useAppStore.setState({ claimAudits: next });
}
function startChainFeed() {
  if (chainClosers.length > 0) return;

  // Seed the Sui Trust Ledger with recent rows so a fresh page load shows
  // history, not just whatever happens after the SSE connects.
  void (async () => {
    try {
      const res = await fetch(`${TRUST_URL}/v1/events/recent?limit=30`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const body = (await res.json()) as { events?: ChainRow[] };
      const events = body.events ?? [];
      if (events.length === 0) return;
      const st = useAppStore.getState();
      const existing = new Set(st.chainRows.map((r) => r.seq));
      const seeded = events
        .filter((e) => !existing.has(e.seq))
        .map((e) => ({ ...e, receivedAt: Date.now(), label: chainRowLabel(e) }))
        .reverse(); // ledger is oldest-first → newest on top
      seeded.forEach(ingestClaimAudit);
      if (seeded.length === 0) return;
      useAppStore.setState({ chainRows: [...seeded, ...st.chainRows].slice(0, 50) });
    } catch {
      // trust server down — the SSE retry loop will carry the feed later
    }
  })();

  const connect = () => {
    try {
      const closer = openChainStream((row: ChainRow) => {
        const st = useAppStore.getState();
        ingestClaimAudit(row);
        useAppStore.setState({
          chainRows: [
            { ...row, receivedAt: Date.now(), label: chainRowLabel(row) },
            ...st.chainRows,
          ].slice(0, 50),
        });
      });
      chainClosers.push(closer);
      // EventSource constructor rarely throws; EventSource itself retries.
    } catch {
      // ignore — the SSE stream retries on its own.
    }
  };

  connect();
}
import { daysAgo, fmtClock } from "../services/format";
import { startConnectivity, setMockDownlink, setMockFailure, type NetworkSample } from "../services/connectivity";
import { hasUsableProof, type ZkLoginSession } from "../services/zklogin";
import type {
  ActivityItem,
  Capacity,
  Incident,
  Payment,
  ProtectionState,
  RecoveryKind,
  RecoveryRecord,
  RecoveryRequest,
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
  /** true (default): the RescueAgent pays from the pre-funded escrow pool with
   *  its own server key — agent-to-agent payment, no user prompts.
   *  false: the user's wallet (Slush/zk) signs every commit personally. */
  agentSigning: boolean;
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

  // on-chain ledger rows (trust server SSE, real tx digests)
  chainRows: (ChainRow & { receivedAt?: number; label?: string })[];
  // Truth Agent SLA audits keyed by incident (CLAIM_VERIFIED ledger rows).
  claimAudits: Record<string, ClaimAudit>;

  // explorer preference
  preferredExplorer: ExplorerType;
  // actions — settings
  setAuto: (v: boolean) => void;
  setMaxPerRecovery: (v: number) => void;
  setMonthlyLimit: (v: number) => void;
  setNotif: (v: boolean) => void;
  setAgentSigning: (v: boolean) => void;
  addFunds: (v: number) => void;
  recordTopUp: (amount: number, txDigest: string) => void;
  disclose: (key: string) => void;
  setZkLogin: (session: ZkLoginSession | null) => void;
  setPreferredExplorer: (v: ExplorerType) => void;
  // actions — enterprise services
  saveService: (svc: Omit<ServiceItem, "id">, editId?: string) => void;
  removeService: (id: string) => void;

  // actions — recovery
  startRecovery: (kind: RecoveryKind, customShortage?: number) => void;
  startLiveRecovery: (scenarioKey: string) => void;
  runScenario: (scenarioId: "S1" | "S2" | "S3" | "S4" | "S5" | "S6") => void;
  sendSms: (text: string, opts?: { auto?: boolean }) => void;
  dismissOverlay: () => void;
  resetSim: () => void;
  addCheck: () => void;
  startConnectivityWatcher: () => void;
  startChainFeed: () => void;
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
  preferredExplorer:
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("netchain_explorer") as ExplorerType)) ||
    "suivision",
  balance: 65,
  notif: true,
  agentSigning: true,
  walletAddr: initialZkLogin?.address ?? "0x71F3a9B2c44E5d16820cCb7713a2fF0e999A82C5512",
  zkLogin: initialZkLogin,

  capacity: { primary: DEMAND_MBPS, current: DEMAND_MBPS, extra: 0, primaryDown: false },
  demand: DEMAND_MBPS,
  claimAudits: {},
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

  chainRows: [],

  startChainFeed: () => {
    startChainFeed();
  },

  // ----- settings -----
  setAuto: (v) => set({ auto: v }),
  setMaxPerRecovery: (v) => set({ maxPerRecovery: v }),
  setMonthlyLimit: (v) => set({ monthlyLimit: v }),
  setNotif: (v) => set({ notif: v }),
  setAgentSigning: (v) => set({ agentSigning: v }),
  addFunds: (v) => set((s) => ({ balance: +(s.balance + v).toFixed(2) })),
  // Escrow top-ups join the payments ledger as deposits (money IN) — the
  // transaction history shows them green with a Suiscan link; spend totals
  // ("This month") exclude them via kind !== "topup".
  recordTopUp: (amount, txDigest) =>
    set((s) => ({
      payments: [
        {
          id: "topup-" + Date.now(),
          ts: Date.now(),
          label: "Escrow top-up",
          provider: "Sui escrow pool",
          cap: "deposit",
          amount,
          refund: 0,
          refundNote: "",
          state: "FUNDED",
          txDigest,
          kind: "topup" as const,
        },
        ...s.payments,
      ],
    })),
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
  setPreferredExplorer: (v) => {
    try {
      localStorage.setItem("netchain_explorer", v);
    } catch {}
    set({ preferredExplorer: v });
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

  startLiveRecovery: (scenarioKey) => {
    if (get().running) return;
    clearMachine();
    const st = get();
    const intent = getScenario(scenarioKey);
    const shortage = scenarioShortage(intent) || st.demand;

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
      kind: "live",
      outcome: "ok",
      pauseAt: "sms",
      autoSend: null,
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
      scenarioKey,
    };

    set({ incident: inc, recoverySeq: seq, outageSource: st.outageSource ?? "simulated" });
    void refreshBrands();
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
          thread: [...inc.thread, { from: "err", text: `Couldn't read that. Try: “${inc.kind === "live" ? "60 min, USDC 5" : "30 min, USDC 14"}”.` }],
        },
      });
      return;
    }

    // Live mode: the user's duration and budget flow through untouched — the
    // real agent market quotes within the budget (no sim-rate shrinking).
    const plan =
      inc.kind === "live"
        ? { min: Math.max(15, Math.round(p.min / 15) * 15), cost: 0, adjusted: false }
        : adjustPlan(p.min, p.budget, inc.shortage);
    const req = { ...plan, text, budget: p.budget };
    const now = Date.now();
    const thread = [
      ...inc.thread,
      { from: "user" as const, text, auto: opts?.auto },
      {
        from: "sys" as const,
        text:
          inc.kind === "live"
            ? `Intent accepted — ${inc.shortage} Mbps · ${plan.min} min · budget ${rm0(p.budget)} — agents will quote within it.`
            : `Intent accepted — ${inc.shortage} Mbps · ${plan.min} min · ${rm(plan.cost)}` +
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
    // Live mode: real agents + Sui escrow take over from here — no timers.
    if (inc.kind === "live") {
      void beginLive(req, text);
      return;
    }
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
  closeLive();
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
            `Reply with duration & budget — e.g. “${inc.kind === "live" ? "60 min, USDC 5" : "30 min, USDC 14"}”.`,
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

  const timeline = inc.events.map((e) => ({ time: fmtClock(e.at), label: e.label, at: e.at }));
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
      label: "Autonomous recovery (simulated)",
      provider: "KilatLink FWA",
      cap: `+${inc.shortage} Mbps · ${reqMin} min`,
      amount: charged,
      refund: refund > 0 && kind !== "failed" ? refund : kind === "failed" ? cost : 0,
      refundNote: kind === "failed" ? "reservation refunded" : "",
      state,
      txDigest: undefined,
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

/* ---------------- live backend machine (real agents + Sui) ----------------
   Drives the recovery once the user's SMS reply exists: POST the intent to
   Person 2's gateway, follow its SSE events through the phase machine,
   commit the signed Selected Offer on Sui via Person 3's trust server, and
   finish on the SETTLED/REFUNDED ledger row. Everything narrates into the
   same SMS thread the simulation uses. */

interface LiveState {
  incidentId: string | null; // gateway-side id (INC-…-L1)
  scenarioKey: string | null;
  offer: SelectedOffer | null;
  committed: boolean;
  activationReported: boolean;
  adopting: boolean;
  chainOffline: boolean;
  arrivals: { providerId: string; receivedAtMs: number }[];
  rejections: { providerId: string; reason: string; detail?: string }[];
  votes: ConsensusVote[] | null;
  closers: (() => void)[];
  runSeq: number;
  finished: boolean;
}

let live: LiveState | null = null;

function closeLive() {
  live?.closers.forEach((close) => close());
  live = null;
}

function sysBubble(text: string, opts?: { event?: boolean }) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc) return;
  useAppStore.setState({
    incident: {
      ...inc,
      thread: [...inc.thread, { from: "sys", text }],
      // agent-visible actions ALSO join inc.events → the incident page's
      // AgentSteps log (prototype's "Agent activity behind this stage").
      events:
        opts?.event === false
          ? inc.events
          : [...inc.events, { label: text, at: Date.now() }],
    },
  });
}

function patchReq(patch: Partial<RecoveryRequest>) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc?.req) return;
  useAppStore.setState({
    incident: { ...inc, req: { ...inc.req, ...patch } },
  });
}

function finishLive(kind: "ok" | "failed", row?: ChainRow, stateLabel?: string) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || !live || live.finished) return;
  live.finished = true;
  const snapshot = {
    arrivals: [...live.arrivals],
    rejections: [...live.rejections],
    offer: live.offer,
    committed: live.committed,
    chainOffline: live.chainOffline,
    votes: live.votes ? [...live.votes] : null,
  };
  closeLive();
  clearMachine();

  const time = +((Date.now() - (inc.sentAt || inc.startedAt)) / 1000).toFixed(1);
  const offer = snapshot.offer;
  const escrow = inc.req?.escrow ?? inc.req?.cost ?? 0;
  const providerName = inc.req?.provider ?? "live provider";
  const reqMin = inc.req?.min ?? 30;
  const delivered = kind === "ok" ? (offer?.selectedProvider.capacityMbps ?? inc.shortage) : 0;

  const seenProviders = new Set<string>();
  const comparison: { name: string; state: string; sel: boolean; id: string }[] = [];

  if (offer) {
    seenProviders.add(offer.selectedProvider.providerId);
    comparison.push({
      name: `${providerName} (winner)`,
      state: `selected · ${offer.selectedProvider.capacityMbps} Mbps · USDC ${escrow.toFixed(2)} escrowed`,
      sel: true,
      id: offer.selectedProvider.providerId,
    });
  }

  const rejectionByProvider = new Map(snapshot.rejections.map((r) => [r.providerId, r]));

  for (const a of snapshot.arrivals) {
    if (seenProviders.has(a.providerId)) continue;
    seenProviders.add(a.providerId);
    const rej = rejectionByProvider.get(a.providerId);
    if (rej) {
      comparison.push({
        name: `${liveBrand(rej.providerId)} (${rej.providerId})`,
        state: `✗ ${reasonLabel(rej.reason)}${rej.detail ? ` — ${rej.detail}` : ""}`,
        sel: false,
        id: rej.providerId,
      });
    } else {
      comparison.push({
        name: `${liveBrand(a.providerId)} (${a.providerId})`,
        state: `quoted in ${((a.receivedAtMs ?? 0) / 1000).toFixed(1)}s — ranked below the winner`,
        sel: false,
        id: a.providerId,
      });
    }
  }

  for (const r of snapshot.rejections) {
    if (seenProviders.has(r.providerId)) continue;
    seenProviders.add(r.providerId);
    comparison.push({
      name: `${liveBrand(r.providerId)} (${r.providerId})`,
      state: `✗ ${reasonLabel(r.reason)}${r.detail ? ` — ${r.detail}` : ""}`,
      sel: false,
      id: r.providerId,
    });
  }

  const charged = kind === "ok" ? escrow : 0;
  const refund = kind === "failed" ? (snapshot.committed ? escrow : 0) : 0;
  const state =
    stateLabel ??
    (kind === "ok" ? "Settled on-chain" : snapshot.committed ? "Refunded on-chain" : "Chain offline");

  const record: RecoveryRecord = {
    id: inc.id,
    time,
    timeline: inc.events.map((e) => ({ time: fmtClock(e.at), label: e.label, at: e.at })),
    outcome: kind,
    provider: providerName,
    cap: delivered,
    min: reqMin,
    smsText: inc.req?.text ?? "",
    budget: inc.req?.budget ?? 0,
    cost: escrow,
    charged,
    refund,
    fee: inc.req?.platformFee ?? 0,
    state,
    tx: row?.txDigest ?? inc.req?.nonce ?? "live-run",
    restored: kind === "ok",
    delivered,
    nonce: inc.req?.nonce ?? undefined,
    commitTx: row?.txDigest ?? undefined,
    comparison,
    consensus: snapshot.votes ?? undefined,
    providerAddr: "pinned-to-provider-key",
    platformAddr: "platform-treasury",
  };

  useAppStore.setState({
    running: false,
    locked: 0,
    protectionState: kind === "ok" ? "protected" : "attention",
    session:
      kind === "ok"
        ? makeSession(inc.id, reqMin, escrow, delivered, inc.shortage)
        : null,
    balance: Math.max(0, +(st.balance - charged + refund).toFixed(2)),
    month: {
      usage: +(st.month.usage + charged).toFixed(2),
      fees: +(st.month.fees + (kind === "ok" ? inc.req?.platformFee ?? 0 : 0)).toFixed(2),
    },
    records: { ...st.records, [inc.id]: record },
    // LIVE runs join the payments ledger too — the Transaction history and
    // the Profile "This month" figure are driven by this array.
    payments: [
      ...(charged > 0 || refund > 0
        ? [
            {
              id: inc.id,
              ts: Date.now(),
              label: "On-chain recovery",
              provider: providerName,
              cap: `+${delivered} Mbps · ${reqMin} min`,
              amount: charged,
              refund: kind === "failed" ? charged : refund,
              refundNote: kind === "failed" ? "escrow refunded" : "",
              state,
              txDigest: row?.txDigest ?? record.commitTx,
            },
          ]
        : []),
      ...st.payments,
    ],
    activity: [
      {
        id: inc.id + "-live",
        ts: Date.now(),
        type: kind === "ok" ? "ok" : "failed",
        title: kind === "ok" ? "Live recovery completed" : "Live recovery failed",
        sub: kind === "ok" ? `${providerName} · on-chain settlement` : state,
        note: `+${delivered} Mbps · ${reqMin} min${row?.txDigest ? ` · tx ${row.txDigest.slice(0, 10)}…` : ""}`,
        time: time + " sec",
        cost: charged,
        recordId: inc.id,
      },
      ...st.activity,
    ],
    incident: {
      ...inc,
      status: kind === "ok" ? "restored" : "failed",
      result: { time, charged, refund, state },
    },
  });

  // Late-fill: the Gonka audit trail can lose the race against settlement
  // (60s model budget vs a fast market). If this record carries no consensus,
  // pull it from the gateway's durable recovery row and patch in place.
  if (!record.consensus && record.commitTx) {
    void (async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/v1/recoveries`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const body = (await res.json()) as {
          recoveries?: { incidentId?: string; consensus?: ConsensusVote[] | null }[];
        };
        const row = (body.recoveries ?? []).find((r) => r.incidentId === record.id);
        if (row?.consensus?.length) {
          const cur = useAppStore.getState().records[record.id];
          if (cur && !cur.consensus) {
            useAppStore.setState({
              records: { ...useAppStore.getState().records, [record.id]: { ...cur, consensus: row.consensus } },
            });
          }
        }
      } catch {
        // audit trail is best-effort
      }
    })();
  }
}

function finishNoRecovery() {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || !live || live.finished) return;
  live.finished = true;
  closeLive();
  clearMachine();

  useAppStore.setState({
    running: false,
    locked: 0,
    protectionState: "protected",
    capacity: { ...st.capacity, current: st.capacity.primary, primaryDown: false, extra: 0 },
    activity: [
      {
        id: inc.id + "-noop",
        ts: Date.now(),
        type: "check",
        title: "Live network check",
        sub: "No recovery needed",
        note: "Agents confirmed healthy capacity — no escrow, no purchase",
      },
      ...st.activity,
    ],
    incident: {
      ...inc,
      status: "noop",
      result: { time: +((Date.now() - (inc.sentAt || inc.startedAt)) / 1000).toFixed(1), charged: 0, refund: 0, state: "No recovery needed" },
    },
  });
}

async function adoptSelectedOffer(incidentId: string) {
  if (!live || live.adopting || live.offer) return;
  live.adopting = true;

  // The gateway answers 409 until the market decides (Gonka ranking runs
  // while providers quote) — poll until the Selected Offer exists or the
  // run ends, instead of giving up after ~3s and hanging the flow.
  let offer: SelectedOffer | null = null;
  for (let i = 0; i < 150 && live && !live.finished && !live.offer; i++) {
    try {
      offer = await fetchResult(incidentId);
    } catch {
      offer = null;
    }
    if (offer) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  live.adopting = false;

  if (!offer || !live || live.finished || live.offer) return;
  live.offer = offer;

  // Durable consensus votes: the SELECTED SSE event is one-shot — if it was
  // missed (refresh/HMR), recover the audit trail from the recoveries row.
  void (async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/recoveries`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const body = (await res.json()) as {
        recoveries?: { incidentId?: string; consensus?: ConsensusVote[] | null }[];
      };
      const row = (body.recoveries ?? []).find((r) => r.incidentId === incidentId);
      if (row?.consensus?.length && live && !live.votes) live.votes = row.consensus;
    } catch {
      // audit trail is best-effort — never block the flow
    }
  })();

  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc) return;
  const a = offer.agreement;
  patchReq({
    provider: offer.selectedProvider.brand,
    planPrice: a.planPrice,
    platformFee: a.platformFee,
    escrow: a.amount,
    nonce: a.nonce,
  });
  useAppStore.setState({
    locked: a.amount,
    incident: {
      ...useAppStore.getState().incident!,
      available: offer.selectedProvider.capacityMbps,
      status: "escrow_locked",
      events: [
        ...useAppStore.getState().incident!.events,
        { label: `Selected ${offer.selectedProvider.brand} · USDC ${a.amount.toFixed(2)} escrow`, at: Date.now() },
      ],
    },
  });

  try {
    // zkLogin buyer-direct path: the USER signs the commit_as_buyer PTB in
    // their browser (no server key touches the payment). Wallet mode: the
    // extension (Slush etc.) signs with its own key + gas. Custodial
    // fallback: server cap path (localnet demo / prover outage).
    const zk = st.zkLogin;
    // agentSigning (default): the RescueAgent pays from the pre-funded escrow
    // pool with its server key — no user prompt. Wallet/zk paths only run
    // when the user explicitly opts into signing personally.
    if (st.agentSigning) {
      sysBubble("🤖 Agent-to-agent payment — RescueAgent commits from the escrow pool (no user signature needed)", { event: false });
      const res = await commitSelected(offer);
      if (!live || live.finished) return;
      live.committed = true;
      sysBubble(`✓ On-chain commitment ${res.txDigest ? `tx ${res.txDigest.slice(0, 10)}… ` : ""}recorded (agent-signed)`);
      live.closers.push(openChainStream(onChainRow));
    } else if (zk?.proof && hasUsableProof(zk.proof) && zk.signingMode === "zk") {
      sysBubble("🔐 Signing the escrow commitment with your zkLogin identity…", { event: false });
      const zkRes = await zkCommitSelected(offer, zk);
      if (!live || live.finished) return;
      live.committed = true;
      sysBubble(`✓ On-chain commitment ${zkRes.txDigest ? `tx ${zkRes.txDigest.slice(0, 10)}… ` : ""}recorded`);
      live.closers.push(openChainStream(onChainRow));
    } else if (zk?.signingMode === "wallet") {
      sysBubble("🔐 Signing the escrow commitment with your connected wallet…", { event: false });
      const walletRes = await walletCommitSelected(offer, zk.address);
      if (!live || live.finished) return;
      live.committed = true;
      sysBubble(`✓ On-chain commitment ${walletRes.digest ? `tx ${walletRes.digest.slice(0, 10)}… ` : ""}recorded (wallet)`);
      live.closers.push(openChainStream(onChainRow));
    } else {
      sysBubble("ℹ️ Demo signing mode (no zk proof) — server-cap commit path", { event: false });
      const res = await commitSelected(offer);
      if (!live || live.finished) return;
      live.committed = true;
      live.closers.push(openChainStream(onChainRow));
      void res;
    }
    // AVAILABLE may already have arrived while the commit tx was in flight —
    // settle now if so (the gateway-event path no-ops via activationReported).
    reportActivationWhenCommitted();
  } catch (error) {
    if (!live || live.finished) return;
    live.chainOffline = true;
    sysBubble(`⚠️ Sui trust service unreachable — proceeding without escrow (${String((error as Error).message).slice(0, 60)})`);
    // Delivery may already be reported — don't hang waiting for a commit
    // that will never land.
    if (useAppStore.getState().incident?.status === "verifying") {
      setTimeout(() => finishLive("ok", undefined, "Settled (chain offline)"), 1200);
    }
  }
}

function onGatewayEvent(ev: GatewayEvent) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || inc.result || !live || live.finished) return;
  if (ev.incidentId && ev.incidentId !== live.incidentId) return;

  const advance = (status: string, label?: string) => {
    const cur = useAppStore.getState().incident;
    if (!cur || cur.result) return;
    useAppStore.setState({
      incident: {
        ...cur,
        status,
        events: [...cur.events, { label: label ?? EVENT_LABELS[status] ?? status, at: Date.now() }],
      },
    });
  };

  switch (ev.type) {
    case "status": {
      switch (ev.status) {
        case "QUERYING":
          advance("request_detected", "Intent broadcast to the live provider market");
          break;
        case "SELECTED":
          advance("provider_selected", `Gonka + market selected ${liveBrand(ev.providerId ?? "")}`);
          if (live) live.votes = ev.votes ?? null;
          if (live?.incidentId) void adoptSelectedOffer(live.incidentId);
          break;
        case "ACTIVATING":
          advance("activating", `Activating ${liveBrand(ev.providerId ?? "")} (attempt ${ev.attempt ?? 1})`);
          break;
        case "AVAILABLE": {
          advance("verifying", "Capacity delivered — SLA verification running");
          const cur = useAppStore.getState().incident;
          if (cur) {
            useAppStore.setState({
              capacity: {
                ...useAppStore.getState().capacity,
                current: live?.offer?.selectedProvider.capacityMbps ?? cur.shortage,
                extra: live?.offer?.selectedProvider.capacityMbps ?? cur.shortage,
              },
            });
          }
          // Report once; if the commit is still in flight (on-chain tx is
          // slower than the provider's simulated activation), adoptSelected
          // reports the moment the COMMITTED lands — no dead wait either way.
          if (live && !live.offer && live.incidentId) {
            void adoptSelectedOffer(live.incidentId); // selection lagged past the SELECTED event — adopt now
          }
          reportActivationWhenCommitted();
          // Insurance: never leave the spinner spinning forever.
          setTimeout(() => {
            const st = useAppStore.getState();
            if (live && !live.finished && st.incident && !st.incident.result && st.incident.status === "verifying") {
              sysBubble("⏳ Settlement is taking unusually long — the escrow stays committed on-chain and stays reclaimable if the provider stalls.");
            }
          }, 45_000);
          break;
        }
        case "NO_EXTERNAL_RECOVERY_NEEDED":
          finishNoRecovery();
          break;
        case "FAILED_ALL_ACTIVATIONS":
          if (live?.committed && live.incidentId) {
            void reportActivation(live.incidentId, "FAILED").catch(() => {});
            sysBubble("⚠️ Every activation failed — refund requested from the escrow");
          } else {
            finishLive("failed", undefined, "All activations failed");
          }
          break;
        case "FAILED_NO_VIABLE_PROVIDER":
          finishLive("failed", undefined, "No viable provider");
          break;
        case "FAILED":
          finishLive("failed", undefined, "Recovery failed");
          break;
      }
      break;
    }
    case "arrival": {
      if (live && ev.providerId && typeof ev.receivedAtMs === "number") {
        if (!live.arrivals.some((a) => a.providerId === ev.providerId)) {
          live.arrivals.push({ providerId: ev.providerId, receivedAtMs: ev.receivedAtMs });
        }
        sysBubble(
          `${liveBrand(ev.providerId)} quoted in ${(ev.receivedAtMs / 1000).toFixed(1)}s` +
            (typeof ev.pitch === "string" && ev.pitch ? ` — “${ev.pitch}”` : "")
        );  // event: true (default) → joins AgentSteps log
      }
      break;
    }
    case "rejection": {
      if (live && ev.providerId && typeof ev.reason === "string") {
        if (!live.rejections.some((r) => r.providerId === ev.providerId)) {
          live.rejections.push({ providerId: ev.providerId, reason: ev.reason, detail: ev.detail });
        }
      }
      break;
    }
    case "settlement": {
      // Trust-server callback rows also arrive via the gateway stream.
      onChainRow(ev as unknown as ChainRow);
      break;
    }
  }
}

/** Fire the AVAILABLE activation exactly once — callable from both the
    gateway event and the post-commit path, whoever gets there first. */
function reportActivationWhenCommitted() {
  if (!live || live.activationReported || live.finished) return;
  if (!live.committed || !live.incidentId) return; // not yet — retried by the commit path
  live.activationReported = true;
  void reportActivation(live.incidentId, "AVAILABLE").catch(() => {});
}

function onChainRow(row: ChainRow) {  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || !live || live.finished) return;
  if (row.incidentId && live.incidentId && row.incidentId !== live.incidentId) return;

  sysBubble(chainRowLabel(row));  // ledger row → AgentSteps log

  if (row.type === "SETTLED") {
    finishLive("ok", row);
  } else if (row.type === "REFUNDED" || row.type === "RECLAIMED") {
    finishLive("failed", row);
  }
}

async function beginLive(req: RecoveryRequest, smsText: string) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc) return;

  const scenarioKey = inc.scenarioKey ?? "s2";
  const baseIntent = getScenario(scenarioKey);
  const runSeq = ((live?.runSeq ?? 0) + 1) % 1000;
  const gatewayIncidentId = `${(baseIntent.incidentId as string) ?? "INC-S2"}-L${runSeq}-${Date.now() % 10000}`;

  live = {
    incidentId: null,
    scenarioKey,
    offer: null,
    committed: false,
    activationReported: false,
    adopting: false,
    chainOffline: false,
    arrivals: [],
    rejections: [],
    votes: null,
    closers: [],
    runSeq,
    finished: false,
  };

  const intent: Record<string, unknown> = {
    ...baseIntent,
    incidentId: gatewayIncidentId,
    constraints: {
      ...((baseIntent.constraints as Record<string, unknown>) ?? {}),
      durationMinutes: req.min,
      maxBudget: req.budget,
    },
  };

  sysBubble(`Live mode — broadcasting your intent (${req.min} min · ${"USDC " + req.budget.toFixed(0)}) to the agent market…`);

  try {
    const ack = await submitIntent(intent);
    if (!live) return;
    live.incidentId = ack.incidentId ?? gatewayIncidentId;
    live.closers.push(openIncidentStream(live.incidentId, onGatewayEvent));
    sysBubble(`Gateway accepted the intent (${live.incidentId}) — provider agents are quoting now.`);
  } catch (error) {
    sysBubble(
      `⚠️ Agent market unreachable (${String((error as Error).message).slice(0, 60)}). Start it with: node scripts/start-all.mjs`
    );
    finishLive("failed", undefined, "Agent market unreachable");
  }
  void smsText;
}
