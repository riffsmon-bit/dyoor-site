import fs from "node:fs/promises";
import path from "node:path";
import type { JsonStore } from "./fileStore";

function safeKey(key: string) {
  return key.replace(/^\/+/, "").replace(/\.\.+/g, "").replace(/\\/g, "/");
}

function localPath(storeName: string, key: string) {
  const configured = process.env.DYOOR_RUNTIME_DATA_DIR;
  const root = configured
    ? path.resolve(/* turbopackIgnore: true */ process.cwd(), configured)
    : path.join(/* turbopackIgnore: true */ process.cwd(), "data", "runtime");
  return path.join(root, storeName, safeKey(key));
}

export function createLocalJsonStore(storeName: string): JsonStore {
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
