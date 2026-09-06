import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { ethers } from "ethers";
import {
  DYOOR_WORLD_CHALLENGE_TTL_MS,
  DYOOR_WORLD_CHANNELS,
  DYOOR_WORLD_COLLECTIONS,
  DYOOR_WORLD_SESSION_COOKIE,
  DYOOR_WORLD_SESSION_TTL_SECONDS,
  canAccessDyoorWorldChannel,
  dyoorWorldChannelsForEntitlements,
  type DyoorWorldAvatar,
  type DyoorWorldChannelId,
  type DyoorWorldEntitlementKey,
  type DyoorWorldEntitlements,
  type DyoorWorldMessage,
  type DyoorWorldMessageView,
  type DyoorWorldNameClaim,
  type DyoorWorldProfile,
  isWorldChannel,
  isWorldOwnerChannel,
  isWorldWritableChannel,
  normalizeDyoorWorldMessageReply,
  normalizeWorldLabel,
  normalizeWorldMessageId,
  normalizeWorldWallet,
  resolveWorldNameClaims,
  shortWorldWallet,
  validateWorldLabel,
  worldProfileFromClaim,
} from "@/lib/dyoor-world";
import {
  normalizeDyoorWorldAttachment,
  type DyoorWorldMessageAttachment,
} from "@/lib/dyoor-world-media";
import type {
  DyoorWorldDirectConversationView,
  DyoorWorldDirectMessage,
  DyoorWorldDirectMessageView,
} from "@/lib/dyoor-world-direct";
import {
  enqueueDyoorWorldPush,
  processDyoorWorldPushOutbox as processPushOutbox,
} from "@/lib/dyoor-world-push-server";
import {
  DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS,
  DYOOR_WORLD_CHAT_REWARD_DAILY_CAP,
  DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP,
  DYOOR_WORLD_CHAT_REWARD_ENERGY,
  DYOOR_WORLD_TIP_REWARD_DAILY_CAP,
  DYOOR_WORLD_TIP_REWARD_ENERGY,
  DYOOR_WORLD_TIP_REWARD_MIN_MON,
  DYOOR_WORLD_TRADE_REWARD_DAILY_CAP,
  DYOOR_WORLD_TRADE_REWARD_ENERGY,
  type DyoorWorldRewardClaim,
  type DyoorWorldRewardKind,
  type DyoorWorldRewardRecord,
  dyoorWorldDailyPrize,
  dyoorWorldUtcDate,
  qualifiesForDyoorWorldChatReward,
} from "@/lib/dyoor-world-rewards";
import {
  createDyoorWorldSessionToken,
  dyoorWorldChallengeMessage,
  readDyoorWorldCookie,
  recoverDyoorWorldChallengeWallet,
  verifyDyoorWorldSessionToken,
  type DyoorWorldChallenge,
  type DyoorWorldSession,
} from "@/lib/dyoor-world-auth";
import { dyoorWorldRequestAudience } from "@/lib/dyoor-world-origin";
import {
  dyoorS2Contract,
  energyBankContract,
  optionalContractAddress,
} from "@/lib/contracts/addresses";
import { S2_ISSUED_SUPPLY_FALLBACK } from "@/lib/s2-supply";
import { createJsonStore } from "@/src/lib/storage/fileStore";
import { createMonadReadProvider } from "@/lib/monad-rpc";

const worldStore = createJsonStore("dyoor-world");
const ERC721_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const ASCENSION_BALANCE_ABI = [
  "function tokensOfStaker(address user) view returns (uint256[])",
];
const ERC721_OWNER_ABI = ["function ownerOf(uint256 tokenId) view returns (address)"];
const OWNABLE_ABI = ["function owner() view returns (address)"];
const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];
const WORLD_TRADE_ABI = [
  "event TradeCreated(uint256 indexed tradeId,address indexed maker,address indexed taker,uint256 offeredTokenId,uint256 requestedTokenId,uint256 monOffered,uint256 monRequested,uint64 expiresAt)",
  "event TradeCompleted(uint256 indexed tradeId,address indexed maker,address indexed taker)",
  "event TradeCancelled(uint256 indexed tradeId,address indexed maker)",
  "event TradeExpired(uint256 indexed tradeId,address indexed maker)",
  "function S2_COLLECTION() view returns (address)",
  "function trades(uint256 tradeId) view returns (address maker,address taker,uint256 offeredTokenId,uint256 requestedTokenId,uint256 monOffered,uint256 monRequested,uint64 expiresAt,uint8 status)",
];
const WORLD_NAMES_ABI = [
  "function nameOf(address wallet) view returns (string)",
  "function ownerOfName(string label) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function labelOfToken(uint256 tokenId) view returns (string)",
  "function claimsOpen() view returns (bool)",
  "function isAvailable(string label) view returns (bool)",
  "function isHolder(address wallet) view returns (bool)",
  "function S2_COLLECTION() view returns (address)",
];
export type DyoorWorldAccessSnapshot = {
  wallet: string;
  eligible: boolean;
  entitlements: DyoorWorldEntitlements;
  balances: Record<DyoorWorldEntitlementKey, string | null>;
  unavailable: DyoorWorldEntitlementKey[];
  checkedAt: string;
};

const holderCache = new Map<string, {
  access: DyoorWorldAccessSnapshot;
  expiresAt: number;
}>();
const challengeConsumeLocks = new Map<string, Promise<void>>();
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
let worldOwnerCache: { wallet: string; expiresAt: number } | null = null;
let rewardClaimQueue = Promise.resolve();
const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)").toLowerCase();
const DEFAULT_S2_DEPLOYMENT_BLOCK = 87_616_887;
const DEFAULT_ETHERSCAN_V2_API_URL = "https://api.etherscan.io/v2/api";
const DEFAULT_WORLD_NAMES_CONTRACT = "0xDE073c0ea9052a51c7fC67BE6fc311a1C0c00357";
const DEFAULT_WORLD_TRADE_ESCROW = "0xdea68BF8acFd96F174f93Bd936A5dc3d2f010601";

type DyoorWorldAvatarRecord = DyoorWorldAvatar & {
  version: 1;
  wallet: string;
};

type DyoorWorldTipRecord = {
  version: 1;
  txHash: string;
  from: string;
  to: string;
  amountWei: string;
  amountMon: string;
  createdAt: string;
};

type DyoorWorldDirectInboxRecord = {
  version: 1;
  conversationId: string;
  wallet: string;
  otherWallet: string;
  lastMessageId: string;
  lastMessage: string;
  lastMessageAt: string;
  lastSender: string;
  unreadCount: number;
};

type RequestSession = {
  session: DyoorWorldSession;
  wallet: string;
};

export function dyoorWorldError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function dyoorWorldErrorStatus(error: unknown) {
  const value = Number((error as { status?: number })?.status || 500);
  return value >= 400 && value <= 599 ? value : 500;
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function envFlag(...names: string[]) {
  return /^(1|true|yes|on)$/i.test(readEnv(...names));
}

function derivedWorldSecret(purpose: "automation" | "reward") {
  const master = readEnv(
    "DYOOR_WORLD_SESSION_SECRET",
    "VERIFY_SESSION_SECRET",
    "DYOOR_TRAIT_LAB_SECRET",
  );
  if (master.length < 32) return "";
  return createHmac("sha256", master)
    .update(`dyoor-world:${purpose}:v1`)
    .digest("hex");
}

function worldAutomationSecret() {
  return readEnv("DYOOR_WORLD_AUTOMATION_SECRET") || derivedWorldSecret("automation");
}

function worldRewardSecret() {
  return readEnv("DYOOR_WORLD_REWARD_SECRET") || derivedWorldSecret("reward");
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function worldRpcUrl() {
  const rpcUrl = readEnv(
    "DYOOR_S2_RPC_URL",
    "MONAD_RPC_URL",
    "NEXT_PUBLIC_MONAD_RPC_URL",
    "ALCHEMY_MONAD_RPC_URL",
  ) || "https://rpc.monad.xyz";
  if (/testnet/i.test(rpcUrl)) {
    throw dyoorWorldError("dYOOR World requires a Monad mainnet RPC endpoint.", 503);
  }
  return rpcUrl;
}

let worldProvider: ethers.FallbackProvider | null = null;
let robinhoodWorldProvider: ethers.JsonRpcProvider | null = null;

function provider() {
  // Validate explicit configuration, then use bounded multi-provider reads.
  worldRpcUrl();
  if (!worldProvider) worldProvider = createMonadReadProvider();
  return worldProvider;
}

function robinhoodWorldRpcUrl() {
  const rpcUrl = readEnv(
    "HOODYOOR_RPC_URL",
    "ROBINHOOD_RPC_URL",
    "NEXT_PUBLIC_ROBINHOOD_RPC_URL",
  ) || "https://rpc.mainnet.chain.robinhood.com";
  if (/testnet/i.test(rpcUrl)) {
    throw dyoorWorldError("HoodYØØR access requires a Robinhood Chain mainnet RPC endpoint.", 503);
  }
  return rpcUrl;
}

function robinhoodProvider() {
  if (!robinhoodWorldProvider) {
    robinhoodWorldProvider = new ethers.JsonRpcProvider(robinhoodWorldRpcUrl(), 4_663);
  }
  return robinhoodWorldProvider;
}

async function dyoorWorldOwnerWallet() {
  const configured = normalizeWorldWallet(readEnv(
    "DYOOR_WORLD_OWNER_WALLET",
    "DYOOR_OWNER_ADDRESS",
    "ADMIN_WALLET",
    "OWNER_WALLET",
  ).split(",")[0]);
  if (configured) return configured;
  if (worldOwnerCache && worldOwnerCache.expiresAt > Date.now()) {
    return worldOwnerCache.wallet;
  }
  const collection = new ethers.Contract(dyoorS2Contract, OWNABLE_ABI, provider());
  const wallet = normalizeWorldWallet(await collection.owner());
  if (!wallet) throw dyoorWorldError("The World owner wallet is unavailable.", 503);
  worldOwnerCache = {
    wallet,
    expiresAt: Date.now() + 5 * 60_000,
  };
  return wallet;
}

export async function canPostDyoorWorldAnnouncements(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  return Boolean(wallet && wallet === await dyoorWorldOwnerWallet());
}

export function dyoorWorldNamesContractAddress() {
  return optionalContractAddress(
    process.env.DYOOR_WORLD_NAMES_CONTRACT
      || process.env.NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT
      || DEFAULT_WORLD_NAMES_CONTRACT,
  );
}

export function dyoorWorldTradeEscrowAddress() {
  return optionalContractAddress(
    process.env.DYOOR_WORLD_TRADE_ESCROW_ADDRESS
      || process.env.NEXT_PUBLIC_DYOOR_WORLD_TRADE_ESCROW_ADDRESS
      || DEFAULT_WORLD_TRADE_ESCROW,
  );
}

export function dyoorWorldRewardsEnabled() {
  return envFlag("DYOOR_WORLD_REWARDS_ENABLED");
}

export function dyoorWorldSalesBotEnabled() {
  return envFlag("DYOOR_WORLD_SALES_BOT_ENABLED");
}

function namesContract() {
  const address = dyoorWorldNamesContractAddress();
  return address ? new ethers.Contract(address, WORLD_NAMES_ABI, provider()) : null;
}

async function validatedNamesContract() {
  const contract = namesContract();
  if (!contract) return null;
  try {
    const configuredCollection = normalizeWorldWallet(await contract.S2_COLLECTION());
    if (configuredCollection !== String(dyoorS2Contract).toLowerCase()) {
      throw dyoorWorldError(
        "The configured dYOOR name registry does not gate the production S2 contract.",
        503,
      );
    }
    return contract;
  } catch (error) {
    if (
      (error as Error)?.message
      === "The configured dYOOR name registry does not gate the production S2 contract."
    ) {
      throw error;
    }
    throw dyoorWorldError("The Monad dYOOR name registry is unavailable.", 503);
  }
}

export function assertDyoorWorldRateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000,
) {
  const now = Date.now();
  if (rateLimitBuckets.size > 5_000) {
    for (const [bucketKey, bucketValue] of rateLimitBuckets) {
      if (bucketValue.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
    while (rateLimitBuckets.size > 5_000) {
      const oldestKey = rateLimitBuckets.keys().next().value;
      if (!oldestKey) break;
      rateLimitBuckets.delete(oldestKey);
    }
  }
  const existing = rateLimitBuckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (bucket.count > limit) {
    throw dyoorWorldError("Too many requests. Wait a moment and try again.", 429);
  }
}

export function dyoorWorldClientIp(request: Request) {
  return String(
    request.headers.get("x-forwarded-for")
      || request.headers.get("x-real-ip")
      || "unknown",
  ).split(",")[0].trim();
}

function assertDyoorWorldOrigin(request: Request) {
  const audience = dyoorWorldRequestAudience(request);
  if (!audience) {
    throw dyoorWorldError("This holder-authentication request came from an untrusted origin.", 403);
  }
  return audience;
}

async function withDyoorWorldChallengeLock<T>(key: string, task: () => Promise<T>) {
  const previous = challengeConsumeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const latch = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => latch);
  challengeConsumeLocks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (challengeConsumeLocks.get(key) === queued) challengeConsumeLocks.delete(key);
  }
}

type DyoorWorldCollectionCheck = {
  key: DyoorWorldEntitlementKey;
  status: "holder" | "not-holder" | "unavailable";
  balance: string | null;
};

function worldReadTimeoutMs() {
  const configured = Number.parseInt(readEnv("DYOOR_WORLD_RPC_TIMEOUT_MS"), 10);
  return Number.isSafeInteger(configured) && configured >= 1_000
    ? Math.min(configured, 10_000)
    : 4_000;
}

async function withWorldReadTimeout<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("holder RPC read timed out")),
          worldReadTimeoutMs(),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDyoorWorldCollection(
  collection: (typeof DYOOR_WORLD_COLLECTIONS)[number],
  wallet: string,
): Promise<DyoorWorldCollectionCheck> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const collectionProvider = collection.chainId === 4_663
        ? robinhoodProvider()
        : provider();
      const contract = new ethers.Contract(
        collection.address,
        collection.ownershipMethod === "tokensOfStaker"
          ? ASCENSION_BALANCE_ABI
          : ERC721_BALANCE_ABI,
        collectionProvider,
      );
      const balance = collection.ownershipMethod === "tokensOfStaker"
        ? BigInt((await withWorldReadTimeout(contract.tokensOfStaker(wallet))).length)
        : BigInt(await withWorldReadTimeout(contract.balanceOf(wallet)));
      return {
        key: collection.key,
        status: balance > 0n ? "holder" : "not-holder",
        balance: balance.toString(),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 175 * (attempt + 1)));
      }
    }
  }
  console.error(`dYOOR World ${collection.key} holder check failed`, lastError);
  return {
    key: collection.key,
    status: "unavailable",
    balance: null,
  };
}

