import { json, methodNotAllowed, parseBody } from "./_quest/http.js";
import { loginChallenge, verifyWalletAuth, isAdminWallet } from "./_quest/auth.js";
import * as store from "./_quest/store.js";

export async function handler(event) {
  try {
    if (event.httpMethod === "GET") {
      const wallet = event.queryStringParameters?.wallet || "";
      const challenge = await loginChallenge(wallet);
      return json(200, {
        ok: true,
        message: challenge.message,
        nonce: challenge.nonce,
        expiresAt: challenge.expires_at,
      });
    }
    if (event.httpMethod !== "POST") return methodNotAllowed();

    const body = parseBody(event);
    const wallet = await verifyWalletAuth(body);
    const user = await store.ensureUser(wallet);
    return json(200, { ok: true, user, admin: isAdminWallet(wallet) });
  } catch (err) {
    return json(err.statusCode || 400, { ok: false, error: err.message || "Quest login failed." });
  }
}
