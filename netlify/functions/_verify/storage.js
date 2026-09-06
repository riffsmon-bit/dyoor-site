import { getStore } from "@netlify/blobs";
import { getVerifyConfig } from "./config.js";

let cachedStore;

function store() {
  if (globalThis.__DYOOR_VERIFY_STORE__) return globalThis.__DYOOR_VERIFY_STORE__;
  if (!cachedStore) {
    const { storage } = getVerifyConfig();
    cachedStore = getStore({
      name: "dyoor-discord-verification-v2",
      siteID: storage.siteId,
      token: storage.token,
      consistency: "strong",
    });
  }
  return cachedStore;
}

export async function getJson(key, fallback = null) {
  const value = await store().get(key, { type: "json", consistency: "strong" });
  return value ?? fallback;
}

export async function setJson(key, value) {
  await store().setJSON(key, value);
}

export async function deleteKey(key) {
  await store().delete(key);
}

export async function listByPrefix(prefix) {
  const result = await store().list({ prefix });
  return (result.blobs || []).map((blob) => blob.key);
}

export async function listJson(prefix) {
  const keys = await listByPrefix(prefix);
  const values = await Promise.all(keys.map((key) => getJson(key, null)));
  return values.filter(Boolean);
}

export function resetVerifyStoreForTests() {
  cachedStore = undefined;
}
