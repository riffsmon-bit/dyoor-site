import { createHmac, timingSafeEqual } from "node:crypto";
import { ethers } from "ethers";

const DYOOR_WORLD_CHAIN_ID = 143;
const DYOOR_WORLD_SESSION_TTL_SECONDS = 12 * 60 * 60;
const DYOOR_S2_MAINNET_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";

function normalizeWorldWallet(value: unknown) {
  const wallet = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export type DyoorWorldChallenge = {
  version: 1;
  wallet: string;
  nonce: string;
  audience: string;
  issuedAt: string;
  expiresAt: string;
  message: string;
};

export type DyoorWorldSession = {
  version: 1;
  wallet: string;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
};

function sessionSecret() {
  const configured = String(
    process.env.DYOOR_WORLD_SESSION_SECRET
      || process.env.VERIFY_SESSION_SECRET
      || process.env.DYOOR_TRAIT_LAB_SECRET
      || "",
  ).trim();

  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") {
    return "dyoor-world-local-development-session-secret-only";
  }
  throw Object.assign(
    new Error("DYOOR_WORLD_SESSION_SECRET must contain at least 32 characters."),
    { status: 503 },
  );
}

export function dyoorWorldChallengeMessage(input: Omit<DyoorWorldChallenge, "version" | "message">) {
  return [
    "D.Y.O.O.R World Holder Access",
    "Sign this message to enter the private holder world. This request does not create a transaction.",
    `Wallet: ${normalizeWorldWallet(input.wallet)}`,
    `Chain ID: ${DYOOR_WORLD_CHAIN_ID}`,
    `S2 Contract: ${DYOOR_S2_MAINNET_CONTRACT.toLowerCase()}`,
    `Audience: ${input.audience}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createDyoorWorldSessionToken(wallet: string, now = Date.now()) {
  const normalized = normalizeWorldWallet(wallet);
  if (!normalized) throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  const session: DyoorWorldSession = {
    version: 1,
    wallet: normalized,
    chainId: DYOOR_WORLD_CHAIN_ID,
    issuedAt: now,
    expiresAt: now + (DYOOR_WORLD_SESSION_TTL_SECONDS * 1000),
  };
  const payload = encode(JSON.stringify(session));
  return `${payload}.${signature(payload)}`;
}

export function verifyDyoorWorldSessionToken(token: string, now = Date.now()) {
  const [payload, suppliedSignature, ...extra] = String(token || "").split(".");
  if (!payload || !suppliedSignature || extra.length) return null;

  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const session = JSON.parse(decode(payload)) as DyoorWorldSession;
    if (
      session.version !== 1
      || session.chainId !== DYOOR_WORLD_CHAIN_ID
      || !normalizeWorldWallet(session.wallet)
      || !Number.isSafeInteger(session.issuedAt)
      || !Number.isSafeInteger(session.expiresAt)
      || session.issuedAt > now + 30_000
      || session.expiresAt <= now
      || session.expiresAt - session.issuedAt > (DYOOR_WORLD_SESSION_TTL_SECONDS * 1000)
    ) {
      return null;
    }
    return { ...session, wallet: normalizeWorldWallet(session.wallet) };
  } catch {
    return null;
  }
}

export function recoverDyoorWorldChallengeWallet(challenge: DyoorWorldChallenge, signatureValue: string) {
  try {
    return normalizeWorldWallet(ethers.verifyMessage(challenge.message, signatureValue));
  } catch {
    return "";
  }
}

export function readDyoorWorldCookie(cookieHeader: string, cookieName: string) {
  for (const item of String(cookieHeader || "").split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === cookieName) return decodeURIComponent(parts.join("="));
  }
  return "";
}
