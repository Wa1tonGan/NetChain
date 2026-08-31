import { useAppStore } from "../store/useAppStore";
import { rm, rm0 } from "../services/pricing";

export default function WalletPage() {
  const s = useAppStore();
  const remaining = Math.max(0, +(s.monthlyLimit - s.month.usage).toFixed(2));
  const lastTx = s.payments[0] ? s.records[s.payments[0].id] : undefined;

  return (
    <>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.01em", paddingTop: 6 }}>Wallet</h1>

      <div className="cols">
        <div>
          <div className="card">
            <div className="pad">
              <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>NetChain balance</div>
              <div className="big-num">{rm(s.balance)}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>Available for automatic recovery</div>
              <div className="seg" style={{ marginTop: 16 }}>
                {[20, 50, 100].map((v) => (
                  <button key={v} onClick={() => s.addFunds(v)}>+ RM {v}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="card-title">This month</div>
          <div className="card">
            <div className="stat-line"><span className="k">Recovery usage</span><span className="v">{rm(s.month.usage)}</span></div>
            <div className="stat-line"><span className="k">Platform fees</span><span className="v">{rm(s.month.fees)}</span></div>
            {s.locked > 0 && (
              <div className="stat-line"><span className="k">In escrow (locked)</span><span className="v warnv">{rm(s.locked)}</span></div>
            )}
            <div className="stat-line"><span className="k">Remaining budget</span><span className="v">{rm(remaining)}</span></div>
          </div>

          <div className="card-title">Sui trust layer</div>
          <div className="card">
            <div className="row">
              <span className="grow">
                <span className="t">Wallet address</span>
                <div className="s mono">
                  {s.walletAddr.slice(0, 10)}…{s.walletAddr.slice(-6)}
                </div>
              </span>
              <span className="chip green"><span className="dot" />Escrow ready</span>
            </div>
            <div className="stat-line"><span className="k">Settlement asset</span><span className="v">MYRC · 1 = RM 1</span></div>
            <div className="stat-line"><span className="k">Spending authority</span><span className="v">up to {rm0(s.maxPerRecovery)} / recovery</span></div>
            <div className="stat-line"><span className="k">Funds release rule</span><span className="v">only after verified delivery</span></div>
            {lastTx && (
              <div className="stat-line">
                <span className="k">Latest settlement</span>
                <span className="v">
                  <a className="txlink" href="https://suiscan.xyz/testnet" target="_blank" rel="noopener">
                    {lastTx.tx || "view"} ↗ SuiScan
                  </a>
                </span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card-title" style={{ marginTop: 16 }}>Recent payments</div>
          {s.payments.length ? (
            s.payments.map((p) => (
              <div className="card" key={p.id}>
                <div className="row">
                  <div className="grow">
                    <div className="t">{p.label}</div>
                    <div className="s">{p.provider} · {p.cap}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="v">{rm(p.amount)}</div>
                    <div className="s" style={{ color: p.refund ? "var(--warn)" : "var(--ok)", fontWeight: 700 }}>
                      {p.refund ? `↓ ${rm(p.refund)} ${p.refundNote || "refunded"}` : `✓ ${p.state}`}
                    </div>
                  </div>
                  <button className="btn sm subtle" onClick={() => s.disclose("pay_" + p.id)}>Details</button>
                </div>
                {s.disclosures["pay_" + p.id] && <PaymentDetails id={p.id} />}
              </div>
            ))
          ) : (
            <div className="card">
              <div className="row">
                <span className="s">No payments yet. Payment is only taken after a recovery is verified.</span>
              </div>
            </div>
          )}
          <p className="note">
            Money states: <b>locked</b> while capacity is activating → <b>settled</b> after verification →{" "}
            <b>refunded</b> automatically if the provider fails.
          </p>
        </div>
      </div>
    </>
  );
}

function PaymentDetails({ id }: { id: string }) {
  const p = useAppStore((s) => s.payments.find((x) => x.id === id));
  const rec = useAppStore((s) => s.records[id]);
  if (!p) return null;
  const fee = rec?.fee ?? 0;
  const cap = Math.max(0, +(p.amount - fee).toFixed(2));
  return (
    <div className="disc">
      <div className="tech">
        <span className="k">Capacity charge</span><span className="v">{rm(cap)}</span>
        <span className="k">Platform fee</span><span className="v">{rm(fee)}</span>
        <span className="k">Total{p.refund && !p.refundNote ? " (after refund)" : ""}</span><span className="v">{rm(p.amount)}</span>
        {p.refund ? <><span className="k">Refunded to you</span><span className="v">{rm(p.refund)}</span></> : null}
        <span className="k">Money state</span><span className="v">{rec?.state || p.state}</span>
        <span className="k">Verification</span>
        <span className="v">
          {rec?.outcome === "under"
            ? "Under-delivery — penalty applied"
            : rec?.outcome === "failed"
              ? "Failed — refunded"
              : "Passed"}
        </span>
        <span className="k">Transaction ID</span><span className="v">{rec?.tx || "—"}</span>
      </div>
    </div>
  );
}
