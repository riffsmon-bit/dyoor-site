import { json, methodNotAllowed, parseBody } from "./_quest/http.js";
import { verifyWalletAuth } from "./_quest/auth.js";
import * as store from "./_quest/store.js";
import { verifyQuest } from "./_quest/verify.js";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return methodNotAllowed();

    const body = parseBody(event);
    const wallet = await verifyWalletAuth(body);
    await store.checkRateLimit(`quest-verify:${wallet}`, 30, 60_000);
    const user = await store.ensureUser(wallet);
    const quest = await store.getQuest(String(body.quest_id || body.questId || ""));
    if (!quest || quest.active === false) return json(404, { ok: false, error: "Quest not found." });

    const existing = await store.getCompletion(user.id, quest.id);
    if (existing?.status === "verified") {
      return json(200, {
        ok: true,
        completed: true,
        status: "verified",
        reason: "Already claimed",
        pointsAwarded: 0,
        proofTxHash: existing.tx_hash || existing.verification_details?.proofTxHash || null,
        proofSource: existing.verification_details?.proofSource || null,
        verifiedAt: existing.verified_at,
        completion: existing,
      });
    }

    const proofText = String(body.proof_text || body.proofText || "").trim();
    const proofUrl = String(body.proof_url || body.proofUrl || "").trim();
    const txHash = String(body.tx_hash || body.txHash || "").trim();
    const result = await verifyQuest({ quest, wallet, proofText, proofUrl, txHash });
    const shouldStore = result.completed || proofText || proofUrl || txHash || result.status === "pending";
    const completion = shouldStore ? await store.saveCompletion({
      userId: user.id,
      questId: quest.id,
      status: result.status,
      proofUrl,
      proofText,
      txHash: txHash || (/^0x[a-fA-F0-9]{64}$/.test(proofText) ? proofText : ""),
      verificationDetails: {
        ...(result.details || {}),
        reason: result.reason,
        proofTxHash: result.proofTxHash || null,
        proofSource: result.proofSource || null,
      },
    }) : null;

    return json(200, {
      ok: true,
      completed: !!result.completed,
      status: result.status,
      reason: result.reason,
      pointsAwarded: result.completed ? Number(quest.points || 0) : 0,
      proofTxHash: result.proofTxHash || null,
      proofSource: result.proofSource || null,
      verifiedAt: result.completed ? completion?.verified_at || result.verifiedAt : null,
      completion,
      details: result.details,
    });
  } catch (err) {
    const statusCode = /duplicate/i.test(err.message) ? 409 : err.statusCode || 400;
    return json(statusCode, { ok: false, error: err.message || "Quest verification failed." });
  }
}
