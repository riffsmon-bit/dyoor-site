import { getVerifyConfig } from "./_verify/config.js";
import { evaluateAndSyncUser } from "./_verify/evaluator.js";
import { json, safeHandlerError } from "./_verify/http.js";
import { listUsers } from "./_verify/linking.js";

export const config = { schedule: "0 * * * *" };

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

function authorized(event) {
  if (event?.next_run && !event?.httpMethod) return true;
  const secret = getVerifyConfig().sync.cronSecret;
  const supplied = String(event?.headers?.authorization || "");
  return Boolean(secret && supplied === `Bearer ${secret}`);
}

export const handler = async (event) => {
  try {
    if (!authorized(event)) return json(401, { ok: false, error: "Scheduled sync authorization required." });
    const config = getVerifyConfig();
    const users = await listUsers();
    const results = await mapConcurrent(users, config.sync.concurrency, async (user) => {
      try {
        const result = await evaluateAndSyncUser(user);
        return { discordUserId: user.discordUser.id, ok: true, roleSync: result.roleSync };
      } catch {
        return { discordUserId: user.discordUser.id, ok: false };
      }
    });
    return json(200, {
      ok: true,
      usersChecked: results.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
    });
  } catch (error) {
    return safeHandlerError(error, "Scheduled Discord role synchronization failed.");
  }
};
