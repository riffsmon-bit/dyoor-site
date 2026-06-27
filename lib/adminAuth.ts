import { ethers } from "ethers";
import { adminMessage, type AdminAction } from "@/lib/adminMessage";

const ADMIN_WINDOW_MS = 5 * 60 * 1000;

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

function markNonce(wallet: string, action: AdminAction, nonce: string, now: number) {
  pruneExpiredNonces(now);
  const key = `${wallet.toLowerCase()}:${action}:${nonce}`;
  if (usedAdminNonces.has(key)) {
    throw Object.assign(new Error("Admin nonce was already used. Sign again."), { status: 409 });
  }
  usedAdminNonces.set(key, now + ADMIN_WINDOW_MS);
}

export async function verifyAdmin(body: Record<string, unknown>, action: AdminAction) {
  const owner = adminOwnerWallet();
  if (!owner) throw Object.assign(new Error("Admin owner wallet is not configured."), { status: 500 });

  const wallet = normalizeAdminAddress(body.wallet);
  const timestamp = String(body.timestamp || "");
  const nonce = String(body.nonce || "");
  const signature = String(body.signature || "");
  const now = Date.now();

  if (!wallet) throw Object.assign(new Error("Missing wallet."), { status: 400 });
  if (wallet.toLowerCase() !== owner.toLowerCase()) throw Object.assign(new Error("Not authorized."), { status: 403 });
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > ADMIN_WINDOW_MS) {
    throw Object.assign(new Error("Admin signature expired. Sign again."), { status: 401 });
  }
  if (!nonce || nonce.length < 8 || !signature) {
    throw Object.assign(new Error("Missing admin signature."), { status: 400 });
  }

  let recovered = "";
  try {
    recovered = normalizeAdminAddress(ethers.verifyMessage(adminMessage(wallet, timestamp, nonce, action), signature));
  } catch {
    recovered = "";
  }
  if (recovered.toLowerCase() !== owner.toLowerCase()) {
    throw Object.assign(new Error("Admin signature does not match owner wallet."), { status: 401 });
  }

  markNonce(owner, action, nonce, now);
  return owner;
}
