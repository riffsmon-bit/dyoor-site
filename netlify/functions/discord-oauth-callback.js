import { ensureUser } from "./_verify/linking.js";
import { consumeOAuthState } from "./_verify/oauth-state.js";
import {
  assertMethod,
  buildSessionCookie,
  clearOAuthStateCookie,
  readOAuthStateCookie,
  redirect,
  safeReturnTo,
} from "./_verify/http.js";
import { createSession } from "./_verify/session.js";
import { ensureDyoorified, fetchDiscordOAuthUser } from "./_verify/discord.js";
import { recordVerificationAudit } from "./_verify/audit.js";

function destination(returnTo, key, value) {
  const url = new URL(safeReturnTo(returnTo), "https://dyoor.fun");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export const handler = async (event) => {
  let returnTo = "/discord/verify";
  try {
    assertMethod(event, "GET");
    const suppliedState = String(event?.queryStringParameters?.state || "");
    const browserState = readOAuthStateCookie(event);
    if (!browserState || browserState !== suppliedState) {
      throw Object.assign(new Error("The Discord sign-in browser binding is invalid or expired."), { status: 401 });
    }
    const state = await consumeOAuthState(suppliedState);
    if (!state) throw Object.assign(new Error("The Discord sign-in request expired or was already used."), { status: 401 });
    returnTo = state.returnTo;
    const code = String(event?.queryStringParameters?.code || "");
    if (!code) throw Object.assign(new Error("Discord did not return an authorization code."), { status: 401 });
    const discordUser = await fetchDiscordOAuthUser(code);
    await ensureDyoorified(discordUser.id);
    await ensureUser(discordUser);
    const sessionId = await createSession(discordUser);
    await recordVerificationAudit("DYOORIFIED", discordUser.id, { source: "discord-oauth" });
    return {
      ...redirect(destination(returnTo, "discord", "verified")),
      multiValueHeaders: {
        "set-cookie": [clearOAuthStateCookie(), buildSessionCookie(sessionId)],
      },
    };
  } catch (error) {
    return redirect(
      destination(returnTo, "discord_error", String(error?.message || "Discord verification failed.").slice(0, 160)),
      { "set-cookie": clearOAuthStateCookie() },
    );
  }
};
