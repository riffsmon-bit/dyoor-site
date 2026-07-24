import { randomUUID } from "node:crypto";
import { ethers } from "ethers";
import {
  DYOOR_WORLD_CHALLENGE_TTL_MS,
  DYOOR_WORLD_CHANNELS,
  DYOOR_WORLD_SESSION_COOKIE,
  DYOOR_WORLD_SESSION_TTL_SECONDS,
  type DyoorWorldMessage,
  type DyoorWorldMessageView,
  type DyoorWorldNameClaim,
  type DyoorWorldProfile,
  isWorldChannel,
  normalizeWorldLabel,
  normalizeWorldWallet,
  resolveWorldNameClaims,
  shortWorldWallet,
  validateWorldLabel,
  worldProfileFromClaim,
} from "@/lib/dyoor-world";
import {
  createDyoorWorldSessionToken,
  dyoorWorldChallengeMessage,
  readDyoorWorldCookie,
  recoverDyoorWorldChallengeWallet,
  verifyDyoorWorldSessionToken,
  type DyoorWorldChallenge,
  type DyoorWorldSession,
} from "@/lib/dyoor-world-auth";
import { dyoorS2Contract, optionalContractAddress } from "@/lib/contracts/addresses";
import { createJsonStore } from "@/src/lib/storage/fileStore";

const worldStore = createJsonStore("dyoor-world");
const ERC721_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const WORLD_NAMES_ABI = [
  "function nameOf(address wallet) view returns (string)",
  "function ownerOfName(string label) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function labelOfToken(uint256 tokenId) view returns (string)",
  "function claimsOpen() view returns (bool)",
  "function S2_COLLECTION() view returns (address)",
];
const holderCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

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

function worldRpcUrl() {
  const rpcUrl = readEnv(
    "ALCHEMY_MONAD_RPC_URL",
    "DYOOR_S2_RPC_URL",
    "MONAD_RPC_URL",
    "NEXT_PUBLIC_MONAD_RPC_URL",
  ) || "https://rpc.monad.xyz";
  if (/testnet/i.test(rpcUrl)) {
    throw dyoorWorldError("dYOOR World requires a Monad mainnet RPC endpoint.", 503);
  }
  return rpcUrl;
}

let worldProvider: ethers.JsonRpcProvider | null = null;

function provider() {
  if (!worldProvider) worldProvider = new ethers.JsonRpcProvider(worldRpcUrl(), 143);
  return worldProvider;
}

export function dyoorWorldNamesContractAddress() {
  return optionalContractAddress(
    process.env.DYOOR_WORLD_NAMES_CONTRACT
      || process.env.NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT,
  );
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

export async function hasDyoorWorldAccess(walletValue: unknown, fresh = false) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);

  const cached = holderCache.get(wallet);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.allowed;

  const contract = new ethers.Contract(dyoorS2Contract, ERC721_BALANCE_ABI, provider());
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const allowed = BigInt(await contract.balanceOf(wallet)) > 0n;
      holderCache.set(wallet, { allowed, expiresAt: Date.now() + 15_000 });
      return allowed;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 175 * (attempt + 1)));
    }
  }

  console.error("dYOOR World holder check failed", lastError);
  throw dyoorWorldError("Could not verify S2 ownership on Monad. Try again in a moment.", 503);
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
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  assertDyoorWorldRateLimit(
    `challenge:${wallet}:${dyoorWorldClientIp(request)}`,
    8,
    60_000,
  );
  if (!(await hasDyoorWorldAccess(wallet, true))) {
    throw dyoorWorldError("This wallet does not currently hold a D.Y.O.O.R S2 Droid.", 403);
  }
  await pruneDyoorWorldChallenges(wallet);

  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + DYOOR_WORLD_CHALLENGE_TTL_MS).toISOString();
  const nonce = randomUUID();
  const challengeInput = {
    wallet,
    nonce,
    audience: new URL(request.url).host.toLowerCase(),
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
  const challenge = await worldStore.getJsonStrict<DyoorWorldChallenge>(key);
  if (!challenge || challenge.version !== 1 || challenge.wallet !== wallet || challenge.nonce !== nonce) {
    throw dyoorWorldError("This holder challenge was not found or was already used.", 401);
  }
  if (challenge.audience !== new URL(request.url).host.toLowerCase()) {
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
  if (!(await hasDyoorWorldAccess(wallet, true))) {
    throw dyoorWorldError("This wallet no longer holds a D.Y.O.O.R S2 Droid.", 403);
  }

  await worldStore.deleteJson(key);
  return {
    wallet,
    token: createDyoorWorldSessionToken(wallet),
  };
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
    throw dyoorWorldError("A current S2 holder session is required.", 401);
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
  const onchain = await onchainWorldProfile(wallet);
  if (onchain) return onchain;
  if (dyoorWorldNamesContractAddress()) return null;

  const resolved = resolveWorldNameClaims(await loadWorldClaims());
  const claim = resolved.byWallet.get(wallet);
  return claim ? worldProfileFromClaim(claim) : null;
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
  const unique = Array.from(new Set(wallets.map(normalizeWorldWallet).filter(Boolean)));
  const profiles = await Promise.all(unique.map(async (wallet) => [
    wallet,
    await getDyoorWorldProfile(wallet),
  ] as const));
  return new Map(profiles);
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
    .filter((message): message is DyoorWorldMessage => Boolean(
      message
        && message.version === 1
        && isWorldChannel(message.channelId)
        && normalizeWorldWallet(message.wallet)
        && message.content
        && Number.isFinite(Date.parse(message.createdAt)),
    ))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-limit);
}

