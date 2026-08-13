import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  assertMainnetBroadcastSafety,
  loadHoodyoorLocalEnvironment,
  normalizePrivateKey,
  readJson,
  requireContract,
  saveCheckpoint,
  verifyFrozenEnergyMigrationLedger,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const artifactRoot = path.join(projectRoot, "contracts", "hoodyoor", "out");
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const ledgerPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-energy-migration-ledger.json",
);
const ledger = readJson(ledgerPath);
const energyBankArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOREnergyBank.sol",
  "HoodYOOREnergyBank.json",
));
const execute = process.env.EXECUTE_HOODYOOR_ENERGY_MIGRATION === "1";

function deploymentPath(name) {
  return path.join(
    projectRoot,
    "deployments",
    "robinhood",
    `${name}-${HOODYOOR_CHAIN_ID}.json`,
  );
}

function requiredCoreCheckpoint() {
  const filePath = deploymentPath("hoodyoor-core");
  if (!fs.existsSync(filePath)) throw new Error("The HoodYØØR core checkpoint is required first.");
  const checkpoint = readJson(filePath);
  if (
    checkpoint.schema !== "dyoor-hoodyoor-core-deployment-v1"
    || checkpoint.chainId !== HOODYOOR_CHAIN_ID
    || !checkpoint.energyBank
  ) throw new Error("The core checkpoint does not describe the reviewed Robinhood deployment.");
  return checkpoint;
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

const ledgerVerification = verifyFrozenEnergyMigrationLedger(projectRoot);
if (!ledgerVerification.passed) {
  throw new Error(`Frozen Energy migration ledger failed verification: ${ledgerVerification.error}`);
}
const migrationRows = ledger.rows.filter((row) => BigInt(row.destinationEnergy) > 0n);

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    chainId: HOODYOOR_CHAIN_ID,
    sourceSnapshotBlock: ledger.source.snapshotBlock,
    ledgerHash: ledger.binary.keccak256,
    wallets: migrationRows.length,
    destinationEnergy: ledger.totals.destinationEnergy,
    batches: ledger.batches.map((batch) => ({
      index: batch.index,
      count: batch.count,
      totalEnergy: batch.totalEnergy,
      campaignId: batch.campaignId,
    })),
    requiresCheckpoint: "deployments/robinhood/hoodyoor-core-4663.json",
    executeWith: "EXECUTE_HOODYOOR_ENERGY_MIGRATION=1",
  }, null, 2));
  process.exit(0);
}

const rpcUrl = process.env.HOODYOOR_RPC_URL || "";
const privateKey = normalizePrivateKey(process.env.HOODYOOR_DEPLOYER_PRIVATE_KEY || "");
if (!rpcUrl || !privateKey) {
  throw new Error("HOODYOOR_RPC_URL and HOODYOOR_DEPLOYER_PRIVATE_KEY are required.");
}
const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);
const network = await provider.getNetwork();
if (Number(network.chainId) !== HOODYOOR_CHAIN_ID) {
  throw new Error(`Refusing chain ${network.chainId}; expected ${HOODYOOR_CHAIN_ID}.`);
}
assertMainnetBroadcastSafety(config.owner, process.env, projectRoot);

const coreCheckpoint = requiredCoreCheckpoint();
await requireContract(provider, getAddress(coreCheckpoint.energyBank), "HoodYØØR Energy Bank");
const energyBank = new Contract(coreCheckpoint.energyBank, energyBankArtifact.abi, wallet);
if (getAddress(await energyBank.owner()) !== wallet.address) {
  throw new Error("Deployment wallet is not the HoodYØØR Energy Bank owner.");
}
if (await energyBank.paused()) throw new Error("HoodYØØR Energy Bank is paused.");
const creditRole = await energyBank.CREDIT_ROLE();
if (!await energyBank.hasRole(creditRole, wallet.address)) {
  throw new Error("Deployment wallet is missing HoodYØØR Energy CREDIT_ROLE.");
}

