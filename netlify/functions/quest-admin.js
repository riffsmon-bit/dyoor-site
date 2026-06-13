import { json, methodNotAllowed, parseBody } from "./_quest/http.js";
import { requireAdmin } from "./_quest/auth.js";
import * as store from "./_quest/store.js";

function pickWeightedWinners(entries, count) {
  const pool = entries
    .filter((entry) => Number(entry.total_points || 0) > 0)
    .map((entry) => ({ ...entry, weight: Number(entry.total_points || 0) }));
  const winners = [];
  const used = new Set();

  while (winners.length < count && used.size < pool.length) {
    const available = pool.filter((entry) => !used.has(entry.wallet_address));
    const total = available.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    const winner = available.find((entry) => {
      roll -= entry.weight;
      return roll <= 0;
    }) || available[available.length - 1];
    used.add(winner.wallet_address);
    winners.push(winner);
  }

  return winners;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return methodNotAllowed();
    const body = parseBody(event);
    requireAdmin(body);

    const action = String(body.action || "dashboard");
    if (action === "dashboard") {
      const data = await store.adminData();
      return json(200, { ok: true, ...data });
    }

    if (action === "save_quest") {
      const quest = await store.upsertQuest(body.quest || {});
      return json(200, { ok: true, quest });
    }

    if (action === "approve_completion" || action === "reject_completion") {
      const status = action === "approve_completion" ? "verified" : "rejected";
      const completion = await store.approveCompletion(String(body.completion_id || ""), status);
      return json(200, { ok: true, completion });
    }

    if (action === "pick_winners") {
      const count = Math.max(1, Math.min(100, Number(body.count || 1)));
      const leaderboard = await store.leaderboard(10000);
      return json(200, { ok: true, winners: pickWeightedWinners(leaderboard, count) });
    }

    return json(400, { ok: false, error: "Unknown admin action." });
  } catch (err) {
    return json(err.statusCode || 403, { ok: false, error: err.message || "Admin request failed." });
  }
}
