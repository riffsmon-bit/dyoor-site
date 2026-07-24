import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ASCENSION_STAKING_CONTRACT } from "@/lib/contracts/addresses";
import type { HarvestEvent } from "@/src/lib/storage/types";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_START_BLOCK = 54_985_442;
const DEFAULT_CHUNK_SIZE = 2_500;
const POINTS_CLAIMED_TOPIC = ethers.id("PointsClaimed(address,uint256)");
const ASCENSION_ABI = [
  "event PointsClaimed(address indexed user,uint256 amount)",
  "function pendingPoints(address user) view returns (uint256)",
];

const iface = new ethers.Interface(ASCENSION_ABI);

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function addressTopic(address: string) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function wholeNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function ascensionStakingAddress() {
  return ethers.getAddress(
    readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT")
    || DEFAULT_ASCENSION_STAKING_CONTRACT,
  );
}

export function energyRpcProvider() {
  return new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
}

export async function assertMonadMainnet(provider: ethers.JsonRpcProvider) {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
    throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
  }
}

export async function readPendingEnergyRaw(wallet: string) {
  const normalized = normalizeAddress(wallet);
  if (!normalized) throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  const provider = energyRpcProvider();
  const contract = new ethers.Contract(ascensionStakingAddress(), ASCENSION_ABI, provider);
  const value = await contract.pendingPoints(normalized).catch(() => 0n);
  return BigInt(value || 0);
}

function eventFromLog(log: ethers.Log): HarvestEvent | null {
  const parsed = iface.parseLog(log);
  if (!parsed || parsed.name !== "PointsClaimed") return null;
  const wallet = normalizeAddress(parsed.args.user);
  if (!wallet) return null;
  return {
    id: `${String(log.transactionHash).toLowerCase()}:${String(log.index ?? 0)}`,
    wallet,
    amountRaw: BigInt(parsed.args.amount).toString(),
    txHash: String(log.transactionHash).toLowerCase(),
    logIndex: String(log.index ?? 0),
    blockNumber: String(log.blockNumber || 0),
    source: "ascension-points-claimed",
  };
}

export async function harvestEventsFromReceipt(txHash: string, wallet?: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw Object.assign(new Error("txHash must be a transaction hash."), { status: 400 });
  }
  const normalizedWallet = wallet ? normalizeAddress(wallet) : "";
  const provider = energyRpcProvider();
  let receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    receipt = await provider.getTransactionReceipt(txHash);
  }
  if (!receipt) throw Object.assign(new Error("Harvest transaction is not confirmed yet."), { status: 409 });
  if (receipt.status !== 1) throw Object.assign(new Error("Harvest transaction failed on-chain."), { status: 400 });

  const stakingAddress = ascensionStakingAddress().toLowerCase();
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === stakingAddress && log.topics[0]?.toLowerCase() === POINTS_CLAIMED_TOPIC.toLowerCase())
    .map((log) => eventFromLog(log))
    .filter((event): event is HarvestEvent => Boolean(event))
    .filter((event) => !normalizedWallet || event.wallet === normalizedWallet);
}

async function getLogsWithRetry(provider: ethers.JsonRpcProvider, filter: ethers.Filter, fromBlock: number, toBlock: number): Promise<ethers.Log[]> {
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock });
  } catch (error) {
    if (fromBlock >= toBlock) throw error;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsWithRetry(provider, filter, fromBlock, mid);
    const right = await getLogsWithRetry(provider, filter, mid + 1, toBlock);
    return left.concat(right);
  }
}

export async function scanHarvestEvents({
  wallet,
  fromBlock,
  toBlock,
  maxChunks,
}: {
  wallet?: string;
  fromBlock?: number;
  toBlock?: number;
  maxChunks?: number;
} = {}) {
  const provider = energyRpcProvider();
  const latest = toBlock ?? await provider.getBlockNumber();
  const start = fromBlock ?? wholeNumber(readEnv("ASCENSION_ENERGY_START_BLOCK", "ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"), DEFAULT_START_BLOCK);
  const chunkSize = Math.max(1, wholeNumber(readEnv("ASCENSION_ENERGY_LOG_CHUNK_SIZE", "ASCENSION_LOG_CHUNK_SIZE"), DEFAULT_CHUNK_SIZE));
  const normalizedWallet = wallet ? normalizeAddress(wallet) : "";
  if (wallet && !normalizedWallet) {
    throw Object.assign(new Error("Invalid wallet address."), { status: 400 });
  }
  const topics = normalizedWallet ? [POINTS_CLAIMED_TOPIC, addressTopic(normalizedWallet)] : [POINTS_CLAIMED_TOPIC];
  const filter: ethers.Filter = {
    address: ascensionStakingAddress(),
    topics,
  };
  const events: HarvestEvent[] = [];
  let chunksScanned = 0;
  let cursor = start;

  while (cursor <= latest) {
    if (maxChunks && chunksScanned >= maxChunks) break;
    const end = Math.min(latest, cursor + chunkSize - 1);
    const logs = await getLogsWithRetry(provider, filter, cursor, end);
    events.push(...logs.map((log) => eventFromLog(log)).filter((event): event is HarvestEvent => Boolean(event)));
    chunksScanned += 1;
    cursor = end + 1;
  }

  return {
    events,
    fromBlock: start,
    toBlock: Math.min(latest, cursor - 1),
    latestBlock: latest,
    nextBlock: cursor,
    complete: cursor > latest,
    chunksScanned,
  };
}
