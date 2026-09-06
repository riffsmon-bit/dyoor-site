import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  recoverMessageAddress,
} from "viem";
import { getVerifyConfig } from "./config.js";

const ERC721_ABI = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }],
}];

const ASCENSION_ABI = [{
  type: "function",
  name: "tokensOfStaker",
  stateMutability: "view",
  inputs: [{ name: "user", type: "address" }],
  outputs: [{ name: "tokenIds", type: "uint256[]" }],
}];

const memberships = ["season1", "ascended", "season2", "hoodyoor"];
let cachedClients;
let healthCache;

export function normalizeAddress(value) {
  if (!isAddress(String(value || ""), { strict: false })) {
    throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  }
  return getAddress(String(value)).toLowerCase();
}

function clients() {
  if (!cachedClients) {
    const config = getVerifyConfig();
    cachedClients = {
      monad: createPublicClient({
        transport: http(config.chains.monad.rpcUrl, { timeout: config.sync.rpcTimeoutMs }),
      }),
      robinhood: createPublicClient({
        transport: http(config.chains.robinhood.rpcUrl, { timeout: config.sync.rpcTimeoutMs }),
      }),
    };
  }
  return cachedClients;
}

async function withRetries(task) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function chainHealth(fresh = false) {
  if (!fresh && healthCache?.expiresAt > Date.now()) return healthCache.value;
  const config = getVerifyConfig();
  const [monad, robinhood] = await Promise.all([
    withRetries(() => clients().monad.getChainId())
      .then((id) => ({ ok: id === config.chains.monad.id, id }))
      .catch(() => ({ ok: false, id: null })),
    withRetries(() => clients().robinhood.getChainId())
      .then((id) => ({ ok: id === config.chains.robinhood.id, id }))
      .catch(() => ({ ok: false, id: null })),
  ]);
  const value = { monad, robinhood };
  healthCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

async function checkErc721(key, chainKey, address, wallet, health) {
  if (!health[chainKey].ok) return { key, status: "RPC_ERROR", balance: null };
  try {
    const balance = await withRetries(() => clients()[chainKey].readContract({
      address: getAddress(address),
      abi: ERC721_ABI,
      functionName: "balanceOf",
      args: [getAddress(wallet)],
    }));
    return {
      key,
      status: balance > 0n ? "QUALIFIED" : "CONFIRMED_ZERO",
      balance: balance.toString(),
    };
  } catch {
    return { key, status: "RPC_ERROR", balance: null };
  }
}

async function checkAscension(address, wallet, health) {
  if (!health.monad.ok) return { key: "ascended", status: "RPC_ERROR", balance: null };
  try {
    const tokenIds = await withRetries(() => clients().monad.readContract({
      address: getAddress(address),
      abi: ASCENSION_ABI,
      functionName: "tokensOfStaker",
      args: [getAddress(wallet)],
    }));
    return {
      key: "ascended",
      status: tokenIds.length > 0 ? "QUALIFIED" : "CONFIRMED_ZERO",
      balance: String(tokenIds.length),
    };
  } catch {
    return { key: "ascended", status: "RPC_ERROR", balance: null };
  }
}

export async function getVerificationSnapshot(walletValue, freshHealth = false) {
  const wallet = normalizeAddress(walletValue);
  const config = getVerifyConfig();
  const health = await chainHealth(freshHealth);
  const reads = await Promise.all([
    checkErc721("season1", "monad", config.contracts.season1, wallet, health),
    checkAscension(config.contracts.ascended, wallet, health),
    checkErc721("season2", "monad", config.contracts.season2, wallet, health),
    checkErc721("hoodyoor", "robinhood", config.contracts.hoodyoor, wallet, health),
  ]);
  const entitlements = Object.fromEntries(
    reads.map((read) => [read.key, read.status === "QUALIFIED"]),
  );
  return {
    version: 2,
    wallet,
    checkedAt: Date.now(),
    reads: Object.fromEntries(reads.map((read) => [read.key, read])),
    entitlements,
    qualified: memberships.some((key) => entitlements[key]),
    rpcUncertain: reads.filter((read) => read.status === "RPC_ERROR").map((read) => read.key),
  };
}

export async function recoverVerificationSigner(message, signature) {
  try {
    return normalizeAddress(await recoverMessageAddress({ message, signature }));
  } catch {
    return "";
  }
}

export async function verifyContractRegistry() {
  const config = getVerifyConfig();
  const health = await chainHealth(true);
  const checks = [];
  for (const [key, address] of Object.entries(config.contracts)) {
    const chainKey = key === "hoodyoor" ? "robinhood" : "monad";
    let code = "0x";
    if (health[chainKey].ok) {
      code = await clients()[chainKey].getBytecode({ address: getAddress(address) }).catch(() => "0x");
    }
    checks.push({
      key,
      address: normalizeAddress(address),
      chainId: config.chains[chainKey].id,
      ok: Boolean(health[chainKey].ok && code && code !== "0x"),
    });
  }
  return { health, contracts: checks };
}

export function resetChainClientsForTests() {
  cachedClients = undefined;
  healthCache = undefined;
}