export async function getDyoorWorldAccess(
  walletValue: unknown,
  fresh = false,
): Promise<DyoorWorldAccessSnapshot> {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);

  const cached = holderCache.get(wallet);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.access;

  const checks = await Promise.all(
    DYOOR_WORLD_COLLECTIONS.map((collection) => (
      checkDyoorWorldCollection(collection, wallet)
    )),
  );
  const entitlements: DyoorWorldEntitlements = {
    season1: false,
    ascended: false,
    season2: false,
    hoodyoor: false,
  };
  const balances: Record<DyoorWorldEntitlementKey, string | null> = {
    season1: null,
    ascended: null,
    season2: null,
    hoodyoor: null,
  };
  const unavailable: DyoorWorldEntitlementKey[] = [];
  for (const check of checks) {
    entitlements[check.key] = check.status === "holder";
    balances[check.key] = check.balance;
    if (check.status === "unavailable") unavailable.push(check.key);
  }
  const eligible = Object.values(entitlements).some(Boolean);

  if (!eligible && unavailable.length > 0) {
    throw dyoorWorldError(
      "Could not verify all DYØØR holder contracts. Try again in a moment.",
      503,
    );
  }

  const access: DyoorWorldAccessSnapshot = {
    wallet,
    eligible,
    entitlements,
    balances,
    unavailable,
    checkedAt: new Date().toISOString(),
  };
  holderCache.set(wallet, { access, expiresAt: Date.now() + 15_000 });
  return access;
}

export async function hasDyoorWorldAccess(walletValue: unknown, fresh = false) {
  return (await getDyoorWorldAccess(walletValue, fresh)).eligible;
}

export async function requireDyoorWorldEntitlement(
  walletValue: unknown,
  entitlement: DyoorWorldEntitlementKey,
) {
  const access = await getDyoorWorldAccess(walletValue);
  if (access.entitlements[entitlement]) return access;
  const collection = DYOOR_WORLD_COLLECTIONS.find((item) => item.key === entitlement);
  if (access.unavailable.includes(entitlement)) {
    throw dyoorWorldError(
      `${collection?.label || "Collection"} ownership is temporarily unavailable. Try again shortly.`,
      503,
    );
  }
  throw dyoorWorldError(
    `${collection?.label || "Collection"} ownership is required for this World feature.`,
    403,
  );
}

export async function requireDyoorWorldChannelAccess(
  walletValue: unknown,
  channelValue: unknown,
) {
  const channelId = String(channelValue || "");
  const channel = DYOOR_WORLD_CHANNELS.find((item) => item.id === channelId);
  if (!channel) {
    throw dyoorWorldError("channel must identify a dYOOR World stream.", 400);
  }
  const access = await getDyoorWorldAccess(walletValue);
  if (!access.eligible) {
    throw dyoorWorldError("Current DYØØR holder access is required.", 403);
  }
  if (canAccessDyoorWorldChannel(channelId, access.entitlements)) return access;
  const requiredEntitlements = channel.access === "any"
    ? []
    : Array.isArray(channel.access)
      ? channel.access
      : [channel.access];
  if (
    requiredEntitlements.length > 0
    && requiredEntitlements.every((entitlement) => access.unavailable.includes(entitlement))
  ) {
    throw dyoorWorldError(
      "This collection gate is temporarily unavailable. Try again shortly.",
      503,
    );
  }
  throw dyoorWorldError(
    `Current ${requiredEntitlements.length ? requiredEntitlements.join(" or ") : "DYØØR"} holder access is required for #${channel.label}.`,
    403,
  );
}

function challengeKey(wallet: string, nonce: string) {
  return `auth/challenges/${wallet}/${nonce}.json`;
}

async function pruneDyoorWorldChallenges(wallet: string) {
  const prefix = `auth/challenges/${wallet}/`;
  const keys = await worldStore.listKeys(prefix);
  const records = await Promise.all(keys.map(async (key) => ({
    key,
    challenge: await worldStore.getJsonStrict<DyoorWorldChallenge>(key),
  })));
  const now = Date.now();
  const expiredKeys: string[] = [];
  const active = records
    .filter((record) => {
      const expiry = Date.parse(record.challenge?.expiresAt || "");
      if (!record.challenge || !Number.isFinite(expiry) || expiry <= now) {
        expiredKeys.push(record.key);
        return false;
      }
      return true;
    })
    .sort((left, right) => (
      Date.parse(left.challenge!.issuedAt) - Date.parse(right.challenge!.issuedAt)
    ));
  const surplusKeys = active
    .slice(0, Math.max(0, active.length - 4))
    .map((record) => record.key);
  await Promise.all(
    expiredKeys.concat(surplusKeys)
      .map((key) => worldStore.deleteJson(key).catch(() => undefined)),
  );
}

export async function createDyoorWorldChallenge(request: Request, walletValue: unknown) {
  const audience = assertDyoorWorldOrigin(request);
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  assertDyoorWorldRateLimit(
    `challenge:${wallet}:${dyoorWorldClientIp(request)}`,
    8,
    60_000,
  );
  if (!(await hasDyoorWorldAccess(wallet, true))) {
    throw dyoorWorldError(
      "This wallet does not currently qualify through Season 1, Ascension, Season 2, or HoodYØØR.",
      403,
    );
  }
  await pruneDyoorWorldChallenges(wallet);

  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + DYOOR_WORLD_CHALLENGE_TTL_MS).toISOString();
  const nonce = randomUUID();
  const challengeInput = {
    wallet,
    nonce,
    audience,
    issuedAt,
    expiresAt,
  };
  const challenge: DyoorWorldChallenge = {
    version: 1,
    ...challengeInput,
    message: dyoorWorldChallengeMessage(challengeInput),
  };
  await worldStore.setJson(challengeKey(wallet, nonce), challenge);
  return challenge;
}

export async function completeDyoorWorldChallenge(
  request: Request,
  input: {
    wallet?: unknown;
    nonce?: unknown;
    signature?: unknown;
  },
) {
  const audience = assertDyoorWorldOrigin(request);
  const wallet = normalizeWorldWallet(input.wallet);
  const nonce = String(input.nonce || "").trim();
  const signature = String(input.signature || "").trim();
  assertDyoorWorldRateLimit(
    `session:${wallet || "invalid"}:${dyoorWorldClientIp(request)}`,
    15,
    60_000,
  );
  if (
    !wallet
    || !/^[a-f0-9-]{20,80}$/i.test(nonce)
    || !/^0x(?:[a-f0-9]{128}|[a-f0-9]{130})$/i.test(signature)
  ) {
    throw dyoorWorldError("The signed holder challenge is invalid.", 400);
  }

  const key = challengeKey(wallet, nonce);
  return withDyoorWorldChallengeLock(key, async () => {
    const challenge = await worldStore.getJsonStrict<DyoorWorldChallenge>(key);
    if (!challenge || challenge.version !== 1 || challenge.wallet !== wallet || challenge.nonce !== nonce) {
      throw dyoorWorldError("This holder challenge was not found or was already used.", 401);
    }
    if (challenge.audience !== audience) {
      throw dyoorWorldError("This holder challenge belongs to a different site.", 401);
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      await worldStore.deleteJson(key);
      throw dyoorWorldError("This holder challenge expired. Request a new one.", 401);
    }

    const expectedMessage = dyoorWorldChallengeMessage({
      wallet: challenge.wallet,
      nonce: challenge.nonce,
      audience: challenge.audience,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    });
    if (challenge.message !== expectedMessage) {
      await worldStore.deleteJson(key);
      throw dyoorWorldError("The stored holder challenge failed validation.", 401);
    }
    if (recoverDyoorWorldChallengeWallet(challenge, signature) !== wallet) {
      throw dyoorWorldError("The wallet signature did not match this holder challenge.", 401);
    }
    // Consume immediately after cryptographic validation. A valid signature can
    // never be replayed even if a downstream RPC request subsequently fails.
    await worldStore.deleteJson(key);
    if (!(await hasDyoorWorldAccess(wallet, true))) {
      throw dyoorWorldError(
        "This wallet no longer qualifies through Season 1, Ascension, Season 2, or HoodYØØR.",
        403,
      );
    }

    return {
      wallet,
      token: createDyoorWorldSessionToken(wallet),
    };
  });
}

