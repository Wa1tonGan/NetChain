import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import type { Priority, ServiceItem } from "../services/types";
import {
  fetchMarket,
  setFailureMode,
  type FailureMode,
  type ProviderMarketEntry,
} from "../services/market";

const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4", "P5"];

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  P1: { label: "Critical", color: "#b42318", bg: "#fdeceb" },
  P2: { label: "High", color: "#b45a08", bg: "#fcf3e3" },
  P3: { label: "Standard", color: "#1e4fd6", bg: "#eaf1fe" },
  P4: { label: "Low", color: "#475467", bg: "#f2f4f7" },
  P5: { label: "Best Effort", color: "#667085", bg: "#f8f9fb" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className="chip"
      style={{
        color: meta.color,
        background: meta.bg,
        fontSize: 11.5,
        padding: "3px 8px",
      }}
    >
      <span className="dot" style={{ background: meta.color }} />
      {priority} · {meta.label}
    </span>
  );
}

function ServiceModal({
  service,
  onClose,
  onSave,
  onDelete,
}: {
  service: ServiceItem | null;
  onClose: () => void;
  onSave: (svc: Omit<ServiceItem, "id">, editId?: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [name, setName] = useState(service?.name ?? "");
  const [prio, setPrio] = useState<Priority>(service?.prio ?? "P3");
  const [minSpeed, setMinSpeed] = useState(service?.minSpeed ?? 50);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), prio, minSpeed }, service?.id);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{service ? "Edit Service Policy" : "Add Enterprise Service"}</h3>
          <button className="btn link" onClick={onClose} style={{ fontSize: 18, padding: 0 }}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              Service Name
            </label>
            <input
              className="input"
              value={name}
              placeholder="e.g. CCTV Security or Gate POS"
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Priority Level
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn sm ${prio === p ? "primary" : "subtle"}`}
                  style={{ padding: "8px 4px", fontSize: 12 }}
                  onClick={() => setPrio(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
              {prio === "P1" && "P1: Protected first (payments, life-safety, security)"}
              {prio === "P2" && "P2: High priority business traffic (live broadcast)"}
              {prio === "P3" && "P3: Standard operational traffic"}
              {prio === "P4" && "P4: Non-critical deferrable traffic"}
              {prio === "P5" && "P5: Throttled first during congestion (Guest Wi-Fi)"}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              Required Bandwidth (Mbps)
            </label>
            <input
              type="number"
              className="input"
              value={minSpeed}
              onChange={(e) => setMinSpeed(parseInt(e.target.value, 10) || 10)}
              min={1}
              required
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn primary">
              Save Policy
            </button>
            {service && onDelete && (
              <button
                type="button"
                className="btn subtle"
                style={{ color: "var(--bad)" }}
                onClick={() => {
                  onDelete(service.id);
                  onClose();
                }}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const MODE_LABEL: Record<FailureMode, string> = {
  healthy: "Healthy",
  down: "Down",
  unresponsive: "Unresponsive",
  slow: "Slow",
  fail_activation: "Activation fails",
  laggy: "Laggy",
};

function MarketPanel() {
  const [market, setMarket] = useState<ProviderMarketEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await fetchMarket();
      if (alive) setMarket(next);
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const kill = async (entry: ProviderMarketEntry, mode: FailureMode) => {
    setBusy(entry.providerId);
    await setFailureMode(entry.endpoint, mode);
    const next = await fetchMarket();
    setMarket(next);
    setBusy(null);
  };

  if (!market) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="pad" style={{ color: "var(--muted)", fontSize: 13 }}>
          Probing the live provider market… (start it with <code className="mono">node scripts/start-all.mjs</code>)
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Live Provider Market</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Real A2A agents on 8101–8103 · identities re-dressed per request · payout address pinned to each agent's signing key
            </div>
          </div>
          <span className="chip blue" style={{ fontSize: 11 }}>
            {market.filter((m) => m.reachable).length}/{market.length} online
          </span>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {market.map((entry) => (
            <div
              key={entry.endpoint}
              style={{
                border: "1px solid var(--line-soft)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 180, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                    {entry.brand ?? "— offline —"}
                  </span>
                  {entry.reachable ? (
                    entry.healthy ? (
                      <span className="chip green" style={{ fontSize: 10.5 }}>
                        {MODE_LABEL[entry.failureMode ?? "healthy"]}
                      </span>
                    ) : (
                      <span className="chip red" style={{ fontSize: 10.5 }}>
                        {MODE_LABEL[entry.failureMode ?? "down"]}
                      </span>
                    )
                  ) : (
                    <span className="chip amber" style={{ fontSize: 10.5 }}>unreachable</span>
                  )}
                  {entry.reachable && (
                    <span className="mono" style={{ color: "var(--faint)", fontSize: 10.5 }}>
                      {entry.providerId} · :{entry.endpoint.slice(-4)}
                    </span>
                  )}
                </div>
                {entry.reachable && entry.policy && (
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {entry.policy.maxCapacityMbps} Mbps · base {entry.policy.baseFee}{" "}
                    {entry.policy.currency} ·{" "}
                    {entry.policy.pricePer100MbpsPerHour}/{entry.policy.currency} per 100M·h
                    {entry.capabilities ? ` · ${entry.capabilities.join(", ")}` : ""}
                  </div>
                )}
              </div>

              {entry.reachable && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["healthy", "down", "unresponsive", "slow"] as FailureMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={`btn sm ${entry.failureMode === mode ? "primary" : "subtle"}`}
                      disabled={busy === entry.providerId || entry.failureMode === mode}
                      onClick={() => kill(entry, mode)}
                      title={`POST ${entry.endpoint}/admin/mode {"mode":"${mode}"}`}
                    >
                      {MODE_LABEL[mode]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ServicesPage() {
  const services = useAppStore((s) => s.services);
  const saveService = useAppStore((s) => s.saveService);
  const removeService = useAppStore((s) => s.removeService);
  const startRecovery = useAppStore((s) => s.startRecovery);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [isThrottledDemo, setIsThrottledDemo] = useState(false);

  const openAddModal = () => {
    setEditingService(null);
    setModalOpen(true);
  };

  const openEditModal = (svc: ServiceItem) => {
    setEditingService(svc);
    setModalOpen(true);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Enterprise QoS Priority</h1>
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 3 }}>
            Configure service protection order. Lower priority traffic (P5) is throttled first during shortfalls.
          </p>
        </div>
        <button className="btn primary sm" onClick={openAddModal}>
          + Add Service
        </button>
      </div>

      {/* Live provider market (real A2A agents) */}
      <MarketPanel />

      {/* Traffic Throttling Simulation */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Dynamic Traffic Shedding Emulation</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Simulates primary line dropping from 1,000 Mbps to 500 Mbps.
              </div>
            </div>
            <button
              className={`btn sm ${isThrottledDemo ? "primary" : "subtle"}`}
              onClick={() => setIsThrottledDemo(!isThrottledDemo)}
            >
              {isThrottledDemo ? "Reset Full Link (1000M)" : "Simulate Link Degradation"}
            </button>
          </div>

          {isThrottledDemo && (
            <div className="money-state" style={{ marginTop: 12 }}>
              ⚠️ Deficit detected: P5 Guest Wi-Fi throttled to 0 Mbps to preserve P1 POS / P1 CCTV.
              <button
                className="btn link"
                style={{ marginLeft: "auto", fontSize: 12 }}
                onClick={() => startRecovery("auto", 250)}
              >
                Acquire 250M via KilatLink FWA →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Configured Services List */}
      <div className="card-title">Configured Business Services ({services.length})</div>
      <div className="card">
        {services.map((svc) => {
          const throttled = isThrottledDemo && svc.prio === "P5";
          return (
            <div key={svc.id} className="row">
              <div className="grow">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="t">{svc.name}</span>
                  <PriorityBadge priority={svc.prio} />
                </div>
                <div className="s">{svc.minSpeed} Mbps minimum requirement</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {throttled ? (
                  <span className="chip red">Throttled (0 Mbps)</span>
                ) : (
                  <span className="chip green">100% Allocated</span>
                )}
              </div>
              <button className="btn sm subtle" onClick={() => openEditModal(svc)}>
                Edit
              </button>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <ServiceModal
          service={editingService}
          onClose={() => setModalOpen(false)}
          onSave={saveService}
          onDelete={removeService}
        />
      )}
    </div>
  );
}
