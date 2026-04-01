const { json } = require('./_verify/http');
const { getSessionFromEvent, updateSession } = require('./_verify/session');
const { normalizeAddress, verifyWalletSignature, getVerificationSnapshot } = require('./_verify/chain');
const { saveLink, getLinkByWallet } = require('./_verify/linking');
const { syncDiscordMemberRoles } = require('./_verify/discord');
const config = require('./_verify/config');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const { sessionId, session } = await getSessionFromEvent(event);
    if (!sessionId || !session?.discordUser) return json(401, { error: 'Connect Discord first.' });

    const body = JSON.parse(event.body || '{}');
    const wallet = normalizeAddress(body.wallet || '');
    const signature = String(body.signature || '').trim();
    const message = String(body.message || '');

    if (!signature) return json(400, { error: 'Missing signature.' });
    if (!session.pendingNonce || !session.pendingWallet || !session.pendingMessage) return json(400, { error: 'Run verify again. Your sign request expired.' });
    if (wallet !== session.pendingWallet) return json(400, { error: 'Wallet does not match pending verification request.' });
    if (message !== session.pendingMessage) return json(400, { error: 'Signed message does not match the issued message.' });

    const ageMs = Date.now() - Number(session.pendingCreatedAt || 0);
    if (ageMs > config.nonceTtlSeconds * 1000) return json(400, { error: 'Verification request expired. Start again.' });

    const existing = await getLinkByWallet(wallet);
    if (existing?.discordUser?.id && existing.discordUser.id !== session.discordUser.id) {
      return json(409, { error: 'That wallet is already linked to another Discord account.' });
    }

    const valid = await verifyWalletSignature({ address: wallet, message, signature });
    if (!valid) return json(400, { error: 'Signature verification failed.' });

    const snapshot = await getVerificationSnapshot(wallet);
    await syncDiscordMemberRoles(session.discordUser.id, snapshot);
    await saveLink({ discordUser: session.discordUser, wallet, snapshot });
    await updateSession(sessionId, {
      wallet,
      pendingNonce: null,
      pendingWallet: null,
      pendingMode: null,
      pendingMessage: null,
      pendingCreatedAt: null,
    });

    return json(200, {
      message: body.mode === 'refresh' ? 'Roles refreshed successfully.' : 'Wallet verified and roles synced.',
      discordUser: session.discordUser,
      wallet,
      snapshot,
    });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
