import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getStore } from "@netlify/blobs";
import * as config from "./config.js";
import * as db from "./supabase.js";

const memory = {
  users: [],
  quests: config.loadSeedQuests(),
  completions: [],
  suspicious: [],
  sessions: [],
  rateLimits: [],
};
const fallbackPath = path.join(os.tmpdir(), "dyoor-quest-store.json");
const blobStoreName = "dyoor-quest-terminal";
const blobStoreKey = "quest-store.json";

function now() {
  return new Date().toISOString();
}

function useSupabase() {
  return db.hasSupabase() && config.questStorage !== "blobs" && config.questStorage !== "netlify_blobs";
}

function sortQuests(quests) {
  return quests
    .filter((quest) => quest.active !== false)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function mergeSeedQuests(storedQuests) {
  const byId = new Map(config.loadSeedQuests().map((quest) => [quest.id, quest]));
  for (const quest of Array.isArray(storedQuests) ? storedQuests : []) {
    if (quest?.id) byId.set(quest.id, { ...byId.get(quest.id), ...quest });
  }
  return Array.from(byId.values());
}

function recomputeMemoryPoints(userId) {
  const user = memory.users.find((entry) => entry.id === userId);
  if (!user) return;
  const total = memory.completions
    .filter((entry) => entry.user_id === userId && entry.status === "verified")
    .reduce((sum, entry) => {
      const quest = memory.quests.find((item) => item.id === entry.quest_id);
      return sum + Number(quest?.points || 0);
    }, 0);
  user.total_points = total;
  user.updated_at = now();
}

function buildLeaderboard(users, completions) {
  return users
    .map((user) => ({
      user_id: user.id,
      wallet_address: user.wallet_address,
      x_username: user.x_username,
      discord_username: user.discord_username,
      m3sh_connected: !!user.m3sh_connected,
      total_points: Number(user.total_points || 0),
      completed_quest_count: completions.filter((entry) => entry.user_id === user.id && entry.status === "verified").length,
    }))
    .sort((a, b) => b.total_points - a.total_points)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function readFallback() {
  try {
    const store = getStore({
      name: blobStoreName,
      consistency: "strong",
    });
    const parsed = await store.get(blobStoreKey, { type: "json", consistency: "strong" });
    if (parsed && typeof parsed === "object") {
      memory.users = Array.isArray(parsed.users) ? parsed.users : [];
      memory.quests = mergeSeedQuests(parsed.quests);
      memory.completions = Array.isArray(parsed.completions) ? parsed.completions : [];
      memory.suspicious = Array.isArray(parsed.suspicious) ? parsed.suspicious : [];
      memory.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      memory.rateLimits = Array.isArray(parsed.rateLimits) ? parsed.rateLimits : [];
      return;
    }
  } catch (_err) {}

  try {
    const parsed = JSON.parse(await fs.readFile(fallbackPath, "utf8"));
    memory.users = Array.isArray(parsed.users) ? parsed.users : [];
    memory.quests = mergeSeedQuests(parsed.quests);
    memory.completions = Array.isArray(parsed.completions) ? parsed.completions : [];
    memory.suspicious = Array.isArray(parsed.suspicious) ? parsed.suspicious : [];
    memory.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    memory.rateLimits = Array.isArray(parsed.rateLimits) ? parsed.rateLimits : [];
  } catch (_err) {
    memory.quests = memory.quests.length ? memory.quests : config.loadSeedQuests();
  }
}

function challengeMessage(wallet, nonce, issuedAt) {
  return [
    "D.Y.O.O.R Quest Terminal",
    `Wallet: ${wallet}`,
    "Action: quest-mode-login",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "This signature proves wallet ownership and does not send a transaction.",
  ].join("\n");
}

async function createChallenge(walletAddress) {
  const wallet = config.normalizeAddress(walletAddress);
  if (!wallet) throw new Error("Invalid wallet address.");
  await readFallback();
  const issuedAt = now();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const nonce = randomUUID();
  const session = {
    id: randomUUID(),
    wallet_address: wallet,
    nonce,
    message: challengeMessage(wallet, nonce, issuedAt),
    issued_at: issuedAt,
    expires_at: expiresAt,
    used_at: null,
  };
  memory.sessions = memory.sessions.filter((entry) => {
    const expired = Date.parse(entry.expires_at || "") <= Date.now();
    return !expired && entry.wallet_address !== wallet;
  });
  memory.sessions.push(session);
  await writeFallback();
  return session;
}

async function consumeChallenge({ walletAddress, message }) {
  const wallet = config.normalizeAddress(walletAddress);
  if (!wallet || !message) throw new Error("Wallet signature is required.");
  await readFallback();
  const session = memory.sessions.find((entry) =>
    entry.wallet_address === wallet &&
    entry.message === message &&
    Date.parse(entry.expires_at || "") > Date.now()
  );
  if (!session) throw new Error("Quest signature challenge expired or was not issued by this server.");
  session.used_at = now();
  await writeFallback();
  return session;
}

async function checkRateLimit(key, limit = 20, windowMs = 60_000) {
  await readFallback();
  const nowMs = Date.now();
  const windowStart = nowMs - windowMs;
  memory.rateLimits = memory.rateLimits.filter((entry) => Number(entry.at || 0) >= windowStart);
  const count = memory.rateLimits.filter((entry) => entry.key === key).length;
  if (count >= limit) {
    const err = new Error("Too many quest verification attempts. Try again shortly.");
    err.statusCode = 429;
    throw err;
  }
  memory.rateLimits.push({ key, at: nowMs });
  await writeFallback();
}

async function writeFallback() {
  try {
    const store = getStore({
      name: blobStoreName,
      consistency: "strong",
    });
    await store.setJSON(blobStoreKey, memory);
    return;
  } catch (_err) {}

  await fs.writeFile(fallbackPath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

async function ensureUser(walletAddress) {
  const wallet = config.normalizeAddress(walletAddress);
  if (!wallet) throw new Error("Invalid wallet address.");

  if (useSupabase()) {
    const existing = await db.select("users", `select=*&${db.eq("wallet_address", wallet)}`);
    if (existing?.[0]) return existing[0];
    const referral = wallet.slice(2, 10).toUpperCase();
    const inserted = await db.insert("users", [{
      wallet_address: wallet,
      referral_code: referral,
    }]);
    return inserted[0];
  }

  await readFallback();
  let user = memory.users.find((entry) => entry.wallet_address === wallet);
  if (!user) {
    user = {
      id: randomUUID(),
      wallet_address: wallet,
      x_user_id: null,
      x_username: null,
      discord_user_id: null,
      discord_username: null,
      m3sh_connected: false,
      total_points: 0,
      referral_code: wallet.slice(2, 10).toUpperCase(),
      created_at: now(),
      updated_at: now(),
    };
    memory.users.push(user);
    await writeFallback();
  }
  return user;
}

async function listQuests() {
  if (useSupabase()) {
    const quests = await db.select("quests", "select=*&active=eq.true&order=sort_order.asc");
    return quests?.length ? quests : sortQuests(memory.quests);
  }
  await readFallback();
  return sortQuests(memory.quests);
}

async function listAllQuests() {
  if (useSupabase()) {
    return db.select("quests", "select=*&order=sort_order.asc");
  }
  await readFallback();
  return memory.quests.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

async function getQuest(questId) {
  if (useSupabase()) {
    const rows = await db.select("quests", `select=*&${db.eq("id", questId)}`);
    return rows?.[0] || null;
  }
  await readFallback();
  return memory.quests.find((quest) => quest.id === questId) || null;
}

async function listCompletions(userId) {
  if (useSupabase()) {
    return db.select("quest_completions", `select=*&${db.eq("user_id", userId)}&order=created_at.desc`);
  }
  await readFallback();
  return memory.completions.filter((entry) => entry.user_id === userId);
}

async function getCompletion(userId, questId) {
  if (useSupabase()) {
    const rows = await db.select("quest_completions", `select=*&${db.eq("user_id", userId)}&${db.eq("quest_id", questId)}`);
    return rows?.[0] || null;
  }
  await readFallback();
  return memory.completions.find((entry) => entry.user_id === userId && entry.quest_id === questId) || null;
}

async function saveCompletion({ userId, questId, status, proofUrl, proofText, txHash, verificationDetails }) {
  if (useSupabase()) {
    const existing = await db.select("quest_completions", `select=*&${db.eq("user_id", userId)}&${db.eq("quest_id", questId)}`);
    const values = {
      user_id: userId,
      quest_id: questId,
      status,
      proof_url: proofUrl || null,
      proof_text: proofText || null,
      tx_hash: txHash || null,
      verification_details: verificationDetails || {},
      verified_at: status === "verified" ? now() : null,
      updated_at: now(),
    };
    if (existing?.[0]) {
      const rows = await db.patch("quest_completions", db.eq("id", existing[0].id), values);
      await recomputeUserPoints(userId);
      return rows[0];
    }
    const rows = await db.insert("quest_completions", [{ ...values, created_at: now() }]);
    await recomputeUserPoints(userId);
    return rows[0];
  }

  await readFallback();
  let entry = memory.completions.find((item) => item.user_id === userId && item.quest_id === questId);
  if (!entry) {
    entry = {
      id: randomUUID(),
      user_id: userId,
      quest_id: questId,
      created_at: now(),
    };
    memory.completions.push(entry);
  }
  Object.assign(entry, {
    status,
    proof_url: proofUrl || null,
    proof_text: proofText || null,
    tx_hash: txHash || null,
    verification_details: verificationDetails || {},
    verified_at: status === "verified" ? now() : null,
    updated_at: now(),
  });
  recomputeMemoryPoints(userId);
  await writeFallback();
  return entry;
}

async function recomputeUserPoints(userId) {
  if (!useSupabase()) {
    await readFallback();
    recomputeMemoryPoints(userId);
    await writeFallback();
    return;
  }

  const completions = await db.select("quest_completions", `select=quest_id,status&${db.eq("user_id", userId)}&status=eq.verified`);
  const quests = await db.select("quests", "select=id,points");
  const questPoints = new Map(quests.map((quest) => [quest.id, Number(quest.points || 0)]));
  const total = completions.reduce((sum, entry) => sum + Number(questPoints.get(entry.quest_id) || 0), 0);
  await db.patch("users", db.eq("id", userId), { total_points: total, updated_at: now() });
}

async function leaderboard(limit = 100) {
  if (useSupabase()) {
    return db.select("leaderboard", `select=*&order=rank.asc&limit=${Number(limit) || 100}`);
  }
  await readFallback();
  return buildLeaderboard(memory.users, memory.completions).slice(0, limit);
}

async function adminData() {
  if (useSupabase()) {
    const [quests, users, completions, suspicious] = await Promise.all([
      db.select("quests", "select=*&order=sort_order.asc"),
      db.select("users", "select=*&order=total_points.desc"),
      db.select("quest_completions", "select=*&order=created_at.desc"),
      db.select("suspicious_users", "select=*&order=created_at.desc"),
    ]);
    return { quests, users, completions, suspicious };
  }
  await readFallback();
  return {
    quests: await listAllQuests(),
    users: memory.users,
    completions: memory.completions,
    suspicious: memory.suspicious,
  };
}

async function upsertQuest(quest) {
  const values = {
    id: String(quest.id || "").trim(),
    title: String(quest.title || "").trim(),
    description: String(quest.description || "").trim(),
    quest_type: String(quest.quest_type || "manual").trim(),
    points: Number(quest.points || 0),
    verification_method: String(quest.verification_method || "manual").trim(),
    external_url: String(quest.external_url || "").trim() || null,
    active: quest.active !== false,
    sort_order: Number(quest.sort_order || 0),
    target: String(quest.target || "").trim() || null,
    updated_at: now(),
  };
  if (!values.id || !values.title) throw new Error("Quest id and title are required.");

  if (useSupabase()) {
    const rows = await db.upsert("quests", [values], "id");
    return rows[0];
  }

  await readFallback();
  const index = memory.quests.findIndex((entry) => entry.id === values.id);
  if (index === -1) memory.quests.push({ ...values, created_at: now() });
  else memory.quests[index] = { ...memory.quests[index], ...values };
  await writeFallback();
  return memory.quests.find((entry) => entry.id === values.id);
}

async function approveCompletion(completionId, status) {
  if (useSupabase()) {
    const rows = await db.patch("quest_completions", db.eq("id", completionId), {
      status,
      verified_at: status === "verified" ? now() : null,
      updated_at: now(),
    });
    if (rows?.[0]) await recomputeUserPoints(rows[0].user_id);
    return rows?.[0] || null;
  }

  await readFallback();
  const entry = memory.completions.find((item) => item.id === completionId);
  if (!entry) return null;
  entry.status = status;
  entry.verified_at = status === "verified" ? now() : null;
  entry.updated_at = now();
  recomputeMemoryPoints(entry.user_id);
  await writeFallback();
  return entry;
}

export {
  ensureUser,
  createChallenge,
  consumeChallenge,
  checkRateLimit,
  listQuests,
  listAllQuests,
  getQuest,
  listCompletions,
  getCompletion,
  saveCompletion,
  leaderboard,
  adminData,
  upsertQuest,
  approveCompletion,
};
