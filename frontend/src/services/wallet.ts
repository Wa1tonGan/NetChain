/* On-chain wallet reads + payment-coin lookup, via the Sui testnet JSON-RPC
   proxy at /suirpc (Vite proxies to sui-testnet-rpc.publicnode.com, which
   still serves JSON-RPC — the official fullnodes dropped it).

   Known-asset decimals are hardcoded (publicnode lacks sui_getCoinMetadata):
   SUI = 9, Circle USDC = 6, MYRC = 2. Balance math converts base units →
   whole coins with those scales.

   Endpoint quirk: untyped suix_getCoins dials a backing fullnode and times
   out on publicnode (-32701), while suix_getAllBalances and coin-type-scoped
   suix_getCoins are indexer-backed. Balance discovery therefore uses
   getAllBalances; coin-object lookup uses typed getCoins. */

export interface StableBalance {
  coinType: string;
  label: string;
  total: number;
}

export interface ChainBalance {
  sui: { total: number };
  stable: StableBalance | null;
  /** every known fungible asset the address holds (USDC, MYRC, SUI, …) */
  assets: StableBalance[];
  online: boolean;
}

const RPC_ENDPOINTS = ["/suirpc", "/suirpc-backup", "https://testnet.sui.rpcpool.com"];

const SUI_TYPE = "0x2::sui::SUI";
const STABLE_COINS: { match: RegExp; label: string; decimals: number }[] = [
  { match: /::myrc::MYRC$/i, label: "MYRC", decimals: 2 },
  { match: /::usdc::USDC$/i, label: "USDC", decimals: 6 },
];
const SUI_DECIMALS = 9;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`sui rpc ${method} → ${res.status}`);
      }

      const body = await res.json();

      if (body.error) {
        throw new Error(body.error.message ?? "rpc error");
      }

      return body.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "RPC request failed"));
}

interface BalanceEntry {
  coinType: string;
  totalBalance: string;
  coinObjectCount: number;
}

// Live reads on the zkLogin (or fallback) address: SUI gas + the first
// known stablecoin (USDC on testnet / MYRC on localnet), from one
// indexer-backed getAllBalances call. Network/endpoint errors set
// online:false so the UI falls back to the demo balance.
export async function fetchChainBalance(address: string): Promise<ChainBalance> {
  const out: ChainBalance = { sui: { total: 0 }, stable: null, assets: [], online: false };

  try {
    const balances = (await rpc("suix_getAllBalances", [address])) as BalanceEntry[];
    for (const entry of balances) {
      const total = Number(entry.totalBalance);
      if (entry.coinType === SUI_TYPE) {
        out.sui.total = total / 10 ** SUI_DECIMALS;
        continue;
      }
      // Prefer the first matching stablecoin; keep scanning if the match
      // holds a zero balance so a funded one still wins.
      const hit = STABLE_COINS.find((c) => c.match.test(entry.coinType));
      if (hit && total > 0 && !out.stable) {
        out.stable = {
          coinType: entry.coinType,
          label: hit.label,
          total: total / 10 ** hit.decimals,
        };
      }
      if (total > 0) {
        out.assets.push({
          coinType: entry.coinType,
          label: hit?.label ?? shortCoinType(entry.coinType),
          total: total / 10 ** (hit?.decimals ?? 9),
        });
      }
    }
    if (out.sui.total > 0) {
      out.assets.push({ coinType: SUI_TYPE, label: "SUI", total: out.sui.total });
    }
    out.online = true;
  } catch {
    return out;
  }

  return out;
}

/** Unrecognized coin type → short display label from its module::NAME tail. */
function shortCoinType(coinType: string): string {
  const tail = coinType.split("::").slice(-2).join(" ");
  return tail.length <= 10 ? tail : tail.slice(0, 10);
}

// Shared escrow pool (testnet deployment) — agent-mode commits draw from it.
const ESCROW_OBJECT = "0x9c4c5958a942daba695b1a6cfceeec7bf522ed25bc7d55fc5f4d2d828c2a6a63";
const USDC_DECIMALS = 6;

/** The shared escrow pool's available balance in whole USDC — the money user
 *  deposits and agent-mode commits spend. null when the chain read fails. */
