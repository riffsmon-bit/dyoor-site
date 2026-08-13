import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
} from "ethers";
import {
  assertMainnetBroadcastSafety,
  loadHoodyoorLocalEnvironment,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const manifestPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-onchain-art-manifest.json",
);
const storeArtifactPath = path.join(
  projectRoot,
  "contracts",
  "hoodyoor",
  "out",
  "HoodYOORPackedTraitStore.sol",
  "HoodYOORPackedTraitStore.json",
);
const rendererArtifactPath = path.join(
  projectRoot,
  "contracts",
  "hoodyoor",
  "out",
  "HoodYOORPixelRenderer.sol",
  "HoodYOORPixelRenderer.json",
);
const collectionConfigPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
);
const execute = process.env.EXECUTE_HOODYOOR_ART_DEPLOYMENT === "1";
const registrationBatchSize = 20;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bytecode(artifact) {
  const value = artifact.bytecode?.object || artifact.bytecode;
  if (!value || value === "0x") throw new Error("Compiled artifact is missing deploy bytecode.");
  return value.startsWith("0x") ? value : `0x${value}`;
}

function assertGeneratedArtifacts(manifest) {
  if (manifest.schema !== "dyoor-hoodyoor-onchain-art-v1") {
    throw new Error(`Unsupported art manifest schema ${manifest.schema}.`);
  }
  if (manifest.totals.traits !== 201 || manifest.totals.chunks !== 25) {
    throw new Error("Generated art totals do not match the reviewed production catalog.");
  }
  for (const chunk of manifest.chunks) {
    const chunkPath = path.join(projectRoot, chunk.path);
    const bytes = fs.readFileSync(chunkPath);
    if (bytes.length !== chunk.bytes || sha256(bytes) !== chunk.sha256) {
      throw new Error(`Chunk verification failed for ${chunk.path}.`);
    }
    if (!chunk.final && bytes.length !== manifest.settings.chunkPayloadBytes) {
      throw new Error(`Non-final chunk ${chunk.index} is not exactly 24,000 bytes.`);
    }
  }
}

function deploymentPath(chainId) {
  return path.join(
    projectRoot,
    "deployments",
    "robinhood",
    `hoodyoor-onchain-art-${chainId}.json`,
  );
}

function saveCheckpoint(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

const manifest = readJson(manifestPath);
const collectionConfig = readJson(collectionConfigPath);
const storeArtifact = readJson(storeArtifactPath);
const rendererArtifact = readJson(rendererArtifactPath);
assertGeneratedArtifacts(manifest);
bytecode(storeArtifact);
bytecode(rendererArtifact);

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    executeWith: "EXECUTE_HOODYOOR_ART_DEPLOYMENT=1",
    traits: manifest.totals.traits,
    payloadBytes: manifest.totals.payloadBytes,
    chunks: manifest.totals.chunks,
    finalChunkBytes: manifest.totals.finalChunkBytes,
    catalogHash: manifest.contracts.catalogHash,
    registrationTransactions: Math.ceil(manifest.records.length / registrationBatchSize),
    note: "This stage deploys and freezes only the art store and renderer; it does not deploy the NFT collection.",
  }, null, 2));
  process.exit(0);
}

const rpcUrl = process.env.HOODYOOR_RPC_URL || "";
const privateKeyValue = process.env.HOODYOOR_DEPLOYER_PRIVATE_KEY || "";
if (!rpcUrl || !privateKeyValue) {
  throw new Error("HOODYOOR_RPC_URL and HOODYOOR_DEPLOYER_PRIVATE_KEY are required for execution.");
}
const privateKey = privateKeyValue.startsWith("0x") ? privateKeyValue : `0x${privateKeyValue}`;
const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);
const network = await provider.getNetwork();
const chainId = Number(network.chainId);
if (chainId !== 46_630 && !(chainId === 4_663 && process.env.ALLOW_HOODYOOR_MAINNET === "1")) {
  throw new Error(
    `Refusing chain ${chainId}. Use Robinhood testnet 46630, or explicitly set ALLOW_HOODYOOR_MAINNET=1 for 4663.`,
  );
}
if (chainId === 4_663) assertMainnetBroadcastSafety(collectionConfig.owner);

const checkpointPath = deploymentPath(chainId);
const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : {
  schema: "dyoor-hoodyoor-art-deployment-v1",
  chainId,
  deployer: wallet.address,
  catalogHash: manifest.contracts.catalogHash,
  store: "",
  renderer: "",
  transactions: [],
};
if (checkpoint.chainId !== chainId || checkpoint.catalogHash !== manifest.contracts.catalogHash) {
  throw new Error("Existing deployment checkpoint does not match this chain/catalog.");
}
if (getAddress(checkpoint.deployer) !== wallet.address) {
  throw new Error("Existing deployment checkpoint belongs to a different deployer.");
}

