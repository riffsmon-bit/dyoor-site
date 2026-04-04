const { getJson, setJson } = require('./_verify/storage');

function randomNonce(bytes = 16) {
  return require('crypto').randomBytes(bytes).toString('hex');
}

exports.handler = async function (event) {
  try {
    const cookieName = process.env.VERIFY_SESSION_COOKIE || 'dyoor_verify_session';
    const rawCookie = event.headers?.cookie || event.headers?.Cookie || '';

    const sessionCookie = rawCookie
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${cookieName}=`));

    if (!sessionCookie) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Discord session missing'
        })
      };
    }

    const encoded = decodeURIComponent(sessionCookie.split('=').slice(1).join('='));
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));

    if (!session?.discordUserId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Invalid Discord session'
        })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const wallet = String(body.wallet || '').trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Invalid wallet address'
        })
      };
    }

    const nonce = randomNonce(16);
    const ttlSeconds = Number(process.env.VERIFY_NONCE_TTL_SECONDS || '900');
    const expiresAt = Date.now() + ttlSeconds * 1000;

    await setJson(`nonce:${session.discordUserId}`, {
      discordUserId: session.discordUserId,
      wallet,
      nonce,
      expiresAt
    });

    const chainId = Number(process.env.CHAIN_ID || '143');

    const message = [
      'DYOOR Verification',
      `Discord User ID: ${session.discordUserId}`,
      `Discord Username: ${session.username || session.globalName || 'unknown'}`,
      `Wallet: ${wallet}`,
      `Guild ID: ${process.env.DISCORD_GUILD_ID}`,
      `Nonce: ${nonce}`,
      `Chain ID: ${chainId}`,
      'Purpose: Verify DYOOR holder roles'
    ].join('\n');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: true,
        message,
        nonce,
        expiresAt
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: false,
        error: error?.message || 'discord-verify-nonce failed'
      })
    };
  }
};