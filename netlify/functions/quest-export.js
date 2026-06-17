import { requireAdmin } from "./_quest/auth.js";
import { parseBody } from "./_quest/http.js";
import * as store from "./_quest/store.js";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function handler(event) {
  try {
    const body = event.httpMethod === "POST" ? parseBody(event) : event.queryStringParameters || {};
    await requireAdmin(body);
    const data = await store.adminData();
    const rows = [["wallet_address", "x_username", "discord_username", "total_points", "created_at"]]
      .concat(data.users.map((user) => [
        user.wallet_address,
        user.x_username || "",
        user.discord_username || "",
        user.total_points || 0,
        user.created_at || "",
      ]));

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=dyoor-quest-wallets.csv",
        "cache-control": "no-store",
      },
      body: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    };
  } catch (err) {
    return {
      statusCode: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: err.message || "Export failed." }),
    };
  }
}
