import { json } from "./_quest/http.js";
import * as store from "./_quest/store.js";

export async function handler() {
  try {
    const leaderboard = await store.leaderboard(250);
    return json(200, { ok: true, leaderboard });
  } catch (err) {
    return json(500, { ok: false, error: err.message || "Leaderboard failed." });
  }
}
