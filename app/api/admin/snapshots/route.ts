import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_ID = 143;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_ASCENSION_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_DYOOR_S1 = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const BLUEPRINTS_KEY = "ascension-blueprints.json";
const LOCAL_BLUEPRINTS_PATH = path.join(process.cwd(), "data", "ascension-blueprints.json");
const LOCAL_HARVEST_LEDGER_PATH = path.join(process.cwd(), "data", "harvested-energy.json");
const ADMIN_WINDOW_MS = 5 * 60 * 1000;

const TRAIT_EXPORT_ORDER = [
  ["background", "Background"],
  ["droid", "Droid"],
  ["eyes", "Eyes"],
  ["clothes", "Clothes"],
  ["mouth", "Mouth"],
  ["hat", "Hat"],
  ["special", "Special"],
  ["accessories", "Accessories"],
] as const;

const stakingAbi = [
  "function tokensOfStaker(address user) view returns (uint256[])",
  "function getStakedTokens(address user) view returns (uint256[])",
  "function stakedBalance(address user) view returns (uint256)",
  "function balanceOf(address user) view returns (uint256)",
  "function pendingPoints(address user) view returns (uint256)",
  "function stakeInfo(uint256 tokenId) view returns (address owner,uint64 stakedAt)",
];

const erc721Abi = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const energyBankAbi = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
];

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function ownerWallet() {
  return normalizeAddress(readEnv("ENERGY_ADMIN_ADDRESS", "DYOOR_OWNER_ADDRESS", "ADMIN_WALLET", "OWNER_WALLET", "ADMIN_WALLETS").split(",")[0]);
}