const checkpointPath = deploymentPath("hoodyoor-energy-migration");
const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : {
  schema: "dyoor-hoodyoor-energy-migration-deployment-v1",
  chainId: HOODYOOR_CHAIN_ID,
  deployer: wallet.address,
  energyBank: getAddress(coreCheckpoint.energyBank),
  sourceChainId: ledger.source.chainId,
  sourceEnergyBank: getAddress(ledger.source.energyBank),
  sourceSnapshotBlock: ledger.source.snapshotBlock,
  ledgerHash: ledger.binary.keccak256,
  wallets: migrationRows.length,
  destinationEnergy: ledger.totals.destinationEnergy,
  batches: [],
  transactions: [],
  status: "in-progress",
};
for (const [key, expected] of Object.entries({
  chainId: HOODYOOR_CHAIN_ID,
  deployer: wallet.address,
  energyBank: getAddress(coreCheckpoint.energyBank),
  sourceChainId: ledger.source.chainId,
  sourceEnergyBank: getAddress(ledger.source.energyBank),
  sourceSnapshotBlock: ledger.source.snapshotBlock,
  ledgerHash: ledger.binary.keccak256,
  wallets: migrationRows.length,
  destinationEnergy: ledger.totals.destinationEnergy,
})) {
  const actual = typeof expected === "string" && expected.length === 42
    ? getAddress(checkpoint[key])
    : checkpoint[key];
  if (actual !== expected) throw new Error(`Energy migration checkpoint has a different ${key}.`);
}

for (const batch of ledger.batches) {
  const rows = migrationRows.slice(batch.start, batch.end + 1);
  if (
    rows.length !== batch.count
    || rows.reduce((total, row) => total + BigInt(row.destinationEnergy), 0n).toString()
      !== batch.totalEnergy
  ) throw new Error(`Frozen Energy batch ${batch.index} is internally inconsistent.`);

  const used = await energyBank.usedCreditCampaign(batch.campaignId);
  const prior = checkpoint.batches.find((entry) => entry.index === batch.index);
  if (used) {
    if (!prior || prior.campaignId.toLowerCase() !== batch.campaignId.toLowerCase()) {
      throw new Error(`Energy campaign ${batch.campaignId} was used outside this checkpoint.`);
    }
    const receipt = await provider.getTransactionReceipt(prior.hash);
    if (receipt?.status !== 1) throw new Error(`Recorded Energy batch ${batch.index} is not successful.`);
    console.log(`verified Energy migration batch ${batch.index + 1}/${ledger.batches.length}`);
    continue;
  }
  if (prior) throw new Error(`Recorded Energy batch ${batch.index} is not marked used onchain.`);

  const recipients = rows.map((row) => row.wallet);
  const amounts = rows.map((row) => BigInt(row.destinationEnergy));
  await energyBank.creditEnergyBatch.staticCall(recipients, amounts, batch.campaignId);
  const receipt = await (
    await energyBank.creditEnergyBatch(recipients, amounts, batch.campaignId)
  ).wait();
  if (receipt?.status !== 1) throw new Error(`Energy migration batch ${batch.index} failed.`);
  const record = {
    index: batch.index,
    campaignId: batch.campaignId,
    count: batch.count,
    totalEnergy: batch.totalEnergy,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
  };
  checkpoint.batches.push(record);
  checkpoint.transactions.push({
    label: `energy-migration-${batch.index + 1}`,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
  });
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`migrated Energy batch ${batch.index + 1}/${ledger.batches.length}`);
}

await mapLimit(migrationRows, 8, async (row) => {
  const balance = BigInt(await energyBank.energyBalance(row.wallet));
  if (balance !== BigInt(row.destinationEnergy)) {
    throw new Error(
      `Migrated Energy balance mismatch for ${row.wallet}: ${balance} != ${row.destinationEnergy}.`,
    );
  }
});
for (const batch of ledger.batches) {
  if (!await energyBank.usedCreditCampaign(batch.campaignId)) {
    throw new Error(`Energy migration campaign ${batch.campaignId} is not frozen onchain.`);
  }
}

checkpoint.status = "complete";
checkpoint.completedAtBlock = await provider.getBlockNumber();
saveCheckpoint(checkpointPath, checkpoint);
console.log(JSON.stringify({
  mode: "executed",
  chainId: HOODYOOR_CHAIN_ID,
  status: checkpoint.status,
  energyBank: checkpoint.energyBank,
  wallets: checkpoint.wallets,
  destinationEnergy: checkpoint.destinationEnergy,
  ledgerHash: checkpoint.ledgerHash,
  batches: checkpoint.batches.length,
  checkpoint: path.relative(projectRoot, checkpointPath),
}, null, 2));
