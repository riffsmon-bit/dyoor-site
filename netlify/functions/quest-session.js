import { json, methodNotAllowed, parseBody } from "./_quest/http.js";
import { loginMessage, verifyWalletAuth, isAdminWallet } from "./_quest/auth.js";
import * as store from "./_quest/store.js";

export async function handler(event) {
  try {
    if (event.httpMethod === "GET") {
      const wallet = event.queryStringParameters?.wallet || "";
      return json(200, { ok: true, message: loginMessage(wallet) });
    }
    if (event.httpMethod !== "POST") return methodNotAllowed();

    const body = parseBody(event);
    const wallet = verifyWalletAuth(body);
    const user = await store.ensureUser(wallet);
    return json(200, { ok: true, user, admin: isAdminWallet(wallet) });
  } catch (err) {
    return json(err.statusCode || 400, { ok: false, error: err.message || "Quest login failed." });
  }
}
