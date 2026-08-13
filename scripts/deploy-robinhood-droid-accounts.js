import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AbiCoder,
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
  isAddress,
  keccak256,
} from "ethers";
import {
  artifactBytecode,
  loadHoodyoorLocalEnvironment,
  normalizePrivateKey,
  readJson,
  saveCheckpoint,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);

const ROBINHOOD_MAINNET_CHAIN_ID = 4_663;
const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
const LOCAL_CHAIN_IDS = new Set([1_337, 31_337]);
const ROBINHOOD_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const ROBINHOOD_MAINNET_COLLECTION = "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25";
const ROBINHOOD_MAINNET_REROLL_CONTROLLER =
  "0x6cf24a0119b7286ad88855Baa9CB220DF628FD11";
const ROBINHOOD_MAINNET_ENERGY_BANK = "0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3";
const ROBINHOOD_MAINNET_RENDERER = "0xb9cB0563013D9741f76a802d2F658EbF3433eE12";
const ROBINHOOD_MAINNET_ACK = "HOODYOOR-DROID-ACCOUNTS-4663-V1-IRREVERSIBLE";
const CANONICAL_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const CANONICAL_REGISTRY_RUNTIME_HASH =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const ZERO_SALT = `0x${"00".repeat(32)}`;
const target = String(process.env.HOODYOOR_DROID_DEPLOYMENT_TARGET || "testnet")
  .trim().toLowerCase();
const execute = process.env.EXECUTE_HOODYOOR_DROID_DEPLOYMENT === "1";
const networkPreflight = process.env.PREFLIGHT_HOODYOOR_DROID_DEPLOYMENT === "1";
const mainnet = target === "mainnet";
const expectedChainId = mainnet
  ? ROBINHOOD_MAINNET_CHAIN_ID
  : target === "local"
    ? Number(process.env.HOODYOOR_DROID_LOCAL_CHAIN_ID || 31_337)
    : ROBINHOOD_TESTNET_CHAIN_ID;
const rpcUrl = target === "local"
  ? String(process.env.HOODYOOR_DROID_LOCAL_RPC_URL || "http://127.0.0.1:8545").trim()
  : mainnet
    ? String(
        process.env.HOODYOOR_DROID_MAINNET_RPC_URL
          || process.env.HOODYOOR_DROID_RPC_URL
          || process.env.HOODYOOR_RPC_URL
          || ROBINHOOD_MAINNET_RPC,
      ).trim()
    : String(
        process.env.HOODYOOR_DROID_TESTNET_RPC_URL
          || "https://rpc.testnet.chain.robinhood.com",
      ).trim();
const collectionValue = target === "local"
  ? process.env.HOODYOOR_DROID_LOCAL_COLLECTION_ADDRESS
  : mainnet
    ? process.env.HOODYOOR_DROID_MAINNET_COLLECTION_ADDRESS
      || ROBINHOOD_MAINNET_COLLECTION
    : process.env.HOODYOOR_DROID_TESTNET_COLLECTION_ADDRESS;
const canonicalRegistryValue = target === "local"
  ? process.env.HOODYOOR_DROID_LOCAL_ERC6551_REGISTRY_ADDRESS
  : CANONICAL_REGISTRY;
const collectionAddress = isAddress(collectionValue || "")
  ? getAddress(collectionValue)
  : "";
const canonicalRegistryAddress = isAddress(canonicalRegistryValue || "")
  ? getAddress(canonicalRegistryValue)
  : "";
const salt = /^0x[a-fA-F0-9]{64}$/.test(process.env.HOODYOOR_DROID_ACCOUNT_SALT || "")
  ? process.env.HOODYOOR_DROID_ACCOUNT_SALT
  : ZERO_SALT;

if (target !== "mainnet" && target !== "testnet" && target !== "local") {
  throw new Error("HOODYOOR_DROID_DEPLOYMENT_TARGET must be mainnet, testnet, or local.");
}
if (target === "local" && !LOCAL_CHAIN_IDS.has(expectedChainId)) {
  throw new Error("Local Droid deployment is restricted to chain 1337 or 31337.");
}

