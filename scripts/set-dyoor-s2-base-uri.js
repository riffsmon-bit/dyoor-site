import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Contract, Interface, JsonRpcProvider, Wallet, formatEther, getAddress } from "ethers";

dotenv.config({ path: ".env.local" });
dotenv.config();

const MONAD_MAINNET_CHAIN_ID = 143n;
const CONFIRMATION = "YES_SET_DYOOR_S2_BASE_URI";
const DEFAULT_NEW_BASE_URI = "https://dyoor.netlify.app/api/metadata/";

const ABI = [
  "function owner() view returns (address)",
  "function baseURI() view returns (string)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function metadataFrozen() view returns (bool)",
  "function setBaseURI(string newBaseURI)",
];

function env(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function firstEnv(...names) {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  return "";
}

function requireEnv(...names) {
  const value = firstEnv(...names);
  if (!value) throw new Error(`${names.join(" or ")} is required`);
  return value;
}

function requireAddress(...names) {
  return getAddress(requireEnv(...names));
}

function metadataUrlFor(baseURI, tokenId) {
  if (!baseURI.endsWith("/")) return baseURI;
  return `${baseURI}${tokenId}`;
}

async function checkHttpMetadataEndpoint(baseURI) {
  if (!/^https?:\/\//i.test(baseURI)) {
    return { skipped: true, reason: "baseURI is not HTTP(S)" };
  }

  const url = metadataUrlFor(baseURI, 1);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Metadata endpoint check failed: ${url} returned HTTP ${response.status}`);
  }

  const metadata = await response.json();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`Metadata endpoint check failed: ${url} did not return a JSON object`);
  }

  const image = typeof metadata.image === "string" ? metadata.image : "";
  if (!metadata.name || typeof metadata.name !== "string") {
    throw new Error(`Metadata endpoint check failed: ${url} is missing name`);
  }
  if (!image) {
    throw new Error(`Metadata endpoint check failed: ${url} is missing image`);
  }
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(image)) {
    throw new Error(`Metadata endpoint check failed: ${url} returned local image URL ${image}`);
  }

  return {
    skipped: false,
    url,
    name: metadata.name,
    image,
  };
}

async function main() {
  const execute = env("EXECUTE_DYOOR_S2_BASE_URI_UPDATE") === "1";
  if (execute && env("SET_DYOOR_S2_BASE_URI_CONFIRMATION") !== CONFIRMATION) {
    throw new Error(`SET_DYOOR_S2_BASE_URI_CONFIRMATION=${CONFIRMATION} is required to broadcast`);
  }

  const rpcUrl = requireEnv("MONAD_MAINNET_RPC_URL", "DYOOR_S2_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL");
  const contractAddress = requireAddress("DYOOR_S2_CONTRACT_ADDRESS", "NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS");
  const newBaseURI = env("DYOOR_NEW_BASE_URI", env("DYOOR_BASE_URI", DEFAULT_NEW_BASE_URI));
  if (!newBaseURI.endsWith("/")) {
    throw new Error("New baseURI must end with / because ERC721SeaDrop appends the token ID");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== MONAD_MAINNET_CHAIN_ID) {
    throw new Error(`Wrong chain. Expected Monad mainnet 143, got ${network.chainId.toString()}`);
  }

  const code = await provider.getCode(contractAddress);
  if (code === "0x") {
    throw new Error(`No contract bytecode at ${contractAddress}`);
  }

  const contract = new Contract(contractAddress, ABI, provider);
  const [owner, currentBaseURI, currentTokenURI, totalSupply, metadataFrozen] = await Promise.all([
    contract.owner(),
    contract.baseURI(),
    contract.tokenURI(1),
    contract.totalSupply(),
    contract.metadataFrozen(),
  ]);

  if (metadataFrozen) {
    throw new Error("Contract metadata is frozen; baseURI cannot be changed");
  }

  const endpointCheck = env("SKIP_BASE_URI_ENDPOINT_CHECK") === "1"
    ? { skipped: true, reason: "SKIP_BASE_URI_ENDPOINT_CHECK=1" }
    : await checkHttpMetadataEndpoint(newBaseURI);

  const iface = new Interface(ABI);
  const calldata = iface.encodeFunctionData("setBaseURI", [newBaseURI]);
  const gasEstimate = await provider.estimateGas({
    from: owner,
    to: contractAddress,
    data: calldata,
  });
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
  const estimatedCost = gasEstimate * gasPrice;

  console.log("D.Y.O.O.R Season 2 baseURI update preflight");
  console.log("Mode:", execute ? "BROADCAST" : "DRY RUN");
  console.log("Chain ID:", network.chainId.toString());
  console.log("Contract:", contractAddress);
  console.log("Owner:", owner);
  console.log("Metadata frozen:", String(metadataFrozen));
  console.log("Total supply:", totalSupply.toString());
  console.log("Current baseURI:", currentBaseURI);
  console.log("Current tokenURI(1):", currentTokenURI);
  console.log("New baseURI:", newBaseURI);
  console.log("New tokenURI(1):", metadataUrlFor(newBaseURI, 1));
  console.log("Endpoint check:", JSON.stringify(endpointCheck, null, 2));
  console.log("Gas estimate:", gasEstimate.toString());
  console.log("Estimated gas cost:", `${formatEther(estimatedCost)} MON`);
  console.log("setBaseURI calldata:", calldata);

  if (!execute) {
    console.log("Dry run complete. Broadcast requires EXECUTE_DYOOR_S2_BASE_URI_UPDATE=1 and the exact confirmation env var.");
    return;
  }

  const privateKey = firstEnv("DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY");
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY or PRIVATE_KEY is required to broadcast");

  const wallet = new Wallet(privateKey, provider);
  const signerAddress = await wallet.getAddress();
  if (signerAddress.toLowerCase() !== String(owner).toLowerCase()) {
    throw new Error(`Signer ${signerAddress} is not contract owner ${owner}`);
  }

  const tx = await contract.connect(wallet).setBaseURI(newBaseURI);
  console.log("setBaseURI tx:", tx.hash);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`setBaseURI reverted: ${tx.hash}`);

  const updatedBaseURI = await contract.baseURI();
  const updatedTokenURI = await contract.tokenURI(1);
  const report = {
    contractAddress,
    chainId: Number(network.chainId),
    owner,
    previousBaseURI: currentBaseURI,
    newBaseURI: updatedBaseURI,
    previousTokenURI1: currentTokenURI,
    newTokenURI1: updatedTokenURI,
    totalSupply: totalSupply.toString(),
    transactionHash: tx.hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    endpointCheck,
    updatedAt: new Date().toISOString(),
  };

  fs.mkdirSync("deployments", { recursive: true });
  const reportPath = path.join("deployments", "dyoor-s2-base-uri-update.latest.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log("Updated baseURI:", updatedBaseURI);
  console.log("Updated tokenURI(1):", updatedTokenURI);
  console.log(`Wrote ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