export function dyoorWorldSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `${DYOOR_WORLD_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${DYOOR_WORLD_SESSION_TTL_SECONDS}`,
    secure.replace(/^;\s*/, ""),
  ].filter(Boolean).join("; ");
}

export function clearDyoorWorldSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `${DYOOR_WORLD_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    secure.replace(/^;\s*/, ""),
  ].filter(Boolean).join("; ");
}

export async function authenticateDyoorWorldToken(token: string): Promise<RequestSession | null> {
  const session = verifyDyoorWorldSessionToken(token);
  if (!session) return null;
  if (!(await hasDyoorWorldAccess(session.wallet))) return null;
  return { session, wallet: session.wallet };
}

export async function authenticateDyoorWorldRequest(request: Request): Promise<RequestSession | null> {
  const token = readDyoorWorldCookie(
    request.headers.get("cookie") || "",
    DYOOR_WORLD_SESSION_COOKIE,
  );
  return await authenticateDyoorWorldToken(token);
}

export async function requireDyoorWorldRequest(request: Request) {
  const authenticated = await authenticateDyoorWorldRequest(request);
  if (!authenticated) {
    throw dyoorWorldError("A current DYØØR holder session is required.", 401);
  }
  return authenticated;
}

async function loadWorldClaims() {
  const keys = await worldStore.listKeys("names/claims/");
  const claims = await Promise.all(
    keys.map((key) => worldStore.getJsonStrict<DyoorWorldNameClaim>(key)),
  );
  return claims.filter((claim): claim is DyoorWorldNameClaim => Boolean(claim));
}

async function onchainWorldProfile(wallet: string): Promise<DyoorWorldProfile | null> {
  const contract = await validatedNamesContract();
  if (!contract) return null;
  try {
    const displayName = String(await contract.nameOf(wallet) || "").trim();
    if (!displayName) return null;
    const label = normalizeWorldLabel(displayName.replace(/\.dyoor$/i, ""));
    const valid = validateWorldLabel(label);
    if (!valid.ok) return null;
    return {
      wallet,
      label: valid.label,
      displayName: `${valid.label}.dYOOR`,
      canonicalName: `${valid.label}.dyoor`,
      createdAt: "",
      registryStatus: "monad-active",
    };
  } catch {
    throw dyoorWorldError("The Monad dYOOR name registry is unavailable.", 503);
  }
}

export async function getDyoorWorldNameToken(tokenIdValue: unknown) {
  const tokenIdText = String(tokenIdValue || "").trim();
  if (!/^\d{1,78}$/.test(tokenIdText)) {
    throw dyoorWorldError("tokenId must be an unsigned integer.", 400);
  }
  const tokenId = BigInt(tokenIdText);
  if (tokenId >= (1n << 256n)) {
    throw dyoorWorldError("tokenId exceeds uint256.", 400);
  }
  const contract = await validatedNamesContract();
  if (!contract) throw dyoorWorldError("The Monad dYOOR name registry is not active.", 404);

  try {
    const [owner, labelValue] = await Promise.all([
      contract.ownerOf(tokenId),
      contract.labelOfToken(tokenId),
    ]);
    const wallet = normalizeWorldWallet(owner);
    const validation = validateWorldLabel(labelValue);
    if (!wallet || !validation.ok) throw new Error("Invalid on-chain name record.");
    return {
      tokenId: tokenId.toString(),
      wallet,
      profile: {
        wallet,
        label: validation.label,
        displayName: `${validation.label}.dYOOR`,
        canonicalName: `${validation.label}.dyoor`,
        createdAt: "",
        registryStatus: "monad-active",
      } satisfies DyoorWorldProfile,
    };
  } catch {
    throw dyoorWorldError("This dYOOR World name does not exist.", 404);
  }
}

export async function getDyoorWorldProfile(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const onchain = await onchainWorldProfile(wallet).catch((error) => {
    console.error("dYOOR World profile registry lookup failed", error);
    return null;
  });
  if (onchain) return onchain;
  if (dyoorWorldNamesContractAddress()) return null;

  const resolved = resolveWorldNameClaims(await loadWorldClaims());
  const claim = resolved.byWallet.get(wallet);
  return claim ? worldProfileFromClaim(claim) : null;
}

export async function getDyoorWorldNameAvailability(
  walletValue: unknown,
  labelValue: unknown,
) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const validation = validateWorldLabel(labelValue);
  if (!validation.ok) throw dyoorWorldError(validation.error, 400);

  const label = validation.label;
  const displayName = `${label}.dYOOR`;
  const contract = await validatedNamesContract();
  if (!contract) {
    const resolved = resolveWorldNameClaims(await loadWorldClaims());
    const existingWallet = resolved.byWallet.get(wallet);
    if (existingWallet) {
      const currentName = worldProfileFromClaim(existingWallet).displayName;
      return {
        label,
        displayName,
        available: false,
        registryMode: "preview-reservation" as const,
        currentName,
        reason: `${currentName} is already assigned to this wallet. Each holder wallet can claim one .dYOOR name.`,
      };
    }
    if (resolved.byLabel.has(label)) {
      return {
        label,
        displayName,
        available: false,
        registryMode: "preview-reservation" as const,
        currentName: "",
        reason: `${displayName} is already reserved. Choose another name.`,
      };
    }
    return {
      label,
      displayName,
      available: true,
      registryMode: "preview-reservation" as const,
      currentName: "",
      reason: `${displayName} is available to reserve.`,
    };
  }

  try {
    const [claimsOpen, currentNameValue, holder, available] = await Promise.all([
      contract.claimsOpen(),
      contract.nameOf(wallet),
      contract.isHolder(wallet),
      contract.isAvailable(label),
    ]);
    const currentName = String(currentNameValue || "").trim();
    if (currentName) {
      return {
        label,
        displayName,
        available: false,
        registryMode: "monad" as const,
        currentName,
        reason: `${currentName} is already assigned to this wallet. Each holder wallet can claim one .dYOOR name.`,
      };
    }
    if (!claimsOpen) {
      return {
        label,
        displayName,
        available: false,
        registryMode: "monad" as const,
        currentName: "",
        reason: "dYOOR World name claims are currently closed.",
      };
    }
    if (!holder) {
      return {
        label,
        displayName,
        available: false,
        registryMode: "monad" as const,
        currentName: "",
        reason: "This wallet must currently hold an S2 Droid to claim a .dYOOR name.",
      };
    }
    if (!available) {
      return {
        label,
        displayName,
        available: false,
        registryMode: "monad" as const,
        currentName: "",
        reason: `${displayName} is already claimed or reserved. Choose another name.`,
      };
    }
    return {
      label,
      displayName,
      available: true,
      registryMode: "monad" as const,
      currentName: "",
      reason: `${displayName} is available to claim on Monad.`,
    };
  } catch (error) {
    if (dyoorWorldErrorStatus(error) < 500) throw error;
    throw dyoorWorldError(
      "The Monad dYOOR name registry could not verify this claim. Try again shortly.",
      503,
    );
  }
}

function avatarKey(wallet: string) {
  return `profiles/${wallet}.json`;
}

async function requireOwnedS2Token(wallet: string, tokenIdValue: unknown) {
  const tokenIdText = String(tokenIdValue || "").trim();
  const maxSupply = Math.max(
    1,
    Number(readEnv("DYOOR_S2_MAX_SUPPLY", "NEXT_PUBLIC_DYOOR_S2_MAX_SUPPLY") || 3_333),
  );
  if (!/^\d+$/.test(tokenIdText)) {
    throw dyoorWorldError("Choose a valid S2 Droid token ID.", 400);
  }
  const tokenId = Number(tokenIdText);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > maxSupply) {
    throw dyoorWorldError("That S2 Droid token ID is out of range.", 400);
  }
  const contract = new ethers.Contract(dyoorS2Contract, ERC721_OWNER_ABI, provider());
  let owner = "";
  try {
    owner = normalizeWorldWallet(await contract.ownerOf(tokenId));
  } catch {
    throw dyoorWorldError("That S2 Droid does not currently exist.", 404);
  }
  if (owner !== wallet) {
    throw dyoorWorldError("You can only use an S2 Droid owned by this holder wallet.", 403);
  }
  return tokenId;
}

export async function getDyoorWorldAvatar(walletValue: unknown): Promise<DyoorWorldAvatar | null> {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) return null;
  const record = await worldStore.getJsonStrict<DyoorWorldAvatarRecord>(avatarKey(wallet));
  if (!record || record.version !== 1 || record.wallet !== wallet) return null;
  try {
    const tokenId = await requireOwnedS2Token(wallet, record.tokenId);
    return {
      tokenId: String(tokenId),
      imageUrl: `/api/dyoor-world/pfp-image/${tokenId}`,
      updatedAt: record.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function setDyoorWorldAvatar(walletValue: unknown, tokenIdValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const tokenId = await requireOwnedS2Token(wallet, tokenIdValue);
  const record: DyoorWorldAvatarRecord = {
    version: 1,
    wallet,
    tokenId: String(tokenId),
    imageUrl: `/api/dyoor-world/pfp-image/${tokenId}`,
    updatedAt: new Date().toISOString(),
  };
  await worldStore.setJson(avatarKey(wallet), record);
  return {
    tokenId: record.tokenId,
    imageUrl: record.imageUrl,
    updatedAt: record.updatedAt,
  } satisfies DyoorWorldAvatar;
}

export async function clearDyoorWorldAvatar(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  await worldStore.deleteJson(avatarKey(wallet));
  return null;
}

export async function reserveDyoorWorldName(walletValue: unknown, labelValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  if (dyoorWorldNamesContractAddress()) {
    throw dyoorWorldError("The Monad registry is active; claim this name with your wallet.", 409);
  }
  const validation = validateWorldLabel(labelValue);
  if (!validation.ok) throw dyoorWorldError(validation.error, 400);

  const before = resolveWorldNameClaims(await loadWorldClaims());
  const existingWallet = before.byWallet.get(wallet);
  if (existingWallet) return worldProfileFromClaim(existingWallet);
  if (before.byLabel.has(validation.label)) {
    throw dyoorWorldError(`${validation.label}.dYOOR is already reserved.`, 409);
  }

  const now = new Date().toISOString();
  const id = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}`;
  const claim: DyoorWorldNameClaim = {
    version: 1,
    id,
    wallet,
    label: validation.label,
    createdAt: now,
  };
  await worldStore.setJson(`names/claims/${id}.json`, claim);

  const after = resolveWorldNameClaims(await loadWorldClaims());
  const accepted = after.byWallet.get(wallet);
  if (!accepted || accepted.id !== id || after.byLabel.get(validation.label)?.id !== id) {
    throw dyoorWorldError("That name was claimed by another holder. Choose another.", 409);
  }
  return worldProfileFromClaim(accepted);
}

async function worldProfilesForWallets(wallets: string[]) {
  const unique = Array.from(new Set(
    wallets
      .map(normalizeWorldWallet)
      .filter((wallet) => wallet && wallet !== ethers.ZeroAddress.toLowerCase()),
  ));
  const profiles = await Promise.all(unique.map(async (wallet) => [
    wallet,
    await getDyoorWorldProfile(wallet),
  ] as const));
  return new Map(profiles);
}