const artifactRoot = path.join(projectRoot, "contracts", "hoodyoor", "out");
const implementationArtifactPath = path.join(
  artifactRoot,
  "DroidAccountV1.sol",
  "DroidAccountV1.json",
);
const registryArtifactPath = path.join(
  artifactRoot,
  "DroidAccountRegistry.sol",
  "DroidAccountRegistry.json",
);
const artifactsReady = fs.existsSync(implementationArtifactPath)
  && fs.existsSync(registryArtifactPath);
const blockers = [
  ...(!artifactsReady ? ["build-droid-account-artifacts"] : []),
  ...(!collectionAddress ? [
    target === "local"
      ? "HOODYOOR_DROID_LOCAL_COLLECTION_ADDRESS"
      : mainnet
        ? "HOODYOOR_DROID_MAINNET_COLLECTION_ADDRESS"
        : "HOODYOOR_DROID_TESTNET_COLLECTION_ADDRESS",
  ] : []),
  ...(!canonicalRegistryAddress ? [
    target === "local" ? "HOODYOOR_DROID_LOCAL_ERC6551_REGISTRY_ADDRESS" : "canonical-registry",
  ] : []),
  ...(mainnet && process.env.ALLOW_HOODYOOR_DROID_MAINNET !== "1"
    ? ["ALLOW_HOODYOOR_DROID_MAINNET"]
    : []),
  ...(mainnet && process.env.HOODYOOR_DROID_MAINNET_ACK !== ROBINHOOD_MAINNET_ACK
    ? ["HOODYOOR_DROID_MAINNET_ACK"]
    : []),
];

if (!execute && !networkPreflight) {
  console.log(JSON.stringify({
    mode: "dry-run",
    broadcastAttempted: false,
    target,
    expectedChainId,
    rpcUrl: target === "local" ? rpcUrl : `configured ${target} RPC`,
    collectionAddress: collectionAddress || null,
    canonicalRegistryAddress: canonicalRegistryAddress || null,
    accountSalt: salt,
    deploys: ["DroidAccountV1", "DroidAccountRegistry"],
    accountImplementation: "immutable and versioned",
    registryAdministration: "none",
    blockers,
    executeWith: mainnet
      ? `ALLOW_HOODYOOR_DROID_MAINNET=1 HOODYOOR_DROID_MAINNET_ACK=${ROBINHOOD_MAINNET_ACK} EXECUTE_HOODYOOR_DROID_DEPLOYMENT=1 npm run deploy:robinhood:droid-accounts:mainnet`
      : "EXECUTE_HOODYOOR_DROID_DEPLOYMENT=1 npm run deploy:robinhood:droid-accounts:testnet",
    note: mainnet
      ? "No transaction was sent. Mainnet execution requires both exact Droid-specific acknowledgements."
      : "No transaction was sent.",
  }, null, 2));
  process.exit(0);
}

if (blockers.length) {
  throw new Error(`Deployment configuration is incomplete: ${blockers.join(", ")}.`);
}
const implementationArtifact = readJson(implementationArtifactPath);
const registryArtifact = readJson(registryArtifactPath);
const implementationBytecode = artifactBytecode(implementationArtifact);
const registryBytecode = artifactBytecode(registryArtifact);
const privateKey = normalizePrivateKey(
  process.env.HOODYOOR_DROID_DEPLOYER_PRIVATE_KEY
    || (mainnet ? process.env.HOODYOOR_DEPLOYER_PRIVATE_KEY : "")
    || "",
);
if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
  throw new Error("HOODYOOR_DROID_DEPLOYER_PRIVATE_KEY is required for execution.");
}

const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);
const network = await provider.getNetwork();
const actualChainId = Number(network.chainId);
if (actualChainId !== expectedChainId) {
  throw new Error(`Refusing chain ${actualChainId}; expected ${expectedChainId}.`);
}

const [collectionCode, canonicalRegistryCode] = await Promise.all([
  provider.getCode(collectionAddress),
  provider.getCode(canonicalRegistryAddress),
]);
if (collectionCode === "0x") throw new Error("Configured controlling NFT collection has no code.");
if (canonicalRegistryCode === "0x") throw new Error("Configured ERC-6551 registry has no code.");
if (
  target !== "local"
  && keccak256(canonicalRegistryCode).toLowerCase()
    !== CANONICAL_REGISTRY_RUNTIME_HASH.toLowerCase()
) {
  throw new Error(`Robinhood ${target} canonical ERC-6551 registry code hash mismatch.`);
}

