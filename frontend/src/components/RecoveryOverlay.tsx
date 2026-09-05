import { useEffect, useRef, useState } from "react";
import { useAppStore, elapsedSecAt } from "../store/useAppStore";
import { rm } from "../services/pricing";
import type { Incident } from "../services/types";
import { TextWithIcons } from "./Icon";

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

export default function RecoveryOverlay({ incident }: { incident: Incident }) {
  const dismiss = useAppStore((s) => s.dismissOverlay);
  const sendSms = useAppStore((s) => s.sendSms);

  const [inputVal, setInputVal] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const completed = Boolean(incident.result);
  const inSms = incident.status === "sms";

  useTicker(!completed);
  const now = Date.now();
  const elapsed = elapsedSecAt(incident, now).toFixed(1);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [incident.thread.length, incident.status, completed]);

  const handleSend = (text?: string) => {
    const toSend = (text ?? inputVal).trim();
    if (toSend) {
      sendSms(toSend);
      setInputVal("");
    }
  };

  const quickChips = [
    { label: "500 Mbps, USDC 14", text: "500 Mbps, USDC 14" },
    { label: "300 Mbps, USDC 10", text: "300 Mbps, USDC 10" },
    { label: "100 Mbps, USDC 5", text: "100 Mbps, USDC 5" },
  ];

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
            {/* SVG Agent Avatar (No emoji) */}
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

        {/* Chat Body - Theme Clean Slate/Subtle Background */}
        <div
          style={{
            background: "#f5f5f7",
            flex: 1,
            overflowY: "auto",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minHeight: 280,
            maxHeight: 380,
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
              Messages authenticated autonomously on Sui Trust Layer
            </span>
          </div>

          {/* Initial Agent Alert Message */}
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "84%",
              background: "#ffffff",
              border: "1px solid var(--line)",
              borderRadius: "0 14px 14px 14px",
              padding: "10px 14px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
              fontSize: 13,
              lineHeight: 1.5,
              position: "relative",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0071e3", marginBottom: 3 }}>RescueAgent</div>
            <div>
              <b>Weak network detected in current location.</b>
              <br />
              Downlink degraded to <b>15 Mbps</b>. Uplink compromised.
              <br />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Protection rule P1 activated: Please specify required bandwidth (e.g. 500 Mbps) and budget (USDC).
              </span>
            </div>
            <div style={{ textAlign: "right", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
              T+0.0s
            </div>
          </div>

          {/* Thread Messages */}
          {incident.thread.map((b, i) => {
            const isUser = b.from === "user";
            const formattedText = b.text
              .replace(/30\s*min(?:ute)?s?/gi, "500 Mbps")
              .replace(/60\s*min(?:ute)?s?/gi, "600 Mbps")
              .replace(/15\s*min(?:ute)?s?/gi, "300 Mbps");

            return (
              <div
                key={i}
                style={{
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  maxWidth: "84%",
                  background: isUser ? "#0071e3" : "#ffffff",
                  color: isUser ? "#ffffff" : "var(--ink)",
                  border: isUser ? "none" : "1px solid var(--line)",
                  borderRadius: isUser ? "14px 0 14px 14px" : "0 14px 14px 14px",
                  padding: "9px 13px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
                  fontSize: 13,
                  lineHeight: 1.45,
                  position: "relative",
                }}
              >
                {!isUser && (
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#0071e3", marginBottom: 2 }}>
                    RescueAgent
                  </div>
                )}
                {isUser && b.auto && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255, 255, 255, 0.8)", marginBottom: 2 }}>
                    Auto Intent Dispatch
                  </div>
                )}
                <TextWithIcons text={formattedText} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 4,
                    fontSize: 10,
                    color: isUser ? "rgba(255, 255, 255, 0.75)" : "var(--muted)",
                    marginTop: 3,
                  }}
                >
                  <span>T+{elapsed}s</span>
                  {isUser && <span style={{ color: "#93c5fd", fontWeight: 800 }}>✓✓</span>}
                </div>
              </div>
            );
          })}

          {/* Real-time Status Feedback Bubble */}
          {!completed && !inSms && (
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
                {incident.status === "request_detected" && "Matching quotes with KilatLink FWA..."}
                {incident.status === "provider_selected" && "Signing contract & locking Sui Escrow..."}
                {incident.status === "activating" && "Activating +500 Mbps backup link..."}
                {incident.status === "verifying" && "Verifying SLA and network throughput..."}
                {incident.status === "escrow_locked" && "Sui escrow locked — activating link..."}
              </span>
            </div>
          )}

          {/* Step 2 Completion Bubble */}
          {completed && (
            <div
              style={{
                alignSelf: "flex-start",
                maxWidth: "88%",
                background: "#ffffff",
                border: "1px solid var(--line)",
                borderRadius: "0 14px 14px 14px",
                padding: "12px 16px",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
                borderLeft: "4px solid #0071e3",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 800, color: "#0071e3", fontSize: 14 }}>
                <span>Connection Successfully Restored</span>
              </div>
              <div style={{ marginTop: 4, color: "var(--ink-2)" }}>
                High-speed backup slice active: <b>+500 Mbps</b> via <b>KilatLink FWA</b>.
                <br />
                SLA throughput verified. Escrow settled on Sui Trust Layer.
              </div>
              <div style={{ textAlign: "right", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                {incident.result?.time ?? elapsed}s · Verified ✓✓
              </div>
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

        {/* Step 1 WhatsApp Input & Suggestions Bar - Theme Blue Accent */}
        {!completed && (
          <div
            style={{
              padding: "10px 14px",
              background: "#ffffff",
              borderTop: "1px solid var(--line)",
            }}
          >
            {/* Quick Suggestions Chips */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, overflowX: "auto", paddingBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", alignSelf: "center", whiteSpace: "nowrap" }}>
                Suggested Reply:
              </span>
              {quickChips.map((c) => (
                <button
                  key={c.text}
                  type="button"
                  onClick={() => handleSend(c.text)}
                  style={{
                    fontSize: 11.5,
                    padding: "4px 10px",
                    borderRadius: 16,
                    background: "rgba(0, 113, 227, 0.08)",
                    border: "1px solid rgba(0, 113, 227, 0.18)",
                    color: "#0071e3",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Input & Send Button */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                style={{
                  flex: 1,
                  borderRadius: 22,
                  padding: "9px 16px",
                  background: "#f5f5f7",
                  border: "1px solid var(--line)",
                  fontSize: 13,
                }}
                placeholder="Type bandwidth & budget: e.g. 500 Mbps, USDC 14"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
              />
              <button
                type="button"
                onClick={() => handleSend()}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: "#0071e3",
                  color: "#ffffff",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(0, 113, 227, 0.35)",
                  flexShrink: 0,
                }}
                title="Send reply"
                aria-label="Send reply"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
