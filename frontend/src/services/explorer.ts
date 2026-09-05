export type ExplorerType = "suivision" | "suiscan";

export function getExplorerTxUrl(digest: string, explorer: ExplorerType = "suivision"): string {
  if (explorer === "suivision") {
    return `https://testnet.suivision.xyz/txblock/${digest}`;
  }
  return `https://suiscan.xyz/testnet/tx/${digest}`;
}

export function getExplorerAddressUrl(address: string, explorer: ExplorerType = "suivision"): string {
  if (explorer === "suivision") {
    return `https://testnet.suivision.xyz/address/${address}`;
  }
  return `https://suiscan.xyz/testnet/account/${address}`;
}

export function getExplorerName(explorer: ExplorerType): string {
  return explorer === "suivision" ? "SuiVision" : "Suiscan";
}
