import { useEffect, useState } from "react";
import { fetchAddressHistory, type OnChainTx } from "../services/wallet";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";

function fmtTs(tsMs: number | null): string {
  if (!tsMs) return "";
  const d = new Date(tsMs);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function TxRow({ t, mode }: { t: OnChainTx; mode?: "purchase" }) {
  const incoming = t.amountUsdc != null && t.amountUsdc > 0;
  const kindLabel = mode === "purchase" ? (PURCHASE_LABELS[t.fn] ?? t.kind) : t.kind;
  return (
    <div className="row">
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="t">{kindLabel}</span>
          <span
            className="chip"
            style={{
              fontSize: 9.5,
              padding: "1px 7px",
              background: t.fn === "transfer" ? "var(--bg)" : "var(--blue-soft)",
              color: t.fn === "transfer" ? "var(--muted)" : "var(--blue)",
              fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
            }}
          >
            {t.fn}
          </span>
        </div>
        <div className="s">
          {fmtTs(t.tsMs)}
          {t.gasSui != null ? ` · gas ${t.gasSui.toFixed(5)} SUI` : ""}
        </div>
        <a
          className="link-btn ghost"
          style={{ padding: "1px 0", fontSize: 10.5, textDecoration: "none" }}
          href={`https://suiscan.xyz/testnet/tx/${t.digest}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.digest.slice(0, 10)}…{t.digest.slice(-6)} ↗ Suiscan
        </a>
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        {t.amountUsdc != null && t.amountUsdc !== 0 ? (
          <div className="v" style={{ color: incoming ? "var(--green-ink)" : undefined, fontWeight: incoming ? 700 : undefined }}>
            {incoming ? "+" : ""}
            {rm(Math.abs(t.amountUsdc))}
          </div>
        ) : (
          <div className="v">—</div>
        )}
        <div className="s" style={{ color: incoming ? "var(--green-ink)" : "var(--ok)", fontWeight: 700 }}>
          {incoming ? "IN ✓" : t.amountUsdc != null && t.amountUsdc < 0 ? "LOCKED" : "OK ✓"}
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** whose chain history to show — defaults to the connected wallet */
  ownerAddress?: string;
  title?: string;
  collapsible?: boolean; // latest 3 + "Show more"
  /** "purchase": reframe rows as the user buying network offers
   *  (commit → bought, settle → settled) — for the agent-signed view */
  mode?: "purchase";
}

const PURCHASE_LABELS: Record<string, string> = {
  commit: "Bought network offer",
  commit_as_buyer: "Bought network offer",
  settle: "Offer settled",
  refund: "Offer refunded",
  reclaim: "Offer reclaimed (expired)",
};

/** On-chain transaction history fetched live from the Sui testnet
 *  (queryTransactionBlocks). Default owner = the connected wallet; pass
 *  ownerAddress to show another party (e.g. the platform operator). */
export default function TransactionHistory({ ownerAddress, title, collapsible = false, mode }: Props) {
  const ownAddress = useAppStore((s) => s.zkLogin?.address ?? null);
  const localPayments = useAppStore((s) => s.payments);
  const address = ownerAddress ?? ownAddress;
  const [rows, setRows] = useState<OnChainTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!address) {
      setRows(null);
      return;
    }
    let alive = true;
    setRows(null);
    setError(null);
    void fetchAddressHistory(address)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    const timer = setInterval(() => {
      void fetchAddressHistory(address).then((r) => alive && setRows(r));
    }, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [address]);

  // only meaningful for the wallet's own view; SIM runs never touch the chain
  const sims = ownerAddress ? [] : localPayments.filter((p) => !p.txDigest);
  const visible = collapsible && !expanded ? (rows ?? []).slice(0, 3) : rows ?? [];

  const resolvedTitle = title ?? (ownerAddress ? "Agent intent history" : "On-chain activity");

  return (
    <>
      <div className="card-title">
        {resolvedTitle}
        <span className="chip good" style={{ marginLeft: 8, fontSize: 10 }}>
          <span className="dot" /> live from Sui testnet
        </span>
        {ownerAddress && (
          <a
            className="link-btn ghost"
            style={{ marginLeft: 6, fontSize: 10, textDecoration: "none" }}
            href={`https://suiscan.xyz/testnet/account/${ownerAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            account ↗
          </a>
        )}
      </div>
      <div className="card">
        {!address && <div className="row"><span className="s">Connect a wallet to see on-chain history.</span></div>}

        {address && rows === null && !error && (
          <div className="row"><span className="s">Fetching on-chain history…</span></div>
        )}
        {error && <div className="row"><span className="s" style={{ color: "var(--amber-ink)" }}>Chain read failed: {error}</span></div>}
        {rows !== null && rows.length === 0 && (
          <div className="row"><span className="s">No on-chain transactions yet for this address.</span></div>
        )}

        {visible.map((t) => (
          <TxRow key={t.digest} t={t} mode={mode} />
        ))}

        {collapsible && (rows?.length ?? 0) > 3 && (
          <div style={{ padding: "6px 12px 10px" }}>
            <button className="btn sm subtle" onClick={() => setExpanded(!expanded)}>
              {expanded ? "▲ Show less" : `▼ Show more (${(rows?.length ?? 0) - 3} earlier)`}
            </button>
          </div>
        )}

        {sims.length > 0 && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 4 }}>
            {sims.map((p) => (
              <div key={p.id + p.ts} className="row" style={{ opacity: 0.75 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="t">{p.label}</span>
                    <span className="chip amber" style={{ fontSize: 9.5, padding: "1px 6px" }}>SIM</span>
                  </div>
                  <div className="s">
                    {p.provider} · {new Date(p.ts).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div className="v">{rm(p.refund ? p.amount - p.refund : p.amount)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
