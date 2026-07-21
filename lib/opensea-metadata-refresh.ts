import { dyoorS2Contract } from "@/lib/contracts/addresses";
import { createJsonStore } from "@/src/lib/storage/fileStore";

export type OpenSeaMetadataRefreshResult = {
  status: "queued" | "scheduled" | "skipped" | "failed";
  chain: string;
  contractAddress: string;
  tokenId: string;
  statusCode?: number;
  endpoint?: string;
  response?: unknown;
  error?: string;
  note?: string;
  queuedAt?: string;
  scheduledAt?: string;
  runAt?: string;
  delayMs?: number;
  immediate?: OpenSeaMetadataRefreshResult;
  followUp?: OpenSeaMetadataRefreshResult;
};

const DEFAULT_OPENSEA_CHAIN = "monad";
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_REFRESH_DELAY_MS = 120_000;
const REFRESH_QUEUE_KEY = "trait-lab/opensea-refresh-queue.json";
const refreshQueueStore = createJsonStore("dyoor-s2-metadata");

type OpenSeaRefreshQueueEntry = {
  key: string;
  chain: string;
  contractAddress: string;
  tokenId: string;
  scheduledAt: string;
  runAt: string;
  attempts: number;
  reason?: string;
  lastAttemptAt?: string;
  lastResult?: OpenSeaMetadataRefreshResult;
};

type OpenSeaRefreshQueue = {
  version: 1;
  updatedAt: string;
  items: Record<string, OpenSeaRefreshQueueEntry>;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function envFlag(value: string) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function configuredOpenSeaChain() {
  const raw = readEnv("OPENSEA_CHAIN", "OPENSEA_METADATA_CHAIN", "DYOOR_OPENSEA_CHAIN") || DEFAULT_OPENSEA_CHAIN;
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return normalized || DEFAULT_OPENSEA_CHAIN;
}

function configuredTimeoutMs() {
  const raw = readEnv("OPENSEA_METADATA_REFRESH_TIMEOUT_MS", "DYOOR_OPENSEA_METADATA_REFRESH_TIMEOUT_MS");
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(parsed), 500), 10_000);
}

function configuredRefreshDelayMs() {
  const raw = readEnv("OPENSEA_METADATA_REFRESH_DELAY_MS", "DYOOR_OPENSEA_METADATA_REFRESH_DELAY_MS");
  if (!raw) return DEFAULT_REFRESH_DELAY_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_DELAY_MS;
  return Math.min(Math.max(Math.floor(parsed), 15_000), 10 * 60_000);
}

function responsePayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed.slice(0, 500);
  }
}

function emptyQueue(): OpenSeaRefreshQueue {
  return {
    version: 1,
    updatedAt: "",
    items: {},
  };
}

function queueEntryKey(chain: string, contractAddress: string, tokenId: string) {
  return `${chain}:${contractAddress.toLowerCase()}:${tokenId}`;
}

async function readRefreshQueue() {
  return await refreshQueueStore.getJson<OpenSeaRefreshQueue>(REFRESH_QUEUE_KEY, emptyQueue());
}

async function writeRefreshQueue(queue: OpenSeaRefreshQueue) {
  await refreshQueueStore.setJson(REFRESH_QUEUE_KEY, queue);
}

export async function queueOpenSeaTokenMetadataRefresh({
  tokenId,
  contractAddress = dyoorS2Contract,
  delayMs = configuredRefreshDelayMs(),
  reason = "trait_lab_update",
}: {
  tokenId: number | string;
  contractAddress?: string;
  delayMs?: number;
  reason?: string;
}): Promise<OpenSeaMetadataRefreshResult> {
  const chain = configuredOpenSeaChain();
  const identifier = String(tokenId || "").trim();
  const now = new Date();
  const safeDelayMs = Math.min(Math.max(Math.floor(Number(delayMs) || configuredRefreshDelayMs()), 15_000), 10 * 60_000);
  const runAt = new Date(now.getTime() + safeDelayMs).toISOString();
  const key = queueEntryKey(chain, contractAddress, identifier);
  const queue = await readRefreshQueue();
  const existing = queue.items[key];
  const entry: OpenSeaRefreshQueueEntry = {
    key,
    chain,
    contractAddress,
    tokenId: identifier,
    scheduledAt: now.toISOString(),
    runAt,
    attempts: existing?.attempts || 0,
    reason,
    lastAttemptAt: existing?.lastAttemptAt,
    lastResult: existing?.lastResult,
  };
  await writeRefreshQueue({
    version: 1,
    updatedAt: now.toISOString(),
    items: {
      ...queue.items,
      [key]: entry,
    },
  });

  return {
    status: "scheduled",
    chain,
    contractAddress,
    tokenId: identifier,
    scheduledAt: entry.scheduledAt,
    runAt,
    delayMs: safeDelayMs,
    note: "OpenSea metadata refresh scheduled after the Trait Lab settle delay.",
  };
}

