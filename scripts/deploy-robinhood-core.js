import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  getAddress,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  artifactBytecode,
  assertMainnetBroadcastSafety,
  loadHoodyoorLocalEnvironment,
  normalizePrivateKey,
  readJson,
  requireContract,
  saveCheckpoint,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const launchManifest = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-mainnet-launch-manifest.json",
));
const artifactRoot = path.join(projectRoot, "contracts", "hoodyoor", "out");
const collectionArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOR.sol",
  "HoodYOOR.json",
));
const energyBankArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOOREnergyBank.sol",
  "HoodYOOREnergyBank.json",
));
const rendererArtifact = readJson(path.join(
  artifactRoot,
  "HoodYOORPixelRenderer.sol",
  "HoodYOORPixelRenderer.json",
));
const execute = process.env.EXECUTE_HOODYOOR_CORE_DEPLOYMENT === "1";

function deploymentPath(name) {
  return path.join(
    projectRoot,
    "deployments",
    "robinhood",
    `${name}-${HOODYOOR_CHAIN_ID}.json`,
  );
}

artifactBytecode(collectionArtifact);
artifactBytecode(energyBankArtifact);

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    chainId: HOODYOOR_CHAIN_ID,
    configuredOwner: config.owner,
    configuredTreasury: config.treasury,
    requiresCheckpoint: "deployments/robinhood/hoodyoor-onchain-art-4663.json",
    deploys: ["HoodYOOR", "HoodYOOREnergyBank"],
    saleStateAfterDeployment: "closed",
    executeWith: "EXECUTE_HOODYOOR_CORE_DEPLOYMENT=1",
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
assertMainnetBroadcastSafety(config.owner);

const artCheckpointPath = deploymentPath("hoodyoor-onchain-art");
if (!fs.existsSync(artCheckpointPath)) {
  throw new Error("The frozen onchain-art deployment checkpoint is required first.");
}
const artCheckpoint = readJson(artCheckpointPath);
if (
  artCheckpoint.schema !== "dyoor-hoodyoor-art-deployment-v1"
  || artCheckpoint.chainId !== HOODYOOR_CHAIN_ID
  || artCheckpoint.catalogHash.toLowerCase()
    !== launchManifest.payloads.art.catalogHash.toLowerCase()
) {
  throw new Error("The onchain-art checkpoint does not match the frozen launch manifest.");
}
await requireContract(provider, getAddress(artCheckpoint.store), "Packed trait store");
await requireContract(provider, getAddress(artCheckpoint.renderer), "Pixel renderer");
const renderer = new Contract(artCheckpoint.renderer, rendererArtifact.abi, provider);
if (!await renderer.isFrozen()) throw new Error("The renderer's trait store is not frozen.");
if (getAddress(await renderer.traitStore()) !== getAddress(artCheckpoint.store)) {
  throw new Error("The renderer points to an unexpected trait store.");
}

const checkpointPath = deploymentPath("hoodyoor-core");
const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : {
  schema: "dyoor-hoodyoor-core-deployment-v1",
  chainId: HOODYOOR_CHAIN_ID,
  deployer: wallet.address,
  owner: getAddress(config.owner),
  treasury: getAddress(config.treasury),
  renderer: getAddress(artCheckpoint.renderer),
  sourceTree: launchManifest.sourceTree.canonicalKeccak256,
  collection: "",
  energyBank: "",
  transactions: [],
};
for (const [key, expected] of Object.entries({
  chainId: HOODYOOR_CHAIN_ID,
  deployer: wallet.address,
  owner: getAddress(config.owner),
  treasury: getAddress(config.treasury),
  renderer: getAddress(artCheckpoint.renderer),
  sourceTree: launchManifest.sourceTree.canonicalKeccak256,
})) {
  const actual = typeof expected === "string" && expected.length === 42
    ? getAddress(checkpoint[key])
    : checkpoint[key];
  if (actual !== expected) throw new Error(`Core checkpoint has a different ${key}.`);
}

let collection;
if (checkpoint.collection) {
  await requireContract(provider, getAddress(checkpoint.collection), "HoodYØØR collection");
  collection = new Contract(checkpoint.collection, collectionArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(
    collectionArtifact.abi,
    artifactBytecode(collectionArtifact),
    wallet,
  );
  collection = await factory.deploy(wallet.address, config.treasury, artCheckpoint.renderer);
  await collection.waitForDeployment();
  const receipt = await collection.deploymentTransaction().wait();
  checkpoint.collection = await collection.getAddress();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`deployed HoodYØØR collection ${checkpoint.collection}`);
}

let energyBank;
if (checkpoint.energyBank) {
  await requireContract(provider, getAddress(checkpoint.energyBank), "HoodYØØR Energy Bank");
  energyBank = new Contract(checkpoint.energyBank, energyBankArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(
    energyBankArtifact.abi,
    artifactBytecode(energyBankArtifact),
    wallet,
  );
  energyBank = await factory.deploy(wallet.address);
  await energyBank.waitForDeployment();
  const receipt = await energyBank.deploymentTransaction().wait();
  checkpoint.energyBank = await energyBank.getAddress();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`deployed HoodYØØR Energy Bank ${checkpoint.energyBank}`);
}

const collectionChecks = [
  ["owner", wallet.address],
  ["treasury", config.treasury],
  ["royaltyReceiver", config.treasury],
  ["renderer", artCheckpoint.renderer],
];
for (const [getter, expected] of collectionChecks) {
  if (getAddress(await collection[getter]()) !== getAddress(expected)) {
    throw new Error(`Collection ${getter} does not match the launch configuration.`);
  }
}
if (Number(await collection.MAX_SUPPLY()) !== config.maxSupply) {
  throw new Error("Collection max supply differs from the launch configuration.");
}
if (
  Number(await collection.totalSupply()) !== 0
  || await collection.gtdSaleActive()
  || await collection.publicSaleActive()
  || await collection.secondaryTradingEnabled()
) {
  throw new Error("New core deployment is not in the required closed launch state.");
}
if (getAddress(await energyBank.owner()) !== wallet.address) {
  throw new Error("Energy Bank owner differs from the deployment wallet.");
}

console.log(JSON.stringify({
  mode: "executed",
  chainId: HOODYOOR_CHAIN_ID,
  collection: checkpoint.collection,
  energyBank: checkpoint.energyBank,
  renderer: checkpoint.renderer,
  saleState: "closed",
  checkpoint: path.relative(projectRoot, checkpointPath),
}, null, 2));
