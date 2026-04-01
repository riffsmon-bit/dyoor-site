const { json } = require('./_verify/http');
const { getSessionFromEvent } = require('./_verify/session');
const { getLinkByDiscordUserId, saveLink } = require('./_verify/linking');
const { getVerificationSnapshot } = require('./_verify/chain');
const { syncDiscordMemberRoles } = require('./_verify/discord');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const { session } = await getSessionFromEvent(event);
    if (!session?.discordUser) return json(401, { error: 'Connect Discord first.' });

    const link = await getLinkByDiscordUserId(session.discordUser.id);
    if (!link?.wallet) return json(400, { error: 'No linked wallet found for this Discord account.' });

    const snapshot = await getVerificationSnapshot(link.wallet);
    await syncDiscordMemberRoles(session.discordUser.id, snapshot);
    await saveLink({ discordUser: session.discordUser, wallet: link.wallet, snapshot });

    return json(200, {
      message: 'Roles refreshed successfully.',
      discordUser: session.discordUser,
      wallet: link.wallet,
      snapshot,
    });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
