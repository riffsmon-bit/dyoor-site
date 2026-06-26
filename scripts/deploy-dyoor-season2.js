import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;

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

const owner = requireAddress(ethers, process.env.DYOOR_OWNER_ADDRESS || deployer.address, "DYOOR_OWNER_ADDRESS");
const treasury = requireAddress(
  ethers,
  process.env.DYOOR_TREASURY_ADDRESS || deployer.address,
  "DYOOR_TREASURY_ADDRESS",
);
const baseURI = process.env.DYOOR_BASE_URI || "";
const droidsContractURI = process.env.DYOOR_CONTRACT_URI || "";
const traitsURI = process.env.DYOOR_TRAITS_URI || "";
const traitsContractURI = process.env.DYOOR_TRAITS_CONTRACT_URI || "";

console.log("Deploying D.Y.O.O.R Season 2 contracts...");
console.log("Deployer:", deployer.address);
console.log("Owner:", owner);
console.log("Treasury:", treasury);
console.log("Chain ID:", chain.chainId.toString());

const Droids = await ethers.getContractFactory("DyoorDroids", deployer);
const droids = await Droids.deploy(owner, treasury);
await droids.waitForDeployment();
const droidsAddress = await droids.getAddress();
console.log("DyoorDroids:", droidsAddress);

const Traits = await ethers.getContractFactory("DyoorTraits", deployer);
const traits = await Traits.deploy(owner, traitsURI);
await traits.waitForDeployment();
const traitsAddress = await traits.getAddress();
console.log("DyoorTraits:", traitsAddress);

const Manager = await ethers.getContractFactory("DyoorTraitManager", deployer);
const manager = await Manager.deploy(owner, droidsAddress, traitsAddress);
await manager.waitForDeployment();
const managerAddress = await manager.getAddress();
console.log("DyoorTraitManager:", managerAddress);

if (owner !== deployer.address) {
  console.log("Owner differs from deployer. Set manager/URI values from owner wallet:");
  console.log(`DyoorDroids.setTraitManager(${managerAddress})`);
  console.log(`DyoorTraits.setTraitManager(${managerAddress})`);
} else {
  let tx = await droids.setTraitManager(managerAddress);
  await tx.wait();
  console.log("DyoorDroids trait manager set:", tx.hash);

  tx = await traits.setTraitManager(managerAddress);
  await tx.wait();
  console.log("DyoorTraits trait manager set:", tx.hash);

  tx = await droids.setTreasury(treasury);
  await tx.wait();
  console.log("Treasury set:", tx.hash);

  if (baseURI) {
    tx = await droids.setBaseURI(baseURI);
    await tx.wait();
    console.log("Droid baseURI set:", tx.hash);
  }

  if (droidsContractURI) {
    tx = await droids.setContractURI(droidsContractURI);
    await tx.wait();
    console.log("Droid contractURI set:", tx.hash);
  }

  if (traitsURI) {
    tx = await traits.setURI(traitsURI);
    await tx.wait();
    console.log("Trait URI set:", tx.hash);
  }

  if (traitsContractURI) {
    tx = await traits.setContractURI(traitsContractURI);
    await tx.wait();
    console.log("Trait contractURI set:", tx.hash);
  }
}

console.log("Deployment complete.");
