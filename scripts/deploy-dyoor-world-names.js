import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const DYOOR_S2_MAINNET = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const RESERVED_LABELS = [
  "admin",
  "administrator",
  "api",
  "app",
  "ascension",
  "burn",
  "dyoor",
  "dyoorworld",
  "energy",
  "help",
  "holder",
  "holders",
  "mesh",
  "m3sh",
  "moderator",
  "official",
  "owner",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "traitlab",
  "treasury",
  "verify",
  "world",
];

function requireAddress(ethers, value, label) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid address. Received: ${value || "<empty>"}`);
  }
  return ethers.getAddress(value);
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();
if (!deployer) {
  throw new Error("No deployer signer found. Set DEPLOYER_PRIVATE_KEY before deploying.");
}

const chain = await ethers.provider.getNetwork();
if (chain.chainId !== MONAD_CHAIN_ID) {
  throw new Error(`Wrong network. Expected Monad chain id 143, got ${chain.chainId.toString()}.`);
}

const owner = requireAddress(
  ethers,
  process.env.DYOOR_OWNER_ADDRESS || deployer.address,
  "DYOOR_OWNER_ADDRESS",
);
const s2Collection = requireAddress(
  ethers,
  process.env.DYOOR_S2_CONTRACT_ADDRESS || DYOOR_S2_MAINNET,
  "DYOOR_S2_CONTRACT_ADDRESS",
);
if (s2Collection !== ethers.getAddress(DYOOR_S2_MAINNET)) {
  throw new Error(`dYOOR World names must gate the production S2 contract ${DYOOR_S2_MAINNET}.`);
}
const metadataBaseURI = String(process.env.DYOOR_WORLD_NAMES_METADATA_BASE_URI || "").trim();

console.log("Deploying DYOORWorldNames...");
console.log("Deployer:", deployer.address);
console.log("Owner:", owner);
console.log("S2 collection:", s2Collection);
console.log("Chain ID:", chain.chainId.toString());
console.log("Claims open after setup:", enabled(process.env.DYOOR_WORLD_OPEN_CLAIMS));

const Names = await ethers.getContractFactory("DYOORWorldNames", deployer);
const names = await Names.deploy(owner, s2Collection, metadataBaseURI);
await names.waitForDeployment();
const address = await names.getAddress();

console.log("DYOORWorldNames address:", address);

if (owner !== deployer.address) {
  console.log("Owner differs from deployer. Claims remain closed.");
  console.log("From the owner wallet, reserve protocol labels before calling setClaimsOpen(true).");
} else {
  for (const label of RESERVED_LABELS) {
    const tx = await names.setReservedLabel(label, true);
    await tx.wait();
    console.log("Reserved:", label, tx.hash);
  }

  if (enabled(process.env.DYOOR_WORLD_OPEN_CLAIMS)) {
    const tx = await names.setClaimsOpen(true);
    await tx.wait();
    console.log("Claims opened:", tx.hash);
  } else {
    console.log("Claims remain closed. Audit the deployment, then call setClaimsOpen(true).");
  }
}

console.log("Add both Netlify variables only after verifying the deployment:");
console.log(`DYOOR_WORLD_NAMES_CONTRACT=${address}`);
console.log(`NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT=${address}`);