const productionCollectionAbi = [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function revealed() view returns (bool)",
  "function renderer() view returns (address)",
  "function energyBank() view returns (address)",
  "function rerollController() view returns (address)",
  "function rerollControllerFrozen() view returns (bool)",
  "function rendererFrozen() view returns (bool)",
  "function energyConfigurationFrozen() view returns (bool)",
  "function initialTraitsFrozen() view returns (bool)",
];
const productionRerollAbi = [
  "function collection() view returns (address)",
  "function paused() view returns (bool)",
  "function paymentConfigurationFrozen() view returns (bool)",
  "function weiPerEnergy() view returns (uint256)",
  "function usdgUnitsPerEnergy() view returns (uint256)",
];

let productionSnapshot = null;
if (mainnet) {
  if (collectionAddress !== getAddress(ROBINHOOD_MAINNET_COLLECTION)) {
    throw new Error("Mainnet controlling collection is not the canonical HoodYØØR V2 contract.");
  }
  if (salt.toLowerCase() !== ZERO_SALT.toLowerCase()) {
    throw new Error("Mainnet Droid Account V1 requires the reviewed zero salt.");
  }

  const collection = new Contract(collectionAddress, productionCollectionAbi, provider);
  const reroll = new Contract(
    ROBINHOOD_MAINNET_REROLL_CONTROLLER,
    productionRerollAbi,
    provider,
  );
  const [
    owner,
    treasury,
    totalSupply,
    revealed,
    renderer,
    energyBank,
    rerollController,
    rerollControllerFrozen,
    rendererFrozen,
    energyConfigurationFrozen,
    initialTraitsFrozen,
    rerollCollection,
    rerollPaused,
    paymentConfigurationFrozen,
    weiPerEnergy,
    usdgUnitsPerEnergy,
    rerollCode,
  ] = await Promise.all([
    collection.owner(),
    collection.treasury(),
    collection.totalSupply(),
    collection.revealed(),
    collection.renderer(),
    collection.energyBank(),
    collection.rerollController(),
    collection.rerollControllerFrozen(),
    collection.rendererFrozen(),
    collection.energyConfigurationFrozen(),
    collection.initialTraitsFrozen(),
    reroll.collection(),
    reroll.paused(),
    reroll.paymentConfigurationFrozen(),
    reroll.weiPerEnergy(),
    reroll.usdgUnitsPerEnergy(),
    provider.getCode(ROBINHOOD_MAINNET_REROLL_CONTROLLER),
  ]);
  if (getAddress(owner) !== wallet.address || getAddress(treasury) !== wallet.address) {
    throw new Error("Mainnet deployer does not control the HoodYØØR owner/treasury wallet.");
  }
  if (
    rerollCode === "0x"
    || getAddress(rerollController) !== getAddress(ROBINHOOD_MAINNET_REROLL_CONTROLLER)
    || getAddress(rerollCollection) !== collectionAddress
    || getAddress(energyBank) !== getAddress(ROBINHOOD_MAINNET_ENERGY_BANK)
    || getAddress(renderer) !== getAddress(ROBINHOOD_MAINNET_RENDERER)
    || !rerollControllerFrozen
    || !rendererFrozen
    || !energyConfigurationFrozen
    || !initialTraitsFrozen
    || !paymentConfigurationFrozen
    || rerollPaused
    || weiPerEnergy !== 1_000_000_000_000n
    || usdgUnitsPerEnergy !== 1_000n
  ) {
    throw new Error("Live HoodYØØR collection/reroll invariants differ from the reviewed V2 state.");
  }
  productionSnapshot = {
    owner: getAddress(owner),
    treasury: getAddress(treasury),
    totalSupply: Number(totalSupply),
    revealed,
    renderer: getAddress(renderer),
    energyBank: getAddress(energyBank),
    rerollController: getAddress(rerollController),
    rerollControllerFrozen,
    rendererFrozen,
    energyConfigurationFrozen,
    initialTraitsFrozen,
    rerollPaused,
    paymentConfigurationFrozen,
    weiPerEnergy: weiPerEnergy.toString(),
    usdgUnitsPerEnergy: usdgUnitsPerEnergy.toString(),
  };
}

