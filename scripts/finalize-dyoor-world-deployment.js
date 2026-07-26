import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { ethers } from "ethers";

const EXPECTED_CHAIN_ID = 143n;
const S2_COLLECTION = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";

if (process.env.FINALIZE_DYOOR_WORLD_DEPLOYMENT !== "1") {
  throw new Error(
    "Refusing to finalize deployment. Set FINALIZE_DYOOR_WORLD_DEPLOYMENT=1 explicitly.",
  );
}

const root = process.cwd();
const localEnvPath = path.join(root, ".env");
const masterEnvPath = path.join(root, "netlify-dyoor-world.env");
const functionsEnvPath = path.join(root, "netlify-dyoor-world-functions.env");
const buildsEnvPath = path.join(root, "netlify-dyoor-world-builds.env");
const deploymentsDir = path.join(root, "deployments");
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

function requiredAddress(key) {
  const value = String(process.env[key] || "").trim();
  if (!ethers.isAddress(value)) throw new Error(`${key} must be a valid address.`);
  return ethers.getAddress(value);
}

function requiredHash(key) {
  const value = String(process.env[key] || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(value)) throw new Error(`${key} must be a transaction hash.`);
  return value;
}

function requiredBlock(key) {
  const value = String(process.env[key] || "").trim();
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new Error(`${key} must be a block number.`);
  return value;
}

function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
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

function writeAtomic(filePath, contents, mode) {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, contents, { encoding: "utf8", mode });
  renameSync(tempPath, filePath);
  chmodSync(filePath, mode);
}

const worldAddress = requiredAddress("DEPLOYED_DYOOR_WORLD_NAMES_CONTRACT");
const bountyAddress = requiredAddress("DEPLOYED_DYOOR_TRAIT_BOUNTIES_CONTRACT");
const worldBlock = requiredBlock("DEPLOYED_DYOOR_WORLD_NAMES_BLOCK");
const bountyBlock = requiredBlock("DEPLOYED_DYOOR_TRAIT_BOUNTIES_BLOCK");
const worldDeploymentTx = requiredHash("DEPLOYED_DYOOR_WORLD_NAMES_TX");
const reserveLabelsTx = requiredHash("DEPLOYED_DYOOR_WORLD_RESERVE_TX");
const bountyDeploymentTx = requiredHash("DEPLOYED_DYOOR_TRAIT_BOUNTIES_TX");
const grantCreditRoleTx = requiredHash("DEPLOYED_DYOOR_TRAIT_BOUNTIES_GRANT_TX");

let localSource = readText(localEnvPath);
let masterSource = removeEnvKeys(
  readText(masterEnvPath),
  NETLIFY_RUNTIME_REMOVED_KEYS,
);
const localValues = parse(localSource);
const masterValues = parse(masterSource);

const owner = requiredAddress("DYOOR_OWNER_ADDRESS");
const processor = requiredAddress("DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS");
const processorKey = String(
  localValues.DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY
    || masterValues.DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY
    || "",
).trim();
const processorSecret = String(
  localValues.DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET
    || masterValues.DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET
    || "",
).trim();
const sessionSecret = String(
  masterValues.DYOOR_WORLD_SESSION_SECRET
    || localValues.DYOOR_WORLD_SESSION_SECRET
    || "",
).trim();
const automationSecret = String(
  masterValues.DYOOR_WORLD_AUTOMATION_SECRET
    || localValues.DYOOR_WORLD_AUTOMATION_SECRET
    || "",
).trim();
const rewardSecret = String(
  masterValues.DYOOR_WORLD_REWARD_SECRET
    || localValues.DYOOR_WORLD_REWARD_SECRET
    || "",
).trim();
if (!processorKey || new ethers.Wallet(processorKey).address !== processor) {
  throw new Error("The stored bounty operator key does not match the dedicated processor.");
}
if (
  processorSecret.length < 32
    || sessionSecret.length < 32
    || automationSecret.length < 32
    || rewardSecret.length < 32
) {
  throw new Error("Deployment secrets were not prepared.");
}

const rpcUrl = String(
  localValues.MONAD_RPC_URL
    || localValues.NEXT_PUBLIC_MONAD_RPC_URL
    || "https://rpc.monad.xyz",
).trim();
const provider = new ethers.JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== EXPECTED_CHAIN_ID) {
  throw new Error(`Wrong network: expected ${EXPECTED_CHAIN_ID}, got ${network.chainId}.`);
}

const world = new ethers.Contract(worldAddress, [
  "function owner() view returns(address)",
  "function S2_COLLECTION() view returns(address)",
  "function claimsOpen() view returns(bool)",
  "function totalNames() view returns(uint256)",
], provider);
const bounties = new ethers.Contract(bountyAddress, [
  "function owner() view returns(address)",
  "function ENERGY_BANK() view returns(address)",
  "function processors(address) view returns(bool)",
  "function bountyCount() view returns(uint256)",
], provider);
const energyBank = new ethers.Contract(ENERGY_BANK, [
  "function CREDIT_ROLE() view returns(bytes32)",
  "function hasRole(bytes32,address) view returns(bool)",
], provider);

