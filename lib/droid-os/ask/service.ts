import { createHash, randomUUID } from "node:crypto";
import { verifyMessage } from "ethers";
import { AskError, COLLECTION, emptyState, parseState, type Operation } from "./schema.ts";
import { takeSlot, type AskStore } from "./storage.ts";
import type { OwnerReader, OwnerEvidence } from "./ownership.ts";
import type { DroidIntelligenceOrchestrator } from "./intelligence.ts";
import { ASK_CHALLENGE_TTL_MS, challengeMessage } from "./protocol.ts";
type Challenge = { version: 1; id: string; digest: string; origin: string; expires: number; owner: OwnerEvidence; message: string; consumed: boolean };
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function createAskService(deps: { store: AskStore; owners: OwnerReader; intelligence: DroidIntelligenceOrchestrator; aiReady: boolean; now?: () => number }) {
  const { store, owners } = deps;
  const now = deps.now || Date.now;
  return {
    async challenge(origin: string, op: Operation) {
      if (op.kind === "chat" && !deps.aiReady) throw new AskError("AI is not configured yet. You can load and save training.", 503);
      const minute = Math.floor(now() / 60000);
      await takeSlot(store, `challenge-global/${minute}`, 30);
      await takeSlot(store, `challenge-owner/${op.wallet}/${minute}`, 6);
      const owner = await owners.current(op.tokenId);
      if (owner.owner !== op.wallet) throw new AskError("Only the current owner of this Droid can access its training.", 403);
      const issuedAt = now();
      const c: Challenge = { version: 1, id: randomUUID(), digest: digest(op), origin, expires: issuedAt + ASK_CHALLENGE_TTL_MS, owner, message: "", consumed: false };
      c.message = challengeMessage(c, op);
      if (!await store.put(`challenge/${c.id}`, c, null)) throw new AskError("Could not create a one-use challenge.", 503);
      return { id: c.id, message: c.message, issuedAt, expires: c.expires, block: owner.block };
    },
    async perform(origin: string, op: Operation, id: string, signature: string) {
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new AskError("Invalid owner proof.", 401);
      const entry = await store.get(`challenge/${id}`);
      const c = entry?.data as Challenge | undefined;
      if (!c || c.version !== 1 || c.consumed || c.id !== id || c.origin !== origin || c.digest !== digest(op) || c.expires <= now() || c.expires > now() + ASK_CHALLENGE_TTL_MS || c.owner.owner !== op.wallet || c.message !== challengeMessage(c, op)) throw new AskError("Proof expired, was used, or does not match this request.", 401);
      let signer = "";
      try { signer = verifyMessage(c.message, signature).toLowerCase(); } catch { /* deny */ }
      if (signer !== op.wallet) throw new AskError("Signature does not match the owner wallet. This canary supports EOA signatures only.", 401);
      if (!await store.put(`challenge/${id}`, { ...c, consumed: true }, entry!.etag)) throw new AskError("This proof was already used.", 401);
      await owners.unchanged(op.tokenId, c.owner);
      const key = `private/143/${COLLECTION}/${op.tokenId}/${op.wallet}`;
      const saved = await store.get(key);
      const state = saved ? parseState(saved.data) : emptyState();
      if (op.kind === "load") return { state, aiReady: deps.aiReady };
      if (op.revision !== state.revision) throw new AskError("Training changed in another tab. Load it again before saving or chatting.", 409);
      let next = { ...state, revision: state.revision + 1 };
      if (op.kind === "save") next = { ...next, training: op.training };
      else {
        if (!deps.aiReady) throw new AskError("AI is not configured yet.", 503);
        // Fixed immutable admissions cap all Droids together, not one process per Droid.
        await takeSlot(store, `chat-owner/${op.wallet}/${Math.floor(now() / 86400000)}`, 20);
        await takeSlot(store, `chat-global/${Math.floor(now() / 86400000)}`, 100);
        const limits = deps.intelligence.getAdmissionLimits();
        if (limits) {
          try {
            await takeSlot(store, `ai-budget/${limits.key}/minute/${Math.floor(now() / 60000)}`, limits.perMinute);
            await takeSlot(store, `ai-budget/${limits.key}/day/${Math.floor(now() / 86400000)}`, limits.perDay);
          } catch (error) {
            if (error instanceof AskError && error.status === 429) throw new AskError("Free AI preview limit reached (1 request/minute, 25/day shared). Please try later. No action occurred.", 429);
            throw error;
          }
        }
        const auditKey = `attempt/${id}`;
        if (!await store.put(auditKey, { version: 1, status: "STARTED", tokenId: op.tokenId, owner: op.wallet, at: now(), requestHash: c.digest }, null)) throw new AskError("AI attempt already exists.", 409);
        const result = await deps.intelligence.chat({ tokenId: op.tokenId, state, message: op.message });
        if (!await store.put(`usage/${id}`, { version: 1, ...result.usage, at: now() }, null)) throw new AskError("Could not record AI usage.", 503);
        await owners.unchanged(op.tokenId, c.owner);
        next = { ...next, messages: [...state.messages, { role: "user" as const, text: op.message }, { role: "assistant" as const, text: result.reply.text }].slice(-12) };
      }
      if (!await store.put(key, next, saved?.etag ?? null)) throw new AskError("Another request updated this Droid. Load again; your change was not saved.", 409);
      return { state: next, aiReady: deps.aiReady };
    },
  };
}