const implementationFactory = new ContractFactory(
  implementationArtifact.abi,
  implementationBytecode,
  wallet,
);
const registryEstimateFactory = new ContractFactory(
  registryArtifact.abi,
  registryBytecode,
  wallet,
);
const implementationDeployRequest = await implementationFactory.getDeployTransaction();
const estimateImplementationGas = await provider.estimateGas(implementationDeployRequest);
const registryEstimateRequest = await registryEstimateFactory.getDeployTransaction(
  canonicalRegistryAddress,
  collectionAddress,
  mainnet ? ROBINHOOD_MAINNET_REROLL_CONTROLLER : collectionAddress,
  actualChainId,
  salt,
);
const [estimateRegistryGas, feeData, deployerBalance] = await Promise.all([
  provider.estimateGas(registryEstimateRequest),
  provider.getFeeData(),
  provider.getBalance(wallet.address),
]);
const estimatedGasPrice = feeData.maxFeePerGas || feeData.gasPrice;
if (!estimatedGasPrice) throw new Error("RPC did not provide a deployment gas price.");
const estimatedDeploymentWei =
  (estimateImplementationGas + estimateRegistryGas) * estimatedGasPrice;
const requiredBufferedBalance = estimatedDeploymentWei * 3n;
if (deployerBalance < requiredBufferedBalance) {
  throw new Error(
    `Deployer balance ${formatEther(deployerBalance)} ETH is below the 3x deployment buffer ${formatEther(requiredBufferedBalance)} ETH.`,
  );
}

if (networkPreflight && !execute) {
  console.log(JSON.stringify({
    mode: "network-preflight",
    passed: true,
    broadcastAttempted: false,
    target,
    chainId: actualChainId,
    deployer: wallet.address,
    controllingCollection: collectionAddress,
    canonicalRegistry: canonicalRegistryAddress,
    accountSalt: salt,
    implementationBytecodeHash: keccak256(implementationBytecode),
    registryBytecodeHash: keccak256(registryBytecode),
    canonicalRegistryRuntimeHash: keccak256(canonicalRegistryCode),
    collectionRuntimeHash: keccak256(collectionCode),
    estimatedImplementationGas: estimateImplementationGas.toString(),
    estimatedRegistryGas: estimateRegistryGas.toString(),
    estimatedGasPriceWei: estimatedGasPrice.toString(),
    estimatedDeploymentEth: formatEther(estimatedDeploymentWei),
    requiredThreeTimesBufferEth: formatEther(requiredBufferedBalance),
    deployerBalanceEth: formatEther(deployerBalance),
    productionSnapshot,
    note: "All live checks passed. No transaction was sent.",
  }, null, 2));
  process.exit(0);
}

const checkpointPath = path.join(
  projectRoot,
  "deployments",
  "robinhood",
  `droid-accounts-${actualChainId}.json`,
);
const checkpoint = fs.existsSync(checkpointPath)
  ? readJson(checkpointPath)
  : {
      schema: "dyoor-droid-accounts-deployment-v1",
      chainId: actualChainId,
      environment: target,
      deployer: wallet.address,
      controllingCollection: collectionAddress,
      canonicalRegistry: canonicalRegistryAddress,
      accountSalt: salt,
      implementationVersion: 1,
      implementation: "",
      registry: "",
      transactions: [],
      verification: {},
    };

for (const [key, expected] of Object.entries({
  chainId: actualChainId,
  deployer: wallet.address,
  controllingCollection: collectionAddress,
  canonicalRegistry: canonicalRegistryAddress,
  accountSalt: salt,
})) {
  const actual = checkpoint[key];
  const matches = typeof expected === "string" && isAddress(expected)
    ? isAddress(actual || "") && getAddress(actual) === getAddress(expected)
    : actual === expected;
  if (!matches) throw new Error(`Existing Droid Account checkpoint has a different ${key}.`);
}

