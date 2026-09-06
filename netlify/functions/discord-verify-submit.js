import { consumeVerificationChallenge } from "./_verify/challenge.js";
import { getVerificationSnapshot } from "./_verify/chain.js";
import { evaluateAndSyncUser, publicUserStatus } from "./_verify/evaluator.js";
import { assertMethod, assertSameOrigin, parseBody, safeHandlerError, json } from "./_verify/http.js";
import { linkWallet } from "./_verify/linking.js";
import { requireSession } from "./_verify/session.js";
import { recordVerificationAudit } from "./_verify/audit.js";

export const handler = async (event) => {
  try {
    assertMethod(event, "POST");
    assertSameOrigin(event);
    const { sessionId, session } = await requireSession(event);
    const body = parseBody(event);
    const { wallet } = await consumeVerificationChallenge({
      sessionId,
      session,
      wallet: body.wallet,
      nonce: body.nonce,
      signature: body.signature,
    });
    const evaluation = await getVerificationSnapshot(wallet, true);
    const user = await linkWallet({ discordUser: session.discordUser, wallet, evaluation });
    await recordVerificationAudit("WALLET_LINKED", session.discordUser.id, {
      walletHash: wallet.slice(0, 8),
      qualified: evaluation.qualified,
      rpcUncertain: evaluation.rpcUncertain,
    });
    const synced = await evaluateAndSyncUser(user);
    return json(200, {
      ok: true,
      wallet,
      status: publicUserStatus(synced.user),
      roleSync: synced.roleSync,
      warning: evaluation.rpcUncertain.length
        ? "One or more ownership sources were unavailable. Existing roles were preserved."
        : null,
    });
  } catch (error) {
    return safeHandlerError(error, "Wallet verification could not be completed.");
  }
};
