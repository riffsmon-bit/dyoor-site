import { json } from "./_quest/http.js";
import * as store from "./_quest/store.js";

export async function handler(event) {
  try {
    const wallet = event.queryStringParameters?.wallet || "";
    const user = wallet ? await store.ensureUser(wallet) : null;
    const [quests, completions, leaderboard] = await Promise.all([
      store.listQuests(),
      user ? store.listCompletions(user.id) : Promise.resolve([]),
      store.leaderboard(100),
    ]);
    const rank = user ? leaderboard.find((entry) => entry.wallet_address === user.wallet_address)?.rank || null : null;
    return json(200, { ok: true, user, quests, completions, rank, leaderboard });
  } catch (err) {
    return json(500, { ok: false, error: err.message || "Quest state failed." });
  }
}
