const { getAddress, isAddress } = require('viem');

function normalizeAddress(address) {
  if (!isAddress(address)) throw new Error('Invalid wallet address');
  return getAddress(address);
}

exports.handler = async function (event) {
  try {
    const cookieName = process.env.VERIFY_SESSION_COOKIE || 'dyoor_verify_session';
    const rawCookie = event.headers?.cookie || event.headers?.Cookie || '';

    function getCookie(name) {
      const parts = rawCookie.split(';').map((p) => p.trim());
      for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k === name) return decodeURIComponent(v);
      }
      return '';
    }

    const sessionEncoded = getCookie(cookieName);

    if (!sessionEncoded) {
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

    let session;
    try {
      session = JSON.parse(Buffer.from(sessionEncoded, 'base64url').toString('utf8'));
    } catch (e) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Invalid Discord session cookie'
        })
      };
    }

    if (!session?.discordUserId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Discord user missing from session'
        })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    let wallet;
    try {
      wallet = normalizeAddress(String(body.wallet || '').trim());
    } catch (e) {
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

    const crypto = require('crypto');
    const nonce = crypto.randomBytes(16).toString('hex');
    const ttlSeconds = Number(process.env.VERIFY_NONCE_TTL_SECONDS || '900');
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const chainId = Number(process.env.CHAIN_ID || '143');

    const noncePayload = {
      discordUserId: session.discordUserId,
      username: session.username || session.globalName || 'unknown',
      wallet,
      nonce,
      expiresAt
    };

    const nonceCookieValue = Buffer.from(JSON.stringify(noncePayload)).toString('base64url');

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

    const nonceCookieName = 'dyoor_verify_nonce';
    const nonceCookie = `${nonceCookieName}=${encodeURIComponent(nonceCookieValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds}`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': nonceCookie
      },
      multiValueHeaders: {
        'Set-Cookie': [nonceCookie]
      },
      body: JSON.stringify({
        ok: true,
        nonce,
        expiresAt,
        message
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
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