async function worldAvatarsForWallets(wallets: string[]) {
  const unique = Array.from(new Set(
    wallets
      .map(normalizeWorldWallet)
      .filter((wallet) => wallet && wallet !== ethers.ZeroAddress.toLowerCase()),
  ));
  const avatars = await Promise.all(unique.map(async (wallet) => [
    wallet,
    await getDyoorWorldAvatar(wallet),
  ] as const));
  return new Map(avatars);
}

function messagePrefix(channelId: string) {
  return `messages/${channelId}/`;
}

async function loadRawWorldMessages(channelId: string, limit = 100) {
  const keys = (await worldStore.listKeys(messagePrefix(channelId))).slice(-limit);
  const messages = await Promise.all(
    keys.map((key) => worldStore.getJsonStrict<DyoorWorldMessage>(key)),
  );
  return messages
    .filter((message): message is DyoorWorldMessage => validStoredWorldMessage(message))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-limit);
}

function validStoredWorldMessage(
  message: DyoorWorldMessage | null,
): message is DyoorWorldMessage {
  return Boolean(
    message
      && [1, 2, 3, 4].includes(message.version)
      && normalizeWorldMessageId(message.id)
      && isWorldChannel(message.channelId)
      && normalizeWorldWallet(message.wallet)
      && (message.content || normalizeDyoorWorldAttachment(message.attachment))
      && (!message.attachment || normalizeDyoorWorldAttachment(message.attachment))
      && (!message.replyTo || normalizeDyoorWorldMessageReply(message.replyTo))
      && Number.isFinite(Date.parse(message.createdAt)),
  );
}

export async function listDyoorWorldMessages(
  walletValue: unknown,
  channelValue: unknown,
) {
  const channelId = String(channelValue || "");
  if (!isWorldChannel(channelId)) {
    throw dyoorWorldError("channel must identify a dYOOR World stream.", 400);
  }
  await requireDyoorWorldChannelAccess(walletValue, channelId);
  const messages = await loadRawWorldMessages(channelId);
  const [profiles, avatars] = await Promise.all([
    worldProfilesForWallets(messages.map((message) => message.wallet)),
    worldAvatarsForWallets(messages.map((message) => message.wallet)),
  ]);
  return messages.map((message): DyoorWorldMessageView => ({
    ...message,
    kind: message.kind || "user",
    author: message.systemAuthor
      || profiles.get(message.wallet)?.displayName
      || shortWorldWallet(message.wallet),
    avatar: avatars.get(message.wallet) || null,
  }));
}

async function createDyoorWorldSystemMessage(input: {
  id: string;
  channelId: DyoorWorldChannelId;
  content: string;
  kind: Exclude<NonNullable<DyoorWorldMessage["kind"]>, "user">;
  systemAuthor: string;
  data?: DyoorWorldMessage["data"];
  createdAt?: string;
}) {
  const id = String(input.id || "").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 180);
  if (!id) throw dyoorWorldError("System message ID is invalid.", 500);
  const message: DyoorWorldMessage = {
    version: 2,
    id,
    channelId: input.channelId,
    wallet: ethers.ZeroAddress.toLowerCase(),
    content: String(input.content || "").trim().slice(0, 800),
    createdAt: input.createdAt || new Date().toISOString(),
    kind: input.kind,
    systemAuthor: input.systemAuthor,
    data: input.data,
  };
  await worldStore.setJson(`${messagePrefix(input.channelId)}${id}.json`, message);
  return {
    ...message,
    author: input.systemAuthor,
    avatar: null,
  } satisfies DyoorWorldMessageView;
}

export async function createDyoorWorldMessage(input: {
  wallet: unknown;
  channelId: unknown;
  content: unknown;
  attachment?: unknown;
  replyToMessageId?: unknown;
}) {
  const wallet = normalizeWorldWallet(input.wallet);
  const channelId = String(input.channelId || "");
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const worldAccess = await requireDyoorWorldChannelAccess(wallet, channelId);
  const ownerChannel = isWorldOwnerChannel(channelId);
  if (ownerChannel) {
    if (!await canPostDyoorWorldAnnouncements(wallet)) {
      throw dyoorWorldError(
        "Only the D.Y.O.O.R owner wallet can post announcements.",
        403,
      );
    }
  } else if (!isWorldWritableChannel(channelId)) {
    if (isWorldChannel(channelId)) {
      throw dyoorWorldError("This stream is maintained by verified World bots.", 403);
    }
    throw dyoorWorldError("channel must identify a dYOOR World stream.", 400);
  }
  const content = String(input.content || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  const attachment = normalizeDyoorWorldAttachment(input.attachment);
  if (input.attachment != null && !attachment) {
    throw dyoorWorldError("Use a supported HTTPS image, GIF, or World sticker.", 400);
  }
  if (!content && !attachment) {
    throw dyoorWorldError("Write a message or attach media before transmitting.", 400);
  }
  if (content.length > 800) {
    throw dyoorWorldError("World messages must contain 800 characters or fewer.", 400);
  }
  const rawReplyToMessageId = String(input.replyToMessageId || "").trim();
  const replyToMessageId = normalizeWorldMessageId(rawReplyToMessageId);
  if (rawReplyToMessageId && !replyToMessageId) {
    throw dyoorWorldError("The replied-to message ID is invalid.", 400);
  }
  assertDyoorWorldRateLimit(`message:${wallet}`, 8, 30_000);

  const recent = await loadRawWorldMessages(channelId, 30);
  const lastByWallet = recent.filter((message) => message.wallet === wallet).at(-1);
  if (lastByWallet && Date.now() - Date.parse(lastByWallet.createdAt) < 1_500) {
    throw dyoorWorldError("Wait a moment before sending another message.", 429);
  }

  let replyTo: DyoorWorldMessage["replyTo"];
  if (replyToMessageId) {
    const target = await worldStore.getJsonStrict<DyoorWorldMessage>(
      `${messagePrefix(channelId)}${replyToMessageId}.json`,
    );
    if (!validStoredWorldMessage(target) || target.channelId !== channelId) {
      throw dyoorWorldError(
        "That message is no longer available in this World thread.",
        404,
      );
    }
    const targetAttachment = normalizeDyoorWorldAttachment(target.attachment);
    const targetProfile = target.systemAuthor
      ? null
      : await getDyoorWorldProfile(target.wallet);
    replyTo = normalizeDyoorWorldMessageReply({
      messageId: target.id,
      wallet: target.wallet,
      author: target.systemAuthor
        || targetProfile?.displayName
        || shortWorldWallet(target.wallet),
      content: target.content,
      attachmentKind: targetAttachment?.kind,
    }) || undefined;
    if (!replyTo) {
      throw dyoorWorldError("That message cannot be quoted safely.", 400);
    }
  }

  const createdAt = new Date().toISOString();
  const id = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}`;
  const message: DyoorWorldMessage = {
    version: 4,
    id,
    channelId,
    wallet,
    content,
    createdAt,
    kind: ownerChannel ? "announcement" : "user",
    ...(attachment ? { attachment: attachment as DyoorWorldMessageAttachment } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
  await worldStore.setJson(`${messagePrefix(channelId)}${id}.json`, message);
  const [profile, avatar, reward] = await Promise.all([
    getDyoorWorldProfile(wallet),
    getDyoorWorldAvatar(wallet),
    ownerChannel || !worldAccess.entitlements.season2
      ? Promise.resolve(null)
      : createDyoorWorldChatReward(wallet, message).catch((error) => {
        console.error("dYOOR World chat reward creation failed", error);
        return null;
      }),
  ]);
  const author = profile?.displayName || shortWorldWallet(wallet);
  const view = {
    ...message,
    author,
    avatar,
    energyReward: reward?.amountEnergy,
  } satisfies DyoorWorldMessageView;
  const summary = directMessageSummary(content, attachment || undefined);
  if (ownerChannel) {
    await enqueueDyoorWorldPush({
      category: "announcements",
      title: "Official dYOOR World announcement",
      body: summary,
      privateBody: "A new official announcement is waiting in dYOOR World.",
      channelId: "announcements",
      tag: `world-announcement-${id}`,
      excludedWallets: [wallet],
    });
  } else {
    const replyWallet = normalizeWorldWallet(replyTo?.wallet);
    if (replyWallet && replyWallet !== wallet) {
      await enqueueDyoorWorldPush({
        category: "replies",
        title: `${author} replied to you`,
        body: summary,
        privateBody: "A holder replied to your dYOOR World message.",
        channelId,
        tag: `world-reply-${replyTo?.messageId || id}`,
        targetWallets: [replyWallet],
        excludedWallets: [wallet],
      });
    }
    await enqueueDyoorWorldPush({
      category: "chat",
      title: `#${channelId} · ${author}`,
      body: summary,
      privateBody: `New activity in #${channelId}.`,
      channelId,
      tag: `world-chat-${channelId}`,
      excludedWallets: [wallet, replyWallet],
    });
  }
  return view;
}

function directConversationId(leftWallet: string, rightWallet: string) {
  return createHash("sha256")
    .update([leftWallet, rightWallet].sort().join(":"))
    .digest("hex");
}

function directMessagePrefix(conversationId: string) {
  return `direct-messages/conversations/${conversationId}/`;
}

function directInboxKey(wallet: string, conversationId: string) {
  return `direct-messages/inbox/${wallet}/${conversationId}.json`;
}

function validDirectMessage(
  message: DyoorWorldDirectMessage | null,
): message is DyoorWorldDirectMessage {
  return Boolean(
    message
      && message.version === 1
      && normalizeWorldMessageId(message.id)
      && /^[a-f0-9]{64}$/.test(message.conversationId)
      && normalizeWorldWallet(message.from) === message.from
      && normalizeWorldWallet(message.to) === message.to
      && message.from !== message.to
      && (message.content || normalizeDyoorWorldAttachment(message.attachment))
      && (!message.attachment || normalizeDyoorWorldAttachment(message.attachment))
      && Number.isFinite(Date.parse(message.createdAt)),
  );
}

function validDirectInbox(
  record: DyoorWorldDirectInboxRecord | null,
): record is DyoorWorldDirectInboxRecord {
  return Boolean(
    record
      && record.version === 1
      && /^[a-f0-9]{64}$/.test(record.conversationId)
      && normalizeWorldWallet(record.wallet) === record.wallet
      && normalizeWorldWallet(record.otherWallet) === record.otherWallet
      && record.wallet !== record.otherWallet
      && normalizeWorldMessageId(record.lastMessageId)
      && normalizeWorldWallet(record.lastSender) === record.lastSender
      && Number.isFinite(Date.parse(record.lastMessageAt))
      && Number.isSafeInteger(record.unreadCount)
      && record.unreadCount >= 0,
  );
}

function directMessageSummary(
  content: string,
  attachment?: DyoorWorldMessageAttachment,
) {
  if (content) return content.replace(/\s+/g, " ").trim().slice(0, 160);
  if (attachment?.kind === "sticker") return "Sent a World sticker.";
  if (attachment?.kind === "gif") return "Sent a GIF.";
  return "Sent an image.";
}