checkpoint.preflight = {
  checkedAt: new Date().toISOString(),
  implementationBytecodeHash: keccak256(implementationBytecode),
  registryBytecodeHash: keccak256(registryBytecode),
  canonicalRegistryRuntimeHash: keccak256(canonicalRegistryCode),
  collectionRuntimeHash: keccak256(collectionCode),
  estimatedImplementationGas: estimateImplementationGas.toString(),
  estimatedRegistryGas: estimateRegistryGas.toString(),
  estimatedGasPriceWei: estimatedGasPrice.toString(),
  estimatedDeploymentWei: estimatedDeploymentWei.toString(),
  requiredBufferedBalanceWei: requiredBufferedBalance.toString(),
  deployerBalanceWei: deployerBalance.toString(),
  productionSnapshot,
};
saveCheckpoint(checkpointPath, checkpoint);
console.log(JSON.stringify({
  preflight: "passed",
  chainId: actualChainId,
  deployer: wallet.address,
  deployerBalanceEth: formatEther(deployerBalance),
  estimatedDeploymentEth: formatEther(estimatedDeploymentWei),
  requiredThreeTimesBufferEth: formatEther(requiredBufferedBalance),
  productionSnapshot,
}, null, 2));

let implementationAddress = checkpoint.implementation;
if (implementationAddress) {
  if (!isAddress(implementationAddress) || await provider.getCode(implementationAddress) === "0x") {
    throw new Error("Checkpointed DroidAccountV1 implementation has no code.");
  }
  implementationAddress = getAddress(implementationAddress);
} else {
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();
  const receipt = await implementation.deploymentTransaction().wait();
  const deploymentFee = receipt.gasUsed * receipt.gasPrice;
  implementationAddress = await implementation.getAddress();
  checkpoint.implementation = implementationAddress;
  checkpoint.transactions.push({
    label: "deploy-droid-account-v1",
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.gasPrice.toString(),
    fee: deploymentFee.toString(),
  });
  saveCheckpoint(checkpointPath, checkpoint);
}

let registryAddress = checkpoint.registry;
const constructorArguments = [
  canonicalRegistryAddress,
  collectionAddress,
  implementationAddress,
  actualChainId,
  salt,
];
if (registryAddress) {
  if (!isAddress(registryAddress) || await provider.getCode(registryAddress) === "0x") {
    throw new Error("Checkpointed DroidAccountRegistry has no code.");
  }
  registryAddress = getAddress(registryAddress);
} else {
  const registry = await registryEstimateFactory.deploy(...constructorArguments);
  await registry.waitForDeployment();
  const receipt = await registry.deploymentTransaction().wait();
  const deploymentFee = receipt.gasUsed * receipt.gasPrice;
  registryAddress = await registry.getAddress();
  checkpoint.registry = registryAddress;
  checkpoint.transactions.push({
    label: "deploy-droid-account-registry",
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.gasPrice.toString(),
    fee: deploymentFee.toString(),
  });
  saveCheckpoint(checkpointPath, checkpoint);
}

const registry = new Contract(registryAddress, registryArtifact.abi, provider);
const [
  wiredCanonical,
  wiredCollection,
  wiredImplementation,
  wiredChain,
  wiredSalt,
  implementationVersion,
  tokenOneAccount,
] =
  await Promise.all([
    registry.canonicalRegistry(),
    registry.tokenContract(),
    registry.implementation(),
    registry.tokenChainId(),
    registry.accountSalt(),
    registry.IMPLEMENTATION_VERSION(),
    registry["account(uint256)"](1),
  ]);
if (
  getAddress(wiredCanonical) !== canonicalRegistryAddress
  || getAddress(wiredCollection) !== collectionAddress
  || getAddress(wiredImplementation) !== implementationAddress
  || Number(wiredChain) !== actualChainId
  || wiredSalt.toLowerCase() !== salt.toLowerCase()
  || Number(implementationVersion) !== 1
) throw new Error("Deployed DroidAccountRegistry wiring validation failed.");

const canonicalRegistry = new Contract(
  canonicalRegistryAddress,
  [
    "function account(address implementation,bytes32 salt,uint256 chainId,address tokenContract,uint256 tokenId) view returns (address)",
  ],
  provider,
);
const canonicalTokenOneAccount = await canonicalRegistry.account(
  implementationAddress,
  salt,
  actualChainId,
  collectionAddress,
  1,
);
if (getAddress(canonicalTokenOneAccount) !== getAddress(tokenOneAccount)) {
  throw new Error("Facade and canonical registry disagree on the token #1 account address.");
}

