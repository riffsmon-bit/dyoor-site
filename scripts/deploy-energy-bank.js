import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const DEFAULT_ASCENSION_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";

function requireAddress(ethers, value, label) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid address. Received: ${value || "<empty>"}`);
  }
  return ethers.getAddress(value);
}

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();

if (!deployer) {
  throw new Error("No deployer signer found. Set DEPLOYER_PRIVATE_KEY in .env before deploying.");
}

const chain = await ethers.provider.getNetwork();
if (chain.chainId !== MONAD_CHAIN_ID) {
  throw new Error(`Wrong network. Expected Monad chain id 143, got ${chain.chainId.toString()}.`);
}

const admin = requireAddress(
  ethers,
  process.env.ENERGY_ADMIN_ADDRESS || deployer.address,
  "ENERGY_ADMIN_ADDRESS",
);
const ascensionStaking = requireAddress(
  ethers,
  process.env.ASCENSION_STAKING_ADDRESS || DEFAULT_ASCENSION_STAKING,
  "ASCENSION_STAKING_ADDRESS",
);

console.log("Deploying DYOOREnergyBank...");
console.log("Deployer:", deployer.address);
console.log("Admin:", admin);
console.log("Ascension staking:", ascensionStaking);
console.log("Chain ID:", chain.chainId.toString());

const EnergyBank = await ethers.getContractFactory("DYOOREnergyBank", deployer);
const energyBank = await EnergyBank.deploy(admin, ascensionStaking);

await energyBank.waitForDeployment();

const energyBankAddress = await energyBank.getAddress();

console.log("DYOOREnergyBank address:", energyBankAddress);
console.log("Admin address:", admin);
console.log("Ascension staking address:", ascensionStaking);
console.log("Chain id:", chain.chainId.toString());

const creditSigner = process.env.ENERGY_CREDIT_SIGNER_ADDRESS || "";
if (creditSigner) {
  const signerAddress = requireAddress(ethers, creditSigner, "ENERGY_CREDIT_SIGNER_ADDRESS");
  const tx = await energyBank.setCreditSigner(signerAddress, true);
  await tx.wait();
  console.log("Credit signer enabled:", signerAddress);
  console.log("setCreditSigner tx:", tx.hash);
}
