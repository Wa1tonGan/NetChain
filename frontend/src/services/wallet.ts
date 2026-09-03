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

export interface ChainBalance {
  sui: { total: number };
  stable: { total: number; coinType: string; label: string } | null;
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
  const out: ChainBalance = { sui: { total: 0 }, stable: null, online: false };

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
    }
    out.online = true;
  } catch {
    return out;
  }

  return out;
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
