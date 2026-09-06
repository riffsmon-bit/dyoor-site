import { createVerificationChallenge } from "./_verify/challenge.js";
import { assertMethod, assertSameOrigin, parseBody, safeHandlerError, json } from "./_verify/http.js";
import { requireSession } from "./_verify/session.js";

export const handler = async (event) => {
  try {
    assertMethod(event, "POST");
    assertSameOrigin(event);
    const { sessionId, session } = await requireSession(event);
    const body = parseBody(event);
    const challenge = await createVerificationChallenge({
      sessionId,
      session,
      wallet: body.wallet,
    });
    return json(200, {
      ok: true,
      challenge: {
        wallet: challenge.wallet,
        nonce: challenge.nonce,
        message: challenge.message,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        chainId: 143,
      },
    });
  } catch (error) {
    return safeHandlerError(error, "A wallet verification challenge could not be created.");
  }
};