export async function listDyoorWorldMessages(channelValue: unknown) {
  const channelId = String(channelValue || "");
  if (!isWorldChannel(channelId)) {
    throw dyoorWorldError("channel must identify a dYOOR World stream.", 400);
  }
  const messages = await loadRawWorldMessages(channelId);
  const profiles = await worldProfilesForWallets(messages.map((message) => message.wallet));
  return messages.map((message): DyoorWorldMessageView => ({
    ...message,
    author: profiles.get(message.wallet)?.displayName || shortWorldWallet(message.wallet),
  }));
}

export async function createDyoorWorldMessage(input: {
  wallet: unknown;
  channelId: unknown;
  content: unknown;
}) {
  const wallet = normalizeWorldWallet(input.wallet);
  const channelId = String(input.channelId || "");
  if (!wallet) throw dyoorWorldError("wallet must be a valid address.", 400);
  if (!isWorldChannel(channelId)) {
    throw dyoorWorldError("channel must identify a dYOOR World stream.", 400);
  }
  const content = String(input.content || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!content) throw dyoorWorldError("Write a message before transmitting.", 400);
  if (content.length > 800) {
    throw dyoorWorldError("World messages must contain 800 characters or fewer.", 400);
  }
  assertDyoorWorldRateLimit(`message:${wallet}`, 8, 30_000);

  const recent = await loadRawWorldMessages(channelId, 30);
  const lastByWallet = recent.filter((message) => message.wallet === wallet).at(-1);
  if (lastByWallet && Date.now() - Date.parse(lastByWallet.createdAt) < 1_500) {
    throw dyoorWorldError("Wait a moment before sending another message.", 429);
  }

  const createdAt = new Date().toISOString();
  const id = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}`;
  const message: DyoorWorldMessage = {
    version: 1,
    id,
    channelId,
    wallet,
    content,
    createdAt,
  };
  await worldStore.setJson(`${messagePrefix(channelId)}${id}.json`, message);
  const profile = await getDyoorWorldProfile(wallet);
  return {
    ...message,
    author: profile?.displayName || shortWorldWallet(wallet),
  } satisfies DyoorWorldMessageView;
}

export async function dyoorWorldPublicConfig() {
  const registryAddress = dyoorWorldNamesContractAddress();
  let claimsOpen = false;
  if (registryAddress) {
    const contract = await validatedNamesContract();
    try {
      claimsOpen = Boolean(await contract?.claimsOpen());
    } catch {
      throw dyoorWorldError("The Monad dYOOR name registry is unavailable.", 503);
    }
  }
  return {
    chainId: 143,
    s2ContractAddress: dyoorS2Contract,
    registryAddress,
    registryMode: registryAddress ? "monad" : "preview-reservation",
    claimsOpen,
    channels: DYOOR_WORLD_CHANNELS,
  };
}
