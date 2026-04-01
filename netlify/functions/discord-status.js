const { json } = require('./_verify/http');
const { getSessionFromEvent } = require('./_verify/session');
const { getLinkByDiscordUserId } = require('./_verify/linking');

exports.handler = async (event) => {
  try {
    const { session } = await getSessionFromEvent(event);
    if (!session?.discordUser) {
      return json(200, { discordUser: null, wallet: null, snapshot: null });
    }

    const link = await getLinkByDiscordUserId(session.discordUser.id);

    return json(200, {
      discordUser: session.discordUser,
      wallet: link?.wallet || session.wallet || null,
      snapshot: link?.snapshot || null,
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
