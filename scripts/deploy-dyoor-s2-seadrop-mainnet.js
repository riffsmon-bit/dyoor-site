import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet, formatEther, getAddress, getCreateAddress } from "ethers";

const MONAD_MAINNET_CHAIN_ID = 143n;
const MAINNET_CONFIRMATION = "DEPLOY_DYOOR_MAINNET_OPENSEA_EXPERIMENT";
const NAME = "D.Y.O.O.R";
const SYMBOL = "DYOOR";

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireAddress(name) {
  return getAddress(requireEnv(name));
}

function requireBps(name) {
  const raw = requireEnv(name);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole-number basis point value`);
  const value = BigInt(raw);
  if (value > 10_000n) throw new Error(`${name} cannot exceed 10000`);
  return value;
}

function loadArtifact() {
  const artifactPath = path.join(
    process.cwd(),
    "out",
    "DYOORSeason2SeaDrop.sol",
    "DYOORSeason2SeaDrop.json",
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { artifactPath, abi: artifact.abi, bytecode: artifact.bytecode?.object || artifact.bytecode };
}

async function waitTx(label, txPromise, receipts) {
  const tx = await txPromise;
  console.log(`${label} tx: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} reverted: ${tx.hash}`);
  receipts.push({
    label,
    hash: tx.hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  });
  return receipt;
}

async function main() {
  const execute = env("EXECUTE_MAINNET_DEPLOY") === "1";
  const confirmation = env("MONAD_MAINNET_DEPLOY_CONFIRMATION");
  if (confirmation !== MAINNET_CONFIRMATION) {
    throw new Error(`MONAD_MAINNET_DEPLOY_CONFIRMATION=${MAINNET_CONFIRMATION} is required`);
  }

  const rpcUrl = requireEnv("MONAD_MAINNET_RPC_URL");
  const privateKey = env("DEPLOYER_PRIVATE_KEY", env("PRIVATE_KEY"));
  if (!privateKey) throw new Error("PRIVATE_KEY or DEPLOYER_PRIVATE_KEY is required");

  const seaDrop = requireAddress("SEADROP_ADDRESS");
  const treasury = requireAddress("DYOOR_TREASURY_ADDRESS");
  const royaltyReceiver = requireAddress("DYOOR_ROYALTY_RECEIVER");
  const royaltyBps = requireBps("DYOOR_ROYALTY_BPS");
  const metadataManagerRaw = env("DYOOR_METADATA_MANAGER");
  const metadataManager = metadataManagerRaw ? getAddress(metadataManagerRaw) : null;
  const baseURI = requireEnv("DYOOR_BASE_URI");
  const contractURI = env("DYOOR_CONTRACT_URI");

  if (!baseURI.endsWith("/")) {
    throw new Error("DYOOR_BASE_URI must end with / because ERC721SeaDrop appends the token ID");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== MONAD_MAINNET_CHAIN_ID) {
    throw new Error(`Wrong chain. Expected Monad mainnet 143, got ${network.chainId.toString()}`);
  }

  const seaDropCode = await provider.getCode(seaDrop);
  if (seaDropCode === "0x") {
    throw new Error(`SEADROP_ADDRESS has no bytecode on Monad mainnet: ${seaDrop}`);
  }

  const wallet = new Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const nonce = await provider.getTransactionCount(deployer);
  const predictedAddress = getCreateAddress({ from: deployer, nonce });
  const balance = await provider.getBalance(deployer);
  const feeData = await provider.getFeeData();
  const { artifactPath, abi, bytecode } = loadArtifact();
  const factory = new ContractFactory(abi, bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(NAME, SYMBOL, [seaDrop]);
  const deployGas = await provider.estimateGas({ ...deployTx, from: deployer });
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
  const estimatedDeployCost = deployGas * gasPrice;

  console.log("D.Y.O.O.R Season 2 SeaDrop mainnet deploy preflight");
  console.log("Mode:", execute ? "BROADCAST" : "DRY RUN");
  console.log("Artifact:", artifactPath);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer);
  console.log("Deployer balance:", `${formatEther(balance)} MON`);
  console.log("Predicted contract:", predictedAddress);
  console.log("SeaDrop:", seaDrop);
  console.log("SeaDrop bytecode bytes:", (seaDropCode.length - 2) / 2);
  console.log("Treasury:", treasury);
  console.log("Royalty receiver:", royaltyReceiver);
  console.log("Royalty bps:", royaltyBps.toString());
  console.log("Metadata manager:", metadataManager || "none");
  console.log("Base URI:", baseURI);
  console.log("Contract URI:", contractURI || "none");
  console.log("Deploy gas estimate:", deployGas.toString());
  console.log("Estimated deploy gas cost:", `${formatEther(estimatedDeployCost)} MON`);
  console.log("Max supply:", "3333");
  console.log("Airdrop reserve:", "610");
  console.log("SeaDrop cap:", "2723");

  if (!execute) {
    console.log("Dry run complete. Set EXECUTE_MAINNET_DEPLOY=1 to broadcast.");
    return;
  }

  const receipts = [];
  const contract = await factory.deploy(NAME, SYMBOL, [seaDrop]);
  console.log("Deploy tx:", contract.deploymentTransaction()?.hash);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  const deployReceipt = await contract.deploymentTransaction()?.wait();
  receipts.push({
    label: "deploy",
    hash: contract.deploymentTransaction()?.hash,
    blockNumber: Number(deployReceipt?.blockNumber || 0),
    gasUsed: deployReceipt?.gasUsed?.toString() || "0",
  });
  console.log("Deployed contract:", contractAddress);

  await waitTx("setTreasury", contract.setTreasury(treasury), receipts);
  await waitTx(
    "setRoyaltyInfo",
    contract.setRoyaltyInfo({ royaltyAddress: royaltyReceiver, royaltyBps }),
    receipts,
  );
  if (metadataManager) {
    await waitTx("setMetadataManager", contract.setMetadataManager(metadataManager), receipts);
  }
  await waitTx("setBaseURI", contract.setBaseURI(baseURI), receipts);
  if (contractURI) {
    await waitTx("setContractURI", contract.setContractURI(contractURI), receipts);
  }

  const deployment = {
    contractName: "DYOORSeason2SeaDrop",
    name: NAME,
    symbol: SYMBOL,
    contractAddress,
    deployer,
    chainId: Number(network.chainId),
    constructorSeaDrop: seaDrop,
    treasury,
    royaltyReceiver,
    royaltyBps: royaltyBps.toString(),
    metadataManager: metadataManager || null,
    baseURI,
    contractURI: contractURI || null,
    maxSupply: "3333",
    airdropReserve: "610",
    seaDropMaxSupply: "2723",
    timestamp: new Date().toISOString(),
    constructorArgs: ["D.Y.O.O.R", "DYOOR", [seaDrop]],
    transactions: receipts,
  };

  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    "deployments/dyoor-s2-seadrop-mainnet.latest.json",
    `${JSON.stringify(deployment, null, 2)}\n`,
  );
  console.log("Wrote deployments/dyoor-s2-seadrop-mainnet.latest.json");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
