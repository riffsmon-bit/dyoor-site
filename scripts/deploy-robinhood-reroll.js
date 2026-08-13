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
const generatedRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const manifestPath = path.join(generatedRoot, "hoodyoor-reroll-rules.json");
const binaryPath = path.join(generatedRoot, "hoodyoor-reroll-rules.bin");
const rulesArtifactPath = path.join(
  projectRoot,
  "contracts",
  "hoodyoor",
  "out",
  "HoodYOORTraitRules.sol",
  "HoodYOORTraitRules.json",
);
const controllerArtifactPath = path.join(
  projectRoot,
  "contracts",
  "hoodyoor",
  "out",
  "HoodYOORRerollController.sol",
  "HoodYOORRerollController.json",
);
const collectionConfigPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
);
const execute = process.env.EXECUTE_HOODYOOR_REROLL_DEPLOYMENT === "1";
const registrationBatchSize = 40;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function bytecode(artifact) {
  const value = artifact.bytecode?.object || artifact.bytecode;
  if (!value || value === "0x") throw new Error("Compiled artifact is missing deploy bytecode.");
  return value.startsWith("0x") ? value : `0x${value}`;
}

function parsePairs(encoded) {
  if (encoded.length === 0 || encoded.length % 6 !== 0) {
    throw new Error("Reroll rule binary must contain complete six-byte records.");
  }
  const pairs = [];
  for (let cursor = 0; cursor < encoded.length; cursor += 6) {
    pairs.push({
      layerA: encoded[cursor],
      traitA: encoded.readUInt16BE(cursor + 1),
      layerB: encoded[cursor + 3],
      traitB: encoded.readUInt16BE(cursor + 4),
    });
  }
  return pairs;
}

function assertGeneratedArtifacts(manifest, encoded, pairs) {
  if (manifest.schema !== "dyoor-hoodyoor-reroll-rules-v1") {
    throw new Error(`Unsupported reroll manifest schema ${manifest.schema}.`);
  }
  if (manifest.contract.expectedPairCount !== 329 || pairs.length !== 329) {
    throw new Error("Generated rules do not match the reviewed 329-pair catalog.");
  }
  if (encoded.length !== manifest.totals.bytes) {
    throw new Error("Generated rule byte count does not match its manifest.");
  }
  if (keccak256(encoded).toLowerCase() !== manifest.contract.rulesHash.toLowerCase()) {
    throw new Error("Generated rule hash does not match its manifest.");
  }
}

function deploymentPath(chainId) {
  return path.join(
    projectRoot,
    "deployments",
    "robinhood",
    `hoodyoor-reroll-${chainId}.json`,
  );
}

