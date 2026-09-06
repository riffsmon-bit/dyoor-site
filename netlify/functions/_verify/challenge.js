import crypto from "node:crypto";
import { getVerifyConfig } from "./config.js";
import { recoverVerificationSigner, normalizeAddress } from "./chain.js";
import { assertWalletAvailable } from "./linking.js";
import { deleteKey, getJson, listByPrefix, setJson } from "./storage.js";

const consumeLocks = new Map();

function challengeKey(sessionId, nonce) {
  return `challenges/${sessionId}/${nonce}.json`;
}

async function withConsumeLock(key, task) {
  const previous = consumeLocks.get(key) || Promise.resolve();
  let release;
  const latch = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => latch);
  consumeLocks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (consumeLocks.get(key) === queued) consumeLocks.delete(key);
  }
}

export function verificationMessage(input) {
  const config = getVerifyConfig();
  const domain = new URL(config.baseUrl).host;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    input.wallet,
    "",
    "Link this wallet to your DYØØR Discord identity and synchronize holder roles.",
    "This is authentication only. It does not request a transaction, approval, transfer, or payment.",
    "",
    `URI: ${config.baseUrl}/discord/verify`,
    "Version: 1",
    "Chain ID: 143",
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    `Request ID: discord:${input.discordUserId}:guild:${config.discord.guildId}`,
    "Resources:",
    `- eip155:143/erc721:${config.contracts.season1}`,
    `- eip155:143/ascension:${config.contracts.ascended}`,
    `- eip155:143/erc721:${config.contracts.season2}`,
    `- eip155:4663/erc721:${config.contracts.hoodyoor}`,
  ].join("\n");
}

async function pruneChallenges(sessionId) {
  const keys = await listByPrefix(`challenges/${sessionId}/`);
  const records = await Promise.all(keys.map(async (key) => ({ key, value: await getJson(key, null) })));
  const now = Date.now();
  const active = records
    .filter(({ value }) => value?.expiresAt > now)
    .sort((a, b) => a.value.createdAt - b.value.createdAt);
  const remove = records.filter(({ value }) => !value || value.expiresAt <= now).map(({ key }) => key)
    .concat(active.slice(0, Math.max(0, active.length - 4)).map(({ key }) => key));
  await Promise.all(remove.map((key) => deleteKey(key).catch(() => undefined)));
}

export async function createVerificationChallenge({ sessionId, session, wallet: walletValue }) {
  const config = getVerifyConfig();
  const wallet = normalizeAddress(walletValue);
  await assertWalletAvailable(wallet, session.discordUser.id);
  await pruneChallenges(sessionId);
  const now = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const input = {
    wallet,
    nonce,
    discordUserId: session.discordUser.id,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + config.session.nonceTtlMs).toISOString(),
  };
  const challenge = {
    version: 2,
    ...input,
    guildId: config.discord.guildId,
    sessionId,
    createdAt: now,
    expiresAtMs: now + config.session.nonceTtlMs,
    message: verificationMessage(input),
  };
  await setJson(challengeKey(sessionId, nonce), challenge);
  return challenge;
}

export async function consumeVerificationChallenge({ sessionId, session, wallet: walletValue, nonce, signature }) {
  const wallet = normalizeAddress(walletValue);
  const normalizedNonce = String(nonce || "");
  const normalizedSignature = String(signature || "");
  if (!/^[a-f0-9]{32}$/.test(normalizedNonce) || !/^0x(?:[a-f0-9]{128}|[a-f0-9]{130})$/i.test(normalizedSignature)) {
    throw Object.assign(new Error("The signed verification challenge is malformed."), { status: 400 });
  }
  const key = challengeKey(sessionId, normalizedNonce);
  return withConsumeLock(key, async () => {
    const challenge = await getJson(key, null);
    if (!challenge || challenge.version !== 2) {
      throw Object.assign(new Error("This verification challenge was already used or does not exist."), { status: 401 });
    }
    if (
      challenge.sessionId !== sessionId
      || challenge.discordUserId !== session.discordUser.id
      || challenge.guildId !== getVerifyConfig().discord.guildId
      || challenge.wallet !== wallet
    ) {
      throw Object.assign(new Error("This challenge is bound to a different Discord session."), { status: 401 });
    }
    if (challenge.expiresAtMs <= Date.now()) {
      await deleteKey(key);
      throw Object.assign(new Error("This verification challenge expired. Request a new one."), { status: 401 });
    }
    const expected = verificationMessage({
      wallet,
      nonce: normalizedNonce,
      discordUserId: session.discordUser.id,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    });
    if (challenge.message !== expected) {
      await deleteKey(key);
      throw Object.assign(new Error("The stored verification challenge failed validation."), { status: 401 });
    }
    const signer = await recoverVerificationSigner(challenge.message, normalizedSignature);
    if (signer !== wallet) {
      throw Object.assign(new Error("The wallet signature did not match the connected wallet."), { status: 401 });
    }
    await deleteKey(key);
    return { wallet, challenge };
  });
}
