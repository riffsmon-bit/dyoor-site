import { getVerifyConfig } from "./config.js";

export const managedRoleKeys = ["season1", "ascended", "season2", "hoodyoor"];

export async function discordFetch(path, init = {}) {
  const { botToken } = getVerifyConfig().discord;
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Discord API request failed (${response.status}).`), {
      status: response.status === 404 ? 404 : 502,
      discordStatus: response.status,
    });
  }
  return response.status === 204 ? null : response.json();
}

export async function getDiscordGuildMember(discordUserId) {
  const { guildId } = getVerifyConfig().discord;
  return discordFetch(`/guilds/${guildId}/members/${discordUserId}`);
}

async function addRole(discordUserId, roleId) {
  const { guildId } = getVerifyConfig().discord;
  await discordFetch(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: "PUT",
  });
}

async function removeRole(discordUserId, roleId) {
  const { guildId } = getVerifyConfig().discord;
  await discordFetch(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: "DELETE",
  });
}

export async function ensureDyoorified(discordUserId) {
  const member = await getDiscordGuildMember(discordUserId);
  const roleId = getVerifyConfig().discord.roles.dyoorified;
  if (!(member.roles || []).includes(roleId)) await addRole(discordUserId, roleId);
  return member;
}

export async function syncDiscordMemberRoles(discordUserId, desired) {
  const config = getVerifyConfig();
  const member = await getDiscordGuildMember(discordUserId);
  const current = new Set(member.roles || []);
  const added = [];
  const removed = [];
  if (!current.has(config.discord.roles.dyoorified)) {
    await addRole(discordUserId, config.discord.roles.dyoorified);
    current.add(config.discord.roles.dyoorified);
    added.push("dyoorified");
  }
  for (const key of managedRoleKeys) {
    const decision = desired[key];
    const roleId = config.discord.roles[key];
    if (decision === true && !current.has(roleId)) {
      await addRole(discordUserId, roleId);
      current.add(roleId);
      added.push(key);
    } else if (decision === false && current.has(roleId)) {
      await removeRole(discordUserId, roleId);
      current.delete(roleId);
      removed.push(key);
    }
  }
  return { added, removed, preserved: managedRoleKeys.filter((key) => desired[key] === "PRESERVE") };
}

export async function fetchDiscordOAuthUser(code) {
  const config = getVerifyConfig();
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.discord.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    throw Object.assign(new Error("Discord OAuth authorization was rejected."), { status: 401 });
  }
  const token = await tokenResponse.json();
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) {
    throw Object.assign(new Error("Discord identity could not be verified."), { status: 401 });
  }
  const user = await userResponse.json();
  if (!/^\d{17,20}$/.test(String(user.id || ""))) {
    throw Object.assign(new Error("Discord returned an invalid identity."), { status: 401 });
  }
  await getDiscordGuildMember(user.id).catch((error) => {
    if (error?.discordStatus === 404) {
      throw Object.assign(new Error("Join the official DYØØR Discord before verifying."), { status: 403 });
    }
    throw error;
  });
  return user;
}