export async function processDueOpenSeaMetadataRefreshes({
  limit = 5,
  now = new Date(),
}: {
  limit?: number;
  now?: Date;
} = {}) {
  const queue = await readRefreshQueue();
  const due = Object.values(queue.items)
    .filter((entry) => Date.parse(entry.runAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt))
    .slice(0, Math.max(1, Math.min(Math.floor(limit), 25)));

  if (!due.length) {
    return {
      ok: true,
      processed: 0,
      remaining: Object.keys(queue.items).length,
      results: [] as OpenSeaMetadataRefreshResult[],
    };
  }

  const items = { ...queue.items };
  const results: OpenSeaMetadataRefreshResult[] = [];

  for (const entry of due) {
    const result = await refreshOpenSeaTokenMetadata({
      tokenId: entry.tokenId,
      contractAddress: entry.contractAddress,
    });
    results.push(result);

    if (result.status === "queued" || result.status === "skipped") {
      delete items[entry.key];
      continue;
    }

    const attempts = (entry.attempts || 0) + 1;
    const retryDelayMs = Math.min(15 * 60_000, 60_000 * Math.max(2, attempts));
    items[entry.key] = {
      ...entry,
      attempts,
      lastAttemptAt: now.toISOString(),
      lastResult: result,
      runAt: new Date(now.getTime() + retryDelayMs).toISOString(),
    };
  }

  await writeRefreshQueue({
    version: 1,
    updatedAt: new Date().toISOString(),
    items,
  });

  return {
    ok: true,
    processed: results.length,
    remaining: Object.keys(items).length,
    results,
  };
}

export async function refreshOpenSeaTokenMetadataNowAndLater({
  tokenId,
  contractAddress = dyoorS2Contract,
  delayMs = configuredRefreshDelayMs(),
  reason = "trait_lab_update",
}: {
  tokenId: number | string;
  contractAddress?: string;
  delayMs?: number;
  reason?: string;
}): Promise<OpenSeaMetadataRefreshResult> {
  const immediate = await refreshOpenSeaTokenMetadata({ tokenId, contractAddress });
  const followUp = await queueOpenSeaTokenMetadataRefresh({
    tokenId,
    contractAddress,
    delayMs,
    reason: `${reason}_follow_up`,
  });

  return {
    ...followUp,
    immediate,
    followUp,
    note: immediate.status === "queued"
      ? "OpenSea metadata refresh fired immediately; follow-up refresh scheduled after the Trait Lab settle delay."
      : "OpenSea follow-up refresh scheduled after the Trait Lab settle delay.",
  };
}

export async function refreshOpenSeaTokenMetadata({
  tokenId,
  contractAddress = dyoorS2Contract,
}: {
  tokenId: number | string;
  contractAddress?: string;
}): Promise<OpenSeaMetadataRefreshResult> {
  const chain = configuredOpenSeaChain();
  const identifier = String(tokenId || "").trim();
  const endpoint = `https://api.opensea.io/api/v2/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contractAddress)}/nfts/${encodeURIComponent(identifier)}/refresh?ignoreCachedItemUrls=true`;
  const base = {
    chain,
    contractAddress,
    tokenId: identifier,
    endpoint,
  };

  if (envFlag(readEnv("OPENSEA_METADATA_REFRESH_DISABLED", "DYOOR_OPENSEA_METADATA_REFRESH_DISABLED"))) {
    return { ...base, status: "skipped", note: "OpenSea metadata refresh is disabled by environment." };
  }

  const apiKey = readEnv("OPENSEA_API_KEY");
  if (!apiKey) {
    return { ...base, status: "skipped", note: "OPENSEA_API_KEY is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuredTimeoutMs());

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    const payload = responsePayload(text);
    if (!response.ok) {
      return {
        ...base,
        status: "failed",
        statusCode: response.status,
        response: payload,
        error: `OpenSea refresh failed with HTTP ${response.status}.`,
      };
    }
    return {
      ...base,
      status: "queued",
      statusCode: response.status,
      response: payload,
      queuedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    return {
      ...base,
      status: "failed",
      error: name === "AbortError"
        ? "OpenSea refresh request timed out."
        : message || "OpenSea refresh request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