async function loadRawDirectMessages(conversationId: string) {
  const keys = (await worldStore.listKeys(directMessagePrefix(conversationId)))
    .slice(-100);
  const messages = await Promise.all(
    keys.map((key) => worldStore.getJsonStrict<DyoorWorldDirectMessage>(key)),
  );
  return messages
    .filter(validDirectMessage)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export async function listDyoorWorldDirectConversations(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const keys = await worldStore.listKeys(`direct-messages/inbox/${wallet}/`);
  const records = (await Promise.all(
    keys.map((key) => worldStore.getJsonStrict<DyoorWorldDirectInboxRecord>(key)),
  ))
    .filter(validDirectInbox)
    .sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt));
  const [profiles, avatars] = await Promise.all([
    worldProfilesForWallets(records.map((record) => record.otherWallet)),
    worldAvatarsForWallets(records.map((record) => record.otherWallet)),
  ]);
  const conversations = records.map((record): DyoorWorldDirectConversationView => ({
    conversationId: record.conversationId,
    wallet: record.otherWallet,
    author: profiles.get(record.otherWallet)?.displayName
      || shortWorldWallet(record.otherWallet),
    profile: profiles.get(record.otherWallet) || null,
    avatar: avatars.get(record.otherWallet) || null,
    lastMessage: record.lastMessage,
    lastMessageAt: record.lastMessageAt,
    lastSender: record.lastSender,
    unreadCount: record.unreadCount,
  }));
  return {
    conversations,
    unreadCount: conversations.reduce(
      (total, conversation) => total + conversation.unreadCount,
      0,
    ),
  };
}

export async function listDyoorWorldDirectMessages(input: {
  wallet: unknown;
  otherWallet: unknown;
}) {
  const wallet = normalizeWorldWallet(input.wallet);
  const otherWallet = normalizeWorldWallet(input.otherWallet);
  if (!wallet || !otherWallet || wallet === otherWallet) {
    throw dyoorWorldError("Choose another holder for this direct conversation.", 400);
  }
  const conversationId = directConversationId(wallet, otherWallet);
  const messages = (await loadRawDirectMessages(conversationId))
    .filter((message) => (
      [message.from, message.to].includes(wallet)
        && [message.from, message.to].includes(otherWallet)
    ));
  const [profiles, avatars] = await Promise.all([
    worldProfilesForWallets([wallet, otherWallet]),
    worldAvatarsForWallets([wallet, otherWallet]),
  ]);
  const inboxKey = directInboxKey(wallet, conversationId);
  const inbox = await worldStore.getJsonStrict<DyoorWorldDirectInboxRecord>(inboxKey);
  if (validDirectInbox(inbox) && inbox.unreadCount > 0) {
    await worldStore.setJson(inboxKey, {
      ...inbox,
      unreadCount: 0,
    });
  }
  return {
    conversationId,
    other: {
      wallet: otherWallet,
      author: profiles.get(otherWallet)?.displayName || shortWorldWallet(otherWallet),
      profile: profiles.get(otherWallet) || null,
      avatar: avatars.get(otherWallet) || null,
    },
    messages: messages.map((message): DyoorWorldDirectMessageView => ({
      ...message,
      author: profiles.get(message.from)?.displayName || shortWorldWallet(message.from),
      avatar: avatars.get(message.from) || null,
    })),
  };
}

