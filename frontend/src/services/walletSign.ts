/* Sign + submit the trust server's built PTB with the USER'S OWN Sui wallet.
 *
 * This is the real-buyer signing path for the escrow commit: the server
 * builds the unsigned commit_as_buyer PTB with the user's wallet address as
 * sender (buyerAddress), and the user's wallet extension (Sui Wallet /
 * Slush / any Wallet-Standard wallet) signs it with THEIR key. The USDC is
 * deducted from the user's wallet; no platform key touches the payment.
 *
 * Two signing transports, in order of preference:
 *   1. Wallet Standard feature `sui:signAndExecuteTransaction` (Slush,
 *      Sui Wallet, most modern wallets — the wallet executes and returns
 *      the digest itself).
 *   2. Legacy `window.suiWallet.signTransactionBlock` (old Sui Wallet API —
 *      returns signature + bytes; we submit via the /suirpc proxy).
 */

export interface WalletSignResult {
	digest: string;
}

interface WalletStandardAccount {
	address: string;
}

interface WalletStandardWallet {
	name: string;
	accounts?: WalletStandardAccount[];
	features?: Record<string, any>;
}

function getRegisteredWallets(): WalletStandardWallet[] {
	const w = window as unknown as {
		wallets?: WalletStandardWallet[] | { get: () => WalletStandardWallet[] };
	};
	if (Array.isArray(w.wallets)) return w.wallets;
	if (w.wallets && typeof w.wallets.get === "function") return w.wallets.get();
	return [];
}

export function isWalletAvailable(): boolean {
	const win = window as unknown as { suiWallet?: unknown };
	return getRegisteredWallets().some((w) => w.features?.["sui:signAndExecuteTransaction"]) || Boolean(win.suiWallet);
}

export async function walletSignAndSubmit(
	txBytesBase64: string,
	accountAddress: string
): Promise<WalletSignResult> {
	const { Transaction } = await import("@mysten/sui/transactions");
	const tx = Transaction.from(txBytesBase64);

	// --- 1. Wallet Standard path -------------------------------------------
	const stdWallet = getRegisteredWallets().find((w) => Boolean(w.features?.["sui:signAndExecuteTransaction"]));
	if (stdWallet?.features?.["sui:signAndExecuteTransaction"]) {
		const accounts: WalletStandardAccount[] = stdWallet.accounts ?? [];
		const account = accounts.find((a) => a.address === accountAddress) ?? accounts[0];
		if (!account) {
			throw new Error(
				`connected wallet "${stdWallet.name}" has no account ${accountAddress.slice(0, 10)}… — switch accounts or reconnect`
			);
		}
		const feature = stdWallet.features["sui:signAndExecuteTransaction"];
		const result = await feature.signAndExecuteTransaction({
			transaction: tx,
			account,
			chain: "sui:testnet",
		});
		return { digest: result.digest };
	}

	// --- 2. Legacy window.suiWallet path ------------------------------------
	const win = window as unknown as {
		suiWallet?: {
			signTransactionBlock: (input: {
				transactionBlock: string;
				account: string;
				chain: string;
			}) => Promise<{ signature: string; transactionBlock?: string }>;
		};
	};
	if (win.suiWallet?.signTransactionBlock) {
		const signed = await win.suiWallet.signTransactionBlock({
			transactionBlock: txBytesBase64,
			account: accountAddress,
			chain: "sui:testnet",
		});

		const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");
		const client = new SuiJsonRpcClient({ url: "/suirpc", network: "testnet" });
		const result = await client.executeTransactionBlock({
			transactionBlock: signed.transactionBlock ?? txBytesBase64,
			signature: signed.signature,
			options: { showEvents: true },
		});
		if (result.effects?.status?.status !== "success") {
			throw new Error(result.effects?.status?.error ?? "transaction failed on-chain");
		}
		return { digest: result.digest };
	}

	throw new Error(
		"no Sui wallet connected — install the Sui Wallet / Slush extension and connect it in the Account tab"
	);
}
