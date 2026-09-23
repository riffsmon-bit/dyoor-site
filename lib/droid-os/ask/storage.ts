import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { getStore } from "droid-os-blobs";
import { AskError } from "./schema.ts";

export type Entry = { data: unknown; etag: string };
export interface AskStore {
  get(key: string): Promise<Entry | null>;
  put(key: string, data: unknown, etag: string | null): Promise<boolean>;
}
export function strictStorageFetch(fetcher: typeof fetch): typeof fetch {
  return async (url, init) => {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(10000) });
    const method = (init?.method || (url instanceof Request ? url.method : "GET")).toUpperCase();
    const missingRead = response.status === 404 && (method === "GET" || method === "HEAD");
    if (!response.ok && !missingRead && response.status !== 412) throw new AskError("Training storage unavailable.", 503);
    return response;
  };
}
// A separate SDK alias preserves the legacy Energy/metadata storage SDK.
export function blobAskStore(): AskStore {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  const store = getStore({ name: "droid-os-ask-preview-v1", consistency: "strong", ...(siteID && token ? { siteID, token } : {}), fetch: strictStorageFetch(fetch) });
  return {
    async get(key) {
      const entry = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
      if (!entry) return null;
      if (!entry.etag) throw new AskError("Storage revision unavailable.", 503);
      return { data: entry.data, etag: entry.etag };
    },
    async put(key, data, etag) {
      const result = await store.set(key, JSON.stringify(data), etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return result.modified === true;
    },
  };
}
export function localAskStore(root: string): AskStore {
  const file = (key: string) => path.join(root, `${createHash("sha256").update(key).digest("hex")}.json`);
  async function get(key: string): Promise<Entry | null> {
    try { return JSON.parse(await readFile(file(key), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  return { get, async put(key, data, etag) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lockPath = `${file(key)}.lock`;
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    try {
      if ((await get(key))?.etag !== (etag ?? undefined)) return false;
      const temp = `${file(key)}.${randomUUID()}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ data, etag: randomUUID() })); } finally { await handle.close(); }
      await rename(temp, file(key));
      return true;
    } finally { await lock.close(); await unlink(lockPath); }
  } };
}
// Each admission occupies an immutable slot; no read-modify-write counters.
export async function takeSlot(store: AskStore, scope: string, count: number) {
  for (let i = 0; i < count; i++) if (await store.put(`limits/${scope}/${i}`, { version: 1, admitted: true }, null)) return;
  throw new AskError("ASK test limit reached. Try again later.", 429);
}
