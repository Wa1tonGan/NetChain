import { rm, rm0 } from "../services/pricing";
import { COMPARISON } from "../services/flows";

/* The dedicated "why this provider" decision evidence card.
   Shown in the recovery overlay once a provider is selected and on
   the incident receipt — one consistent place for the reasoning. */

export default function DecisionCard({
  cap,
  cost,
  budget,
}: {
  cap: number;
  cost: number;
  budget: number;
}) {
  const priceFor = (name: string): string | null =>
    name === "Provider B" ? rm(cost) : name === "Provider C" ? rm(+(cost * 1.45).toFixed(2)) : null;

  const reasons = [
    "Available right now",
    `Meets the full ${cap} Mbps requirement`,
    "Lowest price of the viable offers",
    `Within your ${rm0(budget)} budget`,
    "Latency within policy",
  ];

  return (
    <div className="purchase">
      <div className="ph">Why Provider B — decision evidence</div>
      <div style={{ marginTop: 8 }}>
        {COMPARISON.map((c) => {
          const price = priceFor(c.name);
          return (
            <div className="pr" key={c.name}>
              <span className="k">
                {c.name} <span style={{ color: "var(--faint)" }}>· {c.state}</span>
              </span>
              <span className="v" style={{ fontWeight: c.sel ? 800 : 500, color: c.sel ? "var(--ok)" : undefined }}>
                {price || "—"}
                {c.sel ? " · ✓" : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="why">
        {reasons.map((r) => (
          <div key={r}>✓ {r}</div>
        ))}
      </div>
    </div>
  );
}