let store;
if (checkpoint.store) {
  store = new Contract(getAddress(checkpoint.store), storeArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(storeArtifact.abi, bytecode(storeArtifact), wallet);
  store = await factory.deploy(wallet.address, manifest.contracts.expectedTraitCount);
  await store.waitForDeployment();
  const receipt = await store.deploymentTransaction().wait();
  checkpoint.store = await store.getAddress();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`deployed packed trait store ${checkpoint.store}`);
}

const storedChunks = Number(await store.chunkCount());
if (storedChunks > manifest.chunks.length) {
  throw new Error("Onchain store contains more chunks than the generated manifest.");
}
for (let index = 0; index < storedChunks; index += 1) {
  const pointer = await store.chunkAt(index);
  const runtimeCode = await provider.getCode(pointer);
  if (!runtimeCode.startsWith("0x00")) throw new Error(`Chunk ${index} is missing its STOP byte.`);
  const storedPayload = `0x${runtimeCode.slice(4)}`;
  if (keccak256(storedPayload).toLowerCase() !== manifest.chunks[index].keccak256.toLowerCase()) {
    throw new Error(`Onchain chunk ${index} does not match the generated manifest.`);
  }
}
for (let index = storedChunks; index < manifest.chunks.length; index += 1) {
  const chunk = manifest.chunks[index];
  const bytes = fs.readFileSync(path.join(projectRoot, chunk.path));
  const transaction = chunk.final
    ? await store.appendFinalChunk(bytes)
    : await store.appendChunk(bytes);
  const receipt = await transaction.wait();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`stored art chunk ${index + 1}/${manifest.chunks.length}`);
}
if (Number(await store.totalPayloadBytes()) !== manifest.totals.payloadBytes) {
  throw new Error("Onchain payload byte count does not match the generated manifest.");
}

for (let offset = 0; offset < manifest.records.length; offset += registrationBatchSize) {
  const candidates = manifest.records.slice(offset, offset + registrationBatchSize);
  const missing = [];
  for (const record of candidates) {
    if (await store.traitExists(record.layer, record.traitId)) {
      const stored = await store.traitRecord(record.layer, record.traitId);
      if (
        Number(stored.nameOffset) !== record.nameOffset
        || Number(stored.nameLength) !== record.nameLength
        || Number(stored.artOffset) !== record.artOffset
        || Number(stored.artLength) !== record.artLength
      ) throw new Error(`Onchain trait record differs for ${record.slot}::${record.name}.`);
    } else {
      missing.push({
        layer: record.layer,
        traitId: record.traitId,
        nameOffset: record.nameOffset,
        nameLength: record.nameLength,
        artOffset: record.artOffset,
        artLength: record.artLength,
      });
    }
  }
  if (missing.length) {
    const transaction = await store.setTraitRecords(missing);
    const receipt = await transaction.wait();
    checkpoint.transactions.push(receipt.hash);
    saveCheckpoint(checkpointPath, checkpoint);
  }
  console.log(`verified trait records ${Math.min(offset + registrationBatchSize, manifest.records.length)}/${manifest.records.length}`);
}
if (Number(await store.registeredTraitCount()) !== manifest.totals.traits) {
  throw new Error("Onchain registered trait count does not match the generated manifest.");
}

if (!await store.frozen()) {
  const transaction = await store.freeze(manifest.contracts.catalogHash);
  const receipt = await transaction.wait();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
}
if ((await store.catalogHash()).toLowerCase() !== manifest.contracts.catalogHash.toLowerCase()) {
  throw new Error("Frozen onchain catalog hash does not match the generated manifest.");
}

if (!checkpoint.renderer) {
  const factory = new ContractFactory(rendererArtifact.abi, bytecode(rendererArtifact), wallet);
  const renderer = await factory.deploy(await store.getAddress());
  await renderer.waitForDeployment();
  const receipt = await renderer.deploymentTransaction().wait();
  checkpoint.renderer = await renderer.getAddress();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
}
const renderer = new Contract(getAddress(checkpoint.renderer), rendererArtifact.abi, wallet);
if (getAddress(await renderer.traitStore()) !== getAddress(checkpoint.store)) {
  throw new Error("Renderer points to an unexpected trait store.");
}
if (!await renderer.isFrozen()) throw new Error("Renderer does not report a frozen trait store.");

console.log(JSON.stringify({
  mode: "executed",
  chainId,
  store: checkpoint.store,
  renderer: checkpoint.renderer,
  catalogHash: checkpoint.catalogHash,
  checkpoint: path.relative(projectRoot, checkpointPath),
}, null, 2));
