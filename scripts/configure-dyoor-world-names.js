import "dotenv/config";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const DYOOR_S2_MAINNET = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const LOCK_CONFIRMATION = "LOCK_DYOOR_WORLD_METADATA_FOREVER";

function requireAddress(ethers, value, label) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid address. Received: ${value || "<empty>"}`);
  }
  return ethers.getAddress(value);
}

const { ethers } = await network.create();
const [signer] = await ethers.getSigners();
if (!signer) {
  throw new Error("No signer found. Set DEPLOYER_PRIVATE_KEY for the World registry owner wallet.");
}
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== MONAD_CHAIN_ID) {
  throw new Error(`Wrong network. Expected Monad chain id 143, got ${chain.chainId.toString()}.`);
}

const address = requireAddress(
  ethers,
  process.env.DYOOR_WORLD_NAMES_CONTRACT,
  "DYOOR_WORLD_NAMES_CONTRACT",
);
const names = new ethers.Contract(
  address,
  [
    "function owner() view returns (address)",
    "function S2_COLLECTION() view returns (address)",
    "function claimsOpen() view returns (bool)",
    "function metadataLocked() view returns (bool)",
    "function totalNames() view returns (uint256)",
    "function setClaimsOpen(bool open)",
    "function setReservedLabels(string[] labels,bool reserved)",
    "function setMetadataBaseURI(string metadataBaseURI)",
    "function lockMetadataForever()",
  ],
  signer,
);

const [owner, s2Collection, claimsOpen, metadataLocked, totalNames] = await Promise.all([
  names.owner(),
  names.S2_COLLECTION(),
  names.claimsOpen(),
  names.metadataLocked(),
  names.totalNames(),
]);
if (ethers.getAddress(s2Collection) !== ethers.getAddress(DYOOR_S2_MAINNET)) {
  throw new Error(`Registry does not gate production S2 ${DYOOR_S2_MAINNET}.`);
}

console.log("DYOORWorldNames:", address);
console.log("Owner:", owner);
console.log("Connected signer:", signer.address);
console.log("S2 collection:", s2Collection);
console.log("Claims open:", claimsOpen);
console.log("Metadata locked:", metadataLocked);
console.log("Total names:", totalNames.toString());

const action = String(process.env.DYOOR_WORLD_CONFIGURE_ACTION || "status").trim().toLowerCase();
if (action === "status") process.exit(0);
if (ethers.getAddress(owner) !== ethers.getAddress(signer.address)) {
  throw new Error("Connected signer is not the World registry owner.");
}

let tx;
if (action === "open") {
  tx = await names.setClaimsOpen(true);
} else if (action === "close") {
  tx = await names.setClaimsOpen(false);
} else if (action === "reserve") {
  const labels = String(process.env.DYOOR_WORLD_RESERVED_LABELS || "")
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  if (!labels.length) throw new Error("Set DYOOR_WORLD_RESERVED_LABELS to a comma-separated list.");
  tx = await names.setReservedLabels(labels, true);
} else if (action === "metadata") {
  const metadataBaseURI = String(process.env.DYOOR_WORLD_NAMES_METADATA_BASE_URI || "").trim();
  if (!/^https:\/\/[^\s]+\/$/.test(metadataBaseURI)) {
    throw new Error("DYOOR_WORLD_NAMES_METADATA_BASE_URI must be an HTTPS URL ending in /.");
  }
  tx = await names.setMetadataBaseURI(metadataBaseURI);
} else if (action === "lock-metadata") {
  if (process.env.DYOOR_WORLD_CONFIRM_LOCK_METADATA !== LOCK_CONFIRMATION) {
    throw new Error(`Set DYOOR_WORLD_CONFIRM_LOCK_METADATA=${LOCK_CONFIRMATION} to confirm the irreversible lock.`);
  }
  tx = await names.lockMetadataForever();
} else {
  throw new Error("DYOOR_WORLD_CONFIGURE_ACTION must be status, open, close, reserve, metadata, or lock-metadata.");
}

console.log("Submitted:", tx.hash);
const receipt = await tx.wait();
if (receipt?.status !== 1) throw new Error("World registry configuration transaction failed.");
console.log("Confirmed in block:", String(receipt.blockNumber || ""));
