import { useEffect, useRef, useState } from "react";
import { useAppStore, elapsedSecAt } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { reasonLabel } from "../services/live";
import type { ClaimAudit } from "../services/live";
import type { Incident, RunBid, RunLogEntry } from "../services/types";

export function StrengthBars({ filled, cls }: { filled: number; cls?: string }) {
  return (
    <span className={`strength ${cls ?? ""}`} role="img" aria-label={`${filled} of 4 signal bars`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= filled ? "on" : ""} />
      ))}
    </span>
  );
}

function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [active]);
}

interface ChatMsg {
  id: string;
  sender: string;
  role: "agent" | "user";
  tag: string;
  tagBg: string;
  tagColor: string;
  text: React.ReactNode;
  time: string;
  isWinner?: boolean;
  isEscrow?: boolean;
  isSpecialIndicator?: boolean;
}

/* One palette slot per bid, assigned in arrival order — pure UI styling. */
const BID_TAG_STYLES = [
  { tagBg: "rgba(2, 132, 199, 0.12)", tagColor: "#0284c7" },
  { tagBg: "rgba(217, 119, 6, 0.12)", tagColor: "#d97706" },
  { tagBg: "rgba(99, 102, 241, 0.12)", tagColor: "#6366f1" },
];

const MODEL_CARD: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "8px 10px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const REQ_CHIP: React.CSSProperties = {
  fontSize: 9.5,
  fontFamily: "monospace",
  background: "#f1f5f9",
  color: "#64748b",
  padding: "1px 6px",
  borderRadius: 4,
  border: "1px solid #e2e8f0",
};

const shortId = (id?: string | null): string | null => {
  if (!id) return null;
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
};

function SuiscanLink({ digest, color }: { digest: string; color: string }) {
  return (
    <a
      href={`https://suiscan.xyz/testnet/tx/${digest}`}
      target="_blank"
      rel="noreferrer"
      style={{ color, fontSize: 11, textDecoration: "underline", fontFamily: "monospace" }}
    >
      Sui Tx: {shortId(digest)} ↗
    </a>
  );
}