export async function fetchEscrowPoolBalance(): Promise<number | null> {
  try {
    const res = await rpc("sui_getObject", [ESCROW_OBJECT, { showContent: true }]);
    const fields = (res as { data?: { content?: { fields?: { available?: string } } } }).data?.content?.fields;
    if (!fields?.available) return null;
    return Number(fields.available) / 10 ** USDC_DECIMALS;
  } catch {
    return null;
  }
}

/* ---------------- on-chain tx history (the chain IS the ledger) ----------- */

export interface OnChainTx {
  digest: string;
  tsMs: number | null;
  /** human label derived from the Move function actually called */
  kind: string;
  /** raw escrow action word — commit / settle / reclaim / deposit / transfer */
  fn: string;
  /** signed USDC flow for this address (− lock, + reclaim) */
  amountUsdc: number | null;
  gasSui: number | null;
}

const ESCROW_PKG_PREFIX = "0x531c16cde1a45391ab90f21c9f1e3f06ae3d2965965caee5c3de608a5ed50170";
const KIND_BY_FN: Record<string, string> = {
  commit: "Escrow commit",
  commit_as_buyer: "Escrow commit",
  settle: "Settlement (split)",
  refund: "Escrow refund",
  reclaim: "Escrow reclaim (expired)",
  deposit: "Top up",
};

interface SuiTxResponseBlock {
  digest: string;
  timestampMs?: string | number | null;
  transaction?: {
    data?: {
      sender?: string;
      transaction?: {
        inputs?: Array<{
          type?: string;
          typeArg?: { balance?: string };
          reservation?: { maxAmountU64?: string };
          value?: unknown;
          valueType?: string;
        }>;
        transactions?: Array<{
          MoveCall?: {
            package?: string;
            module?: string;
            function?: string;
          };
        }>;
      };
    };
  };
  events?: Array<{
    type?: string;
    parsedJson?: Record<string, unknown>;
  }>;
  balanceChanges?: Array<{
    coinType?: string;
    amount?: string | number;
    owner?: Record<string, unknown>;
  }>;
  effects?: {
    gasUsed?: {
      computationCost?: string | number;
      storageCost?: string | number;
      storageRebate?: string | number;
    };
  };
}

interface CachedTxInfo {
  amountUsdc: number | null;
  gasSui: number | null;
  kind: string;
  fn: string;
  tsMs: number | null;
}

const TX_CACHE_STORAGE_KEY = "netchain_tx_cache_v1";

function loadTxCache(): Map<string, CachedTxInfo> {
  const map = new Map<string, CachedTxInfo>();
  if (typeof window === "undefined" || !window.sessionStorage) return map;
  try {
    const raw = window.sessionStorage.getItem(TX_CACHE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, CachedTxInfo>;
      for (const [digest, info] of Object.entries(parsed)) {
        if (info && info.amountUsdc != null) {
          map.set(digest, info);
        }
      }
    }
  } catch {
    // sessionStorage unavailable or private browsing mode
  }
  return map;
}

function saveTxCache(cache: Map<string, CachedTxInfo>): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const obj: Record<string, CachedTxInfo> = {};
    for (const [digest, info] of cache.entries()) {
      if (info && info.amountUsdc != null) {
        obj[digest] = info;
      }
    }
    window.sessionStorage.setItem(TX_CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // storage quota or private browsing mode
  }
}

const txDigestCache = loadTxCache();

interface ResolverGate<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function delay(ms: number): Promise<void> {
  const p = Promise as unknown as { withResolvers?: <T>() => ResolverGate<T> };
  if (typeof p.withResolvers === "function") {
    const { promise, resolve } = p.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rawRpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown;
  for (const endpoint of RPC_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let isIndexerLag = false;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          if ((res.status === 429 || res.status >= 500) && attempt === 0) {
            await delay(1000);
            continue;
          }
          throw new Error(`sui rawRpc ${method} on ${endpoint} → HTTP ${res.status}`);
        }

        const body = (await res.json()) as { error?: { message?: string }; result?: unknown };
        if (body.error) {
          const errMsg = body.error.message ?? `sui rawRpc ${method} error`;
          const lower = errMsg.toLowerCase();
          if (lower.includes("effect is empty") || (lower.includes("balance") && lower.includes("effect"))) {
            isIndexerLag = true;
          }
          throw new Error(errMsg);
        }
        return body.result;
      } catch (err) {
        lastErr = err;
        if (isIndexerLag) {
          // Healthy RPC node definitively reported transient indexer lag.
          // Fast-fail so caller can fall back immediately rather than wasting seconds.
          throw err;
        }
        if (attempt === 0) {
          await delay(1000);
          continue;
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "RPC request failed"));
}