const [
  worldOwner,
  s2Collection,
  claimsOpen,
  totalNames,
  bountyOwner,
  configuredEnergyBank,
  processorEnabled,
  bountyCount,
] = await Promise.all([
  world.owner(),
  world.S2_COLLECTION(),
  world.claimsOpen(),
  world.totalNames(),
  bounties.owner(),
  bounties.ENERGY_BANK(),
  bounties.processors(processor),
  bounties.bountyCount(),
]);
const creditRole = await energyBank.CREDIT_ROLE();
const creditRoleGranted = await energyBank.hasRole(creditRole, bountyAddress);
if (
  worldOwner !== owner
    || s2Collection !== ethers.getAddress(S2_COLLECTION)
    || claimsOpen
    || totalNames !== 0n
    || bountyOwner !== owner
    || configuredEnergyBank !== ethers.getAddress(ENERGY_BANK)
    || !processorEnabled
    || bountyCount !== 0n
    || !creditRoleGranted
) {
  throw new Error("On-chain deployment preflight failed; env files were not changed.");
}

const transactionHashes = [
  worldDeploymentTx,
  reserveLabelsTx,
  bountyDeploymentTx,
  grantCreditRoleTx,
];
let totalCharged = 0n;
const transactions = [];
for (const hash of transactionHashes) {
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
  ]);
  if (!transaction || !receipt || receipt.status !== 1) {
    throw new Error(`Deployment transaction ${hash} is missing or failed.`);
  }
  const gasPrice = transaction.gasPrice || receipt.gasPrice;
  const charged = receipt.gasUsed * gasPrice;
  totalCharged += charged;
  transactions.push({
    hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    gasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
    chargedMon: ethers.formatEther(charged),
  });
}

const metadataBaseUri = String(
  localValues.DYOOR_WORLD_NAMES_METADATA_BASE_URI
    || "https://dyoor.netlify.app/api/dyoor-world/names/metadata/",
).trim();
const localUpdates = {
  DYOOR_WORLD_NAMES_CONTRACT: worldAddress,
  NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT: worldAddress,
  DYOOR_WORLD_NAMES_START_BLOCK: worldBlock,
  DYOOR_WORLD_NAMES_METADATA_BASE_URI: metadataBaseUri,
  DYOOR_WORLD_OPEN_CLAIMS: "false",
  DYOOR_TRAIT_BOUNTIES_CONTRACT: bountyAddress,
  NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT: bountyAddress,
  DYOOR_TRAIT_BOUNTIES_START_BLOCK: bountyBlock,
  DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS: processor,
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
  NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT: worldAddress,
  NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT: bountyAddress,
  NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD: "true",
  DYOOR_TRAIT_LAB_ENABLE_BOUNTIES: "false",
};
for (const [key, value] of Object.entries(netlifyUpdates)) {
  masterSource = upsertEnv(masterSource, key, value);
}
writeAtomic(localEnvPath, localSource, 0o600);
writeAtomic(masterEnvPath, masterSource, 0o600);

const functionsSource = [
  "# Import into Netlify deploy-preview context with Functions scope.",
  `DYOOR_WORLD_AUTOMATION_SECRET=${automationSecret}`,
  `DYOOR_WORLD_REWARD_SECRET=${rewardSecret}`,
  "DYOOR_WORLD_REWARDS_ENABLED=false",
  "DYOOR_WORLD_SALES_BOT_ENABLED=false",
  `DYOOR_WORLD_SESSION_SECRET=${sessionSecret}`,
  `DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY=${processorKey}`,
  `DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET=${processorSecret}`,
  "DYOOR_TRAIT_LAB_ENABLE_BOUNTIES=false",
  "",
].join("\n");
const buildsSource = [
  "# Import into Netlify deploy-preview context with Builds scope.",
  `NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT=${worldAddress}`,
  `NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT=${bountyAddress}`,
  "NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD=true",
  "",
].join("\n");
writeAtomic(functionsEnvPath, functionsSource, 0o600);
writeAtomic(buildsEnvPath, buildsSource, 0o600);

const record = {
  version: 1,
  chainId: Number(EXPECTED_CHAIN_ID),
  finalizedAt: new Date().toISOString(),
  owner,
  processor,
  totalChargedMon: ethers.formatEther(totalCharged),
  worldNames: {
    address: worldAddress,
    startBlock: Number(worldBlock),
    deploymentTx: worldDeploymentTx,
    reserveLabelsTx,
    s2Collection: ethers.getAddress(S2_COLLECTION),
    claimsOpen: false,
    totalNames: "0",
    sourcify: `https://sourcify-api-monad.blockvision.org/repo-ui/143/${worldAddress}`,
  },
  traitBounties: {
    address: bountyAddress,
    startBlock: Number(bountyBlock),
    deploymentTx: bountyDeploymentTx,
    grantCreditRoleTx,
    energyBank: ethers.getAddress(ENERGY_BANK),
    processorEnabled: true,
    creditRoleGranted: true,
    bountyCount: "0",
    sourcify: `https://sourcify-api-monad.blockvision.org/repo-ui/143/${bountyAddress}`,
  },
  transactions,
};
mkdirSync(deploymentsDir, { recursive: true });
const recordName = `dyoor-world-mainnet-${worldBlock}-${bountyBlock}.json`;
writeAtomic(
  path.join(deploymentsDir, recordName),
  `${JSON.stringify(record, null, 2)}\n`,
  0o644,
);
writeAtomic(
  path.join(deploymentsDir, "dyoor-world-mainnet.latest.json"),
  `${JSON.stringify(record, null, 2)}\n`,
  0o644,
);

console.log(JSON.stringify({
  ok: true,
  worldAddress,
  bountyAddress,
  owner,
  processor,
  totalChargedMon: record.totalChargedMon,
  functionsEnv: path.relative(root, functionsEnvPath),
  buildsEnv: path.relative(root, buildsEnvPath),
  deploymentRecord: path.join("deployments", recordName),
  secretsPrinted: false,
}, null, 2));
