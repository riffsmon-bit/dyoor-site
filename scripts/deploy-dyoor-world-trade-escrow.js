import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const DYOOR_S2_MAINNET = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();
if (!deployer) {
  throw new Error("No deployer signer found. Set DEPLOYER_PRIVATE_KEY before deploying.");
}
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== MONAD_CHAIN_ID) {
  throw new Error(`Wrong network. Expected Monad chain id 143, got ${chain.chainId}.`);
}
const configuredCollection = ethers.getAddress(
  process.env.DYOOR_S2_CONTRACT_ADDRESS || DYOOR_S2_MAINNET,
);
if (configuredCollection !== ethers.getAddress(DYOOR_S2_MAINNET)) {
  throw new Error(`World trades must use production S2 ${DYOOR_S2_MAINNET}.`);
}

console.log("Deploying fee-free DYOORWorldTradeEscrow...");
console.log("Deployer:", deployer.address);
console.log("S2 collection:", configuredCollection);

const Escrow = await ethers.getContractFactory("DYOORWorldTradeEscrow", deployer);
const escrow = await Escrow.deploy(configuredCollection);
await escrow.waitForDeployment();
const address = await escrow.getAddress();
const receipt = await escrow.deploymentTransaction()?.wait();

if (ethers.getAddress(await escrow.S2_COLLECTION()) !== configuredCollection) {
  throw new Error("Post-deployment S2 collection verification failed.");
}

console.log("DYOORWorldTradeEscrow address:", address);
console.log("Deployment block:", String(receipt?.blockNumber || ""));
console.log("The contract has no owner, admin, fee switch, or bot custody key.");
console.log("Add these only after source verification and a test trade:");
console.log(`DYOOR_WORLD_TRADE_ESCROW_ADDRESS=${address}`);
console.log(`NEXT_PUBLIC_DYOOR_WORLD_TRADE_ESCROW_ADDRESS=${address}`);
console.log(`DYOOR_WORLD_TRADE_ESCROW_START_BLOCK=${String(receipt?.blockNumber || "")}`);
