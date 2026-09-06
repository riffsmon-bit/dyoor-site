#!/usr/bin/env node

import { ethers } from "ethers";

const CHAIN_ID = 143;
const DEFAULT_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const DEFAULT_RPC = "https://rpc.monad.xyz";
const TARGET_BASE_URI = "https://dyoor.fun/api/metadata/";
const EXECUTE = process.env.EXECUTE_DYOOR_METADATA_DOMAIN_MIGRATION === "1";
const ABI = [
  "function owner() view returns (address)",
  "function metadataFrozen() view returns (bool)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function setBaseURI(string newBaseURI)",
];

function normalizePrivateKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  return key.startsWith("0x") ? key : `0x${key}`;
}

async function fetchMetadata(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const metadata = await response.json();
  if (!metadata?.name || !metadata?.image || !Array.isArray(metadata?.attributes)) {
    throw new Error(`${url} returned incomplete NFT metadata.`);
  }
  return metadata;
}

async function main() {
  const contractAddress = ethers.getAddress(
    process.env.DYOOR_S2_CONTRACT_ADDRESS || DEFAULT_CONTRACT,
  );
  const rpcUrl = process.env.MONAD_RPC_URL || process.env.DYOOR_S2_RPC_URL || DEFAULT_RPC;
  if (/testnet/i.test(rpcUrl)) throw new Error("Metadata migration requires Monad mainnet.");

  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  const [network, owner, metadataFrozen, totalSupply, currentTokenUri] = await Promise.all([
    provider.getNetwork(),
    contract.owner(),
    contract.metadataFrozen(),
    contract.totalSupply(),
    contract.tokenURI(1n),
  ]);
  if (Number(network.chainId) !== CHAIN_ID) throw new Error(`Expected chain ${CHAIN_ID}.`);
  if (metadataFrozen) throw new Error("Contract metadata is frozen; base URI cannot be migrated.");

  const sampleIds = Array.from(new Set([1, Math.max(1, Math.floor(Number(totalSupply) / 2)), Number(totalSupply)]));
  console.log("Contract:", contractAddress);
  console.log("Owner:", owner);
  console.log("Current token URI:", currentTokenUri);
  console.log("Target base URI:", TARGET_BASE_URI);
  console.log("Metadata frozen:", metadataFrozen);

  for (const tokenId of sampleIds) {
    const metadata = await fetchMetadata(`${TARGET_BASE_URI}${tokenId}`);
    console.log(`Target #${tokenId}: ${metadata.name} · ${metadata.attributes.length} attributes · image ${metadata.image}`);
  }

  const callData = contract.interface.encodeFunctionData("setBaseURI", [TARGET_BASE_URI]);
  await provider.call({ to: contractAddress, from: owner, data: callData });
  console.log("Owner-context setBaseURI simulation: passed");

  if (!EXECUTE) {
    console.log("Dry run complete. No transaction was sent.");
    console.log("Set EXECUTE_DYOOR_METADATA_DOMAIN_MIGRATION=1 with the owner key only after local review.");
    return;
  }

  const privateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required for execution.");
  const signer = new ethers.Wallet(privateKey, provider);
  if (signer.address.toLowerCase() !== String(owner).toLowerCase()) {
    throw new Error(`Configured signer ${signer.address} is not contract owner ${owner}.`);
  }

  const writable = contract.connect(signer);
  const transaction = await writable.setBaseURI(TARGET_BASE_URI);
  console.log("Submitted:", transaction.hash);
  await transaction.wait();
  const migratedTokenUri = await contract.tokenURI(1n);
  if (migratedTokenUri !== `${TARGET_BASE_URI}1`) {
    throw new Error(`Post-transaction tokenURI mismatch: ${migratedTokenUri}`);
  }
  console.log("Verified tokenURI(1):", migratedTokenUri);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
