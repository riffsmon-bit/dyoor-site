import { getUser } from "./_verify/linking.js";
import { assertMethod, clearSessionCookie, json, safeHandlerError } from "./_verify/http.js";
import { getSessionFromEvent } from "./_verify/session.js";
import { publicUserStatus } from "./_verify/evaluator.js";

export const handler = async (event) => {
  try {
    assertMethod(event, "GET");
    const { session } = await getSessionFromEvent(event);
    if (!session) {
      return json(401, { ok: false, authenticated: false }, { "set-cookie": clearSessionCookie() });
    }
    const user = await getUser(session.discordUser.id);
    return json(200, {
      ok: true,
      authenticated: true,
      discordUser: session.discordUser,
      status: publicUserStatus(user),
    });
  } catch (error) {
    return safeHandlerError(error, "Discord verification status is unavailable.");
  }
};
