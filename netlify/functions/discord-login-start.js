const { redirect } = require('./_verify/http');
const { createOAuthState } = require('./_verify/oauth-state');
const config = require('./_verify/config');

exports.handler = async (event) => {
  try {
    const returnTo = event.queryStringParameters?.returnTo || '/';
    const state = await createOAuthState(returnTo);

    const params = new URLSearchParams({
      client_id: config.discordClientId,
      response_type: 'code',
      redirect_uri: config.discordRedirectUri,
      scope: 'identify',
      state,
      prompt: 'consent',
    });

    return redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  } catch (error) {
    return redirect(`/?verifyError=${encodeURIComponent(error.message)}`);
  }
};
