import crypto from "node:crypto";
import { getVerifyConfig } from "./config.js";
import { deleteKey, getJson, setJson } from "./storage.js";
import { safeReturnTo } from "./http.js";

export async function createOAuthState(returnTo = "/discord/verify") {
  const state = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  await setJson(`oauth/${state}.json`, {
    version: 2,
    guildId: getVerifyConfig().discord.guildId,
    returnTo: safeReturnTo(returnTo),
    createdAt: now,
    expiresAt: now + 10 * 60_000,
  });
  return state;
}

export async function consumeOAuthState(stateValue) {
  const state = String(stateValue || "");
  if (!/^[a-f0-9]{48}$/.test(state)) return null;
  const key = `oauth/${state}.json`;
  const payload = await getJson(key, null);
  await deleteKey(key).catch(() => undefined);
  if (
    !payload
    || payload.version !== 2
    || payload.guildId !== getVerifyConfig().discord.guildId
    || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt <= Date.now()
  ) return null;
  return { ...payload, returnTo: safeReturnTo(payload.returnTo) };
}
