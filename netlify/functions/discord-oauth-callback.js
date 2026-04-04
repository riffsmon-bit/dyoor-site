exports.handler = async function (event) {
  try {
    const COOKIE_NAME = process.env.VERIFY_SESSION_COOKIE || 'dyoor_verify_session';

    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
    const discordRedirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!discordClientId) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: false, error: 'Missing DISCORD_CLIENT_ID' })
      };
    }

    if (!discordClientSecret) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: false, error: 'Missing DISCORD_CLIENT_SECRET' })
      };
    }

    if (!discordRedirectUri) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: false, error: 'Missing DISCORD_REDIRECT_URI' })
      };
    }

    const code =
      (event && event.queryStringParameters && event.queryStringParameters.code) || '';

    const state =
      (event && event.queryStringParameters && event.queryStringParameters.state) || '';

    if (!code) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ok: false, error: 'Missing OAuth code' })
      };
    }

    let returnTo = process.env.URL || 'https://dyoor.netlify.app/';

    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        if (parsed && parsed.returnTo) returnTo = parsed.returnTo;
      } catch (e) {
        // ignore bad state
      }
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: discordRedirectUri
      }).toString()
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok || !tokenJson.access_token) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          ok: false,
          error: 'Failed to exchange Discord OAuth code',
          details: tokenJson
        })
      };
    }

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`
      }
    });

    const meJson = await meRes.json();

    if (!meRes.ok || !meJson.id) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          ok: false,
          error: 'Failed to fetch Discord user profile',
          details: meJson
        })
      };
    }

    const sessionPayload = {
      discordUserId: meJson.id,
      username: meJson.username || '',
      globalName: meJson.global_name || '',
      avatar: meJson.avatar || '',
      linkedAt: Date.now()
    };

    const sessionValue = Buffer.from(
      JSON.stringify(sessionPayload)
    ).toString('base64url');

    const cookie = `${COOKIE_NAME}=${encodeURIComponent(sessionValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;

    return {
      statusCode: 302,
      headers: {
        Location: returnTo,
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie
      },
      multiValueHeaders: {
        'Set-Cookie': [cookie]
      },
      body: ''
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
        error: error && error.message ? error.message : 'discord-oauth-callback failed'
      })
    };
  }
};