export async function createDyoorWorldDirectMessage(input: {
  wallet: unknown;
  recipient: unknown;
  content: unknown;
  attachment?: unknown;
}) {
  const wallet = normalizeWorldWallet(input.wallet);
  const recipient = normalizeWorldWallet(input.recipient);
  if (!wallet || !recipient || wallet === recipient) {
    throw dyoorWorldError("Choose another holder for this direct message.", 400);
  }
  if (!await hasDyoorWorldAccess(recipient)) {
    throw dyoorWorldError(
      "Direct messages can only be sent to a current S2 holder.",
      403,
    );
  }
  const content = String(input.content || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  const attachment = normalizeDyoorWorldAttachment(input.attachment);
  if (input.attachment != null && !attachment) {
    throw dyoorWorldError("Use a supported HTTPS image, GIF, or World sticker.", 400);
  }
  if (!content && !attachment) {
    throw dyoorWorldError("Write a direct message or attach media before sending.", 400);
  }
  if (content.length > 800) {
    throw dyoorWorldError("Direct messages must contain 800 characters or fewer.", 400);
  }

  const createdAt = new Date().toISOString();
  const id = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}`;
  const conversationId = directConversationId(wallet, recipient);
  const message: DyoorWorldDirectMessage = {
    version: 1,
    id,
    conversationId,
    from: wallet,
    to: recipient,
    content,
    ...(attachment ? { attachment } : {}),
    createdAt,
  };
  await worldStore.setJson(
    `${directMessagePrefix(conversationId)}${id}.json`,
    message,
  );

  const summary = directMessageSummary(content, attachment || undefined);
  const recipientInboxKey = directInboxKey(recipient, conversationId);
  const recipientInbox = await worldStore.getJsonStrict<DyoorWorldDirectInboxRecord>(
    recipientInboxKey,
  );
  await Promise.all([
    worldStore.setJson(directInboxKey(wallet, conversationId), {
      version: 1,
      conversationId,
      wallet,
      otherWallet: recipient,
      lastMessageId: id,
      lastMessage: summary,
      lastMessageAt: createdAt,
      lastSender: wallet,
      unreadCount: 0,
    } satisfies DyoorWorldDirectInboxRecord),
    worldStore.setJson(recipientInboxKey, {
      version: 1,
      conversationId,
      wallet: recipient,
      otherWallet: wallet,
      lastMessageId: id,
      lastMessage: summary,
      lastMessageAt: createdAt,
      lastSender: wallet,
      unreadCount: validDirectInbox(recipientInbox)
        ? Math.min(999, recipientInbox.unreadCount + 1)
        : 1,
    } satisfies DyoorWorldDirectInboxRecord),
  ]);

  const [sender, avatar] = await Promise.all([
    getDyoorWorldProfile(wallet),
    getDyoorWorldAvatar(wallet),
  ]);
  const author = sender?.displayName || shortWorldWallet(wallet);
  await enqueueDyoorWorldPush({
    category: "directMessages",
    title: `Direct signal from ${author}`,
    body: summary,
    privateBody: "A holder sent you a private dYOOR World message.",
    channelId: "world-lobby",
    url: `/dyoor-world?dm=${encodeURIComponent(wallet)}`,
    tag: `world-dm-${conversationId}`,
    targetWallets: [recipient],
    excludedWallets: [wallet],
  });
  return {
    ...message,
    author,
    avatar,
  } satisfies DyoorWorldDirectMessageView;
}

function rewardPrefix(wallet: string, utcDate?: string) {
  return `rewards/${wallet}/${utcDate ? `${utcDate}/` : ""}`;
}

function rewardClaimPrefix(wallet: string) {
  return `reward-claims/${wallet}/`;
}

function validRewardRecord(record: DyoorWorldRewardRecord | null, wallet: string) {
  return Boolean(
    record
      && record.version === 1
      && record.wallet === wallet
      && ["chat", "daily", "tip", "trade"].includes(record.kind)
      && Number.isSafeInteger(record.amountEnergy)
      && record.amountEnergy > 0
      && /^\d+$/.test(record.amountRaw)
      && Number.isFinite(Date.parse(record.createdAt)),
  );
}

async function loadDyoorWorldRewards(wallet: string, utcDate?: string) {
  const keys = await worldStore.listKeys(rewardPrefix(wallet, utcDate));
  const records = await Promise.all(
    keys.map((key) => worldStore.getJsonStrict<DyoorWorldRewardRecord>(key)),
  );
  return records
    .filter((record): record is DyoorWorldRewardRecord => validRewardRecord(record, wallet))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

async function createDyoorWorldActivityReward(input: {
  wallet: string;
  kind: Exclude<DyoorWorldRewardKind, "chat" | "daily">;
  id: string;
  amountEnergy: number;
  dailyCap: number;
  createdAt?: string;
  referenceId: string;
}) {
  if (!dyoorWorldRewardsEnabled()) return null;
  const wallet = normalizeWorldWallet(input.wallet);
  if (!wallet) return null;
  const createdAt = input.createdAt || new Date().toISOString();
  const utcDate = dyoorWorldUtcDate(createdAt);
  const id = String(input.id || "").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 180);
  if (!id) return null;
  const key = `${rewardPrefix(wallet, utcDate)}${id}.json`;
  const existing = await worldStore.getJsonStrict<DyoorWorldRewardRecord>(key);
  if (validRewardRecord(existing, wallet)) return existing;

  const todaysRewards = await loadDyoorWorldRewards(wallet, utcDate);
  if (todaysRewards.filter((reward) => reward.kind === input.kind).length >= input.dailyCap) {
    return null;
  }
  const record: DyoorWorldRewardRecord = {
    version: 1,
    id,
    wallet,
    kind: input.kind,
    amountEnergy: input.amountEnergy,
    amountRaw: ethers.parseUnits(String(input.amountEnergy), 18).toString(),
    createdAt,
    utcDate,
    referenceId: input.referenceId,
  };
  await worldStore.setJson(key, record);
  return record;
}

async function loadDyoorWorldRewardClaims(wallet: string) {
  const keys = await worldStore.listKeys(rewardClaimPrefix(wallet));
  const records = await Promise.all(
    keys.map((key) => worldStore.getJsonStrict<DyoorWorldRewardClaim>(key)),
  );
  return records.filter((record): record is DyoorWorldRewardClaim => Boolean(
    record
      && record.version === 1
      && record.wallet === wallet
      && /^0x[a-f0-9]{64}$/.test(record.claimHash),
  ));
}

async function createDyoorWorldChatReward(wallet: string, message: DyoorWorldMessage) {
  if (!dyoorWorldRewardsEnabled() || !qualifiesForDyoorWorldChatReward(message.content)) {
    return null;
  }
  const utcDate = dyoorWorldUtcDate(message.createdAt);
  const todaysRewards = await loadDyoorWorldRewards(wallet, utcDate);
  const chatRewards = todaysRewards.filter((reward) => reward.kind === "chat");
  const chatEnergyToday = chatRewards.reduce(
    (total, reward) => total + reward.amountEnergy,
    0,
  );
  if (
    chatEnergyToday + DYOOR_WORLD_CHAT_REWARD_ENERGY
      > DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP
  ) {
    return null;
  }
  const last = chatRewards.at(-1);
  if (
    last
      && Date.parse(message.createdAt) - Date.parse(last.createdAt)
        < DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS
  ) {
    return null;
  }

  const id = `chat-${message.id}`;
  const record: DyoorWorldRewardRecord = {
    version: 1,
    id,
    wallet,
    kind: "chat",
    amountEnergy: DYOOR_WORLD_CHAT_REWARD_ENERGY,
    amountRaw: ethers.parseUnits(String(DYOOR_WORLD_CHAT_REWARD_ENERGY), 18).toString(),
    createdAt: message.createdAt,
    utcDate,
    messageId: message.id,
  };
  await worldStore.setJson(`${rewardPrefix(wallet, utcDate)}${id}.json`, record);
  return record;
}

export async function checkInDyoorWorldDailyReward(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  if (!dyoorWorldRewardsEnabled()) {
    throw dyoorWorldError("World Energy rewards are not enabled yet.", 503);
  }
  const secret = worldRewardSecret();
  if (secret.length < 32) {
    throw dyoorWorldError("The daily World reward engine is not configured.", 503);
  }
  const utcDate = dyoorWorldUtcDate();
  const key = `${rewardPrefix(wallet, utcDate)}daily.json`;
  const existing = await worldStore.getJsonStrict<DyoorWorldRewardRecord>(key);
  if (validRewardRecord(existing, wallet) && existing?.kind === "daily") {
    return { reward: existing, alreadyCheckedIn: true };
  }

  const digest = createHmac("sha256", secret)
    .update(`dyoor-world:daily:v1:${wallet}:${utcDate}`)
    .digest();
  const sample = digest.readUInt32BE(0) % 100;
  const amountEnergy = dyoorWorldDailyPrize(sample);
  const record: DyoorWorldRewardRecord = {
    version: 1,
    id: `daily-${utcDate}`,
    wallet,
    kind: "daily",
    amountEnergy,
    amountRaw: ethers.parseUnits(String(amountEnergy), 18).toString(),
    createdAt: new Date().toISOString(),
    utcDate,
  };
  await worldStore.setJson(key, record);
  return { reward: record, alreadyCheckedIn: false };
}

async function unclaimedDyoorWorldRewards(wallet: string) {
  const [rewards, claims] = await Promise.all([
    loadDyoorWorldRewards(wallet),
    loadDyoorWorldRewardClaims(wallet),
  ]);
  const claimedIds = new Set(
    claims
      .filter((claim) => claim.status === "credited")
      .flatMap((claim) => claim.rewardIds),
  );
  return {
    rewards,
    claims,
    pending: rewards.filter((reward) => !claimedIds.has(reward.id)),
  };
}

export async function getDyoorWorldRewardStatus(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const utcDate = dyoorWorldUtcDate();
  const { pending } = await unclaimedDyoorWorldRewards(wallet);
  const todaysRewards = await loadDyoorWorldRewards(wallet, utcDate);
  const daily = todaysRewards.find((reward) => reward.kind === "daily") || null;
  const chatRewards = todaysRewards.filter((reward) => reward.kind === "chat");
  const tipRewards = todaysRewards.filter((reward) => reward.kind === "tip");
  const tradeRewards = todaysRewards.filter((reward) => reward.kind === "trade");
  const lastChatReward = chatRewards.at(-1);
  const nextChatRewardAt = lastChatReward
    ? new Date(
      Date.parse(lastChatReward.createdAt) + DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS,
    ).toISOString()
    : null;
  const chatEnergyToday = chatRewards.reduce(
    (total, reward) => total + reward.amountEnergy,
    0,
  );
  return {
    enabled: dyoorWorldRewardsEnabled(),
    claimReady: Boolean(
      dyoorWorldRewardsEnabled()
        && normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY")),
    ),
    pendingEnergy: pending.reduce((sum, reward) => sum + reward.amountEnergy, 0),
    pendingRewardCount: pending.length,
    daily,
    utcDate,
    chat: {
      rewardEnergy: DYOOR_WORLD_CHAT_REWARD_ENERGY,
      rewardedToday: chatRewards.length,
      dailyCap: DYOOR_WORLD_CHAT_REWARD_DAILY_CAP,
      earnedEnergyToday: chatEnergyToday,
      dailyEnergyCap: DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP,
      nextRewardAt: nextChatRewardAt,
    },
    tips: {
      rewardEnergy: DYOOR_WORLD_TIP_REWARD_ENERGY,
      minimumMon: DYOOR_WORLD_TIP_REWARD_MIN_MON,
      rewardedToday: tipRewards.length,
      dailyCap: DYOOR_WORLD_TIP_REWARD_DAILY_CAP,
    },
    trades: {
      rewardEnergy: DYOOR_WORLD_TRADE_REWARD_ENERGY,
      rewardedToday: tradeRewards.length,
      dailyCap: DYOOR_WORLD_TRADE_REWARD_DAILY_CAP,
    },
  };
}

async function creditDyoorWorldRewards(wallet: string) {
  if (!dyoorWorldRewardsEnabled()) {
    throw dyoorWorldError("World Energy rewards are not enabled yet.", 503);
  }
  const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY"));
  if (!signerKey) {
    throw dyoorWorldError("World Energy claiming is not configured yet.", 503);
  }
  const { pending, claims } = await unclaimedDyoorWorldRewards(wallet);
  if (pending.length === 0) {
    return { alreadyCredited: true, status: await getDyoorWorldRewardStatus(wallet) };
  }

  const selected = pending.slice(0, 100);
  const rewardIds = selected.map((reward) => reward.id).sort();
  const amountRaw = selected
    .reduce((sum, reward) => sum + BigInt(reward.amountRaw), 0n);
  const amountEnergy = selected.reduce((sum, reward) => sum + reward.amountEnergy, 0);
  const claimHash = ethers.keccak256(ethers.toUtf8Bytes(
    `dyoor-world:rewards:v1:${wallet}:${rewardIds.join(",")}`,
  ));
  const existing = claims.find((claim) => claim.claimHash === claimHash);
  if (existing?.status === "credited") {
    return {
      alreadyCredited: true,
      claim: existing,
      status: await getDyoorWorldRewardStatus(wallet),
    };
  }

  const now = new Date().toISOString();
  const key = `${rewardClaimPrefix(wallet)}${claimHash}.json`;
  const claim: DyoorWorldRewardClaim = {
    version: 1,
    id: claimHash,
    wallet,
    rewardIds,
    amountEnergy,
    amountRaw: amountRaw.toString(),
    claimHash,
    status: "pending",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    txHash: existing?.txHash,
  };
  await worldStore.setJson(key, claim);

  try {
    const signer = new ethers.Wallet(signerKey, provider());
    const bank = new ethers.Contract(energyBankContract, ENERGY_BANK_ABI, signer);
    const [creditRole, used] = await Promise.all([
      bank.CREDIT_ROLE(),
      bank.usedClaimTxHash(claimHash).then(Boolean),
    ]);
    if (!(await bank.hasRole(creditRole, signer.address))) {
      throw new Error("The World reward operator is missing Energy Bank CREDIT_ROLE.");
    }

    let txHash = claim.txHash || "";
    if (!used) {
      await bank.creditEnergy.staticCall(wallet, amountRaw, claimHash);
      const transaction = await bank.creditEnergy(
        wallet,
        amountRaw,
        claimHash,
        { gasLimit: 160_000n },
      );
      txHash = transaction.hash;
      await worldStore.setJson(key, {
        ...claim,
        txHash,
        updatedAt: new Date().toISOString(),
      });
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("The World Energy credit transaction failed.");
      }
    }

    const credited: DyoorWorldRewardClaim = {
      ...claim,
      status: "credited",
      txHash,
      updatedAt: new Date().toISOString(),
    };
    await worldStore.setJson(key, credited);
    return {
      alreadyCredited: used,
      claim: credited,
      status: await getDyoorWorldRewardStatus(wallet),
    };
  } catch (error) {
    const failed: DyoorWorldRewardClaim = {
      ...claim,
      status: "failed",
      error: (error as Error)?.message || "World Energy credit failed.",
      updatedAt: new Date().toISOString(),
    };
    await worldStore.setJson(key, failed);
    throw dyoorWorldError(failed.error || "World Energy credit failed.", 503);
  }
}

export async function claimDyoorWorldRewards(walletValue: unknown) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const run = rewardClaimQueue.then(
    () => creditDyoorWorldRewards(wallet),
    () => creditDyoorWorldRewards(wallet),
  );
  rewardClaimQueue = run.then(() => undefined, () => undefined);
  return await run;
}

function requireTransactionHash(value: unknown) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(hash)) {
    throw dyoorWorldError("txHash must be a Monad transaction hash.", 400);
  }
  return hash;
}

async function createDyoorWorldTipReward(record: DyoorWorldTipRecord) {
  if (BigInt(record.amountWei) < ethers.parseEther(DYOOR_WORLD_TIP_REWARD_MIN_MON)) {
    return null;
  }
  return await createDyoorWorldActivityReward({
    wallet: record.from,
    kind: "tip",
    id: `tip-${record.txHash.slice(2)}`,
    amountEnergy: DYOOR_WORLD_TIP_REWARD_ENERGY,
    dailyCap: DYOOR_WORLD_TIP_REWARD_DAILY_CAP,
    createdAt: record.createdAt,
    referenceId: record.txHash,
  });
}

export async function verifyDyoorWorldTip(input: {
  wallet: unknown;
  recipient: unknown;
  txHash: unknown;
}) {
  const wallet = normalizeWorldWallet(input.wallet);
  const recipient = normalizeWorldWallet(input.recipient);
  const txHash = requireTransactionHash(input.txHash);
  if (!wallet || !recipient) {
    throw dyoorWorldError("Tip sender and recipient must be valid wallet addresses.", 400);
  }
  if (wallet === recipient) throw dyoorWorldError("Choose another holder to tip.", 400);
  try {
    await requireDyoorWorldEntitlement(recipient, "season2");
  } catch (error) {
    if (dyoorWorldErrorStatus(error) >= 500) throw error;
    throw dyoorWorldError("MON tips in dYOOR World can only target a current S2 holder.", 403);
  }

  const key = `tips/${txHash}.json`;
  const existing = await worldStore.getJsonStrict<DyoorWorldTipRecord>(key);
  if (existing) {
    if (existing.from !== wallet || existing.to !== recipient) {
      throw dyoorWorldError("This tip transaction was already recorded differently.", 409);
    }
    return {
      tip: existing,
      reward: await createDyoorWorldTipReward(existing),
      alreadyRecorded: true,
    };
  }

  const [transaction, receipt] = await Promise.all([
    provider().getTransaction(txHash),
    provider().getTransactionReceipt(txHash),
  ]);
  if (!transaction || !receipt) {
    throw dyoorWorldError("The MON tip is not confirmed yet. Check again in a moment.", 409);
  }
  if (receipt.status !== 1) throw dyoorWorldError("The MON tip transaction failed.", 400);
  if (
    normalizeWorldWallet(transaction.from) !== wallet
      || normalizeWorldWallet(transaction.to) !== recipient
      || transaction.value <= 0n
      || (transaction.data && transaction.data !== "0x")
  ) {
    throw dyoorWorldError("This transaction is not a direct MON tip between these holders.", 400);
  }

  const amountMon = ethers.formatEther(transaction.value);
  const record: DyoorWorldTipRecord = {
    version: 1,
    txHash,
    from: wallet,
    to: recipient,
    amountWei: transaction.value.toString(),
    amountMon,
    createdAt: new Date().toISOString(),
  };
  const [sender, receiver] = await Promise.all([
    getDyoorWorldProfile(wallet),
    getDyoorWorldProfile(recipient),
  ]);
  await createDyoorWorldSystemMessage({
    id: `tip-${txHash.slice(2)}`,
    channelId: "tip-ledger",
    kind: "tip",
    systemAuthor: "World Tip Relay",
    content: `${sender?.displayName || shortWorldWallet(wallet)} tipped ${receiver?.displayName || shortWorldWallet(recipient)} ${amountMon} MON.`,
    data: {
      txHash,
      from: wallet,
      to: recipient,
      amountWei: transaction.value.toString(),
      amountMon,
    },
  });
  await worldStore.setJson(key, record);
  await enqueueDyoorWorldPush({
    category: "tips",
    title: "Verified MON tip received",
    body: `${sender?.displayName || shortWorldWallet(wallet)} tipped you ${amountMon} MON.`,
    privateBody: "A verified MON tip is waiting in your dYOOR World ledger.",
    channelId: "tip-ledger",
    tag: `world-tip-${txHash.slice(2, 34)}`,
    targetWallets: [recipient],
    excludedWallets: [wallet],
  });
  return {
    tip: record,
    reward: await createDyoorWorldTipReward(record),
    alreadyRecorded: false,
  };
}

export function requireDyoorWorldAutomationRequest(request: Request) {
  const expected = worldAutomationSecret();
  const supplied = String(request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (expected.length < 32 || supplied.length !== expected.length) {
    throw dyoorWorldError("World automation authorization failed.", 401);
  }
  const allowed = timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!allowed) throw dyoorWorldError("World automation authorization failed.", 401);
}

export async function processDyoorWorldPushNotifications() {
  return await processPushOutbox({
    verifyHolder: async (wallet) => await hasDyoorWorldAccess(wallet, true),
  });
}

type OpenSeaSaleEvent = {
  event_type?: string;
  event_timestamp?: number | string;
  transaction?: string;
  order_hash?: string;
  seller?: string;
  buyer?: string;
  payment?: {
    quantity?: string;
    decimals?: number;
    symbol?: string;
  };
  nft?: {
    identifier?: string;
    contract?: string;
    name?: string;
    display_image_url?: string;
    image_url?: string;
    opensea_url?: string;
  };
};

function openSeaHeaders() {
  const apiKey = readEnv("OPENSEA_API_KEY");
  if (!apiKey) throw dyoorWorldError("OPENSEA_API_KEY is required for the sales bot.", 503);
  return { accept: "application/json", "x-api-key": apiKey };
}

async function dyoorOpenSeaCollectionSlug() {
  const stored = await worldStore.getJsonStrict<{ slug?: string }>("automation/sales/collection.json");
  if (stored?.slug) return stored.slug;
  const response = await fetch(
    `https://api.opensea.io/api/v2/chain/monad/contract/${dyoorS2Contract}`,
    { headers: openSeaHeaders(), signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) {
    throw dyoorWorldError(`OpenSea collection lookup failed (${response.status}).`, 503);
  }
  const data = await response.json().catch(() => ({})) as {
    collection?: string | { slug?: string };
  };
  const slug = typeof data.collection === "string"
    ? data.collection
    : String(data.collection?.slug || "");
  if (!/^[a-z0-9-]{2,120}$/.test(slug)) {
    throw dyoorWorldError("OpenSea did not return the D.Y.O.O.R collection slug.", 503);
  }
  await worldStore.setJson("automation/sales/collection.json", { slug });
  return slug;
}

