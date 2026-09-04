/* Sui wallet connection via the Wallet Standard (@wallet-standard/app).
 *
 * Slush and other modern Sui extensions do NOT inject window.suiWallet —
 * they register through the wallet-standard registry, so detection must go
 * through getWallets(). The legacy window.suiWallet shape is kept as a
 * fallback for very old builds.
 *
 * The wallet owns its own keys and gas. The buyer flow: the trust server
 * builds the unsigned commit_as_buyer PTB (sender = wallet address), the
 * extension signs it, and the signed bytes are submitted over the JSON-RPC
 * proxy. Nothing here ever touches zkLogin material or server keys.
 */
import { getWallets } from "@wallet-standard/app";

export interface ConnectedWallet {
  name: string;
  address: string;
  /** sign only — returns raw signature + bytes for manual submission */
  sign: (bytes: Uint8Array) => Promise<{ signature: string; bytes: Uint8Array }>;
  /** sign + submit inside the wallet; resolves to the tx digest (when supported) */
  signAndExecute?: (bytes: Uint8Array) => Promise<string>;
}

interface WalletAccountLike {
  address: string;
}

interface WalletStandardLike {
  name: string;
  chains: readonly string[];
  features: Record<string, unknown>;
  accounts: readonly WalletAccountLike[];
}

interface LegacySuiWallet {
  name?: string;
  requestPermissions?: () => Promise<string[]>;
  getAccounts: () => Promise<{ address: string }[] | string[]>;
  signTransaction?: (input: {
    transaction?: Uint8Array;
    transactionBlockBytes?: Uint8Array;
    account?: { address: string };
  }) => Promise<{ signature: string; transactionBlockBytes?: Uint8Array; transaction?: Uint8Array }>;
  signAndExecuteTransaction?: (input: {
    transaction?: Uint8Array;
    transactionBlockBytes?: Uint8Array;
    account?: { address: string };
    chain?: string;
  }) => Promise<{ digest: string }>;
  signAndExecuteTransactionBlock?: (input: {
    transactionBlock: Uint8Array;
    account?: { address: string };
  }) => Promise<{ digest: string }>;
}

/** All registered wallets that speak Sui (chain ids starting with "sui:").
 *  getWallets() returns {register, get, on} — the wallets live under .get(). */
function standardSuiWallets(): WalletStandardLike[] {
  try {
    const wallets = getWallets().get();
    return Array.from(wallets ?? []).filter((w) =>
      (w.chains ?? []).some((c) => String(c).startsWith("sui:"))
    );
  } catch {
    return [];
  }
}

function legacySuiWallet(): LegacySuiWallet | null {
  const win = window as unknown as { suiWallet?: LegacySuiWallet; slush?: LegacySuiWallet };
  return win.suiWallet ?? win.slush ?? null;
}

/** Best-effort sync check for the login-page hint. Wallet registration can
 *  lag page load, so treat this as advisory — connectSuiWallet() retries. */
export function isSuiWalletAvailable(): boolean {
  return standardSuiWallets().length > 0 || legacySuiWallet() !== null;
}

/** Discover the Sui wallet, waiting briefly for late registration. */
function discoverSuiWallet(): WalletStandardLike | null {
  const wallets = standardSuiWallets();
  if (wallets.length === 0) return null;
  return wallets.find((w) => /slush/i.test(w.name)) ?? wallets[0];
}

/** Connect to the user's Sui wallet (Slush preferred when several exist).
 *  Tries a silent reconnect first — the approval popup only appears on a
 *  genuinely new connection. Late-arriving extensions are caught via the
 *  registry's 'register' event instead of pure polling. */
