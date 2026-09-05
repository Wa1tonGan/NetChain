import { useState } from "react";
import { depositToEscrowPool } from "../services/live";
import { fetchEscrowPoolBalance } from "../services/wallet";
import { useAppStore } from "../store/useAppStore";
import Icon from "./Icon";
/* Top-up modal: pick an amount (quick chips or custom), ONE signature — the
   signing method adapts to the login: wallet session → Slush approves;
   zk session → the ephemeral key + zk proof signs (no popup, needs a fresh
   Google login). Either way the USDC lands in the shared escrow pool that
   agent-mode commits spend. */
export default function TopUpModal({
  session,
  onClose,
  onDone,
}: {
  session: import("../services/zklogin").ZkLoginSession;
  onClose: () => void;
  onDone?: () => void; // refresh pool balance
}) {
  const recordTopUp = useAppStore((s) => s.recordTopUp);
  const [amount, setAmount] = useState("5");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const isZk = session.signingMode === "zk";

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 1000;

  async function submit() {
    if (!valid) return;
    setState("working");
    setMsg(null);
    try {
      const res = await depositToEscrowPool(session, parsed);
      recordTopUp(parsed, res.digest);
      setState("done");
      setMsg(`USDC ${parsed.toFixed(2)} deposited · tx ${res.digest.slice(0, 10)}…`);
      onDone?.();
      setTimeout(onClose, 1400);
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-head">
          <h3>Top up escrow pool</h3>
          <button className="btn link" onClick={onClose} aria-label="Close" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
          Your USDC goes into the on-chain escrow pool — the RescueAgent spends it autonomously for recoveries, under
          the per-incident cap.
        </p>

        {msg && (
          <div
            style={{
              fontSize: 11.5,
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: state === "error" ? "var(--amber-soft)" : "var(--green-soft)",
              color: state === "error" ? "var(--amber-ink)" : "var(--green-ink)",
              wordBreak: "break-all",
            }}
          >
            {msg}
          </div>
        )}

        {state !== "done" && (
          <>
            <div className="qchips" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[2, 5, 10, 20].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`btn sm ${Number(amount) === v ? "primary" : "subtle"}`}
                  style={{ fontSize: 12.5, padding: "5px 12px", borderRadius: 16 }}
                  onClick={() => setAmount(String(v))}
                >
                  USDC {v}
                </button>
              ))}
            </div>

            <div style={{ position: "relative" }}>
              <input
                className="input mono"
                style={{ paddingRight: 52, fontSize: 15, fontWeight: 700 }}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                aria-label="Top up amount in USDC"
                autoFocus
              />
              <span
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--muted)",
                }}
              >
                USDC
              </span>
            </div>
            {!valid && amount !== "" && (
              <div style={{ fontSize: 11, color: "var(--amber-ink)", marginTop: 6 }}>
                Enter an amount between 0 and 1000 USDC.
              </div>
            )}

            <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={submit} disabled={!valid || state === "working"}>
              {state === "working"
                ? isZk
                  ? "Signing with your zkLogin identity…"
                  : "Waiting for Slush…"
                : `Deposit USDC ${amount || "0"}`}
            </button>
            <div style={{ fontSize: 10.5, color: "var(--faint)", textAlign: "center", marginTop: 8 }}>
              {isZk
                ? "Signed by your zkLogin identity · zk session must be fresh (epoch valid)"
                : "One Slush signature · funds sit in the escrow object on Sui testnet"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Refresh helper shared by pages hosting the modal. */
export function refreshPoolBalance(setter: (v: number | null) => void): void {
  void fetchEscrowPoolBalance().then(setter);
}
