import { verifyMessage } from "ethers";
import { randomUUID } from "node:crypto";
import * as config from "./config.js";

function challengeMessage(wallet, nonce, issuedAt) {
  return [
    "D.Y.O.O.R Quest Terminal",
    `Wallet: ${wallet}`,
    "Action: quest-mode-login",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "This signature proves wallet ownership and does not send a transaction.",
  ].join("\n");
}

async function loginChallenge(address) {
  const wallet = config.normalizeAddress(address);
  if (!wallet) throw new Error("Invalid wallet address.");
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const nonce = randomUUID();
  return {
    wallet_address: wallet,
    nonce,
    message: challengeMessage(wallet, nonce, issuedAt),
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
}

function validateChallengeMessage({ wallet, message }) {
  const lines = String(message || "").split("\n");
  const messageWallet = config.normalizeAddress(lines.find((line) => line.startsWith("Wallet: "))?.replace("Wallet: ", ""));
  const action = lines.find((line) => line.startsWith("Action: "))?.replace("Action: ", "");
  const nonce = lines.find((line) => line.startsWith("Nonce: "))?.replace("Nonce: ", "");
  const issuedAt = lines.find((line) => line.startsWith("Issued At: "))?.replace("Issued At: ", "");
  const issuedAtMs = Date.parse(issuedAt);

  if (lines[0] !== "D.Y.O.O.R Quest Terminal") throw new Error("Quest signature message mismatch.");
  if (messageWallet !== wallet) throw new Error("Quest signature wallet mismatch.");
  if (action !== "quest-mode-login") throw new Error("Quest signature action mismatch.");
  if (!/^[0-9a-f-]{36}$/i.test(nonce)) throw new Error("Quest signature nonce missing.");
  if (!Number.isFinite(issuedAtMs)) throw new Error("Quest signature timestamp missing.");
  if (issuedAtMs > Date.now() + 60_000) throw new Error("Quest signature timestamp is invalid.");
  if (Date.now() - issuedAtMs > 10 * 60 * 1000) throw new Error("Quest signature challenge expired.");
}

async function verifyWalletAuth(body = {}) {
  const wallet = config.normalizeAddress(body.wallet_address || body.walletAddress || body.wallet);
  const signature = String(body.signature || "");
  const message = String(body.message || "");
  if (!wallet || !signature || !message) throw new Error("Wallet signature is required.");
  validateChallengeMessage({ wallet, message });

  const recovered = config.normalizeAddress(verifyMessage(message, signature));
  if (recovered !== wallet) throw new Error("Signature does not match wallet.");
  return wallet;
}

function isAdminWallet(wallet) {
  const normalized = config.normalizeAddress(wallet);
  return Boolean(normalized && config.adminWallets().includes(normalized));
}

async function requireAdmin(body = {}) {
  const wallet = await verifyWalletAuth(body);
  if (!config.hasAdminWalletConfig()) throw new Error("ADMIN_WALLETS is not configured in this environment.");
  if (!isAdminWallet(wallet)) throw new Error("Admin wallet required.");
  return wallet;
}

export {
  loginChallenge,
  verifyWalletAuth,
  isAdminWallet,
  requireAdmin,
};
