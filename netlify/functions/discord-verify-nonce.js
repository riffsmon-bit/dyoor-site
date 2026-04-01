const crypto = require('crypto');
const { json } = require('./_verify/http');
const { getSessionFromEvent, updateSession } = require('./_verify/session');
const { normalizeAddress } = require('./_verify/chain');
const config = require('./_verify/config');

function buildMessage({ discordUser, wallet, nonce, mode }) {
  return [
    'DYOOR Role Verification',
    `Discord User ID: ${discordUser.id}`,
    `Discord Username: ${discordUser.username}`,
    `Wallet: ${wallet}`,
    `Guild ID: ${config.discordGuildId}`,
    `Chain ID: ${config.chainId}`,
    `Mode: ${mode}`,
    `Nonce: ${nonce}`,
    'Purpose: Verify DYOOR holder roles on the official site',
  ].join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const { sessionId, session } = await getSessionFromEvent(event);
    if (!sessionId || !session?.discordUser) return json(401, { error: 'Connect Discord first.' });

    const body = JSON.parse(event.body || '{}');
    const wallet = normalizeAddress(body.wallet || '');
    const mode = body.mode === 'refresh' ? 'refresh' : 'verify';
    const nonce = crypto.randomBytes(18).toString('hex');
    const message = buildMessage({ discordUser: session.discordUser, wallet, nonce, mode });

    await updateSession(sessionId, {
      pendingNonce: nonce,
      pendingWallet: wallet,
      pendingMode: mode,
      pendingMessage: message,
      pendingCreatedAt: Date.now(),
    });

    return json(200, { wallet, nonce, message });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
