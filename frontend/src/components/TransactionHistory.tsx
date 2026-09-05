import React, { useCallback, useEffect, useRef, useState } from "react";
import { fetchAddressHistory, sanitizeRpcError, type OnChainTx } from "../services/wallet";
import { useAppStore } from "../store/useAppStore";
import { rm } from "../services/pricing";
import {
  getExplorerTxUrl,
  getExplorerAddressUrl,
  getExplorerName,
  type ExplorerType,
} from "../services/explorer";
import Icon from "./Icon";

function fmtTs(tsMs: number | null): string {
  if (!tsMs) return "";
  const d = new Date(tsMs);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const PURCHASE_LABELS: Record<string, string> = {
  commit: "Bought network offer",
  commit_as_buyer: "Bought network offer",
  settle: "Offer settled",
  refund: "Offer refunded",
  reclaim: "Offer reclaimed (expired)",
};

function TxRow({
  t,
  mode,
  preferredExplorer,
}: {
  t: OnChainTx;
  mode?: "purchase";
  preferredExplorer: ExplorerType;
}) {
  const incoming = t.amountUsdc != null && t.amountUsdc > 0;
  const kindLabel = mode === "purchase" ? (PURCHASE_LABELS[t.fn] ?? t.kind) : t.kind;

  const txUrl = getExplorerTxUrl(t.digest, preferredExplorer);
  const otherExplorer: ExplorerType = preferredExplorer === "suivision" ? "suiscan" : "suivision";
  const otherTxUrl = getExplorerTxUrl(t.digest, otherExplorer);

  let statusNode: React.ReactNode;
  if (incoming) {
    statusNode = (
      <span
        className="chip good"
        style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, marginTop: 4 }}
      >
        IN <Icon name="check" size={10} />
      </span>
    );
  } else if (t.fn === "settle") {
    statusNode = (
      <span className="chip blue" style={{ fontSize: 10, marginTop: 4, fontWeight: 700 }}>
        SETTLED
      </span>
    );
  } else if (t.fn === "refund") {
    statusNode = (
      <span className="chip good" style={{ fontSize: 10, marginTop: 4, fontWeight: 700 }}>
        REFUNDED
      </span>
    );
  } else if (t.fn === "reclaim") {
    statusNode = (
      <span
        className="chip"
        style={{
          background: "rgba(245,158,11,0.12)",
          color: "#b45309",
          fontWeight: 700,
          fontSize: 10,
          marginTop: 4,
        }}
      >
        RECLAIMED
      </span>
    );
  } else if (t.amountUsdc != null && t.amountUsdc < 0) {
    statusNode = (
      <span
        className="chip"
        style={{
          background: "rgba(245,158,11,0.12)",
          color: "#b45309",
          fontWeight: 700,
          fontSize: 10,
          marginTop: 4,
        }}
      >
        LOCKED
      </span>
    );
  } else {
    statusNode = (
      <span
        className="chip neutral"
        style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, marginTop: 4 }}
      >
        OK <Icon name="check" size={10} />
      </span>
    );
  }

  return (
    <div
      className="row"
      style={{
        padding: "16px 20px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{kindLabel}</span>
          <span
            className="chip"
            style={{
              fontSize: 10,
              padding: "2px 8px",
              background: t.fn === "transfer" ? "var(--bg)" : "var(--blue-soft)",
              color: t.fn === "transfer" ? "var(--muted)" : "var(--blue)",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontWeight: 600,
            }}
          >
            {t.fn}
          </span>
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          {fmtTs(t.tsMs)}
          {t.gasSui != null ? ` · gas ${t.gasSui.toFixed(5)} SUI` : ""}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <a
            className="explorer-badge"
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              fontSize: 11,
              fontFamily: "ui-monospace, Menlo, monospace",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              textDecoration: "none",
              color: "var(--ink)",
            }}
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name={preferredExplorer} size={13} color="var(--blue)" />
            <span>
              {t.digest.slice(0, 10)}…{t.digest.slice(-6)}
            </span>
            <Icon name="external-link" size={11} color="var(--muted)" />
          </a>

          <a
            href={otherTxUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "3px 6px",
            }}
            title={`Open in ${getExplorerName(otherExplorer)}`}
          >
            <span>via {getExplorerName(otherExplorer)}</span>
            <Icon name="external-link" size={9} />
          </a>
        </div>
      </div>

      <div style={{ textAlign: "right", flex: "none" }}>
        {t.amountUsdc != null && t.amountUsdc !== 0 ? (
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: incoming ? "var(--green-ink)" : "var(--ink)",
            }}
          >
            {incoming ? "+" : ""}
            {rm(Math.abs(t.amountUsdc))}
          </div>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--muted)" }}>—</div>
        )}
        <div>{statusNode}</div>
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

