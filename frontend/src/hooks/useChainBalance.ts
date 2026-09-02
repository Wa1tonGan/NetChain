import { useEffect, useState } from "react";
import { fetchChainBalance, type ChainBalance } from "../services/wallet";
import { useAppStore } from "../store/useAppStore";

/** Live on-chain balance for the connected zkLogin address, polled every 10 s.
    Returns null while no wallet is connected; ChainBalance.online signals
    whether the chain read succeeded. */
export function useChainBalance(): ChainBalance | null {
  const address = useAppStore((s) => s.zkLogin?.address ?? null);
  const [chain, setChain] = useState<ChainBalance | null>(null);

  useEffect(() => {
    if (!address) {
      setChain(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      const bal = await fetchChainBalance(address);
      if (alive) setChain(bal);
    };
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [address]);

  return chain;
}

/** Compact headline for the nav pill / cards: stablecoin when held, else SUI
    gas, or "···" while the chain is unreachable. */
export function chainBalanceText(chain: ChainBalance | null): string {
  if (!chain?.online) return "···";
  if (chain.stable) return `${chain.stable.total.toFixed(2)} ${chain.stable.label}`;
  return `${chain.sui.total.toFixed(3)} SUI`;
}
