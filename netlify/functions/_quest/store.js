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
};
const fallbackPath = path.join(os.tmpdir(), "dyoor-quest-store.json");
const blobStoreName = "dyoor-quest-terminal";
const blobStoreKey = "quest-store.json";

function now() {
  return new Date().toISOString();
}

function sortQuests(quests) {
  return quests
    .filter((quest) => quest.active !== false)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
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
      memory.quests = Array.isArray(parsed.quests) && parsed.quests.length ? parsed.quests : config.loadSeedQuests();
      memory.completions = Array.isArray(parsed.completions) ? parsed.completions : [];
      memory.suspicious = Array.isArray(parsed.suspicious) ? parsed.suspicious : [];
      return;
    }
  } catch (_err) {}

  try {
    const parsed = JSON.parse(await fs.readFile(fallbackPath, "utf8"));
    memory.users = Array.isArray(parsed.users) ? parsed.users : [];
    memory.quests = Array.isArray(parsed.quests) && parsed.quests.length ? parsed.quests : config.loadSeedQuests();
    memory.completions = Array.isArray(parsed.completions) ? parsed.completions : [];
    memory.suspicious = Array.isArray(parsed.suspicious) ? parsed.suspicious : [];
  } catch (_err) {
    memory.quests = memory.quests.length ? memory.quests : config.loadSeedQuests();
  }
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

  if (db.hasSupabase()) {
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
  if (db.hasSupabase()) {
    const quests = await db.select("quests", "select=*&active=eq.true&order=sort_order.asc");
    return quests?.length ? quests : sortQuests(memory.quests);
  }
  await readFallback();
  return sortQuests(memory.quests);
}

async function listAllQuests() {
  if (db.hasSupabase()) {
    return db.select("quests", "select=*&order=sort_order.asc");
  }
  await readFallback();
  return memory.quests.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

async function getQuest(questId) {
  if (db.hasSupabase()) {
    const rows = await db.select("quests", `select=*&${db.eq("id", questId)}`);
    return rows?.[0] || null;
  }
  await readFallback();
  return memory.quests.find((quest) => quest.id === questId) || null;
}

async function listCompletions(userId) {
  if (db.hasSupabase()) {
    return db.select("quest_completions", `select=*&${db.eq("user_id", userId)}&order=created_at.desc`);
  }
  await readFallback();
  return memory.completions.filter((entry) => entry.user_id === userId);
}

async function saveCompletion({ userId, questId, status, proofUrl, proofText, txHash, verificationDetails }) {
  if (db.hasSupabase()) {
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
  if (!db.hasSupabase()) {
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
  if (db.hasSupabase()) {
    return db.select("leaderboard", `select=*&order=rank.asc&limit=${Number(limit) || 100}`);
  }
  await readFallback();
  return buildLeaderboard(memory.users, memory.completions).slice(0, limit);
}

async function adminData() {
  if (db.hasSupabase()) {
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

  if (db.hasSupabase()) {
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
  if (db.hasSupabase()) {
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
  listQuests,
  listAllQuests,
  getQuest,
  listCompletions,
  saveCompletion,
  leaderboard,
  adminData,
  upsertQuest,
  approveCompletion,
};