if (mainnet) {
  const collectionAfter = new Contract(collectionAddress, productionCollectionAbi, provider);
  const rerollAfter = new Contract(
    ROBINHOOD_MAINNET_REROLL_CONTROLLER,
    productionRerollAbi,
    provider,
  );
  const [
    rendererAfter,
    energyAfter,
    rerollControllerAfter,
    rerollFrozenAfter,
    rendererFrozenAfter,
    energyFrozenAfter,
    initialTraitsFrozenAfter,
    rerollCollectionAfter,
    pausedAfter,
    paymentFrozenAfter,
    weiRateAfter,
    usdgRateAfter,
  ] = await Promise.all([
    collectionAfter.renderer(),
    collectionAfter.energyBank(),
    collectionAfter.rerollController(),
    collectionAfter.rerollControllerFrozen(),
    collectionAfter.rendererFrozen(),
    collectionAfter.energyConfigurationFrozen(),
    collectionAfter.initialTraitsFrozen(),
    rerollAfter.collection(),
    rerollAfter.paused(),
    rerollAfter.paymentConfigurationFrozen(),
    rerollAfter.weiPerEnergy(),
    rerollAfter.usdgUnitsPerEnergy(),
  ]);
  if (
    getAddress(rendererAfter) !== getAddress(ROBINHOOD_MAINNET_RENDERER)
    || getAddress(energyAfter) !== getAddress(ROBINHOOD_MAINNET_ENERGY_BANK)
    || getAddress(rerollControllerAfter)
      !== getAddress(ROBINHOOD_MAINNET_REROLL_CONTROLLER)
    || getAddress(rerollCollectionAfter) !== collectionAddress
    || !rerollFrozenAfter
    || !rendererFrozenAfter
    || !energyFrozenAfter
    || !initialTraitsFrozenAfter
    || pausedAfter
    || !paymentFrozenAfter
    || weiRateAfter !== 1_000_000_000_000n
    || usdgRateAfter !== 1_000n
  ) throw new Error("HoodYØØR production invariants changed during Droid deployment.");
}

const implementationRuntime = await provider.getCode(implementationAddress);
const registryRuntime = await provider.getCode(registryAddress);
checkpoint.completedAt = new Date().toISOString();
const deploymentBlocks = checkpoint.transactions
  .map((entry) => Number(entry.blockNumber))
  .filter((blockNumber) => Number.isSafeInteger(blockNumber) && blockNumber >= 0);
if (!deploymentBlocks.length) {
  throw new Error("Deployment checkpoint does not contain transaction block numbers.");
}
checkpoint.startBlock = Math.min(...deploymentBlocks);
checkpoint.runtimeCodeHashes = {
  implementation: keccak256(implementationRuntime),
  registry: keccak256(registryRuntime),
  canonicalRegistry: keccak256(canonicalRegistryCode),
};
checkpoint.counterfactualExample = {
  tokenId: 1,
  account: getAddress(tokenOneAccount),
};
checkpoint.verification = {
  implementationContract: "src/droid/DroidAccountV1.sol:DroidAccountV1",
  registryContract: "src/droid/DroidAccountRegistry.sol:DroidAccountRegistry",
  registryConstructorArguments: AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "uint256", "bytes32"],
    constructorArguments,
  ),
  compilerVersion: "0.8.24",
  evmVersion: "paris",
  optimizerRuns: 200,
  viaIR: true,
};
saveCheckpoint(checkpointPath, checkpoint);

console.log(JSON.stringify({
  mode: "executed",
  target,
  chainId: actualChainId,
  broadcastAttempted: true,
  implementation: implementationAddress,
  registry: registryAddress,
  controllingCollection: collectionAddress,
  canonicalRegistry: canonicalRegistryAddress,
  accountSalt: salt,
  checkpoint: path.relative(projectRoot, checkpointPath),
  counterfactualTokenOneAccount: getAddress(tokenOneAccount),
  totalDeploymentFeeWei: checkpoint.transactions.reduce(
    (total, transaction) => total + BigInt(transaction.fee || 0),
    0n,
  ).toString(),
  mainnetDeployment: mainnet,
}, null, 2));