/** Translates transient JSON-RPC indexer errors (e.g. empty effects before derivation)
 *  into clear, user-friendly messages for the UI. */
export function sanitizeRpcError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("effect is empty") || (lower.includes("balance") && lower.includes("effect"))) {
    return "Recent transactions are finalizing on Sui testnet";
  }
  return msg;
}

/** Full on-chain history for one address: everything it SENT plus everything
 *  it RECEIVED (reclaims land from the platform key). Fetched live from the
 *  testnet — survives refreshes, browsers and machines. */
export async function fetchAddressHistory(address: string, limit = 15): Promise<OnChainTx[]> {
  const lower = address.toLowerCase();
  const digests = new Set<string>();
  let successCount = 0;
  let lastQueryError: unknown = null;

  for (const filter of [{ FromAddress: address }, { ToAddress: address }]) {
    try {
      const page = (await rawRpc("suix_queryTransactionBlocks", [{ filter }, null, limit, true])) as {
        data?: { digest: string }[];
      };
      for (const t of page?.data ?? []) digests.add(t.digest);
      successCount++;
    } catch (e) {
      lastQueryError = e;
      // one direction failing shouldn't hide the other
    }
  }

  // If neither direction could be queried, do not claim empty history.
  if (successCount === 0) {
    const rawMsg = lastQueryError instanceof Error ? lastQueryError.message : String(lastQueryError);
    const friendly = sanitizeRpcError(lastQueryError);
    if (friendly !== rawMsg) {
      throw new Error(friendly);
    }
    throw (
      lastQueryError instanceof Error
        ? lastQueryError
        : new Error(`Failed to query transactions for ${address}: ${rawMsg}`)
    );
  }

  if (digests.size === 0) return [];

  const list = [...digests];
  const out: OnChainTx[] = [];
  let blockFetchError: unknown = null;

  for (let i = 0; i < list.length; i += 10) {
    const batchDigests = list.slice(i, i + 10);
    try {
      let blocks: SuiTxResponseBlock[] | null | undefined;
      try {
        blocks = (await rawRpc("sui_multiGetTransactionBlocks", [
          batchDigests,
          { showInput: true, showBalanceChanges: true, showEffects: true, showEvents: true },
        ])) as SuiTxResponseBlock[] | null | undefined;
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr ?? "");
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes("effect is empty") || lowerMsg.includes("balance")) {
          // Transient Sui indexer lag: retry batch with events & inputs so
          // transactions still load immediately with function, gas, ts, amounts, and digest.
          blocks = (await rawRpc("sui_multiGetTransactionBlocks", [
            batchDigests,
            { showInput: true, showEffects: true, showEvents: true },
          ])) as SuiTxResponseBlock[] | null | undefined;
        } else {
          throw batchErr;
        }
      }
      for (const b of blocks ?? []) {
        const calls = b.transaction?.data?.transaction?.transactions ?? [];
        // publicnode returns MoveCall as {package, module, function} — no
        // single `target` string.
        const escrowCall = calls
          .map((c) => c.MoveCall ?? {})
          .find((m) => (m.package ?? "").toLowerCase().startsWith(ESCROW_PKG_PREFIX));
        let fn = escrowCall?.function ?? null;
        let amountUsdc: number | null = null;

        // 1. Direct USDC balance changes
        const usdcChange = (b.balanceChanges ?? []).find(
          (c) =>
            String(c.coinType ?? "").toLowerCase().endsWith("::usdc::usdc") &&
            Object.values(c.owner ?? {}).some((v) => String(v).toLowerCase() === lower)
        );
        if (usdcChange) {
          amountUsdc = Number(usdcChange.amount) / 10 ** USDC_DECIMALS;
        }

        // 2. Escrow events fallback (emitted during execution, resilient to pruned/lagging object effects)
        if (amountUsdc === null) {
          const escrowEvent = (b.events ?? []).find(
            (e) => String(e.type ?? "").toLowerCase().includes("::escrow::") && e.parsedJson?.amount != null
          );
          if (escrowEvent) {
            const rawAmt = Number(escrowEvent.parsedJson?.amount) / 10 ** USDC_DECIMALS;
            const evType = String(escrowEvent.type).toLowerCase();
            if (evType.endsWith("::escrowfunded") || evType.endsWith("::committed")) {
              amountUsdc = -rawAmt; // Outgoing/locked funds
            } else if (evType.endsWith("::refunded") || evType.endsWith("::reclaimed")) {
              amountUsdc = rawAmt; // Incoming refund
            } else {
              amountUsdc = rawAmt;
            }
          }
        }

        // 3. PTB fundsWithdrawal inputs fallback (gasless balance withdrawal in PTB)
        if (amountUsdc === null) {
          const inputs = b.transaction?.data?.transaction?.inputs ?? [];
          const withdrawal = inputs.find(
            (inp) =>
              inp.type === "fundsWithdrawal" &&
              String(inp.typeArg?.balance ?? "").toLowerCase().endsWith("::usdc::usdc")
          );
          if (withdrawal && withdrawal.reservation?.maxAmountU64) {
            const rawAmt = Number(withdrawal.reservation.maxAmountU64) / 10 ** USDC_DECIMALS;
            const sender = String(b.transaction?.data?.sender ?? "").toLowerCase();
            amountUsdc = sender === lower ? -rawAmt : rawAmt;
          }
        }

        // 4. Cache fallback (previously derived immutable on-chain amount)
        const cached = txDigestCache.get(b.digest);
        if (amountUsdc === null && cached?.amountUsdc != null) {
          amountUsdc = cached.amountUsdc;
        }

        const gas = b.effects?.gasUsed;
        let gasSui = gas
          ? (Number(gas.computationCost) + Number(gas.storageCost) - Number(gas.storageRebate)) / 1e9
          : null;
        if (gasSui === null && cached?.gasSui != null) {
          gasSui = cached.gasSui;
        }

        let kind = fn ? (KIND_BY_FN[fn] ?? `escrow::${fn}`) : "Transfer";
        if (kind === "Transfer" && cached?.kind && cached.kind !== "Transfer") {
          kind = cached.kind;
          fn = cached.fn;
        }

        const tsMs = b.timestampMs ? Number(b.timestampMs) : (cached?.tsMs ?? null);

        // Store in cache once amountUsdc is resolved
        if (amountUsdc !== null) {
          txDigestCache.set(b.digest, { amountUsdc, gasSui, kind, fn: fn ?? "transfer", tsMs });
        }

        out.push({
          digest: b.digest,
          tsMs,
          kind,
          fn: fn ?? "transfer",
          amountUsdc,
          gasSui,
        });
      }
    } catch (e) {
      blockFetchError = e;
      // skip a failed batch if we already have some data
    }
  }

  // If there were digests but all block requests failed, rethrow instead of returning []
  if (list.length > 0 && out.length === 0 && blockFetchError) {
    const rawMsg = blockFetchError instanceof Error ? blockFetchError.message : String(blockFetchError);
    const friendly = sanitizeRpcError(blockFetchError);
    if (friendly !== rawMsg) {
      throw new Error(friendly);
    }
    throw (
      blockFetchError instanceof Error
        ? blockFetchError
        : new Error(`Failed to get transaction blocks: ${rawMsg}`)
    );
  }

  saveTxCache(txDigestCache);
  return out.sort((a, b) => (b.tsMs ?? 0) - (a.tsMs ?? 0));
}

/** The buyer's first spendable stablecoin object for escrow::commit_as_buyer's
    `payment: Coin<T>` argument; null when the wallet holds none. Discovers
    the coin type from getAllBalances, then fetches coin objects with a
    coin-type-scoped getCoins (the untyped form times out on publicnode). */
export async function fetchPaymentCoinId(address: string): Promise<{ coinId: string; coinType: string } | null> {
  try {
    const balances = (await rpc("suix_getAllBalances", [address])) as BalanceEntry[];
    const stable = balances.find(
      (entry) => Number(entry.totalBalance) > 0 && STABLE_COINS.some((c) => c.match.test(entry.coinType))
    );
    if (!stable) return null;

    const coins = (await rpc("suix_getCoins", [address, stable.coinType, null, 50])) as {
      data: { coinObjectId: string; balance: string }[];
    };
    for (const coin of coins.data ?? []) {
      if (Number(coin.balance) > 0) {
        return { coinId: coin.coinObjectId, coinType: stable.coinType };
      }
    }
    return null;
  } catch {
    return null;
  }
}
