// Closed runtime schemas. These objects are application state, never wallet policy.
export const COLLECTION = "0x349d8eb480c92cf75371fba5c6344a4d11b9103a";
export const INTERESTS = ["NFTs", "Free mints", "Monad ecosystem", "Memecoin research", "Quests", "Contract research"] as const;
export type Preferences = { version: 1; interests: string[]; detail: "concise" | "detailed"; instructions: string };
export type Training = { version: 1; preferences: Preferences; missions: string[] };
export type Operation = { version: 1; wallet: string; tokenId: string } & (
  { kind: "load" } | { kind: "save"; revision: number; training: Training } |
  { kind: "chat"; revision: number; message: string }
);
export type ChatMessage = { role: "user" | "assistant"; text: string };
export type State = { version: 1; revision: number; training: Training; messages: ChatMessage[] };
export class AskError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AskError("Invalid object.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !(key in result))) throw new AskError("Unexpected or missing fields.");
  return result;
}
export function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new AskError("Invalid text length.");
  return value.trim();
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AskError("Invalid revision.");
  return value as number;
}
export function parseTraining(input: unknown): Training {
  const v = object(input, ["version", "preferences", "missions"]);
  const p = object(v.preferences, ["version", "interests", "detail", "instructions"]);
  if (v.version !== 1 || p.version !== 1 || !Array.isArray(p.interests) || p.interests.length > INTERESTS.length || p.interests.some(i => !INTERESTS.includes(i)) || new Set(p.interests).size !== p.interests.length || !["concise", "detailed"].includes(String(p.detail))) throw new AskError("Invalid training preferences.");
  if (!Array.isArray(v.missions) || v.missions.length > 5) throw new AskError("At most five research objectives are allowed.");
  return { version: 1, preferences: { version: 1, interests: [...p.interests], detail: p.detail as Preferences["detail"], instructions: text(p.instructions, 1000, true) }, missions: v.missions.map(m => text(m, 240)) };
}
export function parseOperation(input: unknown): Operation {
  const kind = (input as Record<string, unknown> | null)?.kind;
  const extras = kind === "save" ? ["revision", "training"] : kind === "chat" ? ["revision", "message"] : kind === "load" ? [] : null;
  if (!extras) throw new AskError("Only load, save and ASK chat are supported.");
  const v = object(input, ["version", "wallet", "tokenId", "kind", ...extras]);
  if (v.version !== 1 || typeof v.wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v.wallet) || typeof v.tokenId !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(v.tokenId) || BigInt(v.tokenId) >= 2n ** 256n) throw new AskError("Invalid Droid identity.");
  const base = { version: 1 as const, wallet: v.wallet.toLowerCase(), tokenId: v.tokenId };
  if (kind === "save") return { ...base, kind, revision: integer(v.revision), training: parseTraining(v.training) };
  if (kind === "chat") return { ...base, kind, revision: integer(v.revision), message: text(v.message, 1200) };
  return { ...base, kind: "load" };
}
export function emptyState(): State {
  return { version: 1, revision: 0, training: { version: 1, preferences: { version: 1, interests: [], detail: "concise", instructions: "" }, missions: [] }, messages: [] };
}
export function parseState(input: unknown): State {
  const v = object(input, ["version", "revision", "training", "messages"]);
  if (v.version !== 1 || !Array.isArray(v.messages) || v.messages.length > 12) throw new AskError("Stored training failed validation.", 503);
  return { version: 1, revision: integer(v.revision), training: parseTraining(v.training), messages: v.messages.map(m => {
    const item = object(m, ["role", "text"]);
    if (item.role !== "user" && item.role !== "assistant") throw new AskError("Invalid conversation role.", 503);
    return { role: item.role, text: text(item.text, 4000) };
  }) };
}
