import { object, parseOperation, parseState, type Operation, type State } from "./schema.ts";
import { ASK_CHALLENGE_TTL_MS, challengeMessage } from "./protocol.ts";

export type AskProgress = "checking-owner" | "awaiting-signature" | "verifying-signature";
export type AskInput = Omit<Operation, "wallet" | "version"> | Record<string, unknown>;
export type AskClient = (input: AskInput, onProgress?: (stage: AskProgress) => void) => Promise<{ state: State; aiReady: boolean }>;

// No wall-clock comparison: device clocks need not match the server. The server
// remains authoritative for absolute expiry; the browser uses a conservative
// elapsed-time budget starting BEFORE challenge issuance, including network time.
export async function requestAsk(input: AskInput, deps: {
  address: string;
  origin: string;
  currentAddress: () => string;
  post: (body: unknown) => Promise<unknown>;
  signMessage: (message: string) => Promise<string>;
  onProgress?: (stage: AskProgress) => void;
  monotonicNow?: () => number;
}) {
  const operation = parseOperation({ ...input, wallet: deps.address, version: 1 });
  const now = deps.monotonicNow || (() => performance.now());
  const started = now();
  function checkElapsed() {
    const elapsed = now() - started;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= ASK_CHALLENGE_TTL_MS) throw new Error("ASK challenge timed out. Please retry for a fresh signature request.");
  }
  function checkWallet() {
    if (deps.currentAddress() !== operation.wallet) throw new Error("Wallet changed. Please retry. Nothing was submitted.");
  }
  checkWallet();
  deps.onProgress?.("checking-owner");
  const c = object(await deps.post({ stage: "challenge", operation }), ["id", "message", "issuedAt", "expires", "block"]);
  if (!Number.isSafeInteger(c.block) || Number(c.block) < 0
    || !Number.isSafeInteger(c.issuedAt) || Number(c.issuedAt) <= 0
    || !Number.isSafeInteger(c.expires) || Number(c.expires) > 8640000000000000
    || Number(c.expires) - Number(c.issuedAt) !== ASK_CHALLENGE_TTL_MS
    || typeof c.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.id)) throw new Error("Invalid ASK challenge. No signature was requested.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(operation))))].map(n => n.toString(16).padStart(2, "0")).join("");
  const expected = challengeMessage({ id: c.id, origin: deps.origin, expires: Number(c.expires), digest: hash, owner: { block: Number(c.block) } }, operation);
  if (c.message !== expected) throw new Error("ASK challenge does not match this request. No signature was requested.");
  checkElapsed(); checkWallet();
  deps.onProgress?.("awaiting-signature");
  const signature = await deps.signMessage(expected);
  checkElapsed(); checkWallet();
  deps.onProgress?.("verifying-signature");
  const result = object(await deps.post({ stage: "perform", operation, id: c.id, signature }), ["state", "aiReady"]);
  checkWallet();
  return { state: parseState(result.state), aiReady: result.aiReady === true };
}
