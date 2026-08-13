import type { OwnedDroid, WalletPort } from "../types/wallet";

export async function validateOwnedSelection(
  wallet: WalletPort,
  tokenId: number,
  listedDroids: OwnedDroid[],
) {
  if (!wallet.available || wallet.kind === "unavailable") {
    return { valid: false, reason: "Wallet host is unavailable." };
  }
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > 3333) {
    return { valid: false, reason: "Token ID is outside the Season 2 range." };
  }
  if (!listedDroids.some((droid) => droid.tokenId === tokenId)) {
    return { valid: false, reason: "The token was not returned by verified ownership discovery." };
  }
  try {
    const stillOwned = await wallet.recheckOwnership(tokenId);
    return stillOwned
      ? { valid: true, reason: "" }
      : { valid: false, reason: "Ownership changed. Refresh the connected wallet." };
  } catch {
    return { valid: false, reason: "Ownership could not be rechecked." };
  }
}