function saveCheckpoint(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function requiredAddress(name) {
  const value = process.env[name] || "";
  if (!value) throw new Error(`${name} is required for execution.`);
  return getAddress(value);
}

async function requireContract(provider, address, label) {
  if (await provider.getCode(address) === "0x") {
    throw new Error(`${label} ${address} has no contract code.`);
  }
}

const manifest = readJson(manifestPath);
const collectionConfig = readJson(collectionConfigPath);
const encoded = fs.readFileSync(binaryPath);
const pairs = parsePairs(encoded);
const rulesArtifact = readJson(rulesArtifactPath);
const controllerArtifact = readJson(controllerArtifactPath);
assertGeneratedArtifacts(manifest, encoded, pairs);
bytecode(rulesArtifact);
bytecode(controllerArtifact);

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry-run",
    executeWith: "EXECUTE_HOODYOOR_REROLL_DEPLOYMENT=1",
    pairs: pairs.length,
    ruleBytes: encoded.length,
    rulesHash: manifest.contract.rulesHash,
    registrationTransactions: Math.ceil(pairs.length / registrationBatchSize),
    requiredExecutionEnvironment: [
      "HOODYOOR_RPC_URL",
      "HOODYOOR_DEPLOYER_PRIVATE_KEY",
      "HOODYOOR_COLLECTION_ADDRESS",
      "HOODYOOR_ENERGY_BANK_ADDRESS",
      "HOODYOOR_RESULT_SIGNER",
    ],
    note: "Deploys and freezes the rule registry, then deploys the controller. Collection and Energy Bank role wiring remain an explicit launch ceremony step.",
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

const collectionAddress = requiredAddress("HOODYOOR_COLLECTION_ADDRESS");
const energyBankAddress = requiredAddress("HOODYOOR_ENERGY_BANK_ADDRESS");
const resultSigner = requiredAddress("HOODYOOR_RESULT_SIGNER");
await requireContract(provider, collectionAddress, "Collection");
await requireContract(provider, energyBankAddress, "Energy Bank");

const checkpointPath = deploymentPath(chainId);
const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : {
  schema: "dyoor-hoodyoor-reroll-deployment-v1",
  chainId,
  deployer: wallet.address,
  collection: collectionAddress,
  energyBank: energyBankAddress,
  resultSigner,
  rulesHash: manifest.contract.rulesHash,
  rules: "",
  controller: "",
  transactions: [],
};
for (const [key, expected] of Object.entries({
  chainId,
  deployer: wallet.address,
  collection: collectionAddress,
  energyBank: energyBankAddress,
  resultSigner,
  rulesHash: manifest.contract.rulesHash,
})) {
  const actual = typeof expected === "string" && expected.startsWith("0x") && expected.length === 42
    ? getAddress(checkpoint[key])
    : checkpoint[key];
  if (actual !== expected) throw new Error(`Existing checkpoint has a different ${key}.`);
}

let rules;
if (checkpoint.rules) {
  await requireContract(provider, getAddress(checkpoint.rules), "Trait rules");
  rules = new Contract(getAddress(checkpoint.rules), rulesArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(rulesArtifact.abi, bytecode(rulesArtifact), wallet);
  rules = await factory.deploy(wallet.address, manifest.contract.expectedPairCount);
  await rules.waitForDeployment();
  const receipt = await rules.deploymentTransaction().wait();
  checkpoint.rules = await rules.getAddress();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`deployed trait rules ${checkpoint.rules}`);
}
if (Number(await rules.expectedPairCount()) !== pairs.length) {
  throw new Error("Onchain rule registry expects a different pair count.");
}

if (!await rules.frozen()) {
  for (let offset = 0; offset < pairs.length; offset += registrationBatchSize) {
    const candidates = pairs.slice(offset, offset + registrationBatchSize);
    const missing = [];
    for (const pair of candidates) {
      if (!await rules.incompatible(pair.layerA, pair.traitA, pair.layerB, pair.traitB)) {
        missing.push(pair);
      }
    }
    if (missing.length) {
      const transaction = await rules.setIncompatibilities(missing);
      const receipt = await transaction.wait();
      checkpoint.transactions.push(receipt.hash);
      saveCheckpoint(checkpointPath, checkpoint);
    }
    console.log(`verified rule pairs ${Math.min(offset + registrationBatchSize, pairs.length)}/${pairs.length}`);
  }
  if (Number(await rules.pairCount()) !== pairs.length) {
    throw new Error("Onchain rule count does not match the generated manifest.");
  }
  const transaction = await rules.freeze(manifest.contract.rulesHash);
  const receipt = await transaction.wait();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
}
if ((await rules.rulesHash()).toLowerCase() !== manifest.contract.rulesHash.toLowerCase()) {
  throw new Error("Frozen onchain rules hash does not match the generated manifest.");
}

let controller;
if (checkpoint.controller) {
  await requireContract(provider, getAddress(checkpoint.controller), "Reroll controller");
  controller = new Contract(getAddress(checkpoint.controller), controllerArtifact.abi, wallet);
} else {
  const factory = new ContractFactory(
    controllerArtifact.abi,
    bytecode(controllerArtifact),
    wallet,
  );
  controller = await factory.deploy(
    wallet.address,
    collectionAddress,
    energyBankAddress,
    await rules.getAddress(),
    resultSigner,
  );
  await controller.waitForDeployment();
  const receipt = await controller.deploymentTransaction().wait();
  checkpoint.controller = await controller.getAddress();
  checkpoint.transactions.push(receipt.hash);
  saveCheckpoint(checkpointPath, checkpoint);
}

const controllerChecks = [
  ["collection", collectionAddress],
  ["energyBank", energyBankAddress],
  ["traitRules", getAddress(checkpoint.rules)],
  ["resultSigner", resultSigner],
  ["owner", wallet.address],
];
for (const [getter, expected] of controllerChecks) {
  if (getAddress(await controller[getter]()) !== getAddress(expected)) {
    throw new Error(`Controller ${getter} does not match its checkpoint.`);
  }
}

console.log(JSON.stringify({
  mode: "executed",
  chainId,
  rules: checkpoint.rules,
  controller: checkpoint.controller,
  rulesHash: checkpoint.rulesHash,
  checkpoint: path.relative(projectRoot, checkpointPath),
  nextSteps: [
    `Grant ${checkpoint.controller} the Energy Bank spender role.`,
    `Set ${checkpoint.controller} as the collection reroll controller.`,
    "Run end-to-end testnet rerolls before permanently freezing the collection controller address.",
  ],
}, null, 2));