export default function RecoveryOverlay({ incident }: { incident: Incident }) {
  const dismiss = useAppStore((s) => s.dismissOverlay);
  const runLog = useAppStore((s) => s.runLog);
  const audit: ClaimAudit | undefined = useAppStore((s) =>
    incident.gatewayIncidentId ? s.claimAudits[incident.gatewayIncidentId] : undefined
  );
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const completed = Boolean(incident.result);

  useTicker(!completed);
  const now = Date.now();
  const elapsed = elapsedSecAt(incident, now).toFixed(1);

  // Auto-scroll chat to bottom as the conversation progresses
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runLog.length, incident.status, completed, audit]);

  const tLabel = (at: number) => `T+${Math.max(0, (at - incident.startedAt) / 1000).toFixed(1)}s`;

  const messages: ChatMsg[] = [];
  let bidIndex = 0;

  for (const entry of runLog) {
    switch (entry.kind) {
      case "alert": {
        messages.push({
          id: entry.id,
          sender: "RescueAgent",
          role: "agent",
          tag: "AUTONOMOUS GUARDIAN",
          tagBg: "rgba(0, 113, 227, 0.12)",
          tagColor: "#0071e3",
          time: tLabel(entry.at),
          text: (
            <div>
              <b>
                {entry.degradedMbps != null
                  ? `Weak network detected${entry.subject ? ` in ${entry.subject}` : ""}.`
                  : `Primary link failure detected${entry.subject ? ` in ${entry.subject}` : ""}.`}
              </b>
              <br />
              {entry.degradedMbps != null && (
                <>
                  Downlink degraded to <b>{entry.degradedMbps} Mbps</b>. Uplink compromised.
                  <br />
                </>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Protection rule {entry.priority ?? "P1"} activated: Auto-broadcasting recovery intent
                for <b>{entry.requiredMbps} Mbps</b> backup link (budget ≤ <b>{rm(entry.budgetUsdc)}</b>).
              </span>
            </div>
          ),
        });
        break;
      }

      case "intent": {
        messages.push({
          id: entry.id,
          sender: "Subscriber Proxy",
          role: "user",
          tag: "AUTO INTENT DISPATCH",
          tagBg: "rgba(255, 255, 255, 0.2)",
          tagColor: "#ffffff",
          time: tLabel(entry.at),
          text: (
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{entry.text}</div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
                Dual-Sig pre-authorized · {entry.capacityMbps} Mbps shortfall replacement ·{" "}
                {entry.durationMinutes} min
                {entry.gatewayIncidentId && (
                  <span className="mono" style={{ opacity: 0.75 }}>
                    {" "}
                    · {entry.gatewayIncidentId}
                  </span>
                )}
              </div>
            </div>
          ),
        });
        break;
      }

      case "bid": {
        const style = BID_TAG_STYLES[bidIndex % BID_TAG_STYLES.length];
        bidIndex += 1;
        const slaPct =
          entry.reliabilityScore != null ? `${(entry.reliabilityScore * 100).toFixed(1)}%` : null;
        messages.push({
          id: entry.id,
          sender: `${entry.brand} Agent`,
          role: "agent",
          tag: `${(entry.category ?? "Provider").replace(/_/g, " ")} bid`.toUpperCase(),
          tagBg: style.tagBg,
          tagColor: style.tagColor,
          time: tLabel(entry.at),
          text: (
            <div>
              <b>
                {entry.brand} Bid Submitted:
                {entry.winner && <span style={{ color: "#059669" }}> ✓ SELECTED</span>}
              </b>
              <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
                {entry.capacityMbps != null && (
                  <>
                    • Bandwidth: <b>{entry.capacityMbps} Mbps</b>
                    <br />
                  </>
                )}
                {entry.latencyMs != null && (
                  <>
                    • Latency: <b>{entry.latencyMs} ms</b> RTT
                    <br />
                  </>
                )}
                {entry.priceUsdc != null && (
                  <>
                    • Offer Price: <b>{rm(entry.priceUsdc)}</b>
                    <br />
                  </>
                )}
                {slaPct && (
                  <>
                    • SLA: {slaPct} availability
                    <br />
                  </>
                )}
                {entry.pitch && (
                  <div style={{ marginTop: 3, color: "var(--muted)" }}>“{entry.pitch}”</div>
                )}
                {entry.rejectedReason && (
                  <div style={{ marginTop: 4, fontSize: 11.5, color: "#b42318", fontWeight: 600 }}>
                    ✗ Not selected — {reasonLabel(entry.rejectedReason)}
                    {entry.rejectedDetail ? ` — ${entry.rejectedDetail}` : ""}
                  </div>
                )}
              </div>
            </div>
          ),
        });
        break;
      }

      case "consensus": {
        const total = entry.votes.length;
        const firstChoices = entry.votes.map((v) => v.ranking[0]).filter(Boolean);
        const unanimous = firstChoices.length === total && firstChoices.every((pid) => pid === entry.winnerProviderId);
        const winnerBrand = entry.brands[entry.winnerProviderId] ?? entry.winnerProviderId;
        messages.push({
          id: entry.id,
          sender: "Gonka Consensus Engine",
          role: "agent",
          tag: "ROUND 1: PROVIDER SELECTION VOTE",
          tagBg: "rgba(2, 132, 199, 0.12)",
          tagColor: "#0284c7",
          time: tLabel(entry.at),
          isSpecialIndicator: true,
          text: (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                <span style={{ fontWeight: 800, color: "#0369a1", fontSize: 13 }}>
                  Multi-LLM Provider Evaluation &amp; Voting (Round 1)
                </span>
                <span style={{ fontSize: 10, background: "#ecfdf5", color: "#059669", padding: "2px 7px", borderRadius: 6, fontWeight: 800 }}>
                  {unanimous
                    ? `${total}/${total} UNANIMOUS: ${winnerBrand.toUpperCase()}`
                    : `${total} MODELS RANKED`}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                {total} independent LLM models evaluated the provider bids under P1 recovery criteria:
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
                {entry.votes.map((v, i) => {
                  const top = v.ranking[0];
                  const topBrand = top ? entry.brands[top] ?? top : "—";
                  return (
                    <div key={i} style={MODEL_CARD}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 12, color: "#1e293b" }}>{v.model}</span>
                          {v.requestId && <span style={REQ_CHIP}>gonka req: {v.requestId}</span>}
                        </div>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 800,
                            color: top === entry.winnerProviderId ? "#059669" : "#b45309",
                          }}
                        >
                          VOTE: {topBrand} {top === entry.winnerProviderId ? "✓" : "≠"}
                        </span>
                      </div>
              <div style={{ fontSize: 11.5, color: "#334155", lineHeight: 1.45 }}>
                <b>Ranking:</b> {v.ranking.map((pid) => entry.brands[pid] ?? pid).join(" › ")}
              </div>
              {v.reason && (
                <div style={{ fontSize: 11.5, color: "#334155", lineHeight: 1.45 }}>
                  <b>Reasoning:</b> {v.reason}
                </div>
              )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "#0369a1", display: "flex", alignItems: "center", gap: 6 }}>
                <span>Round 1 Consensus Reached:</span>
                <span style={{ color: "#059669" }}>
                  {unanimous
                    ? `${total}/${total} Unanimous Vote for ${winnerBrand} · Committing Dual-Sig Escrow`
                    : `Winner: ${winnerBrand} · Committing Dual-Sig Escrow`}
                </span>
              </div>
            </div>
          ),
        });
        break;
      }

      case "escrow": {
        messages.push({
          id: entry.id,
          sender: "Sui Trust Layer",
          role: "agent",
          tag: entry.agentSigned ? "DUAL-SIG ESCROW" : "ESCROW · BUYER-SIGNED",
          tagBg: "rgba(79, 70, 229, 0.12)",
          tagColor: "#4f46e5",
          time: tLabel(entry.at),
          isEscrow: true,
          text: (
            <div>
              <b>Sui Dual-Sig Escrow Locked:</b>
              <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
                Locked <b>{rm(entry.amountUsdc)}</b> into Escrow Contract (
                <span className="mono" style={{ fontSize: 11 }}>
                  {shortId(entry.escrowId) ?? "on-chain"}
                </span>
                ).
                <br />
                Funds secured on-chain. Activating {entry.providerBrand} backup slice...
                {entry.txDigest && (
                  <div style={{ marginTop: 4 }}>
                    <SuiscanLink digest={entry.txDigest} color="#4f46e5" />
                  </div>
                )}
              </div>
            </div>
          ),
        });
        break;
      }

      case "telemetry": {
        const walrusId = entry.walrusBlobId ?? incident.walrusBlobId ?? incident.result?.walrusBlobId;
        messages.push({
          id: entry.id,
          sender: "Telemetry Agent",
          role: "agent",
          tag: "DELIVERY VERIFICATION",
          tagBg: "rgba(13, 148, 136, 0.12)",
          tagColor: "#0d9488",
          time: tLabel(entry.at),
          text: (
            <div>
              <div style={{ fontWeight: 800, color: "#0d9488", fontSize: 13 }}>
                Delivered Bandwidth Verified &amp; Packaged:
              </div>
              <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
                Recovery-window telemetry measured against the contracted SLA:
                <div
                  style={{
                    marginTop: 6,
                    padding: "8px 10px",
                    background: "rgba(13, 148, 136, 0.06)",
                    borderRadius: 8,
                    border: "1px solid rgba(13, 148, 136, 0.2)",
                    fontSize: 11.5,
                    fontFamily: "monospace",
                    color: "#134e4a",
                    lineHeight: 1.55,
                  }}
                >
                  {entry.deliveredMbps != null && (
                    <div>
                      • Downlink Throughput: <b>{entry.deliveredMbps} Mbps</b>
                      {entry.promisedMbps != null && <> (contracted: {entry.promisedMbps} Mbps)</>}
                    </div>
                  )}
                  {entry.latencyMs != null && (
                    <div>
                      • Latency: <b>{entry.latencyMs} ms</b> RTT
                    </div>
                  )}
                  {entry.packetLossPercent != null && (
                    <div>
                      • Packet Loss: <b>{entry.packetLossPercent}%</b>
                    </div>
                  )}
                </div>
                {walrusId && (
                  <>
                    <div style={{ marginTop: 6, color: "var(--ink)" }}>
                      Evidence compiled into an immutable <b>SLA Verification Report</b> and stored to Walrus:
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <a
                        href={`https://walruscan.com/testnet/blob/${walrusId}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "#0d9488",
                          fontSize: 11,
                          textDecoration: "underline",
                          fontFamily: "monospace",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>Stored to Walrus Blob: {shortId(walrusId)}</span>
                        <span>↗</span>
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          ),
        });
        break;
      }
    }
  }

  /* Round-2 SLA audit — the Truth Agent row reliably lands AFTER settlement
     closes the run, so it renders reactively from claimAudits (real models,
     verdicts, gonka request ids and reasoning strings). */
  const auditModels = audit?.models ?? [];
  if (audit) {
    const okCount = auditModels.filter((m) => m.ok).length;
    const total = auditModels.length;
    const auditDone = audit.status === "COMPLETED" && total > 0;
    messages.push({
      id: "audit",
      sender: "Truth Agent · Consensus Engine",
      role: "agent",
      tag: "ROUND 2: WALRUS REPORT SLA AUDIT",
      tagBg: "rgba(99, 102, 241, 0.12)",
      tagColor: "#4f46e5",
      time: `T+${elapsed}s`,
      isSpecialIndicator: true,
      text: (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
            <span style={{ fontWeight: 800, color: "#4338ca", fontSize: 13 }}>
              Fetched Report · Multi-LLM Verification &amp; Voting (Round 2)
            </span>
            <span style={{ fontSize: 10, background: auditDone && okCount === total ? "#ecfdf5" : "#fff7ed", color: auditDone && okCount === total ? "#059669" : "#b45309", padding: "2px 7px", borderRadius: 6, fontWeight: 800 }}>
              {auditDone
                ? `${okCount}/${total} ${okCount === total ? "UNANIMOUS PASS" : "MODELS PASS"}`
                : `AUDIT ${String(audit.status).toUpperCase()}`}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
            Independent Truth Agent audit
            {audit.claimRunId ? (
              <>
                {" "}
                run <code style={{ fontSize: 10.5, color: "#4338ca", background: "rgba(99, 102, 241, 0.08)", padding: "1px 4px", borderRadius: 4 }}>{audit.claimRunId}</code>
              </>
            ) : null}
            . {total > 0 ? `${total} models audited the delivered telemetry against the SLA:` : "No model votes recorded."}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
            {auditModels.map((m, i) => (
              <div key={i} style={MODEL_CARD}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: "#1e293b" }}>{m.model ?? `model ${i + 1}`}</span>
                    {m.requestId && <span style={REQ_CHIP}>gonka req: {m.requestId}</span>}
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: m.ok ? "#059669" : "#b42318" }}>
                    VOTE: {(m.verdict ?? (m.ok ? "PASS" : "FAIL")).toUpperCase()} {m.ok ? "✓" : "✗"}
                  </span>
                </div>
                {m.reasoning && (
                  <div style={{ fontSize: 11.5, color: "#334155", lineHeight: 1.45 }}>
                    <b>Reasoning:</b> {m.reasoning}
                  </div>
                )}
                {m.error && (
                  <div style={{ fontSize: 11.5, color: "#b42318", lineHeight: 1.45 }}>
                    <b>Error:</b> {m.error}
                  </div>
                )}
                {m.score != null && (
                  <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 3 }}>
                    Score: <b>{m.score}</b>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "#4338ca", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Round 2 Consensus:</span>
            <span style={{ color: auditDone ? "#059669" : "#b45309" }}>
              {auditDone
                ? `${audit.score ?? "?"}/100 ${audit.verdict ?? ""} · ${audit.agree ?? "?"} models agree · Settlement executed`
                : `${String(audit.status).toLowerCase()}${audit.error ? ` — ${audit.error}` : ""} · settlement executed regardless, escrow reclaimable`}
            </span>
          </div>
        </div>
      ),
    });
  }

  /* Final bubble — restored / failed / noop, driven by the real result. */
  const winnerEntry = runLog.find((e): e is RunBid => e.kind === "bid" && Boolean(e.winner));
  const lastTelemetry = [...runLog].reverse().find((e): e is Extract<RunLogEntry, { kind: "telemetry" }> => e.kind === "telemetry");
  const restoredMbps = incident.available || lastTelemetry?.deliveredMbps || incident.shortage;
  const winnerBrand = winnerEntry?.brand ?? incident.req?.provider ?? "backup provider";
  const settleTx = incident.settleTxDigest || incident.result?.tx;
  const walrusId = incident.walrusBlobId || incident.result?.walrusBlobId;

  if (incident.status === "restored" && incident.result) {
    messages.push({
      id: "restored",
      sender: "RescueAgent",
      role: "agent",
      tag: "RESTORED & SETTLED",
      tagBg: "rgba(0, 113, 227, 0.15)",
      tagColor: "#0071e3",
      time: `${incident.result.time ?? elapsed}s`,
      isWinner: true,
      text: (
        <div>
          <div style={{ fontWeight: 800, color: "#0071e3", fontSize: 13.5 }}>
            Connection Successfully Restored &amp; Settled
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            High-speed backup slice active: <b>+{restoredMbps} Mbps</b> via <b>{winnerBrand}</b>.
            <br />
            SLA throughput verified. Escrow settled autonomously on Sui Trust Layer.
            {settleTx && (
              <div style={{ marginTop: 4 }}>
                <SuiscanLink digest={settleTx} color="#0071e3" />
              </div>
            )}
            {walrusId && (
              <div style={{ marginTop: 4 }}>
                <a
                  href={`https://walruscan.com/testnet/blob/${walrusId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#0d9488", fontSize: 11, textDecoration: "underline", fontFamily: "monospace" }}
                >
                  Walrus Evidence Blob: {shortId(walrusId)} ↗
                </a>
              </div>
            )}
          </div>
        </div>
      ),
    });
  } else if (incident.status === "failed" && incident.result) {
    messages.push({
      id: "failed",
      sender: "RescueAgent",
      role: "agent",
      tag: "RECOVERY FAILED",
      tagBg: "rgba(180, 35, 24, 0.12)",
      tagColor: "#b42318",
      time: `${incident.result.time ?? elapsed}s`,
      text: (
        <div>
          <div style={{ fontWeight: 800, color: "#b42318", fontSize: 13.5 }}>
            Autonomous recovery could not complete
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {incident.result.state ?? "Recovery failed"}.
            {incident.result.refund
              ? ` Escrow refunded (${rm(incident.result.refund)}).`
              : " No charge was made."}
            {settleTx && (
              <div style={{ marginTop: 4 }}>
                <SuiscanLink digest={settleTx} color="#b42318" />
              </div>
            )}
          </div>
        </div>
      ),
    });
  } else if (incident.status === "noop" && incident.result) {
    messages.push({
      id: "noop",
      sender: "RescueAgent",
      role: "agent",
      tag: "NO RECOVERY NEEDED",
      tagBg: "rgba(52, 199, 89, 0.12)",
      tagColor: "#248a3d",
      time: `${incident.result.time ?? elapsed}s`,
      text: (
        <div>
          <div style={{ fontWeight: 800, color: "#248a3d", fontSize: 13.5 }}>
            Network healthy — no external recovery required
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {incident.result.state ?? "No recovery needed"}. No escrow locked, nothing purchased.
          </div>
        </div>
      ),
    });
  }

  /* Live progress line — keyed off the REAL incident status, not elapsed time. */
  const statusLine =
    incident.status === "detected" ||
    incident.status === "protecting" ||
    incident.status === "searching" ||
    incident.status === "sms"
      ? "Broadcasting recovery intent to provider agents..."
      : incident.status === "request_detected"
      ? "Receiving provider bids from the live agent market..."
      : incident.status === "provider_selected"
      ? "Evaluating bids & locking the optimal provider..."
      : incident.status === "escrow_locked"
      ? "Locking Sui dual-sig escrow & attaching backup slice..."
      : incident.status === "activating"
      ? "Activating backup slice..."
      : "Verifying delivered bandwidth & settling escrow on Sui...";

  return (
    <div
      className="overlay"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div
        className="sheet"
        style={{
          maxWidth: 580,
          width: "100%",
          padding: 0,
          borderRadius: 20,
          overflow: "hidden",
          background: "#ffffff",
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.35)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
        }}
      >
        {/* Two-Step Progress Bar at Top - Theme Blue Styling */}
        <div
          style={{
            background: "#005bb5",
            padding: "10px 18px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            borderBottom: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          {/* Step 1 */}
          <div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: "#38bdf8",
                marginBottom: 4,
              }}
            />
            <div style={{ fontSize: 11, fontWeight: 700, color: "#ffffff", display: "flex", alignItems: "center", gap: 5 }}>
              <span>Step 1: Agent Chat &amp; Intent</span>
              {completed && <span style={{ color: "#38bdf8" }}>✓</span>}
            </div>
          </div>

          {/* Step 2 */}
          <div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: completed ? "#38bdf8" : "rgba(255, 255, 255, 0.3)",
                marginBottom: 4,
              }}
            />
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: completed ? "#ffffff" : "rgba(255, 255, 255, 0.65)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>Step 2: Restored &amp; Settled</span>
              {completed && <span style={{ color: "#38bdf8" }}>✓</span>}
            </div>
          </div>
        </div>

        {/* Modal Chat Header - NetChain Theme Blue (No Emojis) */}
        <div
          style={{
            background: "#0071e3",
            padding: "12px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#ffffff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* SVG Agent Avatar */}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                border: "1.5px solid rgba(255, 255, 255, 0.4)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <span
                style={{
                  position: "absolute",
                  bottom: -1,
                  right: -1,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#38bdf8",
                  border: "2px solid #0071e3",
                }}
              />
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>RescueAgent</span>
                <span
                  style={{
                    background: "rgba(255, 255, 255, 0.22)",
                    color: "#ffffff",
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "1px 6px",
                    borderRadius: 6,
                    letterSpacing: ".04em",
                  }}
                >
                  AUTONOMOUS
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "rgba(255, 255, 255, 0.8)", marginTop: 1 }}>
                {!completed
                  ? "online · Autonomous Network Guardian"
                  : incident.status === "restored"
                  ? "Restoration Complete · Backup Active"
                  : incident.status === "failed"
                  ? "Recovery Incomplete · Funds Refunded"
                  : "Network Healthy · No Recovery Needed"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              className="mono"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                background: "rgba(0, 0, 0, 0.2)",
                padding: "3px 8px",
                borderRadius: 12,
                color: "#e0f2fe",
              }}
            >
              {elapsed}s
            </span>
            <button
              className="btn link"
              onClick={dismiss}
              style={{ color: "#ffffff", fontSize: 18, padding: 0, opacity: 0.9 }}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Chat Body - Theme Clean Slate Background */}
        <div
          style={{
            background: "#f5f5f7",
            flex: 1,
            overflowY: "auto",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minHeight: 300,
            maxHeight: 400,
          }}
        >
          {/* Center Security Notice */}
          <div style={{ textAlign: "center", margin: "2px 0 6px" }}>
            <span
              style={{
                background: "#ffffff",
                color: "#64748b",
                fontSize: 10.5,
                fontWeight: 600,
                padding: "4px 12px",
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                border: "1px solid rgba(0, 0, 0, 0.06)",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
              }}
            >
              Autonomous A2A protocol · Verified on Sui Trust Layer
            </span>
          </div>

          {/* Render Multi-Agent Conversation Messages */}
          {messages.map((m) => {
            const isUser = m.role === "user";
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  maxWidth: isUser ? "78%" : m.isSpecialIndicator ? "92%" : "86%",
                  background: isUser
                    ? "#0071e3"
                    : m.isSpecialIndicator
                    ? "linear-gradient(135deg, #f0f9ff 0%, #ffffff 100%)"
                    : "#ffffff",
                  color: isUser ? "#ffffff" : "var(--ink)",
                  border: isUser
                    ? "none"
                    : m.isSpecialIndicator
                    ? "1.5px solid #38bdf8"
                    : m.isWinner
                    ? "1.5px solid #0071e3"
                    : m.isEscrow
                    ? "1.5px solid #6366f1"
                    : "1px solid var(--line)",
                  borderRadius: isUser ? "14px 0 14px 14px" : "0 14px 14px 14px",
                  padding: m.isSpecialIndicator ? "12px 16px" : "10px 14px",
                  boxShadow: m.isSpecialIndicator
                    ? "0 4px 16px rgba(2, 132, 199, 0.12)"
                    : m.isWinner
                    ? "0 3px 12px rgba(0, 113, 227, 0.15)"
                    : "0 1px 3px rgba(0, 0, 0, 0.06)",
                  fontSize: 13,
                  lineHeight: 1.45,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 800,
                      color: isUser ? "#ffffff" : m.tagColor || "#0071e3",
                    }}
                  >
                    {m.sender}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "1.5px 6px",
                      borderRadius: 6,
                      background: m.tagBg,
                      color: m.tagColor,
                      letterSpacing: ".04em",
                    }}
                  >
                    {m.tag}
                  </span>
                </div>

                {m.text}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 4,
                    fontSize: 10,
                    color: isUser ? "rgba(255, 255, 255, 0.75)" : "var(--muted)",
                    marginTop: 4,
                  }}
                >
                  <span>{m.time}</span>
                  {isUser && <span style={{ color: "#93c5fd", fontWeight: 800 }}>✓✓</span>}
                </div>
              </div>
            );
          })}

          {/* Real-time Status Feedback Bubble */}
          {!completed && (
            <div
              style={{
                alignSelf: "center",
                background: "rgba(0, 113, 227, 0.08)",
                border: "1px solid rgba(0, 113, 227, 0.18)",
                padding: "6px 14px",
                borderRadius: 12,
                fontSize: 11.5,
                fontWeight: 600,
                color: "#0071e3",
                display: "flex",
                alignItems: "center",
                gap: 8,
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
                margin: "4px 0",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#0071e3",
                  animation: "pulse 1s infinite alternate",
                }}
              />
              <span>{statusLine}</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Step 2 Settlement Summary Card - Theme Blue Accent */}
        {completed && incident.result && incident.status === "restored" && (
          <div
            style={{
              padding: "16px 20px",
              background: "#f8fafc",
              borderTop: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "#0071e3", letterSpacing: ".04em" }}>
                Step 2: Restored &amp; Settled
              </div>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 10,
                  background: "rgba(0, 113, 227, 0.1)",
                  color: "#0071e3",
                }}
              >
                SUI DUAL-SIG SETTLED
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                background: "#ffffff",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                textAlign: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>RECOVERED</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#0071e3", marginTop: 2 }}>
                  +{restoredMbps} Mbps
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>RECOVERY TIME</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", marginTop: 2 }}>
                  {incident.result.time}s
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>ESCROW CHARGED</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", marginTop: 2 }}>
                  {rm(incident.result.charged)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>TRUST LAYER</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0071e3", marginTop: 2 }}>
                  Verified ✓
                </div>
              </div>
            </div>

            {settleTx && (
              <div style={{ marginTop: 10, textAlign: "center", fontSize: 11.5, color: "var(--muted)" }}>
                Sui On-Chain Settlement:{" "}
                <SuiscanLink digest={settleTx} color="#0071e3" />
              </div>
            )}

            {walrusId && (
              <div style={{ marginTop: 6, textAlign: "center", fontSize: 11.5, color: "var(--muted)" }}>
                Walrus Decentralized Audit:{" "}
                <a
                  href={`https://walruscan.com/testnet/blob/${walrusId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#0d9488", fontWeight: 600, textDecoration: "underline", fontFamily: "monospace" }}
                >
                  {shortId(walrusId)} ↗
                </a>
              </div>
            )}
          </div>
        )}

        {/* Done / Close button once the run reached any terminal state */}
        {completed && (
          <div style={{ padding: "14px 20px", background: "#f8fafc", borderTop: "1px solid var(--line)" }}>
            <button
              className="btn primary"
              onClick={dismiss}
              style={{
                width: "100%",
                background: "#0071e3",
                borderColor: "#0071e3",
                padding: "11px",
                borderRadius: 24,
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {incident.status === "restored" ? "Done · Return to Restored Network" : "Close"}
            </button>
          </div>
        )}

        {/* Autonomous Autopilot Status Footer when negotiating (No input box) */}
        {!completed && (
          <div
            style={{
              padding: "12px 18px",
              background: "#ffffff",
              borderTop: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: "#0071e3",
                  boxShadow: "0 0 0 3px rgba(0, 113, 227, 0.2)",
                  animation: "pulse 1.2s infinite alternate",
                }}
              />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0071e3" }}>
                  Autonomous A2A Negotiation Active
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Zero-touch recovery · Agents negotiating &amp; verifying SLA autonomously
                </div>
              </div>
            </div>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "#0071e3",
                background: "rgba(0, 113, 227, 0.08)",
                padding: "3px 9px",
                borderRadius: 12,
                border: "1px solid rgba(0, 113, 227, 0.18)",
              }}
            >
              AUTOPILOT
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
