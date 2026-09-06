import crypto from "node:crypto";
import { getVerifyConfig } from "./config.js";
import { deleteKey, getJson, setJson } from "./storage.js";
import { readSessionId } from "./http.js";

function sessionKey(sessionId) {
  return `sessions/${sessionId}.json`;
}

export async function createSession(discordUser) {
  const config = getVerifyConfig();
  const sessionId = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  await setJson(sessionKey(sessionId), {
    version: 2,
    discordUser: {
      id: String(discordUser.id),
      username: String(discordUser.username || "Discord member").slice(0, 80),
      globalName: String(discordUser.global_name || "").slice(0, 80),
    },
    guildId: config.discord.guildId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + config.session.ttlMs,
  });
  return sessionId;
}

export async function getSessionById(sessionId) {
  if (!/^[a-f0-9]{48}$/.test(String(sessionId || ""))) return null;
  const key = sessionKey(sessionId);
  const session = await getJson(key, null);
  if (
    !session
    || session.version !== 2
    || session.guildId !== getVerifyConfig().discord.guildId
    || !/^\d{17,20}$/.test(String(session.discordUser?.id || ""))
    || !Number.isSafeInteger(session.expiresAt)
    || session.expiresAt <= Date.now()
  ) {
    await deleteKey(key).catch(() => undefined);
    return null;
  }
  return session;
}

export async function getSessionFromEvent(event) {
  const sessionId = readSessionId(event);
  return { sessionId, session: await getSessionById(sessionId) };
}

export async function requireSession(event) {
  const result = await getSessionFromEvent(event);
  if (!result.sessionId || !result.session) {
    throw Object.assign(new Error("Your Discord verification session expired. Sign in again."), { status: 401 });
  }
  return result;
}

export async function deleteSession(sessionId) {
  if (sessionId) await deleteKey(sessionKey(sessionId));
}
