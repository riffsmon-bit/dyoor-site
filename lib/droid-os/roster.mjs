export const SEASON_2_COLLECTION = "0x349d8eb480c92cf75371fba5c6344a4d11b9103a";

export function parseWalletRoster(payload, wallet) {
  if (!/^0x[a-f0-9]{40}$/.test(wallet) || payload?.ok !== true ||
      String(payload.wallet).toLowerCase() !== wallet ||
      String(payload.contractAddress).toLowerCase() !== SEASON_2_COLLECTION ||
      !Array.isArray(payload.tokenIds) || payload.tokenIds.length > 3333 ||
      payload.count !== payload.tokenIds.length) throw new Error("Unverified roster response");
  const ids = payload.tokenIds.map(String);
  if (ids.some(id => !/^[1-9][0-9]{0,3}$/.test(id) || Number(id) > 3333) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid roster token IDs");
  }
  return ids.sort((a, b) => Number(a) - Number(b));
}
