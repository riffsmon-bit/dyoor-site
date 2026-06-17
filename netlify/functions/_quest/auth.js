import { verifyMessage } from "ethers";
import * as config from "./config.js";
import * as store from "./store.js";

async function loginChallenge(address) {
  return store.createChallenge(address);
}

async function verifyWalletAuth(body = {}) {
  const wallet = config.normalizeAddress(body.wallet_address || body.walletAddress || body.wallet);
  const signature = String(body.signature || "");
  const message = String(body.message || "");
  if (!wallet || !signature || !message) throw new Error("Wallet signature is required.");
  await store.consumeChallenge({ walletAddress: wallet, message });

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
