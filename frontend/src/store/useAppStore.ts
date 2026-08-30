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
import {
  brand,
  chainRowLabel,
  commitSelected,
  fetchResult,
  getScenario,
  openChainStream,
  openIncidentStream,
  reasonLabel,
  reportActivation,
  scenarioShortage,
  submitIntent,
} from "../services/live";
import type {
  ChainRow,
  GatewayEvent,
  SelectedOffer,
} from "../services/live";
import type {
  ActivityItem,
  Capacity,
  Incident,
  Payment,
  ProtectionState,
  RecoveryKind,
  RecoveryRecord,
  RecoveryRequest,
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
  startLiveRecovery: (scenarioKey: string) => void;
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

  /** Live mode: run a REAL scenario through the agent market + Sui escrow.
      Phases up to the SMS pause are local; after the user's reply the
      gateway/trust SSE events drive everything (see beginLive below). */
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
      scenarioKey,
      pauseAt: "sms",
      autoSend: null, // a real reply from the user triggers the real pipeline
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
    set({ incident: inc, recoverySeq: seq });
    scheduleFrom(1);
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
    if (inc.kind === "live") {
      // Real pipeline: the SMS reply (duration + budget) becomes the intent's
      // constraints and the gateway/trust SSE events take over from here.
      void beginLive(req);
      return;
    }
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
  closeLive();
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

/* ---------------- live machine (real gateway + Sui trust) ----------------
   Driven entirely by the two SSE streams once the SMS reply has been
   submitted as a RecoveryIntent:
     gateway events  QUERYING → SELECTED → ACTIVATING → AVAILABLE / FAILED_*
     chain events    VERIFIED → COMMITTED → SETTLED / REFUNDED
   The Selected Offer is committed from here (the buyer's own device) the
   moment the market decides, and AVAILABLE triggers the buyer release. */

interface LiveState {
  incidentId: string; // gateway-side id (INC-S2 …), ≠ the UI's NC-#### id
  scenarioKey: string;
  offer: SelectedOffer | null;
  commit: { status: string; duplicate?: boolean; txDigest?: string } | null;
  chainOffline: boolean;
  arrivals: { providerId: string; receivedAtMs: number }[];
  rejections: { providerId: string; reason: string; detail?: string }[];
  closers: (() => void)[];
}

let live: LiveState | null = null;

function closeLive() {
  live?.closers.forEach((close) => close());
  live = null;
}

function sysBubble(text: string) {
  const inc = useAppStore.getState().incident;
  if (!inc || inc.result) return;
  useAppStore.setState({ incident: { ...inc, thread: [...inc.thread, { from: "sys", text }] } });
}

function liveFinished(): boolean {
  return useAppStore.getState().incident?.result != null;
}

function beginLive(req: RecoveryRequest): Promise<void> {
  const inc = useAppStore.getState().incident;
  if (!inc?.scenarioKey) return Promise.resolve();

  const intent: Record<string, unknown> = {
    ...getScenario(inc.scenarioKey),
    constraints: {
      ...((getScenario(inc.scenarioKey).constraints as Record<string, unknown>) ?? {}),
      durationMinutes: req.min,
      maxBudget: req.budget,
    },
  };

  return submitIntent(intent)
    .then((res) => {
      live = {
        incidentId: res.incidentId,
        scenarioKey: inc.scenarioKey!,
        offer: null,
        commit: null,
        chainOffline: false,
        arrivals: [],
        rejections: [],
        closers: [],
      };
      sysBubble(
        `📡 Sent to the agent market as ${res.incidentId}${res.duplicate ? " (replaying a previous run)" : ""}`
      );
      live.closers.push(openIncidentStream(res.incidentId, onGatewayEvent));
      live.closers.push(openChainStream(onChainRow));
    })
    .catch((err) => {
      sysBubble(`⚠️ Agent market unreachable (${String(err?.message ?? err).slice(0, 80)}) — start it with: node scripts/start-all.mjs`);
      finishLive("failed", undefined, "Agent market unreachable");
    });
}

function onGatewayEvent(ev: GatewayEvent) {
  if (!live || (ev.incidentId && ev.incidentId !== live.incidentId) || liveFinished()) return;

  if (ev.type === "arrival") {
    live.arrivals.push({ providerId: ev.providerId ?? "", receivedAtMs: ev.receivedAtMs ?? 0 });
    sysBubble(
      `⏱ ${brand(ev.providerId ?? "")} answered in ${((ev.receivedAtMs ?? 0) / 1000).toFixed(1)} s` +
      (ev.pitch ? ` — “${ev.pitch}”` : "")
    );
    return;
  }

  if (ev.type === "rejection") {
    live.rejections.push({ providerId: ev.providerId ?? "", reason: ev.reason ?? "", detail: ev.detail });
    sysBubble(`✗ ${brand(ev.providerId ?? "")}: ${reasonLabel(ev.reason ?? "")}`);
    return;
  }

  if (ev.type === "settlement") {
    // Person 3's settlement callback (when P2_CALLBACK_URL is configured).
    if (ev.status === "SETTLED") finishLive("ok");
    if (ev.status === "REFUNDED" || ev.status === "RECLAIMED") finishLive("failed");
    return;
  }

  if (ev.type !== "status") return;

  switch (ev.status) {
    case "QUERYING":
      advance("request_detected");
      break;
    case "SELECTED":
      advance("provider_selected");
      void adoptSelectedOffer();
      break;
    case "ACTIVATING":
      advance("activating");
      break;
    case "AVAILABLE":
      markAvailable();
      break;
    case "SETTLED":
      finishLive("ok");
      break;
    case "NO_EXTERNAL_RECOVERY_NEEDED":
      finishNoRecovery();
      break;
    case "FAILED_NO_VIABLE_PROVIDER":
      sysBubble("❌ No provider could meet the request — every offer was rejected.");
      finishLive("failed", undefined, "No viable provider — every offer was rejected");
      break;
    case "FAILED_ALL_ACTIVATIONS":
      sysBubble("❌ Every provider failed to activate the backup path.");
      if (live.commit) {
        // escrow already locked — tell the trust layer to refund, the
        // REFUNDED chain row finishes the incident
        reportActivation(live.incidentId, "FAILED").catch(() => finishLive("failed"));
      } else {
        finishLive("failed");
      }
      break;
    case "FAILED":
      sysBubble(`❌ Recovery failed: ${String((ev as { detail?: string }).detail ?? "unknown error").slice(0, 80)}`);
      finishLive("failed");
      break;
    default:
      break;
  }
}

/** SELECTED → pull the signed Selected Offer, show the real deal, commit it
    on Sui (the buyer's own commitment — this is the P2 → P3 handoff). */
async function adoptSelectedOffer(): Promise<void> {
  if (!live) return;

  let offer: SelectedOffer | null = null;
  for (let i = 0; i < 8 && !offer; i++) {
    try {
      offer = await fetchResult(live.incidentId);
    } catch {
      offer = null;
    }
    if (!offer) await new Promise((r) => setTimeout(r, 400));
  }
  if (!offer || !live || liveFinished()) return;

  live.offer = offer;
  const a = offer.agreement;
  const inc = useAppStore.getState().incident;
  if (!inc?.req) return;
  useAppStore.setState({
    incident: {
      ...inc,
      req: {
        ...inc.req,
        provider: offer.selectedProvider.brand ?? brand(offer.selectedProvider.providerId),
        planPrice: a.planPrice,
        platformFee: a.platformFee,
        escrow: a.amount,
        nonce: a.nonce,
      },
    },
    locked: a.amount, // the REAL escrow total (plan + fee) replaces the local estimate
  });
  sysBubble(
    `🏆 ${offer.selectedProvider.brand ?? brand(offer.selectedProvider.providerId)} wins — ` +
      `${offer.selectedProvider.capacityMbps} Mbps · ${a.durationMinutes} min · ` +
      `RM ${a.planPrice} + RM ${a.platformFee} fee = RM ${a.amount} escrowed`
  );

  // the AVAILABLE event may already have passed using the shortfall as the
  // delivered figure — correct the live capacity to the real offer now
  const stNow = useAppStore.getState();
  if (stNow.incident && ["activating", "verifying"].includes(stNow.incident.status)) {
    useAppStore.setState({
      capacity: {
        ...stNow.capacity,
        current: offer.selectedProvider.capacityMbps,
        extra: offer.selectedProvider.capacityMbps,
      },
    });
  }

  try {
    const res = await commitSelected(offer);
    if (live) live.commit = res;
  } catch (err) {
    if (!live) return;
    live.chainOffline = true;
    sysBubble(`⚠️ Sui trust service unreachable — continuing without escrow (${String((err as Error)?.message ?? err).slice(0, 60)})`);
  }
}

/** AVAILABLE → the buyer releases the locked payment on-chain, then the
    SETTLED chain row finishes the recovery. */
function markAvailable() {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc) return;
  const delivered = live?.offer?.selectedProvider.capacityMbps ?? inc.shortage;

  advance("verifying");
  useAppStore.setState({
    capacity: { ...st.capacity, current: delivered, extra: delivered },
  });

  if (live?.commit) {
    reportActivation(live.incidentId, "AVAILABLE").catch(() => {
      // trust service went away mid-flight — finish honestly, money stays locked
      sysBubble("⚠️ Couldn't reach the trust service to settle — escrow stays locked.");
      finishLive("ok", undefined, "Escrow pending — trust service offline");
    });
  } else {
    // no chain in this demo run — settle the story locally
    setTimeout(() => {
      if (!liveFinished()) finishLive("ok", undefined, "Settled (chain offline)");
    }, 1200);
  }
}