function openSeaSaleTime(value: OpenSeaSaleEvent["event_timestamp"]) {
  if (typeof value === "number") {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function safeOpenSeaUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (
      url.hostname === "opensea.io" || url.hostname.endsWith(".opensea.io")
    ) ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeMarketplaceImageUrl(value: unknown) {
  const url = String(value || "").trim();
  return url.startsWith("ipfs://") || /^https:\/\//i.test(url) ? url : "";
}

export async function processDyoorWorldSales() {
  if (!dyoorWorldSalesBotEnabled()) {
    return { enabled: false, inspected: 0, posted: 0 };
  }
  const slug = await dyoorOpenSeaCollectionSlug();
  const response = await fetch(
    `https://api.opensea.io/api/v2/events/collection/${encodeURIComponent(slug)}?event_type=sale&limit=20`,
    { headers: openSeaHeaders(), signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw dyoorWorldError(`OpenSea sales lookup failed (${response.status}).`, 503);
  const data = await response.json().catch(() => ({})) as { asset_events?: OpenSeaSaleEvent[] };
  const events = (Array.isArray(data.asset_events) ? data.asset_events : [])
    .filter((event) => (
      event.event_type === "sale"
        && normalizeWorldWallet(event.nft?.contract) === String(dyoorS2Contract).toLowerCase()
    ))
    .sort(
      (left, right) => Date.parse(openSeaSaleTime(left.event_timestamp))
        - Date.parse(openSeaSaleTime(right.event_timestamp)),
    );

  let posted = 0;
  for (const event of events) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(event.transaction || ""))) continue;
    const txHash = requireTransactionHash(event.transaction);
    const tokenId = String(event.nft?.identifier || "").trim();
    if (!/^\d+$/.test(tokenId)) continue;
    const eventId = ethers.keccak256(ethers.toUtf8Bytes(
      `${txHash}:${event.order_hash || ""}:${tokenId}`,
    )).slice(2);
    const key = `automation/sales/events/${eventId}.json`;
    if (await worldStore.getJsonStrict(key)) continue;

    const decimals = Number.isInteger(event.payment?.decimals) ? Number(event.payment?.decimals) : 18;
    const quantity = /^\d+$/.test(String(event.payment?.quantity || ""))
      ? BigInt(String(event.payment?.quantity))
      : 0n;
    const amount = quantity > 0n ? ethers.formatUnits(quantity, decimals) : "0";
    const symbol = String(event.payment?.symbol || "MON").slice(0, 12);
    const buyer = normalizeWorldWallet(event.buyer);
    const seller = normalizeWorldWallet(event.seller);
    const createdAt = openSeaSaleTime(event.event_timestamp);
    const content = `${event.nft?.name || `D.Y.O.O.R #${tokenId}`} sold for ${amount} ${symbol}.`;
    await createDyoorWorldSystemMessage({
      id: `sale-${eventId}`,
      channelId: "sales-feed",
      kind: "sale",
      systemAuthor: "D.Y.O.O.R Sales Bot",
      content,
      createdAt,
      data: {
        tokenId,
        txHash,
        orderHash: String(event.order_hash || ""),
        buyer,
        seller,
        amount,
        symbol,
        imageUrl: safeMarketplaceImageUrl(
          event.nft?.display_image_url || event.nft?.image_url,
        ),
        openSeaUrl: safeOpenSeaUrl(event.nft?.opensea_url),
      },
    });
    await enqueueDyoorWorldPush({
      category: "sales",
      title: "D.Y.O.O.R sale confirmed",
      body: content,
      privateBody: "A verified D.Y.O.O.R sale was posted in dYOOR World.",
      channelId: "sales-feed",
      tag: `world-sale-${tokenId}`,
    });
    await worldStore.setJson(key, { version: 1, eventId, txHash, tokenId, createdAt });
    posted += 1;
  }
  return { enabled: true, inspected: events.length, posted };
}

type ExplorerNftTransfer = {
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  contractAddress?: string;
  tokenID?: string;
  logIndex?: string;
};

type DyoorWorldBurnCursor = {
  version: 1;
  blockNumber: number;
  totalBurns: number;
  updatedAt: string;
};

function s2StartBlock() {
  const configured = Number(readEnv("DYOOR_S2_START_BLOCK", "NEXT_PUBLIC_DYOOR_S2_START_BLOCK"));
  return Number.isSafeInteger(configured) && configured >= 0
    ? configured
    : DEFAULT_S2_DEPLOYMENT_BLOCK;
}

function explorerApiKey() {
  return readEnv(
    "MONADSCAN_API_KEY",
    "ETHERSCAN_API_KEY",
    "ETHERSCAN_V2_API_KEY",
    "DYOOR_S2_EXPLORER_API_KEY",
  );
}

function explorerApiUrl() {
  const configured = readEnv(
    "ETHERSCAN_V2_API_URL",
    "MONADSCAN_V2_API_URL",
    "DYOOR_S2_EXPLORER_API_URL",
  );
  const url = new URL(configured || DEFAULT_ETHERSCAN_V2_API_URL);
  if (url.protocol !== "https:") {
    throw dyoorWorldError("The Monad explorer API must use HTTPS.", 503);
  }
  return url;
}

async function explorerS2ZeroAddressTransfers(startBlock: number) {
  const apiKey = explorerApiKey();
  if (!apiKey) {
    throw dyoorWorldError("MONADSCAN_API_KEY is required for the burn relay.", 503);
  }
  const transfers: ExplorerNftTransfer[] = [];
  const pageSize = 1_000;
  for (let page = 1; page <= 10; page += 1) {
    const url = explorerApiUrl();
    const query = {
      chainid: "143",
      module: "account",
      action: "tokennfttx",
      address: ethers.ZeroAddress,
      contractaddress: dyoorS2Contract,
      startblock: String(startBlock),
      endblock: "9999999999",
      page: String(page),
      offset: String(pageSize),
      sort: "asc",
      apikey: apiKey,
    };
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw dyoorWorldError(`Monad burn lookup failed (${response.status}).`, 503);
    }
    const payload = await response.json().catch(() => ({})) as {
      status?: string;
      message?: string;
      result?: ExplorerNftTransfer[] | string;
    };
    if (!Array.isArray(payload.result)) {
      if (
        payload.status === "0"
          && /no transactions found/i.test(String(payload.result || payload.message || ""))
      ) {
        break;
      }
      throw dyoorWorldError(
        `Monad burn lookup failed: ${String(payload.result || payload.message || "unknown explorer response").slice(0, 180)}`,
        503,
      );
    }
    transfers.push(...payload.result);
    if (payload.result.length < pageSize) break;
  }
  return transfers;
}

function explorerBurnTime(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toISOString()
    : new Date().toISOString();
}

function topicWallet(value: unknown) {
  const topic = String(value || "").toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(topic)
    ? normalizeWorldWallet(`0x${topic.slice(-40)}`)
    : "";
}

async function verifyExplorerBurnOnChain(transfer: ExplorerNftTransfer) {
  const txHash = requireTransactionHash(transfer.hash);
  const receipt = await provider().getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    throw dyoorWorldError(`Burn transaction ${txHash} is not confirmed on Monad.`, 503);
  }
  const expectedFrom = normalizeWorldWallet(transfer.from);
  const expectedTokenId = String(transfer.tokenID || "");
  const zeroTopic = ethers.zeroPadValue(ethers.ZeroAddress, 32).toLowerCase();
  const log = receipt.logs.find((entry) => (
    entry.address.toLowerCase() === String(dyoorS2Contract).toLowerCase()
      && entry.topics[0]?.toLowerCase() === TRANSFER_TOPIC
      && entry.topics[2]?.toLowerCase() === zeroTopic
      && topicWallet(entry.topics[1]) === expectedFrom
      && BigInt(entry.topics[3] || "0").toString() === expectedTokenId
  ));
  if (!log) {
    throw dyoorWorldError(`Explorer burn ${txHash}:${expectedTokenId} failed receipt verification.`, 503);
  }
  return {
    txHash,
    burner: expectedFrom,
    tokenId: expectedTokenId,
    blockNumber: Number(receipt.blockNumber),
    logIndex: Number(log.index),
  };
}

