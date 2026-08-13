import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
  keccak256,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  HOODYOOR_MAINNET_ACK,
  artifactBytecode,
  loadHoodyoorLocalEnvironment,
  normalizePrivateKey,
  readJson,
  requireContract,
  saveCheckpoint,
  verifyFrozenEnergyMigrationLedger,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const artifact = readJson(path.join(
  projectRoot,
  "contracts",
  "hoodyoor",
  "out",
  "HoodYOORBlockhashCanary.sol",
  "HoodYOORBlockhashCanary.json",
));
const privateEnvironmentPath = path.join(
  projectRoot,
  "data",
  "game",
  "private",
  "hoodyoor-mainnet.env",
);
const checkpointPath = path.join(
  projectRoot,
  "deployments",
  "robinhood",
  `hoodyoor-blockhash-canary-${HOODYOOR_CHAIN_ID}.json`,
);
const execute = process.env.EXECUTE_HOODYOOR_BLOCKHASH_CANARY === "1";
const creationBytecode = artifactBytecode(artifact);
const creationHash = keccak256(creationBytecode);
const runtimeBytecode = artifact.deployedBytecode?.object || artifact.deployedBytecode;
const runtimeHash = keccak256(runtimeBytecode.startsWith("0x") ? runtimeBytecode : `0x${runtimeBytecode}`);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retry(task, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(500 * 2 ** Math.min(attempt, 4));
    }
  }
  throw lastError;
}

async function currentEvmBlockNumber(provider) {
  // Contract-creation eth_call executes NUMBER and returns it as a uint256.
  // Robinhood/Nitro's Solidity block.number is the Ethereum-parent height,
  // which intentionally differs from eth_blockNumber on the Robinhood RPC.
  const encoded = await provider.call({ data: "0x4360005260206000f3" });
  return Number(BigInt(encoded));
}

