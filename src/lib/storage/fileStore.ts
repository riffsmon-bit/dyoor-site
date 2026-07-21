import { getStore } from "@netlify/blobs";

export type JsonStore = {
  getJson<T>(key: string, fallback: T): Promise<T>;
  setJson(key: string, value: unknown): Promise<void>;
};

function safeKey(key: string) {
  return key.replace(/^\/+/, "").replace(/\.\.+/g, "").replace(/\\/g, "/");
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function createFileStore(storeName: string): JsonStore {
  return {
    async getJson<T>(key: string, fallback: T) {
      const { createLocalJsonStore } = await import("./localFileStore");
      return await createLocalJsonStore(storeName).getJson(safeKey(key), fallback);
    },
    async setJson(key: string, value: unknown) {
      const { createLocalJsonStore } = await import("./localFileStore");
      await createLocalJsonStore(storeName).setJson(safeKey(key), value);
    },
  };
}

function createBlobStore(storeName: string): JsonStore {
  const store = () => {
    const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
    const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_AUTH_TOKEN");
    if (siteID && token) return getStore({ name: storeName, siteID, token, consistency: "strong" });
    return getStore({ name: storeName, consistency: "strong" });
  };
  return {
    async getJson<T>(key: string, fallback: T) {
      try {
        const value = await store().get(safeKey(key), { type: "json", consistency: "strong" });
        return (value ?? fallback) as T;
      } catch {
        return fallback;
      }
    },
    async setJson(key: string, value: unknown) {
      await store().setJSON(safeKey(key), value);
    },
  };
}

export function createJsonStore(storeName: string): JsonStore {
  if (process.env.NODE_ENV !== "production") return createFileStore(storeName);
  return createBlobStore(storeName);
}
