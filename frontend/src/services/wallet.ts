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

const RPC = "/suirpc";

const SUI_TYPE = "0x2::sui::SUI";
const STABLE_COINS: { match: RegExp; label: string; decimals: number }[] = [
  { match: /::myrc::MYRC$/i, label: "MYRC", decimals: 2 },
  { match: /::usdc::USDC$/i, label: "USDC", decimals: 6 },
];
const SUI_DECIMALS = 9;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
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

async function rawRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result;
}

/** Full on-chain history for one address: everything it SENT plus everything
 *  it RECEIVED (reclaims land from the platform key). Fetched live from the
 *  testnet — survives refreshes, browsers and machines. */
export async function fetchAddressHistory(address: string, limit = 15): Promise<OnChainTx[]> {
  const lower = address.toLowerCase();
  const digests = new Set<string>();

  for (const filter of [{ FromAddress: address }, { ToAddress: address }]) {
    try {
      const page = (await rawRpc("suix_queryTransactionBlocks", [{ filter }, null, limit, true])) as {
        data?: { digest: string }[];
      };
      for (const t of page?.data ?? []) digests.add(t.digest);
    } catch {
      // one direction failing shouldn't hide the other
    }
  }
  if (digests.size === 0) return [];

  const list = [...digests];
  const out: OnChainTx[] = [];
  for (let i = 0; i < list.length; i += 10) {
    try {
      const blocks = (await rawRpc("sui_multiGetTransactionBlocks", [
        list.slice(i, i + 10),
        { showInput: true, showBalanceChanges: true, showEffects: true },
      ])) as any[];
      for (const b of blocks ?? []) {
        const calls: { MoveCall?: { package?: string; function?: string } }[] =
          b.transaction?.data?.transaction?.transactions ?? [];
        // publicnode returns MoveCall as {package, module, function} — no
        // single `target` string.
        const escrowCall = calls
          .map((c) => c.MoveCall ?? {})
          .find((m) => (m.package ?? "").toLowerCase().startsWith(ESCROW_PKG_PREFIX));
        const fn = escrowCall?.function ?? null;
        const usdcChange = (b.balanceChanges ?? []).find(
          (c: any) =>
            String(c.coinType ?? "").toLowerCase().endsWith("::usdc::usdc") &&
            Object.values(c.owner ?? {}).some((v) => String(v).toLowerCase() === lower)
        );
        const gas = b.effects?.gasUsed;
        out.push({
          digest: b.digest,
          tsMs: b.timestampMs ? Number(b.timestampMs) : null,
          kind: fn ? (KIND_BY_FN[fn] ?? `escrow::${fn}`) : "Transfer",
          fn: fn ?? "transfer",
          amountUsdc: usdcChange ? Number(usdcChange.amount) / 10 ** USDC_DECIMALS : null,
          gasSui: gas ? (Number(gas.computationCost) + Number(gas.storageCost) - Number(gas.storageRebate)) / 1e9 : null,
        });
      }
    } catch {
      // skip a failed batch — show what we have
    }
  }
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
