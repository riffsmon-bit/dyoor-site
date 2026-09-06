import { ethers } from "ethers";

export type AdminAction = "snapshot" | "energy-airdrop" | "energy-reconciliation" | "energy-index" | "metadata" | "droid-economy";

export const ADMIN_AUTH_VERSION = "2";
export const ADMIN_AUTH_DOMAIN = "dyoor.fun";
export const ADMIN_AUTH_CHAIN_ID = 143;

const AUTH_FIELDS = new Set([
  "authVersion",
  "chainId",
  "nonce",
  "payloadHash",
  "route",
  "signature",
  "timestamp",
  "wallet",
]);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Admin payload contains a non-finite number.");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item) ?? null);
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = canonicalJsonValue((value as Record<string, unknown>)[key]);
      if (next !== undefined) result[key] = next;
    }
    return result;
  }
  return undefined;
}

export function canonicalAdminPayload(payload: unknown) {
  return JSON.stringify(canonicalJsonValue(payload) ?? null);
}

export function adminPayloadHash(payload: unknown) {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalAdminPayload(payload)));
}

export function adminRequestPayload(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !AUTH_FIELDS.has(key)));
}

export function adminMessage({
  wallet,
  timestamp,
  nonce,
  action,
  route,
  payloadHash,
  chainId = ADMIN_AUTH_CHAIN_ID,
}: {
  wallet: string;
  timestamp: string;
  nonce: string;
  action: AdminAction;
  route: string;
  payloadHash: string;
  chainId?: number;
}) {
  return [
    "DYOOR Admin Command",
    `Version: ${ADMIN_AUTH_VERSION}`,
    `Domain: ${ADMIN_AUTH_DOMAIN}`,
    `Chain ID: ${chainId}`,
    `Route: ${route}`,
    `Action: ${action}`,
    `Wallet: ${wallet.toLowerCase()}`,
    `Payload Hash: ${payloadHash.toLowerCase()}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function createAdminAuthorization({
  wallet,
  timestamp,
  nonce,
  action,
  route,
  payload,
  chainId = ADMIN_AUTH_CHAIN_ID,
}: {
  wallet: string;
  timestamp: string;
  nonce: string;
  action: AdminAction;
  route: string;
  payload: unknown;
  chainId?: number;
}) {
  const payloadHash = adminPayloadHash(payload);
  return {
    authVersion: ADMIN_AUTH_VERSION,
    chainId,
    route,
    payloadHash,
    message: adminMessage({
      wallet,
      timestamp,
      nonce,
      action,
      route,
      payloadHash,
      chainId,
    }),
  };
}
