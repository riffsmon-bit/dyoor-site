import { getVerifyConfig } from "./_verify/config.js";
import {
  assertMethod,
  buildOAuthStateCookie,
  redirect,
  safeHandlerError,
  safeReturnTo,
} from "./_verify/http.js";
import { createOAuthState } from "./_verify/oauth-state.js";

export const handler = async (event) => {
  try {
    assertMethod(event, "GET");
    const config = getVerifyConfig();
    const returnTo = safeReturnTo(event?.queryStringParameters?.returnTo || "/discord/verify");
    const state = await createOAuthState(returnTo);
    const authorize = new URL("https://discord.com/oauth2/authorize");
    authorize.search = new URLSearchParams({
      client_id: config.discord.clientId,
      redirect_uri: config.discord.redirectUri,
      response_type: "code",
      scope: "identify",
      state,
    }).toString();
    return redirect(authorize.toString(), { "set-cookie": buildOAuthStateCookie(state) });
  } catch (error) {
    return safeHandlerError(error, "Discord sign-in could not be started.");
  }
};
