const { getJson, setJson } = require('./storage');

async function getLinkByDiscordUserId(discordUserId) {
  return getJson(`link:discord:${discordUserId}`, null);
}

async function getLinkByWallet(wallet) {
  return getJson(`link:wallet:${wallet.toLowerCase()}`, null);
}

async function saveLink({ discordUser, wallet, snapshot }) {
  const payload = {
    discordUser,
    wallet,
    snapshot,
    updatedAt: Date.now(),
  };

  await Promise.all([
    setJson(`link:discord:${discordUser.id}`, payload),
    setJson(`link:wallet:${wallet.toLowerCase()}`, payload),
  ]);

  return payload;
}

module.exports = {
  getLinkByDiscordUserId,
  getLinkByWallet,
  saveLink,
};
