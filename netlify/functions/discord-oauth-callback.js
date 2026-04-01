const config = require('./_verify/config');
const { redirect, buildSessionCookie, clearSessionCookie } = require('./_verify/http');
const { consumeOAuthState } = require('./_verify/oauth-state');
const { createSession } = require('./_verify/session');
const { getLinkByDiscordUserId } = require('./_verify/linking');

exports.handler = async (event) => {
  try {
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;
    if (!code || !state) return redirect('/?verifyError=Missing OAuth callback data', { 'Set-Cookie': clearSessionCookie() });

    const stateData = await consumeOAuthState(state);
    if (!stateData) return redirect('/?verifyError=OAuth state expired', { 'Set-Cookie': clearSessionCookie() });

    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.discordRedirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Discord token exchange failed: ${text}`);
    }

    const tokenData = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      const text = await userRes.text();
      throw new Error(`Discord user fetch failed: ${text}`);
    }

    const discordUser = await userRes.json();
    const link = await getLinkByDiscordUserId(discordUser.id);
    const sessionId = await createSession({ discordUser, wallet: link?.wallet || null });

    return redirect(stateData.returnTo || '/', {
      'Set-Cookie': buildSessionCookie(sessionId),
    });
  } catch (error) {
    return redirect(`/?verifyError=${encodeURIComponent(error.message)}`, {
      'Set-Cookie': clearSessionCookie(),
    });
  }
};
