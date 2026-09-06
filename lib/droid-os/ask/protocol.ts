import { COLLECTION, type Operation } from "./schema.ts";
export function challengeMessage(c: { id: string; origin: string; expires: number; digest: string; owner: { block: number } }, op: Operation) {
  return [`dYØØR Droid OS — ${op.kind.toUpperCase()} (ASK ONLY)`, `Site: ${c.origin}`, `Wallet: ${op.wallet}`, `Chain: 143`, `Collection: ${COLLECTION}`, `Droid: ${op.tokenId}`, `Request hash: ${c.digest}`, `Nonce: ${c.id}`, `Ownership block: ${c.owner.block}`, `Expires: ${new Date(c.expires).toISOString()}`, "One request only. No transaction, token approval, financial permission or Energy charge.", "Chat content and saved training may be sent to the configured AI provider. Never include secrets."].join("\n");
}