export async function processDyoorWorldBurns() {
  const cursorKey = "automation/burns/cursor.json";
  const eventPrefix = "automation/burns/events/";
  const [cursor, existingEventKeys] = await Promise.all([
    worldStore.getJsonStrict<DyoorWorldBurnCursor>(cursorKey),
    worldStore.listKeys(eventPrefix),
  ]);
  const startBlock = Math.max(
    s2StartBlock(),
    Number.isSafeInteger(cursor?.blockNumber) ? Number(cursor?.blockNumber) : s2StartBlock(),
  );
  const transfers = await explorerS2ZeroAddressTransfers(startBlock);
  const burns = transfers
    .filter((transfer) => (
      normalizeWorldWallet(transfer.contractAddress) === String(dyoorS2Contract).toLowerCase()
        && normalizeWorldWallet(transfer.to) === ZERO_ADDRESS
        && Boolean(normalizeWorldWallet(transfer.from))
        && normalizeWorldWallet(transfer.from) !== ZERO_ADDRESS
        && /^0x[a-fA-F0-9]{64}$/.test(String(transfer.hash || ""))
        && /^\d+$/.test(String(transfer.tokenID || ""))
        && Number.isSafeInteger(Number(transfer.blockNumber))
    ))
    .sort((left, right) => (
      Number(left.blockNumber) - Number(right.blockNumber)
        || Number(left.logIndex || 0) - Number(right.logIndex || 0)
    ));
  const uniqueBurns = Array.from(new Map(
    burns.map((burn) => [
      `${String(burn.hash).toLowerCase()}:${String(burn.tokenID)}`,
      burn,
    ]),
  ).values());

  let totalBurns = Math.max(Number(cursor?.totalBurns || 0), existingEventKeys.length);
  let posted = 0;
  let highestBlock = startBlock;
  for (const burn of uniqueBurns) {
    const eventId = `${String(burn.hash).toLowerCase().slice(2)}-${String(burn.tokenID)}`;
    const markerKey = `${eventPrefix}${eventId}.json`;
    highestBlock = Math.max(highestBlock, Number(burn.blockNumber));
    if (await worldStore.getJsonStrict(markerKey)) continue;

    const verified = await verifyExplorerBurnOnChain(burn);
    totalBurns += 1;
    const createdAt = explorerBurnTime(burn.timeStamp);
    const supplyAfter = Math.max(0, S2_ISSUED_SUPPLY_FALLBACK - totalBurns);
    const content = `S2 Droid #${verified.tokenId} was permanently burned. Live supply contracted to ${supplyAfter.toLocaleString("en-US")}.`;
    await createDyoorWorldSystemMessage({
      id: `burn-${eventId}`,
      channelId: "burn-log",
      kind: "burn",
      systemAuthor: "D.Y.O.O.R Burn Relay",
      content,
      createdAt,
      data: {
        tokenId: verified.tokenId,
        txHash: verified.txHash,
        burner: verified.burner,
        blockNumber: verified.blockNumber,
        logIndex: verified.logIndex,
        burnNumber: totalBurns,
        supplyAfter,
      },
    });
    await enqueueDyoorWorldPush({
      category: "burns",
      title: "Permanent S2 burn confirmed",
      body: content,
      privateBody: "A verified S2 burn was posted in dYOOR World.",
      channelId: "burn-log",
      tag: `world-burn-${verified.tokenId}`,
    });
    await worldStore.setJson(markerKey, {
      version: 1,
      ...verified,
      burnNumber: totalBurns,
      supplyAfter,
      createdAt,
    });
    posted += 1;
  }

  const nextCursor: DyoorWorldBurnCursor = {
    version: 1,
    blockNumber: highestBlock,
    totalBurns,
    updatedAt: new Date().toISOString(),
  };
  await worldStore.setJson(cursorKey, nextCursor);
  return {
    inspected: uniqueBurns.length,
    posted,
    totalBurns,
    currentSupply: Math.max(0, S2_ISSUED_SUPPLY_FALLBACK - totalBurns),
    cursorBlock: highestBlock,
  };
}

async function validatedTradeContract() {
  const address = dyoorWorldTradeEscrowAddress();
  if (!address) throw dyoorWorldError("The World trade escrow is not deployed yet.", 503);
  const contract = new ethers.Contract(address, WORLD_TRADE_ABI, provider());
  const collection = normalizeWorldWallet(await contract.S2_COLLECTION().catch(() => ""));
  if (collection !== String(dyoorS2Contract).toLowerCase()) {
    throw dyoorWorldError("The configured trade escrow does not use the production S2 collection.", 503);
  }
  return contract;
}

export async function getDyoorWorldTrade(tradeIdValue: unknown) {
  const tradeId = String(tradeIdValue || "").trim();
  if (!/^\d+$/.test(tradeId) || BigInt(tradeId) < 1n) {
    throw dyoorWorldError("Enter a valid World trade ID.", 400);
  }
  const contract = await validatedTradeContract();
  const trade = await contract.trades(tradeId);
  const maker = normalizeWorldWallet(trade.maker);
  const status = Number(trade.status);
  if (!maker || maker === ZERO_ADDRESS || status === 0) {
    throw dyoorWorldError(`World trade #${tradeId} does not exist.`, 404);
  }
  const taker = normalizeWorldWallet(trade.taker);
  const expiresAt = Number(trade.expiresAt);
  const statusLabel = ["none", "active", "completed", "cancelled", "expired"][status]
    || "unknown";
  return {
    tradeId,
    maker,
    taker,
    openOffer: taker === ZERO_ADDRESS,
    offeredTokenId: BigInt(trade.offeredTokenId).toString(),
    requestedTokenId: BigInt(trade.requestedTokenId).toString(),
    monOfferedWei: BigInt(trade.monOffered).toString(),
    monOffered: ethers.formatEther(trade.monOffered),
    monRequestedWei: BigInt(trade.monRequested).toString(),
    monRequested: ethers.formatEther(trade.monRequested),
    expiresAt,
    expired: expiresAt <= Math.floor(Date.now() / 1_000),
    status,
    statusLabel,
  };
}

export async function verifyDyoorWorldTradeTransaction(input: {
  wallet: unknown;
  txHash: unknown;
}) {
  const wallet = normalizeWorldWallet(input.wallet);
  const txHash = requireTransactionHash(input.txHash);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  const contract = await validatedTradeContract();
  const [transaction, receipt] = await Promise.all([
    provider().getTransaction(txHash),
    provider().getTransactionReceipt(txHash),
  ]);
  if (!transaction || !receipt) {
    throw dyoorWorldError("The escrow transaction is not confirmed yet. Check again in a moment.", 409);
  }
  if (receipt.status !== 1) throw dyoorWorldError("The escrow transaction failed.", 400);
  const contractAddress = String(await contract.getAddress()).toLowerCase();
  if (normalizeWorldWallet(transaction.to) !== contractAddress) {
    throw dyoorWorldError("This transaction did not call the configured World escrow.", 400);
  }
  const relayer = normalizeWorldWallet(transaction.from);
  const iface = new ethers.Interface(WORLD_TRADE_ABI);
  const recorded: DyoorWorldMessageView[] = [];
  const rewards: DyoorWorldRewardRecord[] = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress) continue;
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed || ![
      "TradeCreated",
      "TradeCompleted",
      "TradeCancelled",
      "TradeExpired",
    ].includes(parsed.name)) continue;

    const tradeId = BigInt(parsed.args.tradeId).toString();
    const trade = await contract.trades(tradeId);
    const maker = normalizeWorldWallet(trade.maker);
    const taker = normalizeWorldWallet(trade.taker);
    const eventTaker = normalizeWorldWallet(parsed.args.taker);
    const involved = [maker, taker, eventTaker, relayer].includes(wallet);
    if (!involved) {
      throw dyoorWorldError("This holder wallet is not a party to the escrow event.", 403);
    }

    const offeredTokenId = BigInt(trade.offeredTokenId).toString();
    const requestedTokenId = BigInt(trade.requestedTokenId).toString();
    const monOffered = ethers.formatEther(trade.monOffered);
    const monRequested = ethers.formatEther(trade.monRequested);
    const action = parsed.name.replace(/^Trade/, "").toLowerCase();
    const content = parsed.name === "TradeCreated"
      ? `Trade #${tradeId}: S2 #${offeredTokenId} offered for S2 #${requestedTokenId}${BigInt(trade.monOffered) > 0n ? ` + ${monOffered} MON` : ""}${BigInt(trade.monRequested) > 0n ? `; asks ${monRequested} MON` : ""}.`
      : `Trade #${tradeId} ${action} on the non-custodial World escrow.`;
    const message = await createDyoorWorldSystemMessage({
      id: `trade-${txHash.slice(2)}-${log.index}`,
      channelId: "trade-desk",
      kind: "trade",
      systemAuthor: "World Trade Relay",
      content,
      data: {
        tradeId,
        action,
        txHash,
        maker,
        taker,
        offeredTokenId,
        requestedTokenId,
        monOffered,
        monRequested,
        expiresAt: Number(trade.expiresAt),
        status: Number(trade.status),
      },
    });
    recorded.push(message);
    await enqueueDyoorWorldPush({
      category: "trades",
      title: `World trade #${tradeId} ${action}`,
      body: content,
      privateBody: `Your World trade #${tradeId} has a verified update.`,
      channelId: "trade-desk",
      tag: `world-trade-${tradeId}`,
      targetWallets: Array.from(new Set([maker, taker, eventTaker]))
        .filter((participant) => (
          participant
            && participant !== ZERO_ADDRESS
            && participant !== wallet
        )),
      excludedWallets: [wallet],
    });
    if (parsed.name === "TradeCompleted") {
      const completedRewards = await Promise.all(
        Array.from(new Set([maker, taker]))
          .filter(Boolean)
          .map((participant) => createDyoorWorldActivityReward({
            wallet: participant,
            kind: "trade",
            id: `trade-${tradeId}-${participant.slice(2)}`,
            amountEnergy: DYOOR_WORLD_TRADE_REWARD_ENERGY,
            dailyCap: DYOOR_WORLD_TRADE_REWARD_DAILY_CAP,
            referenceId: tradeId,
          })),
      );
      rewards.push(
        ...completedRewards.filter(
          (reward): reward is DyoorWorldRewardRecord => Boolean(reward),
        ),
      );
    }
  }
  if (recorded.length === 0) {
    throw dyoorWorldError("No World escrow event was found in this transaction.", 400);
  }
  return { txHash, messages: recorded, rewards };
}

export async function dyoorWorldPublicConfig() {
  const registryAddress = dyoorWorldNamesContractAddress();
  let claimsOpen = false;
  let registryAvailable = !registryAddress;
  if (registryAddress) {
    try {
      const contract = await validatedNamesContract();
      claimsOpen = Boolean(await contract?.claimsOpen());
      registryAvailable = true;
    } catch (error) {
      console.error("dYOOR World public name-registry check failed", error);
    }
  }
  return {
    chainId: 143,
    s2ContractAddress: dyoorS2Contract,
    registryAddress,
    registryMode: registryAddress ? "monad" : "preview-reservation",
    registryAvailable,
    claimsOpen,
    tradeEscrowAddress: dyoorWorldTradeEscrowAddress(),
    rewardsEnabled: dyoorWorldRewardsEnabled(),
    salesBotEnabled: dyoorWorldSalesBotEnabled(),
    collections: DYOOR_WORLD_COLLECTIONS,
    channels: DYOOR_WORLD_CHANNELS,
  };
}

export async function dyoorWorldConfigForWallet(walletValue: unknown) {
  const [config, access] = await Promise.all([
    dyoorWorldPublicConfig(),
    getDyoorWorldAccess(walletValue),
  ]);
  let canPostAnnouncements = false;
  try {
    canPostAnnouncements = await canPostDyoorWorldAnnouncements(walletValue);
  } catch (error) {
    console.error("dYOOR World owner permission lookup failed", error);
  }
  return {
    ...config,
    channels: dyoorWorldChannelsForEntitlements(access.entitlements),
    access: {
      eligible: access.eligible,
      entitlements: access.entitlements,
      balances: access.balances,
      unavailable: access.unavailable,
      checkedAt: access.checkedAt,
    },
    s2FeaturesEnabled: access.entitlements.season2,
    rewardsEnabled: config.rewardsEnabled && access.entitlements.season2,
    canPostAnnouncements,
  };
}
