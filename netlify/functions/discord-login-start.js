exports.handler = async function (event) {
  try {
    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const discordRedirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!discordClientId) {
      return {
        statusCode: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Missing DISCORD_CLIENT_ID'
        })
      };
    }

    if (!discordRedirectUri) {
      return {
        statusCode: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        },
        body: JSON.stringify({
          ok: false,
          error: 'Missing DISCORD_REDIRECT_URI'
        })
      };
    }

    const returnTo =
      (event &&
        event.queryStringParameters &&
        event.queryStringParameters.returnTo) ||
      process.env.URL ||
      'https://dyoor.netlify.app/';

    const statePayload = {
      returnTo,
      t: Date.now()
    };

    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

    const authUrl = new URL('https://discord.com/oauth2/authorize');
    authUrl.searchParams.set('client_id', discordClientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', discordRedirectUri);
    authUrl.searchParams.set('scope', 'identify guilds');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'consent');

    return {
      statusCode: 302,
      headers: {
        location: authUrl.toString(),
        'cache-control': 'no-store'
      },
      body: ''
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      },
      body: JSON.stringify({
        ok: false,
        error: error && error.message ? error.message : 'discord-login-start failed'
      })
    };
  }
};