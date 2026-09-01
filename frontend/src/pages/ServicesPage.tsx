import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import type { Priority, ServiceItem } from "../services/types";

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
