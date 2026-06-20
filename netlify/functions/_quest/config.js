import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function normalizeAddress(address) {
  const value = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
}

function adminWallets() {
  return readEnv("ADMIN_WALLETS")
    .split(",")
    .map(normalizeAddress)
    .filter(Boolean);
}

function hasAdminWalletConfig() {
  return Boolean(readEnv("ADMIN_WALLETS"));
}

function loadSeedQuests() {
  const seedPaths = [
    path.join(root, "data/quest-seed.json"),
    path.join(root, "quest-seed.json"),
    path.join(moduleDir, "../../../data/quest-seed.json"),
    path.join(moduleDir, "../../data/quest-seed.json"),
    path.join(moduleDir, "../data/quest-seed.json"),
    path.join(moduleDir, "data/quest-seed.json"),
  ];
  for (const seedPath of seedPaths) {
    try {
      const parsed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
      if (Array.isArray(parsed)) return parsed;
    } catch (_err) {}
  }
  return [];
}

const supabaseUrl = readEnv("SUPABASE_URL");
const supabaseKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const questStorage = readEnv("QUEST_STORAGE", readEnv("QUEST_DATA_BACKEND", "auto")).toLowerCase();
const monadRpcUrl = readEnv("MONAD_RPC_URL", "https://rpc.monad.xyz");
const dyoorS1Contract = readEnv("DYOOR_S1_CONTRACT", readEnv("DYOOR_S1_NFT_ADDRESS"));
const ascensionStakingContract = readEnv("ASCENSION_STAKING_CONTRACT", readEnv("ASCENSION_STAKING_ADDRESS"));
const swapContract = readEnv("SWAP_CONTRACT");
const dyoorSwapRouter = readEnv("DYOOR_SWAP_ROUTER", swapContract);
const dyoorTreasuryAddress = readEnv("DYOOR_TREASURY_ADDRESS", readEnv("DYOOR_SUPPORT_FEE_RECIPIENT"));
const m3shProofUrl = readEnv("M3SH_PROOF_URL", readEnv("M3SH_SESSIONS_URL"));
const blueprintProofUrl = readEnv("ASCENSION_BLUEPRINT_PROOF_URL", readEnv("BLUEPRINT_PROOF_URL"));
const openseaApiKey = readEnv("OPENSEA_API_KEY");
const openseaBuyStartBlock = readEnv("OPENSEA_BUY_START_BLOCK", readEnv("QUEST_START_BLOCK"));
const seaportContract = readEnv("SEAPORT_CONTRACT", "0x0000000000000068f116a894984e2db1123eb395");
const targetDyoorPostId = readEnv("TARGET_DYOOR_POST_ID");
const xClientId = readEnv("X_CLIENT_ID");
const xClientSecret = readEnv("X_CLIENT_SECRET");
const discordClientId = readEnv("DISCORD_CLIENT_ID");
const discordClientSecret = readEnv("DISCORD_CLIENT_SECRET");

export {
  root,
  supabaseUrl,
  supabaseKey,
  questStorage,
  monadRpcUrl,
  dyoorS1Contract,
  ascensionStakingContract,
  swapContract,
  dyoorSwapRouter,
  dyoorTreasuryAddress,
  m3shProofUrl,
  blueprintProofUrl,
  openseaApiKey,
  openseaBuyStartBlock,
  seaportContract,
  targetDyoorPostId,
  xClientId,
  xClientSecret,
  discordClientId,
  discordClientSecret,
  adminWallets,
  hasAdminWalletConfig,
  loadSeedQuests,
  normalizeAddress,
};
