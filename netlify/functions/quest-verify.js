import { json, methodNotAllowed, parseBody } from "./_quest/http.js";
import { verifyWalletAuth } from "./_quest/auth.js";
import * as store from "./_quest/store.js";
import { verifyQuest } from "./_quest/verify.js";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return methodNotAllowed();

    const body = parseBody(event);
    const wallet = verifyWalletAuth(body);
    const user = await store.ensureUser(wallet);
    const quest = await store.getQuest(String(body.quest_id || body.questId || ""));
    if (!quest || quest.active === false) return json(404, { ok: false, error: "Quest not found." });

    const proofText = String(body.proof_text || body.proofText || "").trim();
    const proofUrl = String(body.proof_url || body.proofUrl || "").trim();
    const txHash = String(body.tx_hash || body.txHash || "").trim();
    const result = await verifyQuest({ quest, wallet, proofText, proofUrl, txHash });
    const completion = await store.saveCompletion({
      userId: user.id,
      questId: quest.id,
      status: result.status,
      proofUrl,
      proofText,
      txHash: txHash || (/^0x[a-fA-F0-9]{64}$/.test(proofText) ? proofText : ""),
      verificationDetails: result.details,
    });

    return json(200, { ok: true, status: result.status, completion, details: result.details });
  } catch (err) {
    const statusCode = /duplicate/i.test(err.message) ? 409 : err.statusCode || 400;
    return json(statusCode, { ok: false, error: err.message || "Quest verification failed." });
  }
}