function adminMessage(wallet: string, timestamp: string, nonce: string) {
  return [
    "DYOOR Admin Snapshot",
    `Wallet: ${wallet}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function formatUnits(raw: bigint) {
  const whole = raw / 10n ** 18n;
  const frac = (raw % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, serialize(val)]));
  }
  return value;
}

async function verifyAdmin(body: Record<string, unknown>) {
  const owner = ownerWallet();
  if (!owner) throw Object.assign(new Error("Admin owner wallet is not configured."), { status: 500 });

  const wallet = normalizeAddress(body.wallet);
  const timestamp = String(body.timestamp || "");
  const nonce = String(body.nonce || "");
  const signature = String(body.signature || "");

  if (!wallet) throw Object.assign(new Error("Missing wallet."), { status: 400 });
  if (wallet !== owner) throw Object.assign(new Error("Not authorized."), { status: 403 });
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > ADMIN_WINDOW_MS) {
    throw Object.assign(new Error("Admin signature expired. Sign again."), { status: 401 });
  }
  if (!nonce || nonce.length < 8 || !signature) {
    throw Object.assign(new Error("Missing admin signature."), { status: 400 });
  }

  let recovered = "";
  try {
    recovered = normalizeAddress(ethers.verifyMessage(adminMessage(wallet, timestamp, nonce), signature));
  } catch {
    recovered = "";
  }
  if (recovered !== owner) throw Object.assign(new Error("Admin signature does not match owner wallet."), { status: 401 });
  return owner;
}

function getBlueprintStore() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");
  return siteID && token
    ? getStore({ name: "ascension-blueprints", siteID, token, consistency: "strong" })
    : getStore({ name: "ascension-blueprints", consistency: "strong" });
}

async function readBlueprints() {
  try {
    const value = await getBlueprintStore().get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
    return Array.isArray(value) ? value : [];
  } catch {
    const local = await fs.readFile(LOCAL_BLUEPRINTS_PATH, "utf8").catch(() => "[]");
    const value = JSON.parse(local);
    return Array.isArray(value) ? value : [];
  }
}

async function readHarvestLedger() {
  try {
    const local = await fs.readFile(LOCAL_HARVEST_LEDGER_PATH, "utf8");
    const value = JSON.parse(local);
    return value && typeof value === "object" ? value as Record<string, { harvestedRaw?: string }> : {};
  } catch {
    return {};
  }
}

async function safeContract<T>(task: () => Promise<T>, fallback: T) {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

async function discoverStakingWallets(provider: ethers.JsonRpcProvider, stakingAddress: string, nftAddress: string) {
  const wallets = new Set<string>();
  const tokenIds = new Set<string>();
  const iface = new ethers.Interface(erc721Abi);
  const latest = await provider.getBlockNumber();
  const start = Number(readEnv("ASCENSION_START_BLOCK") || "0") || 0;
  const chunk = Math.max(1000, Number(readEnv("ASCENSION_LOG_CHUNK_SIZE") || "5000") || 5000);
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const stakingTopic = ethers.zeroPadValue(stakingAddress, 32);

  for (let from = start; from <= latest; from += chunk) {
    const to = Math.min(latest, from + chunk - 1);
    const logs = await safeContract(() => provider.getLogs({
      address: nftAddress,
      fromBlock: from,
      toBlock: to,
      topics: [transferTopic, null, stakingTopic],
    }), [] as ethers.Log[]);
    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        const fromWallet = normalizeAddress(parsed?.args?.from);
        const tokenId = parsed?.args?.tokenId?.toString();
        if (fromWallet) wallets.add(fromWallet);
        if (tokenId) tokenIds.add(tokenId);
      } catch {}
    }
  }

  return { wallets, tokenIds };
}

async function tokenOwnerFromStakeInfo(staking: ethers.Contract, tokenId: string) {
  const info = await safeContract(async () => await staking.stakeInfo(BigInt(tokenId)), null);
  return normalizeAddress(info?.owner);
}

async function stakingRow(wallet: string, staking: ethers.Contract, energyBank: ethers.Contract, harvestLedger: Record<string, { harvestedRaw?: string }>, timestamp: string) {
  const tokenValues = await safeContract(async () => await staking.tokensOfStaker(wallet), null)
    || await safeContract(async () => await staking.getStakedTokens(wallet), null)
    || [];
  const tokenIds = Array.from(new Set((Array.isArray(tokenValues) ? tokenValues : []).map((id) => id.toString()))).sort((a, b) => Number(a) - Number(b));
  const fallbackCount = await safeContract(async () => await staking.stakedBalance(wallet), 0n)
    || await safeContract(async () => await staking.balanceOf(wallet), 0n);
  const pendingRaw = await safeContract(async () => await staking.pendingPoints(wallet), 0n);
  const lifetimeRaw = await safeContract(async () => await energyBank.lifetimeEnergy(wallet), 0n);
  const harvestedRaw = BigInt(String(harvestLedger[wallet.toLowerCase()]?.harvestedRaw || "0"));

  return {
    wallet,
    stakedCount: tokenIds.length || Number(fallbackCount || 0n),
    tokenIds,
    pendingEnergy: formatUnits(pendingRaw),
    pendingEnergyRaw: pendingRaw.toString(),
    harvestedEnergy: formatUnits(harvestedRaw),
    harvestedEnergyRaw: harvestedRaw.toString(),
    lifetimeEnergy: formatUnits(lifetimeRaw),
    lifetimeEnergyRaw: lifetimeRaw.toString(),
    ascended: tokenIds.length > 0 || Number(fallbackCount || 0n) > 0,
    snapshotTimestamp: timestamp,
  };
}

function blueprintRows(blueprints: Array<Record<string, any>>, timestamp: string) {
  return blueprints.map((entry) => {
    const traits = entry.traits && typeof entry.traits === "object" ? entry.traits : {};
    const row: Record<string, unknown> = {
      wallet: normalizeAddress(entry.wallet),
      savedBlueprint: Boolean(entry.ascensionBlueprint || entry.blueprintId || entry.createdAt),
      savedBlueprintTimestamp: String(entry.createdAt || ""),
      blueprintId: String(entry.blueprintId || entry.hash || ""),
      imageUrl: String(entry.imageUrl || entry.image || entry.png || ""),
      eligibilityStatus: entry.ascensionBlueprint ? "eligible" : "",
      snapshotTimestamp: timestamp,
    };
    for (const [key, label] of TRAIT_EXPORT_ORDER) row[label] = String(traits[key] || "");
    return row;
  }).filter((row) => row.wallet);
}

async function generateSnapshots() {
  const timestamp = new Date().toISOString();
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, CHAIN_ID);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_DYOOR_S1);
  const energyBankAddress = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK);
  const staking = new ethers.Contract(stakingAddress, stakingAbi, provider);
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const energyBank = new ethers.Contract(energyBankAddress, energyBankAbi, provider);
  const blueprints = await readBlueprints() as Array<Record<string, any>>;
  const harvestLedger = await readHarvestLedger();
  const blueprint = blueprintRows(blueprints, timestamp);
  const discovered = await discoverStakingWallets(provider, stakingAddress, nftAddress);
  const walletSet = new Set<string>(blueprint.map((row) => String(row.wallet)));

  for (const tokenId of discovered.tokenIds) {
    const currentOwner = normalizeAddress(await safeContract(async () => await nft.ownerOf(BigInt(tokenId)), ""));
    if (currentOwner !== stakingAddress.toLowerCase()) continue;
    const staker = await tokenOwnerFromStakeInfo(staking, tokenId);
    if (staker) walletSet.add(staker);
  }
  for (const wallet of discovered.wallets) walletSet.add(wallet);

  const stakingRows = (await Promise.all(Array.from(walletSet).map((wallet) => stakingRow(wallet, staking, energyBank, harvestLedger, timestamp))))
    .filter((row) => row.stakedCount > 0 || blueprint.some((item) => item.wallet === row.wallet));
  const stakingByWallet = new Map(stakingRows.map((row) => [row.wallet, row]));
  const blueprintByWallet = new Map(blueprint.map((row) => [String(row.wallet), row]));
  const combined = Array.from(new Set([...stakingByWallet.keys(), ...blueprintByWallet.keys()])).sort().map((wallet) => {
    const stake = stakingByWallet.get(wallet);
    const bp = blueprintByWallet.get(wallet);
    return {
      wallet,
      stakedCount: stake?.stakedCount || 0,
      ascended: stake?.ascended ? "yes" : "no",
      savedBlueprint: bp ? "yes" : "no",
      Background: bp?.Background || "",
      Droid: bp?.Droid || "",
      Eyes: bp?.Eyes || "",
      Clothes: bp?.Clothes || "",
      Mouth: bp?.Mouth || "",
      Hat: bp?.Hat || "",
      Special: bp?.Special || "",
      Accessories: bp?.Accessories || "",
      pendingEnergy: stake?.pendingEnergy || "0",
      harvestedEnergy: stake?.harvestedEnergy || "",
      lifetimeEnergy: stake?.lifetimeEnergy || "0",
      snapshotTimestamp: timestamp,
    };
  });

  return {
    ok: true,
    generatedAt: timestamp,
    totals: {
      walletsFound: combined.length,
      totalStaked: stakingRows.reduce((sum, row) => sum + Number(row.stakedCount || 0), 0),
      totalBlueprintsSaved: blueprint.length,
    },
    staking: stakingRows,
    blueprints: blueprint,
    combined,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = normalizeAddress(url.searchParams.get("wallet"));
  const owner = ownerWallet();
  if (!owner) return json(500, { ok: false, error: "Admin owner wallet is not configured." });
  return json(200, { ok: true, connected: Boolean(wallet), authorized: Boolean(wallet && wallet === owner) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await verifyAdmin(body);
    return json(200, serialize(await generateSnapshots()) as Record<string, unknown>);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Admin snapshot failed." });
  }
}
