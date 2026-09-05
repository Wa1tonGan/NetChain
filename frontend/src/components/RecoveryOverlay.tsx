import { useEffect, useRef, useState } from "react";
import { useAppStore, elapsedSecAt } from "../store/useAppStore";
import { rm } from "../services/pricing";
import type { Incident } from "../services/types";

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

export default function RecoveryOverlay({ incident }: { incident: Incident }) {
  const dismiss = useAppStore((s) => s.dismissOverlay);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const completed = Boolean(incident.result);

  useTicker(!completed);
  const now = Date.now();
  const elapsed = elapsedSecAt(incident, now).toFixed(1);
  const sec = completed ? 999 : parseFloat(elapsed);

  // Auto-scroll chat to bottom as conversation progresses
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [incident.status, completed, elapsed]);

  const messages: ChatMsg[] = [
    {
      id: "alert",
      sender: "RescueAgent",
      role: "agent",
      tag: "AUTONOMOUS GUARDIAN",
      tagBg: "rgba(0, 113, 227, 0.12)",
      tagColor: "#0071e3",
      time: "T+0.0s",
      text: (
        <div>
          <b>Weak network detected in George Town, Penang.</b>
          <br />
          Downlink degraded to <b>15 Mbps</b>. Uplink compromised.
          <br />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Protection rule P1 activated: Auto-broadcasting recovery intent for <b>500 Mbps</b> backup link (budget ≤ <b>USDC 2.00</b>).
          </span>
        </div>
      ),
    },
  ];

  if (sec >= 1.0 || completed || incident.thread.some((t) => t.from === "user")) {
    messages.push({
      id: "intent",
      sender: "Subscriber Proxy",
      role: "user",
      tag: "AUTO INTENT DISPATCH",
      tagBg: "rgba(255, 255, 255, 0.2)",
      tagColor: "#ffffff",
      time: "T+1.0s",
      text: (
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>500 Mbps, USDC 2</div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
            Dual-Sig pre-authorized · 500 Mbps shortfall replacement
          </div>
        </div>
      ),
    });
  }

  if (sec >= 2.5 || completed || ["request_detected", "provider_selected", "escrow_locked", "activating", "verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "maxis",
      sender: "Maxis Agent",
      role: "agent",
      tag: "TELCO 5G BID",
      tagBg: "rgba(2, 132, 199, 0.12)",
      tagColor: "#0284c7",
      time: "T+2.5s",
      text: (
        <div>
          <b>📡 Maxis 5G Ultra Bid Submitted:</b>
          <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
            • Bandwidth: <b>500 Mbps</b><br />
            • Latency: <b>26 ms</b> RTT (Jitter 4 ms)<br />
            • Offer Price: <b>USDC 2.20</b><br />
            • SLA: 99.8% availability guarantee
          </div>
        </div>
      ),
    });
  }

  if (sec >= 3.8 || completed || ["request_detected", "provider_selected", "escrow_locked", "activating", "verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "digi",
      sender: "Digi Agent",
      role: "agent",
      tag: "FIBRE AIR BID",
      tagBg: "rgba(217, 119, 6, 0.12)",
      tagColor: "#d97706",
      time: "T+3.8s",
      text: (
        <div>
          <b>📡 Digi Fibre Air Bid Submitted:</b>
          <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
            • Bandwidth: <b>450 Mbps</b><br />
            • Latency: <b>32 ms</b> RTT (Jitter 5 ms)<br />
            • Offer Price: <b>USDC 1.95</b><br />
            • SLA: 99.5% availability guarantee
          </div>
        </div>
      ),
    });
  }

  if (sec >= 5.0 || completed || ["provider_selected", "escrow_locked", "activating", "verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "kilatlink",
      sender: "KilatLink Agent",
      role: "agent",
      tag: "KILATLINK FWA BID",
      tagBg: "rgba(99, 102, 241, 0.12)",
      tagColor: "#6366f1",
      time: "T+5.0s",
      text: (
        <div>
          <b>📡 KilatLink FWA Bid Submitted:</b>
          <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
            • Bandwidth: <b>500 Mbps</b> (Full shortfall demand)<br />
            • Latency: <b>18 ms</b> RTT (Lowest latency route)<br />
            • Offer Price: <b>USDC 1.80</b><br />
            • SLA: 99.9% uptime · 0% packet loss direct peering
          </div>
        </div>
      ),
    });
  }

  if (sec >= 6.5 || completed || ["provider_selected", "escrow_locked", "activating", "verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "selection",
      sender: "RescueAgent",
      role: "agent",
      tag: "BEST OFFER SELECTED",
      tagBg: "rgba(0, 113, 227, 0.15)",
      tagColor: "#0071e3",
      time: "T+6.5s",
      isWinner: true,
      text: (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#0071e3", fontWeight: 800, fontSize: 13.5 }}>
            <span>🏆</span>
            <span>Multi-Agent Consensus: Best Offer Selected</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5 }}>
            Selected <b>KilatLink FWA</b>:
            <br />
            ✓ <b>Full Capacity:</b> 500 Mbps restored
            <br />
            ✓ <b>Lowest Latency:</b> 18 ms (beats Maxis 26ms, Digi 32ms)
            <br />
            ✓ <b>Optimal Budget:</b> USDC 1.80 (saves USDC 0.20 under budget)
            <br />
            ✓ <b>Unanimous Approval:</b> Pricing, SLA, and Budget agents countersigned
          </div>
        </div>
      ),
    });
  }

  if (sec >= 7.3 || completed || ["provider_selected", "escrow_locked", "activating", "verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "why-best",
      sender: "AI Selection Engine",
      role: "agent",
      tag: "OPTIMAL CHOICE RATIONALE",
      tagBg: "rgba(2, 132, 199, 0.15)",
      tagColor: "#0284c7",
      time: "T+7.2s",
      isSpecialIndicator: true,
      text: (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#0369a1", fontWeight: 800, fontSize: 13 }}>
            <span>💡</span>
            <span>Why this proposal was selected as the optimal choice:</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
            <div style={{ marginBottom: 4 }}>
              • <b>Fastest Response Time:</b> Offers the lowest latency and zero packet loss, delivering instant stability without lag or degradation.
            </div>
            <div style={{ marginBottom: 4 }}>
              • <b>Complete Restoration:</b> Fully satisfies all missing bandwidth capacity to keep all mission-critical tasks operating seamlessly.
            </div>
            <div style={{ marginBottom: 4 }}>
              • <b>Maximum Cost Efficiency:</b> Achieves the highest performance rating per unit of cost while staying safely below your pre-set budget limit.
            </div>
            <div>
              • <b>Unanimous Agent Consensus:</b> Pricing, SLA reliability, and security auditing agents all independently verified and approved this proposal.
            </div>
          </div>
        </div>
      ),
    });
  }

  if (sec >= 8.5 || completed || ["escrow_locked", "activating", "verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "escrow",
      sender: "Sui Trust Layer",
      role: "agent",
      tag: "DUAL-SIG ESCROW",
      tagBg: "rgba(79, 70, 229, 0.12)",
      tagColor: "#4f46e5",
      time: "T+8.5s",
      isEscrow: true,
      text: (
        <div>
          <b>🔒 Sui Dual-Sig Escrow Locked:</b>
          <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
            Locked <b>USDC 1.80</b> into Escrow Contract (<span className="mono" style={{ fontSize: 11 }}>0x9c4c...a6a63</span>).
            <br />
            Funds secured on-chain. Activating KilatLink FWA backup slice...
            {incident.commitTxDigest && (
              <div style={{ marginTop: 4 }}>
                <a
                  href={`https://suiscan.xyz/testnet/tx/${incident.commitTxDigest}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#4f46e5", fontSize: 11, textDecoration: "underline", fontFamily: "monospace" }}
                >
                  Sui Escrow Tx: {incident.commitTxDigest.slice(0, 8)}…{incident.commitTxDigest.slice(-6)} ↗
                </a>
              </div>
            )}
          </div>
        </div>
      ),
    });
  }

  if (sec >= 10.5 || completed || ["verifying", "restored"].includes(incident.status)) {
    messages.push({
      id: "audit",
      sender: "Truth Agent",
      role: "agent",
      tag: "SLA AUDIT PASSED",
      tagBg: "rgba(13, 148, 136, 0.12)",
      tagColor: "#0d9488",
      time: "T+10.5s",
      text: (
        <div>
          <b>⚡ Autonomous SLA Verification Passed:</b>
          <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.5 }}>
            Telemetry audit: <b>500 Mbps delivered</b> · <b>18 ms latency</b> · <b>0.0% packet loss</b>.
            <br />
            SLA verified. Dual-sig authorization signed to release escrow payment.
          </div>
        </div>
      ),
    });
  }

  if (completed || incident.status === "restored") {
    messages.push({
      id: "restored",
      sender: "RescueAgent",
      role: "agent",
      tag: "RESTORED & SETTLED",
      tagBg: "rgba(0, 113, 227, 0.15)",
      tagColor: "#0071e3",
      time: `${incident.result?.time ?? "12.6"}s`,
      isWinner: true,
      text: (
        <div>
          <div style={{ fontWeight: 800, color: "#0071e3", fontSize: 13.5 }}>
            Connection Successfully Restored &amp; Settled
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            High-speed backup slice active: <b>+500 Mbps</b> via <b>KilatLink FWA</b>.
            <br />
            SLA throughput verified. Escrow settled autonomously on Sui Trust Layer.
            {(incident.settleTxDigest || incident.result?.tx) && (
              <div style={{ marginTop: 4 }}>
                <a
                  href={`https://suiscan.xyz/testnet/tx/${incident.settleTxDigest || incident.result?.tx}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#0071e3", fontSize: 11, textDecoration: "underline", fontFamily: "monospace" }}
                >
                  Sui Settlement Tx: {(incident.settleTxDigest || incident.result?.tx)?.slice(0, 8)}…{(incident.settleTxDigest || incident.result?.tx)?.slice(-6)} ↗
                </a>
              </div>
            )}
          </div>
        </div>
      ),
    });
  }

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
                {!completed ? "online · Autonomous Network Guardian" : "Restoration Complete · Backup Active"}
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
              <span>
                {sec < 2.5 && "Broadcasting recovery intent to Malaysian provider agents..."}
                {sec >= 2.5 && sec < 6.5 && "Receiving provider bids (Maxis, Digi, KilatLink)..."}
                {sec >= 6.5 && sec < 8.2 && "Evaluating bids & selecting optimal provider..."}
                {sec >= 8.2 && sec < 10.5 && "Locking Sui dual-sig escrow & attaching backup slice..."}
                {sec >= 10.5 && "Verifying delivered bandwidth & settling escrow on Sui..."}
              </span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Step 2 Settlement Summary Card - Theme Blue Accent */}
        {completed && incident.result && (
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
                  +{incident.available || incident.shortage || 500} Mbps
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

            {(incident.settleTxDigest || incident.result.tx) && (
              <div style={{ marginTop: 10, textAlign: "center", fontSize: 11.5, color: "var(--muted)" }}>
                Sui On-Chain Settlement:{" "}
                <a
                  href={`https://suiscan.xyz/testnet/tx/${incident.settleTxDigest || incident.result.tx}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#0071e3", fontWeight: 600, textDecoration: "underline", fontFamily: "monospace" }}
                >
                  {(incident.settleTxDigest || incident.result.tx)?.slice(0, 10)}…{(incident.settleTxDigest || incident.result.tx)?.slice(-8)} ↗
                </a>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
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
                Done · Return to Restored Network
              </button>
            </div>
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
