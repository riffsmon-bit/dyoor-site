import { ethers } from "ethers";
import {
  ADMIN_AUTH_CHAIN_ID,
  ADMIN_AUTH_VERSION,
  adminMessage,
  adminPayloadHash,
  adminRequestPayload,
  type AdminAction,
} from "@/lib/adminMessage";
import { createJsonStore } from "@/src/lib/storage/fileStore";

const ADMIN_WINDOW_MS = 5 * 60 * 1000;
const ADMIN_NONCE_STORE = "dyoor-admin-auth";
const adminNonceStore = createJsonStore(ADMIN_NONCE_STORE);

const globalForAdmin = globalThis as typeof globalThis & {
  __dyoorAdminNonces?: Map<string, number>;
};

const usedAdminNonces = globalForAdmin.__dyoorAdminNonces ?? new Map<string, number>();
globalForAdmin.__dyoorAdminNonces = usedAdminNonces;

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function normalizeAdminAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

export function adminOwnerWallet() {
  return normalizeAdminAddress(readEnv("ENERGY_ADMIN_ADDRESS", "DYOOR_OWNER_ADDRESS", "ADMIN_WALLET", "OWNER_WALLET", "ADMIN_WALLETS").split(",")[0]);
}

function pruneExpiredNonces(now: number) {
  for (const [key, expiresAt] of usedAdminNonces.entries()) {
    if (expiresAt <= now) usedAdminNonces.delete(key);
  }
}

function nonceKey(wallet: string, action: AdminAction, nonce: string) {
  const digest = ethers.keccak256(ethers.toUtf8Bytes(`${wallet.toLowerCase()}:${action}:${nonce}`));
  return `nonces/${digest.slice(2)}.json`;
}

async function assertNonceAvailable(
  wallet: string,
  action: AdminAction,
  nonce: string,
  now: number,
) {
  pruneExpiredNonces(now);
  const key = `${wallet.toLowerCase()}:${action}:${nonce}`;
  if (usedAdminNonces.has(key)) {
    throw Object.assign(new Error("Admin nonce was already used. Sign again."), { status: 409 });
  }

  const durableKey = nonceKey(wallet, action, nonce);
  const existing = await adminNonceStore.getJsonStrict<{ expiresAt?: number }>(durableKey);
  if (existing && Number(existing.expiresAt || 0) > now) {
    throw Object.assign(new Error("Admin nonce was already used. Sign again."), { status: 409 });
  }
  return { durableKey, key };
}

async function markNonce(
  wallet: string,
  action: AdminAction,
  route: string,
  payloadHash: string,
  nonce: string,
  now: number,
  windowMs = ADMIN_WINDOW_MS,
) {
  const { durableKey, key } = await assertNonceAvailable(wallet, action, nonce, now);
  const expiresAt = now + windowMs;
  await adminNonceStore.setJson(durableKey, {
    version: 1,
    wallet: wallet.toLowerCase(),
    action,
    route,
    payloadHash,
    nonce,
    consumedAt: new Date(now).toISOString(),
    expiresAt,
  });
  usedAdminNonces.set(key, now + windowMs);
}

export async function verifyAdmin(
  body: Record<string, unknown>,
  action: AdminAction,
  options: {
    consumeNonce?: boolean;
    payload?: unknown;
    route: string;
    windowMs?: number;
  },
) {
  const owner = adminOwnerWallet();
  if (!owner) throw Object.assign(new Error("Admin owner wallet is not configured."), { status: 500 });

  const signedWallet = String(body.wallet || "").trim();
  const wallet = normalizeAdminAddress(signedWallet);
  const timestamp = String(body.timestamp || "");
  const nonce = String(body.nonce || "");
  const signature = String(body.signature || "");
  const authVersion = String(body.authVersion || "");
  const chainId = Number(body.chainId);
  const signedRoute = String(body.route || "");
  const suppliedPayloadHash = String(body.payloadHash || "").toLowerCase();
  const now = Date.now();
  const windowMs = options.windowMs || ADMIN_WINDOW_MS;

  if (!wallet) throw Object.assign(new Error("Missing wallet."), { status: 400 });
  if (wallet.toLowerCase() !== owner.toLowerCase()) throw Object.assign(new Error("Not authorized."), { status: 403 });
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > windowMs) {
    throw Object.assign(new Error("Admin signature expired. Sign again."), { status: 401 });
  }
  if (!nonce || nonce.length < 8 || !signature) {
    throw Object.assign(new Error("Missing admin signature."), { status: 400 });
  }
  if (authVersion !== ADMIN_AUTH_VERSION || chainId !== ADMIN_AUTH_CHAIN_ID) {
    throw Object.assign(new Error("Unsupported admin authorization domain or chain."), { status: 401 });
  }
  if (!options.route.startsWith("/api/admin/") || signedRoute !== options.route) {
    throw Object.assign(new Error("Admin signature does not match this route."), { status: 401 });
  }

  const expectedPayloadHash = adminPayloadHash(options.payload ?? adminRequestPayload(body)).toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(suppliedPayloadHash) || suppliedPayloadHash !== expectedPayloadHash) {
    throw Object.assign(new Error("Admin signature payload does not match this request."), { status: 401 });
  }

  let recovered = "";
  try {
    recovered = normalizeAdminAddress(ethers.verifyMessage(adminMessage({
      wallet,
      timestamp,
      nonce,
      action,
      route: options.route,
      payloadHash: expectedPayloadHash,
    }), signature));
  } catch {
    recovered = "";
  }
  if (recovered.toLowerCase() !== owner.toLowerCase()) {
    throw Object.assign(new Error("Admin signature does not match owner wallet."), { status: 401 });
  }

  if (options.consumeNonce === false) {
    await assertNonceAvailable(owner, action, nonce, now);
  } else {
    await markNonce(owner, action, options.route, expectedPayloadHash, nonce, now, windowMs);
  }
  return owner;
}
