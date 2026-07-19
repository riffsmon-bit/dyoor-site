import { dyoorS2Contract } from "@/lib/contracts/addresses";

export type OpenSeaMetadataRefreshResult = {
  status: "queued" | "skipped" | "failed";
  chain: string;
  contractAddress: string;
  tokenId: string;
  statusCode?: number;
  endpoint?: string;
  response?: unknown;
  error?: string;
  note?: string;
  queuedAt?: string;
};

const DEFAULT_OPENSEA_CHAIN = "monad";
const DEFAULT_TIMEOUT_MS = 3500;

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

function responsePayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed.slice(0, 500);
  }
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
