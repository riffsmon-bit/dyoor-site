import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const PRODUCTION_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";

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
const energyBank = requireAddress(
  ethers,
  process.env.ENERGY_BANK_ADDRESS || PRODUCTION_ENERGY_BANK,
  "ENERGY_BANK_ADDRESS",
);
if (energyBank !== ethers.getAddress(PRODUCTION_ENERGY_BANK)) {
  throw new Error(`Trait bounties must credit the production Energy Bank ${PRODUCTION_ENERGY_BANK}.`);
}
const processor = requireAddress(
  ethers,
  process.env.DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS || deployer.address,
  "DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS",
);

console.log("Deploying DYOORTraitBounties...");
console.log("Deployer:", deployer.address);
console.log("Owner:", owner);
console.log("Energy Bank:", energyBank);
console.log("Initial processor:", processor);
console.log("Chain ID:", chain.chainId.toString());

const Factory = await ethers.getContractFactory("DYOORTraitBounties", deployer);
const bounties = await Factory.deploy(owner, energyBank, processor);
await bounties.waitForDeployment();
const address = await bounties.getAddress();
const deploymentReceipt = await bounties.deploymentTransaction()?.wait();

console.log("DYOORTraitBounties address:", address);
console.log("Deployment block:", String(deploymentReceipt?.blockNumber || ""));

const bank = new ethers.Contract(
  energyBank,
  [
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function CREDIT_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role,address account) view returns (bool)",
    "function grantRole(bytes32 role,address account)",
  ],
  deployer,
);
const creditRole = await bank.CREDIT_ROLE();
const adminRole = await bank.DEFAULT_ADMIN_ROLE();
const [alreadyCreditor, deployerIsAdmin] = await Promise.all([
  bank.hasRole(creditRole, address).then(Boolean),
  bank.hasRole(adminRole, deployer.address).then(Boolean),
]);

if (
  !alreadyCreditor
  && deployerIsAdmin
  && enabled(process.env.DYOOR_TRAIT_BOUNTY_GRANT_CREDIT_ROLE)
) {
  const tx = await bank.grantRole(creditRole, address);
  await tx.wait();
  console.log("Granted Energy Bank CREDIT_ROLE:", tx.hash);
} else if (!alreadyCreditor) {
  console.log("CREDIT_ROLE was not granted automatically.");
  console.log("From the Energy Bank admin wallet, grant CREDIT_ROLE to:", address);
}

console.log("Bounties are empty and inactive after deployment.");
console.log("Add Netlify variables only after explorer verification and CREDIT_ROLE confirmation:");
console.log(`DYOOR_TRAIT_BOUNTIES_CONTRACT=${address}`);
console.log(`NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT=${address}`);
console.log(`DYOOR_TRAIT_BOUNTIES_START_BLOCK=${String(deploymentReceipt?.blockNumber || "")}`);
