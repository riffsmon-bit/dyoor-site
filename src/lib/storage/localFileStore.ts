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
    async deleteJson(key: string) {
      await fs.unlink(localPath(storeName, key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
    async getJson<T>(key: string, fallback: T) {
      try {
        const raw = await fs.readFile(localPath(storeName, key), "utf8");
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    async getJsonStrict<T>(key: string) {
      try {
        const raw = await fs.readFile(localPath(storeName, key), "utf8");
        return JSON.parse(raw) as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async listKeys(prefix: string) {
      const safePrefix = safeKey(prefix);
      const root = localPath(storeName, "");
      const keys: string[] = [];

      async function walk(directory: string) {
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        for (const entry of entries) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(entryPath);
          else {
            const key = path.relative(root, entryPath).split(path.sep).join("/");
            if (key.startsWith(safePrefix)) keys.push(key);
          }
        }
      }

      await walk(root);
      return keys.sort();
    },
    async setJson(key: string, value: unknown) {
      const filePath = localPath(storeName, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}
