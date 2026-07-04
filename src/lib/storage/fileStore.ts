import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";

export type JsonStore = {
  getJson<T>(key: string, fallback: T): Promise<T>;
  setJson(key: string, value: unknown): Promise<void>;
};

function useFileStore() {
  return process.env.DYOOR_STORAGE_ADAPTER === "file" || process.env.NODE_ENV !== "production";
}

function safeKey(key: string) {
  return key.replace(/^\/+/, "").replace(/\.\.+/g, "").replace(/\\/g, "/");
}

function localStoreRoot() {
  const configured = process.env.DYOOR_RUNTIME_DATA_DIR;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  return path.join(/* turbopackIgnore: true */ process.cwd(), "data", "runtime");
}

function localPath(storeName: string, key: string) {
  return path.join(localStoreRoot(), storeName, safeKey(key));
}

function createFileStore(storeName: string): JsonStore {
  return {
    async getJson<T>(key: string, fallback: T) {
      try {
        const raw = await fs.readFile(localPath(storeName, key), "utf8");
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    async setJson(key: string, value: unknown) {
      const filePath = localPath(storeName, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

function createBlobStore(storeName: string): JsonStore {
  const store = () => getStore({ name: storeName, consistency: "strong" });
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
  if (useFileStore()) return createFileStore(storeName);
  return createBlobStore(storeName);
}
