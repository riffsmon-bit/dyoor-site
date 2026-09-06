import { deleteKey, getJson, listJson, setJson } from "./storage.js";

const locks = new Map();

async function withLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => next);
  locks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

function userKey(discordUserId) {
  return `users/${discordUserId}.json`;
}

function walletKey(wallet) {
  return `wallets/${wallet.toLowerCase()}.json`;
}

export async function getUser(discordUserId) {
  return getJson(userKey(discordUserId), null);
}

export async function saveUser(user) {
  await setJson(userKey(user.discordUser.id), user);
  return user;
}

export async function ensureUser(discordUser) {
  const existing = await getUser(discordUser.id);
  if (existing) {
    return saveUser({
      ...existing,
      discordUser: {
        id: String(discordUser.id),
        username: String(discordUser.username || existing.discordUser?.username || "Discord member").slice(0, 80),
        globalName: String(discordUser.global_name || existing.discordUser?.globalName || "").slice(0, 80),
      },
      dyoorified: true,
      updatedAt: Date.now(),
    });
  }
  const now = Date.now();
  return saveUser({
    version: 2,
    discordUser: {
      id: String(discordUser.id),
      username: String(discordUser.username || "Discord member").slice(0, 80),
      globalName: String(discordUser.global_name || "").slice(0, 80),
    },
    dyoorified: true,
    wallets: [],
    evaluations: {},
    entitlementState: {},
    manualOverrides: {},
    createdAt: now,
    updatedAt: now,
  });
}

export async function getWalletLink(wallet) {
  return getJson(walletKey(wallet), null);
}

export async function assertWalletAvailable(wallet, discordUserId) {
  const linked = await getWalletLink(wallet);
  if (linked && linked.discordUserId !== discordUserId) {
    throw Object.assign(
      new Error("This wallet is already associated with another Discord account."),
      { status: 409 },
    );
  }
  return linked;
}

export async function linkWallet({ discordUser, wallet, evaluation }) {
  const normalized = String(wallet).toLowerCase();
  return withLock(`wallet:${normalized}`, async () => {
    await assertWalletAvailable(normalized, discordUser.id);
    const user = await ensureUser(discordUser);
    const wallets = Array.from(new Set([...(user.wallets || []), normalized]));
    const now = Date.now();
    const index = {
      version: 2,
      wallet: normalized,
      discordUserId: String(discordUser.id),
      linkedAt: now,
      updatedAt: now,
    };
    await setJson(walletKey(normalized), index);
    try {
      return await saveUser({
        ...user,
        wallets,
        evaluations: { ...(user.evaluations || {}), [normalized]: evaluation },
        updatedAt: now,
      });
    } catch (error) {
      await deleteKey(walletKey(normalized)).catch(() => undefined);
      throw error;
    }
  });
}

export async function listUsers() {
  return listJson("users/");
}

export async function adminRelinkWallet(wallet, nextDiscordUserId, actorDiscordUserId) {
  const normalized = String(wallet).toLowerCase();
  return withLock(`wallet:${normalized}`, async () => {
    const prior = await getWalletLink(normalized);
    await setJson(walletKey(normalized), {
      version: 2,
      wallet: normalized,
      discordUserId: String(nextDiscordUserId),
      overriddenAt: Date.now(),
      overriddenBy: String(actorDiscordUserId),
      previousDiscordUserId: prior?.discordUserId || null,
    });
    return prior;
  });
}