async function recordValidationEnvironment(checkpoint) {
  let contents = fs.readFileSync(privateEnvironmentPath, "utf8");
  const updates = {
    HOODYOOR_REVEAL_BLOCKHASH_VALIDATED: "1",
    HOODYOOR_BLOCKHASH_CANARY_ADDRESS: checkpoint.canary,
    HOODYOOR_BLOCKHASH_CANARY_TARGET_BLOCK: String(checkpoint.targetBlock),
    HOODYOOR_BLOCKHASH_CANARY_OBSERVED_HASH: checkpoint.observedBlockHash,
  };
  for (const [name, value] of Object.entries(updates)) {
    const expression = new RegExp(`^${name}=.*$`, "m");
    if (expression.test(contents)) contents = contents.replace(expression, `${name}=${value}`);
    else contents += `${contents.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
  }
  const temporaryPath = `${privateEnvironmentPath}.tmp`;
  fs.writeFileSync(temporaryPath, contents, { mode: 0o600 });
  fs.renameSync(temporaryPath, privateEnvironmentPath);
  fs.chmodSync(privateEnvironmentPath, 0o600);
}

const privateKey = normalizePrivateKey(process.env.HOODYOOR_DEPLOYER_PRIVATE_KEY || "");
const rpcUrl = process.env.HOODYOOR_RPC_URL || "";
if (!privateKey || !rpcUrl) {
  throw new Error("HOODYOOR_RPC_URL and HOODYOOR_DEPLOYER_PRIVATE_KEY are required.");
}
const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);
const network = await provider.getNetwork();
if (Number(network.chainId) !== HOODYOOR_CHAIN_ID) {
  throw new Error(`Refusing chain ${network.chainId}; expected ${HOODYOOR_CHAIN_ID}.`);
}
if (getAddress(wallet.address) !== getAddress(config.owner)) {
  throw new Error("Canary deployer does not match the configured HoodYØØR owner.");
}
if (
  process.env.HOODYOOR_OWNER_TREASURY_CONTROL_VERIFIED !== "1"
  || process.env.ALLOW_HOODYOOR_MAINNET !== "1"
  || process.env.HOODYOOR_MAINNET_ACK !== HOODYOOR_MAINNET_ACK
) throw new Error("Canary mainnet authorization or owner-control acknowledgement is missing.");
const energyLedger = verifyFrozenEnergyMigrationLedger(projectRoot);
if (!energyLedger.passed) {
  throw new Error(`Frozen Energy ledger verification failed: ${energyLedger.error}`);
}

const factory = new ContractFactory(artifact.abi, creationBytecode, wallet);
const deploymentTransaction = await factory.getDeployTransaction();
const [balance, estimatedGas, feeData] = await Promise.all([
  provider.getBalance(wallet.address),
  provider.estimateGas({ ...deploymentTransaction, from: wallet.address }),
  provider.getFeeData(),
]);
const estimatedMaxCost = feeData.maxFeePerGas
  ? estimatedGas * feeData.maxFeePerGas
  : null;
if (estimatedMaxCost !== null && balance <= estimatedMaxCost) {
  throw new Error("Owner wallet cannot cover the blockhash-canary deployment estimate.");
}

if (!execute) {
  const [rpcBlockNumber, evmBlockNumber] = await Promise.all([
    provider.getBlockNumber(),
    currentEvmBlockNumber(provider),
  ]);
  console.log(JSON.stringify({
    mode: "dry-run",
    chainId: HOODYOOR_CHAIN_ID,
    deployer: wallet.address,
    currentRobinhoodRpcBlock: rpcBlockNumber,
    currentSolidityBlockNumber: evmBlockNumber,
    solidityBlockNumberSource: "Ethereum parent chain via Nitro",
    delayBlocks: 64,
    hashWindow: 256,
    estimatedDeploymentGas: estimatedGas.toString(),
    estimatedMaxCostEth: estimatedMaxCost === null ? null : formatEther(estimatedMaxCost),
    ownerBalanceEth: formatEther(balance),
    creationBytecodeHash: creationHash,
    runtimeBytecodeHash: runtimeHash,
    executeWith: "EXECUTE_HOODYOOR_BLOCKHASH_CANARY=1",
  }, null, 2));
  process.exit(0);
}

let checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : null;
if (checkpoint) {
  if (
    checkpoint.schema !== "dyoor-hoodyoor-blockhash-canary-v1"
    || checkpoint.chainId !== HOODYOOR_CHAIN_ID
    || getAddress(checkpoint.deployer) !== wallet.address
    || checkpoint.creationBytecodeHash.toLowerCase() !== creationHash.toLowerCase()
    || checkpoint.runtimeBytecodeHash.toLowerCase() !== runtimeHash.toLowerCase()
  ) throw new Error("Existing blockhash-canary checkpoint describes a different deployment.");
}

let canary;
if (checkpoint?.canary) {
  await requireContract(provider, getAddress(checkpoint.canary), "Blockhash canary");
  canary = new Contract(checkpoint.canary, artifact.abi, wallet);
} else {
  canary = await factory.deploy();
  await canary.waitForDeployment();
  const receipt = await canary.deploymentTransaction().wait();
  const address = await canary.getAddress();
  checkpoint = {
    schema: "dyoor-hoodyoor-blockhash-canary-v1",
    chainId: HOODYOOR_CHAIN_ID,
    deployer: wallet.address,
    canary: getAddress(address),
    creationBytecodeHash: creationHash,
    runtimeBytecodeHash: runtimeHash,
    deploymentTransaction: receipt.hash,
    deploymentBlock: receipt.blockNumber,
    requestBlock: Number(await canary.requestBlock()),
    targetBlock: Number(await canary.targetBlock()),
    transactions: [{
      label: "deploy-blockhash-canary",
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
    }],
    status: "awaiting-target-block",
  };
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(JSON.stringify({
    status: checkpoint.status,
    canary: checkpoint.canary,
    deploymentBlock: checkpoint.deploymentBlock,
    targetBlock: checkpoint.targetBlock,
  }));
}

if (Number(await canary.targetBlock()) !== checkpoint.targetBlock) {
  throw new Error("Canary target block differs from its checkpoint.");
}
if (!await canary.validated()) {
  let currentBlock = await currentEvmBlockNumber(provider);
  let lastReported = currentBlock;
  while (currentBlock <= checkpoint.targetBlock) {
    if (currentBlock - lastReported >= 4 || currentBlock === checkpoint.targetBlock) {
      console.log(JSON.stringify({
        status: "awaiting-target-block",
        currentSolidityBlockNumber: currentBlock,
        targetBlock: checkpoint.targetBlock,
        remainingParentBlocks: checkpoint.targetBlock + 1 - currentBlock,
      }));
      lastReported = currentBlock;
    }
    await sleep(4_000);
    currentBlock = await currentEvmBlockNumber(provider);
  }
  const receipt = await (await canary.observe()).wait();
  if (receipt?.status !== 1) throw new Error("Blockhash-canary observation transaction failed.");
  checkpoint.transactions.push({
    label: "observe-target-blockhash",
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
  });
  checkpoint.observationTransaction = receipt.hash;
  checkpoint.observationBlock = receipt.blockNumber;
  saveCheckpoint(checkpointPath, checkpoint);
}

const [observedBlockHash, observer, validated] = await Promise.all([
  canary.observedBlockHash(),
  canary.observer(),
  canary.validated(),
]);
const targetBlock = await retry(() => provider.send(
  "eth_getBlockByHash",
  [observedBlockHash, false],
));
const targetL2BlockNumber = targetBlock?.number === undefined
  ? null
  : Number(BigInt(targetBlock.number));
const targetParentBlockNumber = targetBlock?.l1BlockNumber === undefined
  ? null
  : Number(BigInt(targetBlock.l1BlockNumber));
if (
  !validated
  || !targetBlock?.hash
  || observedBlockHash.toLowerCase() !== targetBlock.hash.toLowerCase()
  || targetParentBlockNumber !== checkpoint.targetBlock
  || targetL2BlockNumber === null
  || targetL2BlockNumber >= checkpoint.observationBlock
  || getAddress(observer) !== wallet.address
) throw new Error("Public canary did not reproduce Robinhood Nitro's canonical future target-block hash.");

checkpoint.observedBlockHash = observedBlockHash;
checkpoint.canonicalTargetBlockHash = targetBlock.hash;
checkpoint.canonicalTargetChainId = HOODYOOR_CHAIN_ID;
checkpoint.canonicalTargetBlockNumber = targetL2BlockNumber;
checkpoint.canonicalTargetParentBlockNumber = targetParentBlockNumber;
checkpoint.canonicalTargetSource = "Robinhood L2 block resolved by hash; its Nitro l1BlockNumber equals the Solidity BLOCKHASH argument";
checkpoint.observer = getAddress(observer);
checkpoint.status = "validated";
checkpoint.validatedAt = new Date().toISOString();
saveCheckpoint(checkpointPath, checkpoint);
await recordValidationEnvironment(checkpoint);

console.log(JSON.stringify({
  mode: "executed",
  chainId: HOODYOOR_CHAIN_ID,
  status: checkpoint.status,
  canary: checkpoint.canary,
  deploymentTransaction: checkpoint.deploymentTransaction,
  targetBlock: checkpoint.targetBlock,
  observedBlockHash: checkpoint.observedBlockHash,
  observationTransaction: checkpoint.observationTransaction,
  checkpoint: path.relative(projectRoot, checkpointPath),
}, null, 2));