/** On-chain transaction history fetched live from the Sui testnet
 *  (queryTransactionBlocks). Default owner = the connected wallet; pass
 *  ownerAddress to show another party (e.g. the platform operator). */
export default function TransactionHistory({
  ownerAddress,
  title,
  collapsible = false,
  mode,
}: Props) {
  const ownAddress = useAppStore((s) => s.zkLogin?.address ?? null);
  const localPayments = useAppStore((s) => s.payments);
  const preferredExplorer = useAppStore((s) => s.preferredExplorer);
  const setPreferredExplorer = useAppStore((s) => s.setPreferredExplorer);

  const address = ownerAddress ?? ownAddress;
  const [rows, setRows] = useState<OnChainTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const rowsRef = useRef<OnChainTx[] | null>(null);
  rowsRef.current = rows;

  const activeAddressRef = useRef<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const executeFetch = useCallback(
    (currentAddress: string, isManual = false) => {
      clearTimers();
      setIsSyncing(true);

      void fetchAddressHistory(currentAddress)
        .then((r) => {
          if (activeAddressRef.current !== currentAddress) return;
          setRows((prev) => {
            if (!prev || prev.length === 0) return r;
            if (r.length === 0) return prev;
            // Monotonic merge: never downgrade a resolved on-chain transaction!
            // If an existing transaction already had amountUsdc, gasSui, or tsMs,
            // preserve the resolved values even if a transient poll encountered indexer lag.
            const prevByDigest = new Map(prev.map((t) => [t.digest, t]));
            return r.map((newTx) => {
              const existing = prevByDigest.get(newTx.digest);
              if (!existing) return newTx;
              return {
                ...newTx,
                amountUsdc: newTx.amountUsdc ?? existing.amountUsdc,
                gasSui: newTx.gasSui ?? existing.gasSui,
                tsMs: newTx.tsMs ?? existing.tsMs,
                kind: (newTx.kind === "Transfer" && existing.kind !== "Transfer") ? existing.kind : newTx.kind,
                fn: (newTx.fn === "transfer" && existing.fn !== "transfer") ? existing.fn : newTx.fn,
              };
            });
          });
          setError(null);
          setIsSyncing(false);
          setRetryCount(0);

          // Schedule regular 20s background poll once loaded
          pollTimerRef.current = setInterval(() => {
            if (activeAddressRef.current === currentAddress) {
              executeFetch(currentAddress);
            }
          }, 20_000);
        })
        .catch((e) => {
          if (activeAddressRef.current !== currentAddress) return;
          const sanitized = sanitizeRpcError(e);
          const hasLoadedRows = (rowsRef.current?.length ?? 0) > 0;

          if (hasLoadedRows) {
            // Stale-while-revalidate: keep existing rows intact during background polling errors
            setIsSyncing(false);
            pollTimerRef.current = setInterval(() => {
              if (activeAddressRef.current === currentAddress) {
                executeFetch(currentAddress);
              }
            }, 20_000);
          } else {
            // Initial load failed: track retry and schedule fast auto-retry (2.5s to 5s)
            setError(sanitized);
            setIsSyncing(true);
            setRetryCount((prev) => {
              const nextCount = isManual ? 1 : prev + 1;
              const delayMs = Math.min(2500 + (nextCount - 1) * 1250, 5000);
              retryTimerRef.current = setTimeout(() => {
                if (activeAddressRef.current === currentAddress) {
                  executeFetch(currentAddress);
                }
              }, delayMs);
              return nextCount;
            });
          }
        });
    },
    [clearTimers]
  );

  useEffect(() => {
    activeAddressRef.current = address ?? null;
    clearTimers();
    if (!address) {
      setRows(null);
      setError(null);
      setIsSyncing(false);
      setRetryCount(0);
      return;
    }

    setRows(null);
    setError(null);
    setIsSyncing(true);
    setRetryCount(0);
    executeFetch(address);

    return () => {
      activeAddressRef.current = null;
      clearTimers();
    };
  }, [address, clearTimers, executeFetch]);

  const handleManualRetry = () => {
    if (!address) return;
    setError(null);
    setRetryCount(0);
    executeFetch(address, true);
  };

  // only meaningful for the wallet's own view; SIM runs never touch the chain
  const sims = ownerAddress ? [] : localPayments.filter((p) => !p.txDigest);
  const visible = collapsible && !expanded ? (rows ?? []).slice(0, 3) : rows ?? [];
  const resolvedTitle = title ?? (ownerAddress ? "Agent intent history" : "On-chain activity");

  return (
    <>
      <div
        className="card-title"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{resolvedTitle}</span>
          <span className={`chip ${isSyncing ? "amber" : "good"}`} style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span className={`dot ${isSyncing ? "recovering" : ""}`} /> {isSyncing ? "syncing with Sui testnet" : "live from Sui testnet"}
          </span>
          {address && (
            <a
              className="link-btn ghost"
              style={{
                fontSize: 10.5,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 6,
              }}
              href={getExplorerAddressUrl(address, preferredExplorer)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Account <Icon name="external-link" size={10} />
            </a>
          )}
        </div>

        {/* Explorer Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Explorer:</span>
          <div
            style={{
              display: "inline-flex",
              background: "rgba(0,0,0,0.06)",
              borderRadius: 6,
              padding: 2,
            }}
          >
            <button
              type="button"
              onClick={() => setPreferredExplorer("suivision")}
              style={{
                border: 0,
                background: preferredExplorer === "suivision" ? "#fff" : "transparent",
                boxShadow:
                  preferredExplorer === "suivision" ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
                color: preferredExplorer === "suivision" ? "var(--ink)" : "var(--muted)",
                fontSize: 11,
                fontWeight: preferredExplorer === "suivision" ? 700 : 500,
                padding: "3px 9px",
                borderRadius: 4,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                transition: "all 120ms ease",
              }}
            >
              <Icon name="suivision" size={12} />
              SuiVision
            </button>
            <button
              type="button"
              onClick={() => setPreferredExplorer("suiscan")}
              style={{
                border: 0,
                background: preferredExplorer === "suiscan" ? "#fff" : "transparent",
                boxShadow:
                  preferredExplorer === "suiscan" ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
                color: preferredExplorer === "suiscan" ? "var(--ink)" : "var(--muted)",
                fontSize: 11,
                fontWeight: preferredExplorer === "suiscan" ? 700 : 500,
                padding: "3px 9px",
                borderRadius: 4,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                transition: "all 120ms ease",
              }}
            >
              <Icon name="suiscan" size={12} />
              Suiscan
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {!address && (
          <div className="row" style={{ padding: "18px 20px" }}>
            <span className="s">Connect a wallet to see on-chain history.</span>
          </div>
        )}

        {address && rows === null && (
          <div className="row" style={{ padding: "18px 20px" }}>
            {error && retryCount >= 3 && !error.toLowerCase().includes("finaliz") ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  width: "100%",
                }}
              >
                <span
                  className="s"
                  style={{
                    color: "var(--muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span className="dot attention" />
                  Unable to connect to Sui testnet. Retrying automatically…
                </span>
                <button
                  type="button"
                  onClick={handleManualRetry}
                  className="link-btn ghost"
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--ink)",
                  }}
                >
                  Retry now
                </button>
              </div>
            ) : (
              <span
                className="s"
                style={{
                  color: "var(--muted)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span className="dot recovering" />
                Syncing latest transactions from Sui testnet… Recent activity will appear as soon as finalized.
              </span>
            )}
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="row" style={{ padding: "18px 20px" }}>
            <span className="s">No on-chain transactions yet for this address.</span>
          </div>
        )}

        {visible.map((t) => (
          <TxRow
            key={t.digest}
            t={t}
            mode={mode}
            preferredExplorer={preferredExplorer}
          />
        ))}

        {collapsible && (rows?.length ?? 0) > 3 && (
          <div style={{ padding: "12px 20px", textAlign: "center", borderTop: "1px solid var(--line)" }}>
            <button
              className="btn sm subtle"
              onClick={() => setExpanded(!expanded)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {expanded ? (
                <>Show less</>
              ) : (
                <>Show more ({(rows?.length ?? 0) - 3} earlier)</>
              )}
            </button>
          </div>
        )}

        {sims.length > 0 && (
          <div style={{ borderTop: "1px solid var(--line)" }}>
            {sims.map((p) => (
              <div
                key={p.id + p.ts}
                className="row"
                style={{ opacity: 0.75, padding: "14px 20px" }}
              >
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="t" style={{ fontWeight: 600 }}>{p.label}</span>
                    <span className="chip amber" style={{ fontSize: 9.5, padding: "1px 6px" }}>
                      SIM
                    </span>
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
