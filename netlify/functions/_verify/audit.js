import crypto from "node:crypto";
import { setJson } from "./storage.js";

export async function recordVerificationAudit(event, discordUserId, details = {}) {
  const timestamp = Date.now();
  const id = crypto.randomBytes(8).toString("hex");
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/token|secret|signature|cookie|private/i.test(key)),
  );
  await setJson(`audit/${timestamp}-${id}.json`, {
    version: 2,
    event: String(event).slice(0, 80),
    discordUserId: String(discordUserId || "").slice(0, 24),
    at: timestamp,
    details: safeDetails,
  }).catch(() => undefined);
}
