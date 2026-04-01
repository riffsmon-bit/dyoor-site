const { discordBotToken, discordGuildId, holderRoleId, ascendedRoleId, twentyPlusRoleId, fiftyPlusRoleId } = require('./config');

async function discordFetch(path, init = {}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${discordBotToken}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API error ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function desiredRoleIds(snapshot) {
  const ids = [];
  if (snapshot.isHolder) ids.push(holderRoleId);
  if (snapshot.isAscended) ids.push(ascendedRoleId);
  if (snapshot.isTwentyPlus) ids.push(twentyPlusRoleId);
  if (snapshot.isFiftyPlus) ids.push(fiftyPlusRoleId);
  return ids;
}

async function syncDiscordMemberRoles(discordUserId, snapshot) {
  const member = await discordFetch(`/guilds/${discordGuildId}/members/${discordUserId}`);
  const currentRoles = new Set(member.roles || []);
  const managedRoleIds = [holderRoleId, ascendedRoleId, twentyPlusRoleId, fiftyPlusRoleId];
  const shouldHave = new Set(desiredRoleIds(snapshot));

  const add = [];
  const remove = [];

  for (const roleId of managedRoleIds) {
    if (shouldHave.has(roleId) && !currentRoles.has(roleId)) add.push(roleId);
    if (!shouldHave.has(roleId) && currentRoles.has(roleId)) remove.push(roleId);
  }

  if (add.length || remove.length) {
    await discordFetch(`/guilds/${discordGuildId}/members/${discordUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        roles: [...new Set([...member.roles.filter((id) => !remove.includes(id)), ...add])],
      }),
    });
  }

  return { add, remove };
}

module.exports = {
  syncDiscordMemberRoles,
};
