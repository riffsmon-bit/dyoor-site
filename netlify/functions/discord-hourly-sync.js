const { listByPrefix, getJson } = require('./_verify/storage');
const { getVerificationSnapshot } = require('./_verify/chain');
const { syncDiscordMemberRoles } = require('./_verify/discord');
const { saveLink } = require('./_verify/linking');

const withConcurrency = async (items, limit, worker) => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await worker(item);
    }
  });
  await Promise.all(runners);
};

exports.config = { schedule: '0 * * * *' };

exports.handler = async () => {
  const keys = await listByPrefix('link:discord:');
  const results = [];

  await withConcurrency(keys, 3, async (key) => {
    const link = await getJson(key, null);
    if (!link?.discordUser?.id || !link?.wallet) return;

    try {
      const snapshot = await getVerificationSnapshot(link.wallet);
      await syncDiscordMemberRoles(link.discordUser.id, snapshot);
      await saveLink({ discordUser: link.discordUser, wallet: link.wallet, snapshot });
      results.push({ discordUserId: link.discordUser.id, ok: true });
    } catch (error) {
      results.push({ discordUserId: link.discordUser.id, ok: false, error: error.message });
    }
  });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: true, checked: results.length, results }),
  };
};