export async function connectSuiWallet(preferredAddress?: string): Promise<ConnectedWallet> {
  let wallet: WalletStandardLike | null = discoverSuiWallet();
  if (!wallet) {
    // Wait for extensions that register after this call — the registry fires
    // 'register' for each one, and getWallets() itself dispatched the
    // wallet-standard:app-ready event that makes loaded wallets register.
    await new Promise<void>((resolve) => {
      let done = false;
      const stop = () => {
        if (done) return;
        done = true;
        try {
          off();
        } catch {}
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        wallet = discoverSuiWallet();
        if (wallet) stop();
      };
      let off: () => void = () => {};
      try {
        const { on } = getWallets();
        const un = on("register", () => check());
        off = typeof un === "function" ? un : () => {};
      } catch {}
      const timer = setTimeout(stop, 2_500);
      check();
    });
  }

  if (!wallet) {
    const legacy = legacySuiWallet();
    if (legacy) return connectLegacy(legacy, preferredAddress);
    throw new Error(
      "No Sui wallet extension found — install Slush (https://slush.app), open it once, then retry"
    );
  }
  const connected: WalletStandardLike = wallet;

  const connectFeature = connected.features["standard:connect"] as
    | { connect: (input?: { silent?: boolean }) => Promise<{ accounts: WalletAccountLike[] }> }
    | undefined;
  if (!connectFeature) {
    throw new Error(`${wallet.name} does not expose the standard:connect feature`);
  }

  // Docs: wallets auto-restore previously authorized accounts on load; only
  // prompt when the array is empty. Slush resolves a silent connect() with
  // an EMPTY array for unauthorized dapps — an empty result must fall
  // through to the explicit connect() popup, not error out.
  let accounts: WalletAccountLike[] = [...(connected.accounts ?? [])];
  if (accounts.length === 0) {
    try {
      ({ accounts } = await connectFeature.connect({ silent: true }));
    } catch {}
  }
  if (accounts.length === 0) {
    ({ accounts } = await connectFeature.connect());
  }
  if (!accounts?.length) {
    throw new Error(`${connected.name} returned no accounts — approve the connection in the wallet popup`);
  }
  const account = accounts.find((a) => a.address === preferredAddress) ?? accounts[0];

  const signFeature = connected.features["sui:signTransaction"] as
    | {
        signTransaction: (input: {
          transaction?: Uint8Array | unknown;
          account: unknown;
          chain?: string;
        }) => Promise<{ signature: Uint8Array | string; bytes?: string; transactionBlockBytes?: Uint8Array }>;
      }
    | undefined;
  const execFeature = connected.features["sui:signAndExecuteTransaction"] as
    | {
        signAndExecuteTransaction: (input: {
          transaction?: Uint8Array | unknown;
          transactionBlock?: Uint8Array;
          account: unknown;
          chain?: string;
          options?: Record<string, boolean>;
        }) => Promise<{ digest?: string; transaction?: { digest?: string } }>;
      }
    | undefined;
  // Legacy (pre-rename) features many wallets still ship.
  const legacySignFeature = connected.features["sui:signTransactionBlock"] as
    | {
        signTransactionBlock: (input: {
          transactionBlock: Uint8Array;
          account: unknown;
        }) => Promise<{ signature: Uint8Array | string; transactionBlockBytes?: Uint8Array; bytes?: string }>;
      }
    | undefined;
  const legacyExecFeature = connected.features["sui:signAndExecuteTransactionBlock"] as
    | {
        signAndExecuteTransactionBlock: (input: {
          transactionBlock: Uint8Array;
          account: unknown;
        }) => Promise<{ digest?: string; transaction?: { digest?: string } }>;
      }
    | undefined;

  if (!signFeature && !execFeature && !legacySignFeature && !legacyExecFeature) {
    throw new Error(`${wallet.name} exposes no Sui signing feature`);
  }

  const sigToString = (sig: Uint8Array | string): string => {
    if (typeof sig === "string") return sig;
    let bin = "";
    for (let i = 0; i < sig.length; i += 0x8000) bin += String.fromCharCode(...sig.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  return {
    name: wallet.name,
    address: account.address,
    sign: async (bytes) => {
      const feature = signFeature ?? legacySignFeature;
      if (!feature) throw new Error(`${connected.name} does not support sign-only transactions`);
      // Current wallets (Slush) expect a Transaction OBJECT as `transaction` —
      // they call .toJSON() on it; a raw Uint8Array has no toJSON and crashes.
      // Older wallets want raw bytes under `transactionBlock`.
      const { Transaction } = await import("@mysten/sui/transactions");
      const tx = Transaction.from(bytes);
      const signed = legacySignFeature && !signFeature
        ? await (feature as typeof legacySignFeature).signTransactionBlock({ transactionBlock: bytes, account })
        : await (feature as NonNullable<typeof signFeature>).signTransaction({
            transaction: tx,
            account,
            chain: "sui:testnet",
          });
      if (!signed?.signature) throw new Error(`${connected.name} returned no signature`);
      const signedBytes = signed.bytes
        ? new Uint8Array(atob(signed.bytes).split("").map((c) => c.charCodeAt(0)))
        : signed.transactionBlockBytes ?? bytes;
      return {
        signature: sigToString(signed.signature),
        bytes: signedBytes,
      };
    },
    signAndExecute: execFeature
      ? async (bytes) => {
          const { Transaction } = await import("@mysten/sui/transactions");
          const tx = Transaction.from(bytes);
          let res;
          try {
            res = await execFeature.signAndExecuteTransaction({
              transaction: tx,
              account,
              chain: "sui:testnet",
            });
          } catch {
            // Older wallets want raw bytes under the legacy key.
            res = await execFeature.signAndExecuteTransaction({ transactionBlock: bytes, account });
          }
          const digest = res?.digest ?? res?.transaction?.digest;
          if (!digest) throw new Error(`${connected.name} returned no digest`);
          return digest;
        }
      : legacyExecFeature
        ? async (bytes) => {
            const res = await legacyExecFeature.signAndExecuteTransactionBlock({ transactionBlock: bytes, account });
            const digest = res?.digest ?? res?.transaction?.digest;
            if (!digest) throw new Error(`${connected.name} returned no digest`);
            return digest;
          }
        : undefined,
  };
}

/** Pre-standard injected window (old Sui Wallet builds). */
function connectLegacy(legacy: LegacySuiWallet, preferredAddress: string | undefined): ConnectedWallet {
  if (legacy.requestPermissions) {
    void legacy.requestPermissions().catch(() => {});
  }
  return {
    name: legacy.name ?? "Sui Wallet",
    address: "", // filled by ensureLegacyAccount on first use
    sign: async (bytes) => {
      const account = await ensureLegacyAccount(legacy, preferredAddress);
      if (!legacy.signTransaction) throw new Error("legacy wallet has no signTransaction");
      const signed = await legacy.signTransaction({ transaction: bytes, transactionBlockBytes: bytes, account });
      if (!signed?.signature) throw new Error("wallet returned no signature");
      return { signature: signed.signature, bytes: signed.transactionBlockBytes ?? signed.transaction ?? bytes };
    },
    signAndExecute: legacy.signAndExecuteTransaction
      ? async (bytes) => {
          const account = await ensureLegacyAccount(legacy, preferredAddress);
          const res =
            (await legacy.signAndExecuteTransaction!({ transaction: bytes, transactionBlockBytes: bytes, account })) ??
            (await legacy.signAndExecuteTransactionBlock?.({ transactionBlock: bytes, account }));
          if (!res?.digest) throw new Error("wallet returned no digest");
          return res.digest;
        }
      : legacy.signAndExecuteTransactionBlock
        ? async (bytes) => {
            const account = await ensureLegacyAccount(legacy, preferredAddress);
            const res = await legacy.signAndExecuteTransactionBlock!({ transactionBlock: bytes, account });
            if (!res?.digest) throw new Error("wallet returned no digest");
            return res.digest;
          }
        : undefined,
  };
}

async function ensureLegacyAccount(legacy: LegacySuiWallet, preferredAddress: string | undefined): Promise<{ address: string }> {
  const accounts = await legacy.getAccounts();
  const normalized = (accounts ?? []).map((a) => (typeof a === "string" ? { address: a } : a));
  if (!normalized.length) throw new Error("wallet returned no accounts — unlock the extension and retry");
  return normalized.find((a) => a.address === preferredAddress) ?? normalized[0];
}

/** Sign the trust-server-built PTB with the connected wallet and submit it.
 *  Prefers the wallet's atomic sign-and-execute; falls back to sign + manual
 *  submission over the JSON-RPC proxy. Returns the digest. */
export async function walletSignAndSubmit(wallet: ConnectedWallet, txBytesBase64: string): Promise<{ digest: string }> {
  if (!wallet.signAndExecute) {
    throw new Error(`${wallet.name} does not support sign-and-execute — reconnect the wallet`);
  }
  const bytes = new Uint8Array(atob(txBytesBase64).split("").map((c) => c.charCodeAt(0)));
  const digest = await wallet.signAndExecute(bytes);
  return { digest };
}
