import dotenv from "dotenv";
import { ethers } from "ethers";
import { getStore } from "@netlify/blobs";

dotenv.config({ path: ".env.local" });
dotenv.config();

const DEFAULT_S2_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const LEGACY_S2_TESTNET_CONTRACT = "0xcE586aA467F6351bf819DbF134BC69947125CD92";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const DEFAULT_RPC = "https://rpc.monad.xyz";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function optionalAddress(value) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

function normalizePrivateKey(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function s2ContractAddress() {
  const configured = optionalAddress(readEnv("DYOOR_S2_CONTRACT_ADDRESS", "NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS"));
  const legacy = ethers.getAddress(LEGACY_S2_TESTNET_CONTRACT);
  if (!configured || configured === legacy) return ethers.getAddress(DEFAULT_S2_CONTRACT);
  return configured;
}

function energyBankAddress() {
  return optionalAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS")) || DEFAULT_ENERGY_BANK;
}

function topicAddress(address) {
  return ethers.zeroPadValue(address, 32).toLowerCase();
}

function walletFromTopic(topic) {
  const value = String(topic || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return "";
  return optionalAddress(`0x${value.slice(-40)}`);
}

function droidBurnClaim(wallet, tokenId, burnTxHash, rewardRaw) {
  return ethers.keccak256(ethers.toUtf8Bytes([
    "trait-lab-droid-burn",
    "143",
    s2ContractAddress().toLowerCase(),
    wallet.toLowerCase(),
    String(tokenId),
    burnTxHash.toLowerCase(),
    rewardRaw,
  ].join(":")));
}

function metadataSnapshot(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : [];
  const version = attributes.find((attribute) => attribute?.trait_type === "Metadata Version")?.value;
  return {
    name: metadata.name || "",
    image: String(metadata.image || ""),
    metadataVersion: String(version || ""),
  };
}

async function fetchMetadata(tokenId) {
  const baseUrl = readEnv("DYOOR_METADATA_BASE_URL", "NEXT_PUBLIC_DYOOR_METADATA_BASE_URL") || "https://dyoor.netlify.app/api/metadata/";
  const url = `${baseUrl.replace(/\/+$/, "")}/${tokenId}`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`metadata ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Metadata snapshot unavailable for #${tokenId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function saveBurnedGalleryRecord(record) {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_AUTH_TOKEN");
  if (!siteID || !token) {
    console.warn("Skipping burned gallery write: NETLIFY_BLOBS_SITE_ID/NETLIFY_BLOBS_TOKEN not configured locally.");
    return null;
  }

  const store = getStore({ name: "dyoor-s2-metadata", siteID, token, consistency: "strong" });
  const key = "trait-lab/burned-droids.json";
  const fallback = { version: 1, updatedAt: "", items: [] };
  const gallery = await store.get(key, { type: "json", consistency: "strong" }).catch(() => null) || fallback;
  const updatedAt = new Date().toISOString();
  const txHash = record.burnTxHash.toLowerCase();
  const tokenId = String(record.tokenId);
  const existing = Array.isArray(gallery.items)
    ? gallery.items.find((item) => String(item.tokenId) === tokenId || String(item.burnTxHash || "").toLowerCase() === txHash)
    : null;
  const nextRecord = {
    ...existing,
    ...record,
    tokenId,
    wallet: record.wallet.toLowerCase(),
    burnTxHash: txHash,
    burnedAt: record.burnedAt || updatedAt,
  };
  const existingItems = Array.isArray(gallery.items) ? gallery.items : [];
  const items = [nextRecord]
    .concat(existingItems.filter((item) => String(item.tokenId) !== tokenId && String(item.burnTxHash || "").toLowerCase() !== txHash))
    .sort((a, b) => Date.parse(b.burnedAt || "") - Date.parse(a.burnedAt || ""));
  const nextGallery = { version: 1, updatedAt, items };
  await store.setJSON(key, nextGallery);
  return nextRecord;
}

async function main() {
  const burnTxHash = String(argValue("--tx") || readEnv("BURN_TX_HASH")).trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(burnTxHash)) {
    throw new Error("Usage: npm run trait-lab:droid-burn-credit -- --tx 0x...");
  }

  const requestedTokenId = argValue("--token-id");
  const execute = process.argv.includes("--execute") || readEnv("EXECUTE_DROID_BURN_CREDIT") === "1";
  const rewardEnergy = Number.parseInt(readEnv("DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY", "NEXT_PUBLIC_DYOOR_TRAIT_LAB_DROID_BURN_REWARD_ENERGY") || "2500", 10);
  const rewardRaw = ethers.parseUnits(String(Number.isSafeInteger(rewardEnergy) && rewardEnergy > 0 ? rewardEnergy : 2500), 18).toString();
  const rewardLabel = `${ethers.formatUnits(rewardRaw, 18).replace(/\.0+$/, "")} Energy`;
  const provider = new ethers.JsonRpcProvider(readEnv("DYOOR_S2_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
  const contractAddress = s2ContractAddress().toLowerCase();
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(burnTxHash),
    provider.getTransactionReceipt(burnTxHash),
  ]);

  if (!tx) throw new Error("Burn transaction is not available yet.");
  if (!receipt) throw new Error("Burn transaction is not confirmed yet.");
  if (receipt.status !== 1) throw new Error("Burn transaction failed on-chain.");

  const burnLogs = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== contractAddress) return [];
    const topics = log.topics.map((topic) => String(topic || "").toLowerCase());
    if (topics[0] !== TRANSFER_TOPIC.toLowerCase() || topics[2] !== topicAddress(ZERO_ADDRESS)) return [];
    const wallet = walletFromTopic(topics[1]);
    const tokenId = BigInt(topics[3]).toString();
    if (!wallet) return [];
    return [{ wallet, tokenId }];
  });

  const burn = requestedTokenId
    ? burnLogs.find((entry) => entry.tokenId === String(requestedTokenId))
    : burnLogs.length === 1 ? burnLogs[0] : null;
  if (!burn) throw new Error("Could not identify one verified D.Y.O.O.R Season 2 burn log in this transaction.");

  const claim = droidBurnClaim(burn.wallet, burn.tokenId, burnTxHash, rewardRaw);
  const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "ENERGY_CREDIT_SIGNER_PRIVATE_KEY"));
  if (!signerKey) throw new Error("ENERGY_BANK_OPERATOR_PRIVATE_KEY is required to credit the burn reward.");
  const signer = new ethers.Wallet(signerKey, provider);
  const bank = new ethers.Contract(energyBankAddress(), ENERGY_BANK_ABI, signer);
  const creditRole = await bank.CREDIT_ROLE();
  const hasCreditRole = await bank.hasRole(creditRole, signer.address).then(Boolean);
  const alreadyCredited = await bank.usedClaimTxHash(claim).then(Boolean);

  console.log(JSON.stringify({
    execute,
    burnTxHash,
    burnTxTo: tx.to,
    burnTxFrom: tx.from,
    blockNumber: receipt.blockNumber,
    s2Contract: ethers.getAddress(contractAddress),
    tokenId: burn.tokenId,
    wallet: burn.wallet,
    energyBank: energyBankAddress(),
    operator: signer.address,
    hasCreditRole,
    rewardLabel,
    claim,
    alreadyCredited,
  }, null, 2));

  if (!hasCreditRole) throw new Error("Energy Bank operator is missing CREDIT_ROLE.");

  let rewardTxHash = "";
  let rewardBlockNumber = "";
  if (!alreadyCredited) {
    if (!execute) {
      console.log("Dry run only. Add --execute to credit Energy and save the burned gallery record.");
      return;
    }

    await bank.creditEnergy.staticCall(burn.wallet, BigInt(rewardRaw), claim);
    const rewardTx = await bank.creditEnergy(burn.wallet, BigInt(rewardRaw), claim, { gasLimit: 160000n });
    console.log(`Sent Energy reward tx: ${rewardTx.hash}`);
    const rewardReceipt = await rewardTx.wait();
    if (rewardReceipt?.status !== 1) throw new Error("Energy reward transaction failed.");
    rewardTxHash = rewardTx.hash;
    rewardBlockNumber = String(rewardReceipt.blockNumber || "");
  }

  const metadata = await fetchMetadata(burn.tokenId);
  const record = await saveBurnedGalleryRecord({
    tokenId: burn.tokenId,
    wallet: burn.wallet,
    burnTxHash,
    rewardEnergy: Number.parseFloat(ethers.formatUnits(rewardRaw, 18)),
    rewardRaw,
    rewardLabel,
    claim,
    burnedAt: new Date().toISOString(),
    ...metadataSnapshot(metadata),
    rewardTxHash,
    rewardBlockNumber,
    deduped: alreadyCredited,
  });
  if (record) console.log(`Burned gallery record saved for D.Y.O.O.R #${burn.tokenId}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