function onChainRow(row: ChainRow) {
  if (!live || (row.incidentId && row.incidentId !== live.incidentId) || liveFinished()) return;

  sysBubble(chainRowLabel(row));

  if (row.type === "SETTLED") finishLive("ok", row);
  if (row.type === "REFUNDED" || row.type === "RECLAIMED") finishLive("failed", row);
}

function finishLive(kind: "ok" | "failed", row?: ChainRow, stateLabel?: string) {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || inc.result || inc.kind !== "live") return;
  const snapshot = live; // clearMachine() closes the streams and nulls `live`
  clearMachine(); // stops timers + closes both SSE streams

  const offer = snapshot?.offer ?? null;
  const a = offer?.agreement;
  const amount = a?.amount ?? inc.req?.cost ?? 0;
  const fee = a?.platformFee ?? 0;
  const min = a?.durationMinutes ?? inc.req?.min ?? 30;
  const delivered = offer?.selectedProvider.capacityMbps ?? inc.shortage;
  const provider = offer ? offer.selectedProvider.brand ?? brand(offer.selectedProvider.providerId) : "—";
  const committed = !!live?.commit;
  const tx = row?.txDigest ?? live?.commit?.txDigest ?? "—";

  const time = +((Date.now() - (inc.sentAt || inc.startedAt)) / 1000).toFixed(1);
  let charged = 0;
  let refund = 0;
  let state = "";
  let actTitle = "";
  let actSub = "";
  let actNote = "";
  let session = null as Session | null;
  let protectionState: ProtectionState = "protected";
  let capacityPatch: Partial<Capacity> | null = null;

  if (kind === "ok") {
    charged = amount;
    state = stateLabel ?? "Settled on Sui";
    actTitle = "Recovery completed";
    actSub = "Primary connection failed";
    actNote = `+${delivered} Mbps · ${min} min`;
    session = makeSession(inc.id, min, amount, delivered, delivered);
  } else {
    refund = committed ? amount : 0;
    state = stateLabel ?? (committed ? "Refunded on Sui" : "Nothing committed — no charge");
    actTitle = "Recovery failed";
    actSub = committed ? "Provider failed — escrow refunded" : "No viable provider";
    actNote = committed ? `${rm(refund)} refunded automatically` : "No charge";
    protectionState = "attention";
    capacityPatch = { current: 0 };
  }

  const timeline = inc.events.map((e) => ({ time: fmtClock(e.at), label: e.label }));

  // real decision evidence from the A2A race (winner first, then the rest)
  const comparison: { name: string; state: string; sel: boolean }[] = [];
  if (offer) {
    comparison.push({
      name: provider,
      state: `selected · ${delivered} Mbps · ${min} min · RM ${amount} escrowed`,
      sel: true,
    });
  }
  for (const ar of snapshot?.arrivals ?? []) {
    if (offer && ar.providerId === offer.selectedProvider.providerId) continue;
    if (comparison.some((c) => c.name === brand(ar.providerId))) continue;
    comparison.push({
      name: brand(ar.providerId),
      state: `quoted in ${(ar.receivedAtMs / 1000).toFixed(1)} s — ranked below the winner`,
      sel: false,
    });
  }
  for (const rj of snapshot?.rejections ?? []) {
    if (comparison.some((c) => c.name === brand(rj.providerId))) continue;
    comparison.push({
      name: brand(rj.providerId),
      state: `✗ ${reasonLabel(rj.reason)}${rj.detail ? ` — ${rj.detail.slice(0, 60)}` : ""}`,
      sel: false,
    });
  }

  const record: RecoveryRecord = {
    id: inc.id,
    time,
    timeline,
    outcome: kind,
    provider,
    cap: delivered,
    min,
    smsText: inc.req?.text ?? "",
    budget: inc.req?.budget ?? 0,
    cost: amount,
    charged,
    refund,
    fee,
    state,
    tx,
    restored: kind === "ok",
    delivered,
    nonce: a?.nonce,
    commitTx: snapshot?.commit?.txDigest,
    comparison,
  };

  const payments = [...st.payments];
  if (charged > 0 || refund > 0) {
    payments.unshift({
      id: inc.id,
      ts: Date.now(),
      label: "Temporary capacity",
      provider,
      cap: `+${delivered} Mbps · ${min} min`,
      amount: charged,
      refund,
      refundNote: kind === "failed" ? "escrow refunded" : "",
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
    incident: { ...inc, status: kind === "ok" ? "restored" : "failed", result: { time, charged, refund, state } },
    ...(capacityPatch ? { capacity: { ...st.capacity, ...capacityPatch } } : {}),
  });
}

/** The watcher said no purchase is needed (s0/s1/s6): a healthy-day ending. */
function finishNoRecovery() {
  const st = useAppStore.getState();
  const inc = st.incident;
  if (!inc || inc.result || inc.kind !== "live") return;
  clearMachine();

  const now = Date.now();
  const time = +((now - inc.startedAt) / 1000).toFixed(1);
  useAppStore.setState({
    running: false,
    locked: 0,
    protectionState: "protected",
    capacity: { ...st.capacity, current: st.capacity.primary, extra: 0, primaryDown: false },
    activity: [
      {
        id: inc.id, ts: now, type: "check",
        title: "Network check", sub: "No extra capacity needed",
        note: "Existing links cover the shortfall — nothing was purchased",
        time: time + " sec",
      },
      ...st.activity,
    ],
    incident: {
      ...inc,
      status: "noop",
      events: [...inc.events, { label: EVENT_LABELS.noop, at: now }],
      result: { time, charged: 0, refund: 0, state: "No recovery needed" },
    },
  });
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

// debug affordance: lets the browser console inspect the live state machine
(window as unknown as { __ncStore?: unknown }).__ncStore = useAppStore;
