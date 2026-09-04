import { useEffect, useRef, useState } from "react";
import { useAppStore, elapsedSecAt } from "../store/useAppStore";
import { rm } from "../services/pricing";
import { STEP_INDEX } from "../services/flows";
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

function Thread({ incident }: { incident: Incident }) {
  // Auto-scroll to the newest bubble whenever the thread grows — the SMS
  // channel is live-narrated during LIVE runs and must read bottom-up.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const count = incident.thread.length;

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count]);

  return (
    <div ref={boxRef} className="thread" aria-label="Recovery SMS thread" style={{ maxHeight: 260, overflowY: "auto", padding: "4px 0" }}>
      {incident.thread.map((b, i) => (
        <div
          key={i}
          className={`bubble ${b.from}`}
          style={{
            fontSize: 13.5,
            padding: "10px 14px",
            borderRadius: 14,
            lineHeight: 1.45,
          }}
        >
          {b.auto && (
            <span style={{ display: "block", fontSize: 10, fontWeight: 700, opacity: 0.7, marginBottom: 2 }}>
              Autonomous Reply Engine
            </span>
          )}
          {b.text}
        </div>
      ))}
    </div>
  );
}

function Composer({ shortage, live }: { shortage: number; live?: boolean }) {
  const sendSms = useAppStore((s) => s.sendSms);
  const [value, setValue] = useState("");
  const price = (min: number) => +(shortage * min * 0.00084).toFixed(2);
  // Live mode: quotes are real agent prices, so chips suggest realistic
  // budgets instead of the demo rate.
  const chips = live
    ? [
        { label: "30 min, USDC 2", text: "30 min, USDC 2" },
        { label: "60 min, USDC 5", text: "60 min, USDC 5" },
        { label: "120 min, USDC 8", text: "120 min, USDC 8" },
      ]
    : [
        { label: "15 min (USDC " + price(15) + ")", text: `15 min, USDC ${price(15)}` },
        { label: "30 min (USDC " + price(30) + ")", text: `30 min, USDC ${price(30)}` },
        { label: "60 min (USDC " + price(60) + ")", text: `60 min, USDC ${price(60)}` },
      ];

  const send = (customText?: string) => {
    const textToSend = (customText ?? value).trim();
    if (textToSend) {
      sendSms(textToSend);
      setValue("");
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>
        Quick Reply Suggestions:
      </div>
      <div className="qchips" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {chips.map((c) => (
          <button
            key={c.text}
            type="button"
            className="btn sm subtle"
            style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 20 }}
            onClick={() => send(c.text)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="smsbar" style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="input"
          style={{ borderRadius: 20, padding: "9px 16px" }}
          value={value}
          placeholder={live ? "Or type reply: e.g. 60 min, USDC 5" : "Or type reply: e.g. 30 min, USDC 14"}
          aria-label="Reply with duration and budget"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          autoFocus
        />
        <button
          className="btn primary"
          style={{ width: "auto", borderRadius: 20, padding: "8px 20px" }}
          onClick={() => send()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function RecoveryOverlay({ incident }: { incident: Incident }) {
  const dismiss = useAppStore((s) => s.dismissOverlay);
  const curIdx = STEP_INDEX[incident.status] ?? 0;
  const inSms = incident.status === "sms";
  const isLive = incident.kind === "live";
  const completed = Boolean(incident.result);

  useTicker(!completed);
  const now = Date.now();
  const elapsed = elapsedSecAt(incident, now).toFixed(1);

  const steps = [
    { label: "Detected", done: curIdx >= 1 },
    { label: "SMS Intent", done: curIdx >= 4 },
    { label: "Provider & Sui Escrow", done: curIdx >= 6 },
    { label: "Restored & Settled", done: completed },
  ];

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && dismiss()}>
      <div
        className="sheet"
        style={{
          maxWidth: 620,
          width: "100%",
          padding: "26px 28px",
          borderRadius: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="dot"
              style={{
                background: completed ? "var(--ok)" : "var(--accent)",
                width: 10,
                height: 10,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {completed ? "Recovery Complete" : "Autonomous Recovery"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mono" style={{ fontSize: 15, fontWeight: 800, color: "var(--muted)" }}>
              {elapsed}s
            </span>
            <button
              className="btn link"
              onClick={dismiss}
              style={{ fontSize: 18, padding: "0 4px", color: "var(--muted)" }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Milestone Steps Bar */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
            margin: "18px 0 16px",
            background: "var(--bg)",
            padding: "8px 10px",
            borderRadius: 12,
          }}
        >
          {steps.map((st, idx) => (
            <div key={st.label} style={{ textAlign: "center" }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: st.done ? "var(--ok)" : idx === Math.min(curIdx, 3) ? "var(--accent)" : "#cbd5e1",
                  marginBottom: 6,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: st.done ? "var(--ink)" : "var(--muted)",
                }}
              >
                {st.label}
              </span>
            </div>
          ))}
        </div>

        {/* In-Progress SMS Chat */}
        {inSms && (
          <div style={{ background: "var(--bg)", borderRadius: 14, padding: "16px 18px", marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Interactive Recovery Channel</span>
            </div>
            <Thread incident={incident} />
            <Composer shortage={incident.shortage} live={isLive} />
          </div>
        )}

        {/* Live states after the SMS reply — ONE narration block, no
            duplicated thread/spinner: the thread tells the story, the phase
            chip shows where we are, live quotes render inside the thread. */}
        {isLive && !inSms && !completed && (
          <div style={{ background: "var(--bg)", borderRadius: 14, padding: "16px 18px", marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 18,
                  border: "2px solid var(--accent-soft)",
                  borderTopColor: "var(--accent)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
              <span style={{ fontSize: 13.5, fontWeight: 800 }}>
                {incident.status === "request_detected" && "Agents are quoting your intent…"}
                {incident.status === "provider_selected" && "Signing & committing the Selected Offer…"}
                {incident.status === "activating" && "Activating the purchased capacity…"}
                {incident.status === "verifying" && "Verifying delivered throughput…"}
                {incident.status === "escrow_locked" && "Escrow locked — activating…"}
              </span>
            </div>
            <Thread incident={incident} />
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
              Requesting +{incident.shortage} Mbps · {incident.req?.min ?? 30} min · budget USDC {incident.req?.budget ?? 0}
            </div>
          </div>
        )}

        {/* Sim (non-live) transition state */}
        {!isLive && !inSms && !completed && incident.status !== "escrow_locked" && (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <div
              style={{
                display: "inline-block",
                width: 36,
                height: 36,
                border: "3px solid var(--accent-soft)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                marginBottom: 12,
              }}
            />
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {incident.status === "provider_selected" && "Matching Best Provider (KilatLink FWA)…"}
              {incident.status === "activating" && "Activating High-Speed Backup Link…"}
              {incident.status === "verifying" && "Verifying Delivered Throughput & SLA…"}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Allocating +{incident.shortage} Mbps replacement bandwidth
            </div>
          </div>
        )}

        {/* Agent Signing Terminal (Simulated Escrow Lock) — simulation only;
            live mode narrates the REAL chain rows in the thread instead */}
        {!inSms && !isLive && !completed && incident.status === "escrow_locked" && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, textAlign: "center", marginBottom: 12 }}>
              Locking Escrow on Sui Trust Layer…
            </div>
            <div
              style={{
                background: "#0f172a",
                color: "#38bdf8",
                borderRadius: 12,
                padding: "16px",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                textAlign: "left",
                boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#eab308" }} />
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ animation: "fadeIn 0.2s" }}><span style={{ color: "#a855f7", fontWeight: "bold" }}>[Agent: MiniMax-ABAB6.5]</span> Constructing Programmable Transaction Block (PTB)...</div>
                <div style={{ animation: "fadeIn 0.2s 0.8s backwards" }}><span style={{ color: "#eab308", fontWeight: "bold" }}>[PTB Builder]</span> Injecting SplitCoins: 11.97 SUI (Provider) + 0.63 SUI (Platform Fee)</div>
                <div style={{ animation: "fadeIn 0.2s 1.6s backwards" }}><span style={{ color: "#3b82f6", fontWeight: "bold" }}>[Wallet]</span> Auto-signing payload with connected Sui identity...</div>
                <div style={{ animation: "fadeIn 0.2s 2.4s backwards" }}><span style={{ color: "#22c55e", fontWeight: "bold" }}>[Network]</span> Broadcasting to Sui Testnet...</div>
                <div style={{ animation: "fadeIn 0.2s 3.2s backwards", marginTop: 8, padding: 10, background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: 6 }}>
                  <div style={{ color: "#4ade80", fontWeight: "bold", marginBottom: 4 }}>✓ Transaction Executed Successfully</div>
                  <div style={{ color: "#cbd5e1" }}>Digest: <a href="https://suiscan.xyz/testnet/tx/8AbX9Z12398jklmnOPqrstUVWxyZ" target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8", textDecoration: "none", fontWeight: "bold" }}>8AbX9Z12398jklmnOPqrstUVWxyZ ↗</a></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Completed State */}
        {completed && incident.result && (
          <div>
            <div
              style={{
                background:
                  incident.status === "failed"
                    ? "var(--bad-soft)"
                    : "var(--ok-soft)",
                color: incident.status === "failed" ? "var(--bad-ink)" : "var(--ok-ink)",
                borderRadius: 12,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 10,
              }}
            >
              <span style={{ fontSize: 24 }}>
                {incident.status === "failed" ? "✕" : incident.status === "noop" ? "✓" : "✓"}
              </span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {incident.status === "failed"
                    ? "Recovery Failed"
                    : incident.status === "noop"
                      ? "All Clear — No Recovery Needed"
                      : "Connection Successfully Restored"}
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.9 }}>
                  {incident.status === "failed"
                    ? `Reason: ${incident.result.state}.`
                    : incident.status === "noop"
                      ? "Agents confirmed healthy capacity — no escrow, no purchase"
                      : `${incident.req?.provider ?? "KilatLink FWA"} active · SLA verification passed${isLive ? " · settled on Sui" : ""}`}
                </div>
              </div>
            </div>

            <div className="result-grid" style={{ marginTop: 14 }}>
              {incident.status !== "noop" && (
                <>
                  <div className="rg">
                    <div className="rk">Recovered Capacity</div>
                    <div className="rv ok">+{incident.available || incident.shortage} Mbps</div>
                  </div>
                  <div className="rg">
                    <div className="rk">Time to Recovery</div>
                    <div className="rv">{incident.result.time}s</div>
                  </div>
                  <div className="rg">
                    <div className="rk">{incident.result.refund > 0 ? "Refunded" : "Escrow Settled"}</div>
                    <div className="rv">
                      {incident.result.refund > 0 ? rm(incident.result.refund) : rm(incident.result.charged)}
                    </div>
                  </div>
                  <div className="rg">
                    <div className="rk">Trust Layer</div>
                    <div className="rv ok">{isLive ? "Sui On-Chain ✓" : "Sui Dual-Sig ✓"}</div>
                  </div>
                </>
              )}
              {incident.status === "noop" && (
                <div className="rg">
                  <div className="rk">Charged</div>
                  <div className="rv ok">USDC 0.00</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 18 }}>
              <button className="btn primary" onClick={dismiss}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
