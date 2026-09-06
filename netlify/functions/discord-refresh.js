import { evaluateAndSyncUser, publicUserStatus } from "./_verify/evaluator.js";
import { assertMethod, assertSameOrigin, json, safeHandlerError } from "./_verify/http.js";
import { ensureUser, getUser } from "./_verify/linking.js";
import { requireSession } from "./_verify/session.js";

export const handler = async (event) => {
  try {
    assertMethod(event, "POST");
    assertSameOrigin(event);
    const { session } = await requireSession(event);
    const user = await getUser(session.discordUser.id) || await ensureUser(session.discordUser);
    const synced = await evaluateAndSyncUser(user);
    return json(200, {
      ok: true,
      status: publicUserStatus(synced.user),
      roleSync: synced.roleSync,
    });
  } catch (error) {
    return safeHandlerError(error, "Discord roles could not be refreshed.");
  }
};
