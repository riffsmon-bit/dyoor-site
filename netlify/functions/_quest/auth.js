import { verifyMessage } from "ethers";
import * as config from "./config.js";

function loginMessage(address) {
  return [
    "D.Y.O.O.R Quest Terminal",
    `Wallet: ${config.normalizeAddress(address)}`,
    "Action: login",
  ].join("\n");
}

function verifyWalletAuth(body = {}) {
  const wallet = config.normalizeAddress(body.wallet_address || body.walletAddress || body.wallet);
  const signature = String(body.signature || "");
  const message = String(body.message || "");
  if (!wallet || !signature || !message) throw new Error("Wallet signature is required.");
  if (message !== loginMessage(wallet)) throw new Error("Quest signature message mismatch.");

  const recovered = config.normalizeAddress(verifyMessage(message, signature));
  if (recovered !== wallet) throw new Error("Signature does not match wallet.");
  return wallet;
}

function isAdminWallet(wallet) {
  const normalized = config.normalizeAddress(wallet);
  return Boolean(normalized && config.adminWallets().includes(normalized));
}

function requireAdmin(body = {}) {
  const wallet = verifyWalletAuth(body);
  if (!config.hasAdminWalletConfig()) throw new Error("ADMIN_WALLETS is not configured in this environment.");
  if (!isAdminWallet(wallet)) throw new Error("Admin wallet required.");
  return wallet;
}

export {
  loginMessage,
  verifyWalletAuth,
  isAdminWallet,
  requireAdmin,
};
