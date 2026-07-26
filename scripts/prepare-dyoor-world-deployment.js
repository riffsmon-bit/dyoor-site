import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { ethers } from "ethers";

if (process.env.PREPARE_DYOOR_WORLD_SECRETS !== "1") {
  throw new Error(
    "Refusing to create deployment credentials. Set PREPARE_DYOOR_WORLD_SECRETS=1 explicitly.",
  );
}

const root = process.cwd();
const localEnvPath = path.join(root, ".env");
const netlifyEnvPath = path.join(root, "netlify-dyoor-world.env");
const NETLIFY_RUNTIME_REMOVED_KEYS = [
  "DYOOR_TRAIT_BOUNTIES_CONTRACT",
  "DYOOR_TRAIT_BOUNTIES_START_BLOCK",
  "DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS",
  "DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY",
  "DYOOR_TRAIT_LAB_ENABLE_DROID_BURN",
  "DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD",
  "DYOOR_WORLD_NAMES_CONTRACT",
  "DYOOR_WORLD_NAMES_METADATA_BASE_URI",
  "DYOOR_WORLD_NAMES_START_BLOCK",
  "DYOOR_WORLD_OPEN_CLAIMS",
];

function readEnvFile(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function envValue(...sources) {
  for (const source of sources) {
    const value = String(source || "").trim();
    if (value) return value;
  }
  return "";
}

function normalizedPrivateKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  return key.startsWith("0x") ? key : `0x${key}`;
}

function upsertEnv(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

function removeEnvKeys(source, keys) {
  return keys.reduce(
    (output, key) => output.replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, "gm"), ""),
    source,
  );
}

function writeSecure(filePath, contents) {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, filePath);
  chmodSync(filePath, 0o600);
}

let localSource = readEnvFile(localEnvPath);
let netlifySource = removeEnvKeys(
  readEnvFile(netlifyEnvPath),
  NETLIFY_RUNTIME_REMOVED_KEYS,
);
const localValues = parse(localSource);
const netlifyValues = parse(netlifySource);

const deployerKey = normalizedPrivateKey(localValues.DEPLOYER_PRIVATE_KEY);
if (!deployerKey) {
  throw new Error("DEPLOYER_PRIVATE_KEY must already be configured in .env.");
}
const deployer = new ethers.Wallet(deployerKey);

let processorKey = normalizedPrivateKey(envValue(
  localValues.DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY,
  netlifyValues.DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY,
));
const processorWasCreated = !processorKey;
if (!processorKey) processorKey = ethers.Wallet.createRandom().privateKey;
const processor = new ethers.Wallet(processorKey);
if (processor.address.toLowerCase() === deployer.address.toLowerCase()) {
  throw new Error("The bounty processor must not reuse the deployer/admin wallet.");
}

const sessionSecret = envValue(
  netlifyValues.DYOOR_WORLD_SESSION_SECRET,
  localValues.DYOOR_WORLD_SESSION_SECRET,
  randomBytes(32).toString("hex"),
);
const automationSecret = envValue(
  netlifyValues.DYOOR_WORLD_AUTOMATION_SECRET,
  localValues.DYOOR_WORLD_AUTOMATION_SECRET,
  randomBytes(32).toString("hex"),
);
const rewardSecret = envValue(
  netlifyValues.DYOOR_WORLD_REWARD_SECRET,
  localValues.DYOOR_WORLD_REWARD_SECRET,
  randomBytes(32).toString("hex"),
);
const processorSecret = envValue(
  localValues.DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET,
  netlifyValues.DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET,
  randomBytes(32).toString("hex"),
);
const metadataBaseUri = envValue(
  localValues.DYOOR_WORLD_NAMES_METADATA_BASE_URI,
  "https://dyoor.netlify.app/api/dyoor-world/names/metadata/",
);

const localUpdates = {
  DYOOR_OWNER_ADDRESS: deployer.address,
  DYOOR_WORLD_AUTOMATION_SECRET: automationSecret,
  DYOOR_WORLD_NAMES_METADATA_BASE_URI: metadataBaseUri,
  DYOOR_WORLD_OPEN_CLAIMS: "false",
  DYOOR_WORLD_REWARD_SECRET: rewardSecret,
  DYOOR_WORLD_REWARDS_ENABLED: "false",
  DYOOR_WORLD_SALES_BOT_ENABLED: "false",
  DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS: processor.address,
  DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY: processorKey,
  DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET: processorSecret,
  DYOOR_TRAIT_BOUNTY_GRANT_CREDIT_ROLE: "true",
  DYOOR_TRAIT_LAB_ENABLE_BOUNTIES: "false",
};
for (const [key, value] of Object.entries(localUpdates)) {
  localSource = upsertEnv(localSource, key, value);
}

const netlifyUpdates = {
  DYOOR_WORLD_AUTOMATION_SECRET: automationSecret,
  DYOOR_WORLD_REWARD_SECRET: rewardSecret,
  DYOOR_WORLD_REWARDS_ENABLED: "false",
  DYOOR_WORLD_SALES_BOT_ENABLED: "false",
  DYOOR_WORLD_SESSION_SECRET: sessionSecret,
  DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY: processorKey,
  DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET: processorSecret,
  DYOOR_TRAIT_LAB_ENABLE_BOUNTIES: "false",
  NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD: "true",
};
for (const [key, value] of Object.entries(netlifyUpdates)) {
  netlifySource = upsertEnv(netlifySource, key, value);
}

writeSecure(localEnvPath, localSource);
writeSecure(netlifyEnvPath, netlifySource);

console.log(JSON.stringify({
  ok: true,
  deployer: deployer.address,
  owner: deployer.address,
  processor: processor.address,
  processorWasCreated,
  localEnv: path.relative(root, localEnvPath),
  netlifyEnv: path.relative(root, netlifyEnvPath),
  secretsPrinted: false,
}, null, 2));
