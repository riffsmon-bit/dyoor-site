import { getVerificationSnapshot } from "./chain.js";
import { getVerifyConfig } from "./config.js";
import { managedRoleKeys, syncDiscordMemberRoles } from "./discord.js";
import { recordVerificationAudit } from "./audit.js";
import { saveUser } from "./linking.js";

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function entitlementDecision(key, reads, prior, manualOverride, now, graceMs) {
  if (manualOverride === true || manualOverride === false) {
    return {
      decision: manualOverride,
      state: {
        qualified: manualOverride,
        source: "manual-override",
        updatedAt: now,
        zeroSince: null,
        zeroConfirmations: 0,
      },
    };
  }
  if (reads.some((read) => read?.status === "QUALIFIED")) {
    return {
      decision: true,
      state: {
        qualified: true,
        source: "on-chain",
        updatedAt: now,
        lastSuccessfulCheckAt: now,
        zeroSince: null,
        zeroConfirmations: 0,
      },
    };
  }
  if (reads.length === 0 || reads.some((read) => read?.status === "RPC_ERROR")) {
    return {
      decision: "PRESERVE",
      state: { ...(prior || {}), lastErrorAt: now, source: prior?.source || "on-chain" },
    };
  }
  const zeroSince = Number(prior?.zeroSince || now);
  const zeroConfirmations = Number(prior?.zeroConfirmations || 0) + 1;
  const graceComplete = zeroConfirmations >= 2 && now - zeroSince >= graceMs;
  return {
    decision: graceComplete ? false : "PRESERVE",
    state: {
      qualified: graceComplete ? false : Boolean(prior?.qualified),
      source: "on-chain",
      updatedAt: now,
      lastSuccessfulCheckAt: now,
      zeroSince,
      zeroConfirmations,
    },
  };
}

export async function evaluateAndSyncUser(user, options = {}) {
  const config = getVerifyConfig();
  const now = options.now || Date.now();
  const checkWallet = options.checkWallet || getVerificationSnapshot;
  const wallets = Array.from(new Set((user.wallets || []).map((wallet) => String(wallet).toLowerCase())));
  const snapshots = await mapConcurrent(wallets, config.sync.concurrency, (wallet) => checkWallet(wallet));
  const evaluations = { ...(user.evaluations || {}) };
  snapshots.forEach((snapshot) => { evaluations[snapshot.wallet] = snapshot; });
  const desired = {};
  const entitlementState = { ...(user.entitlementState || {}) };
  for (const key of managedRoleKeys) {
    const reads = snapshots.map((snapshot) => snapshot.reads?.[key]).filter(Boolean);
    const result = entitlementDecision(
      key,
      reads,
      entitlementState[key],
      user.manualOverrides?.[key],
      now,
      config.sync.graceMs,
    );
    desired[key] = result.decision;
    entitlementState[key] = result.state;
  }
  const updated = await saveUser({
    ...user,
    dyoorified: true,
    wallets,
    evaluations,
    entitlementState,
    lastCheckedAt: now,
    updatedAt: now,
  });
  try {
    const roleSync = await syncDiscordMemberRoles(user.discordUser.id, desired);
    await recordVerificationAudit("SYNC_SUCCESS", user.discordUser.id, {
      walletsChecked: wallets.length,
      added: roleSync.added,
      removed: roleSync.removed,
      preserved: roleSync.preserved,
    });
    return { user: updated, desired, roleSync, snapshots };
  } catch (error) {
    await recordVerificationAudit("SYNC_FAILURE", user.discordUser.id, {
      walletsChecked: wallets.length,
      errorClass: error?.constructor?.name || "Error",
    });
    throw error;
  }
}

export function publicUserStatus(user) {
  const memberships = Object.fromEntries(managedRoleKeys.map((key) => [
    key,
    user?.manualOverrides?.[key] === true || user?.entitlementState?.[key]?.qualified === true,
  ]));
  return {
    dyoorified: user?.dyoorified === true,
    wallets: (user?.wallets || []).map((wallet) => ({
      address: wallet,
      checkedAt: user.evaluations?.[wallet]?.checkedAt || null,
      memberships: user.evaluations?.[wallet]?.entitlements || {},
      rpcUncertain: user.evaluations?.[wallet]?.rpcUncertain || [],
    })),
    memberships,
    lastCheckedAt: user?.lastCheckedAt || null,
  };
}
