import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_S1 = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const DEFAULT_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_WINDOW = 2_500;
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const OUT_DIR = path.join(process.cwd(), "data", "snapshots", "s1-ascended");
const CHECKPOINT_FILE = path.join(OUT_DIR, "checkpoint.json");
const LATEST_FILE = path.join(OUT_DIR, "latest.json");

const erc721Abi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const stakingAbi = [
  "function stakeInfo(uint256 tokenId) view returns (address owner,uint64 stakedAt)",
];

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function wholeNumber(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function addressTopic(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function topicAddress(topic) {
  return ethers.getAddress(`0x${String(topic || "").slice(-40)}`).toLowerCase();
}

function tokenIdFromTopic(topic) {
  return BigInt(topic).toString();
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureOutDir() {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function csvValue(value) {
  return `"${String(Array.isArray(value) ? value.join(" ") : value ?? "").replaceAll("\"", "\"\"")}"`;
}

async function writeCsv(filePath, rows) {
  if (!rows.length) {
    await fs.writeFile(filePath, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))].join("\n");
  await fs.writeFile(filePath, `${csv}\n`);
}

function activeFromSnapshot(snapshot) {
  const active = new Map();
  for (const row of snapshot?.tokens || []) {
    if (row.status !== "ascended") continue;
    active.set(String(row.tokenId), {
      tokenId: String(row.tokenId),
      wallet: String(row.wallet || "").toLowerCase(),
      depositedAtBlock: String(row.depositedAtBlock || ""),
      depositedAtTx: String(row.depositedAtTx || ""),
      status: "ascended",
    });
  }
  return active;
}

async function getLogs(provider, filter, fromBlock, toBlock) {
  try {
    return await provider.getLogs({ ...filter, fromBlock, toBlock });
  } catch (error) {
    if (fromBlock >= toBlock) throw error;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogs(provider, filter, fromBlock, mid);
    const right = await getLogs(provider, filter, mid + 1, toBlock);
    return left.concat(right);
  }
}

async function scanTransferWindow(provider, nftAddress, stakingAddress, fromBlock, toBlock) {
  const toStaking = await getLogs(provider, {
    address: nftAddress,
    topics: [TRANSFER_TOPIC, null, addressTopic(stakingAddress)],
  }, fromBlock, toBlock);
  const fromStaking = await getLogs(provider, {
    address: nftAddress,
    topics: [TRANSFER_TOPIC, addressTopic(stakingAddress)],
  }, fromBlock, toBlock);

  return toStaking.concat(fromStaking).sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.index - b.index;
  });
}

function applyTransfer(active, log, stakingAddress) {
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const tokenId = tokenIdFromTopic(log.topics[3]);
  if (to === stakingAddress.toLowerCase()) {
    active.set(tokenId, {
      tokenId,
      wallet: from,
      depositedAtBlock: String(log.blockNumber),
      depositedAtTx: String(log.transactionHash || "").toLowerCase(),
      status: "ascended",
    });
  } else if (from === stakingAddress.toLowerCase()) {
    active.delete(tokenId);
  }
}

async function validateSnapshotRows(provider, rows, nftAddress, stakingAddress) {
  const nft = new ethers.Contract(nftAddress, erc721Abi, provider);
  const staking = new ethers.Contract(stakingAddress, stakingAbi, provider);
  const warnings = [];
  const validated = [];

  for (const row of rows) {
    const notes = [];
    let wallet = row.wallet;
    let ownerOf = "";
    let stakeInfoOwner = "";
    let stakedAt = "";
    try {
      ownerOf = ethers.getAddress(await nft.ownerOf(BigInt(row.tokenId))).toLowerCase();
      if (ownerOf !== stakingAddress.toLowerCase()) notes.push(`ownerOf=${ownerOf}`);
    } catch (error) {
      notes.push(`ownerOf read failed: ${String(error?.shortMessage || error?.message || error).slice(0, 120)}`);
    }
    try {
      const info = await staking.stakeInfo(BigInt(row.tokenId));
      stakeInfoOwner = ethers.getAddress(info.owner ?? info[0]).toLowerCase();
      stakedAt = String(info.stakedAt ?? info[1] ?? "");
      if (stakeInfoOwner && stakeInfoOwner !== ZERO_ADDRESS) {
        if (wallet && wallet !== stakeInfoOwner) notes.push(`transfer depositor ${wallet} differs from stakeInfo ${stakeInfoOwner}`);
        wallet = stakeInfoOwner;
      }
    } catch (error) {
      notes.push(`stakeInfo read failed: ${String(error?.shortMessage || error?.message || error).slice(0, 120)}`);
    }
    if (notes.length) warnings.push({ tokenId: row.tokenId, notes });
    validated.push({
      ...row,
      wallet,
      ownerOf,
      stakeInfoOwner,
      stakedAt,
      validationStatus: notes.length ? "warning" : "verified",
      validationNotes: notes.join("; "),
    });
  }

  return { rows: validated, warnings };
}

function walletRowsFromTokens(tokens) {
  const byWallet = new Map();
  for (const token of tokens) {
    if (!token.wallet || token.wallet === ZERO_ADDRESS) continue;
    const bucket = byWallet.get(token.wallet) || { wallet: token.wallet, ascendedCount: 0, tokenIds: [] };
    bucket.ascendedCount += 1;
    bucket.tokenIds.push(token.tokenId);
    byWallet.set(token.wallet, bucket);
  }
  return Array.from(byWallet.values()).map((row) => ({
    ...row,
    tokenIds: row.tokenIds.sort((a, b) => Number(a) - Number(b)),
  })).sort((a, b) => b.ascendedCount - a.ascendedCount || a.wallet.localeCompare(b.wallet));
}

async function buildSnapshot({ mode }) {
  await ensureOutDir();
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_S1);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_STAKING);
  const latest = await provider.getBlockNumber();
  const windowSize = Math.max(1, wholeNumber(readEnv("S1_SNAPSHOT_BLOCK_WINDOW", "ASCENSION_SNAPSHOT_BLOCK_WINDOW", "ASCENSION_LOG_CHUNK_SIZE"), DEFAULT_WINDOW));
  const checkpoint = await readJson(CHECKPOINT_FILE, null);
  const latestSnapshot = await readJson(LATEST_FILE, null);
  const fullStart = wholeNumber(readEnv("S1_SNAPSHOT_START_BLOCK", "ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK"), 0);
  const startBlock = mode === "incremental" && checkpoint?.lastIndexedBlock
    ? Number(checkpoint.lastIndexedBlock) + 1
    : fullStart;
  const active = mode === "incremental" ? activeFromSnapshot(latestSnapshot) : new Map();

  let cursor = startBlock;
  let chunksScanned = 0;
  const failedChunks = [];

  while (cursor <= latest) {
    const toBlock = Math.min(latest, cursor + windowSize - 1);
    try {
      const logs = await scanTransferWindow(provider, nftAddress, stakingAddress, cursor, toBlock);
      for (const log of logs) applyTransfer(active, log, stakingAddress);
      chunksScanned += 1;
      await writeJson(CHECKPOINT_FILE, {
        mode,
        lastIndexedBlock: toBlock,
        latestBlock: latest,
        activeCount: active.size,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      failedChunks.push({ fromBlock: cursor, toBlock, error: String(error?.message || error) });
    }
    cursor = toBlock + 1;
  }

  const tokenRows = Array.from(active.values()).sort((a, b) => Number(a.tokenId) - Number(b.tokenId));
  const validation = await validateSnapshotRows(provider, tokenRows, nftAddress, stakingAddress);
  const walletRows = walletRowsFromTokens(validation.rows);
  const id = `s1-ascended-${timestampId()}`;
  const snapshot = {
    id,
    generatedAt: new Date().toISOString(),
    fromBlock: String(startBlock),
    toBlock: String(latest),
    sourceBlockRange: `${startBlock}-${latest}`,
    chunksScanned,
    failedChunks,
    totalAscendedTokens: validation.rows.length,
    uniqueWallets: walletRows.length,
    contracts: {
      s1: nftAddress,
      ascensionStaking: stakingAddress,
    },
    tokens: validation.rows,
    wallets: walletRows,
    warnings: validation.warnings,
    errors: failedChunks,
  };

  const snapshotFile = path.join(OUT_DIR, `${id}.json`);
  const tokenCsv = path.join(OUT_DIR, `${id}-tokens.csv`);
  const walletCsv = path.join(OUT_DIR, `${id}-wallets.csv`);
  await writeJson(snapshotFile, snapshot);
  await writeJson(LATEST_FILE, snapshot);
  await writeCsv(tokenCsv, validation.rows);
  await writeCsv(walletCsv, walletRows.map((row) => ({ ...row, tokenIds: row.tokenIds.join(" ") })));
  return { snapshot, snapshotFile, tokenCsv, walletCsv };
}

async function validateLatest() {
  const latest = await readJson(LATEST_FILE, null);
  if (!latest) throw new Error("No latest S1 ascended snapshot found.");
  const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
  const nftAddress = ethers.getAddress(readEnv("DYOOR_S1_CONTRACT", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_S1);
  const stakingAddress = ethers.getAddress(readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_STAKING);
  const validation = await validateSnapshotRows(provider, latest.tokens || [], nftAddress, stakingAddress);
  const failed = validation.rows.filter((row) => row.validationStatus !== "verified");
  return {
    checked: validation.rows.length,
    verified: validation.rows.length - failed.length,
    warnings: failed.length,
    warningSample: failed.slice(0, 25).map((row) => ({ tokenId: row.tokenId, notes: row.validationNotes })),
  };
}

async function exportLatest() {
  const latest = await readJson(LATEST_FILE, null);
  if (!latest) throw new Error("No latest S1 ascended snapshot found.");
  const tokenCsv = path.join(OUT_DIR, "latest-tokens.csv");
  const walletCsv = path.join(OUT_DIR, "latest-wallets.csv");
  await writeCsv(tokenCsv, latest.tokens || []);
  await writeCsv(walletCsv, (latest.wallets || []).map((row) => ({ ...row, tokenIds: (row.tokenIds || []).join(" ") })));
  return { tokenCsv, walletCsv, snapshot: LATEST_FILE };
}

async function main() {
  const mode = process.argv[2] || "full";
  if (mode === "full" || mode === "incremental") {
    const result = await buildSnapshot({ mode });
    console.log(JSON.stringify({
      ok: true,
      mode,
      snapshotFile: result.snapshotFile,
      tokenCsv: result.tokenCsv,
      walletCsv: result.walletCsv,
      summary: {
        totalAscendedTokens: result.snapshot.totalAscendedTokens,
        uniqueWallets: result.snapshot.uniqueWallets,
        fromBlock: result.snapshot.fromBlock,
        toBlock: result.snapshot.toBlock,
        failedChunks: result.snapshot.failedChunks.length,
        warnings: result.snapshot.warnings.length,
      },
    }, null, 2));
    return;
  }
  if (mode === "validate") {
    console.log(JSON.stringify(await validateLatest(), null, 2));
    return;
  }
  if (mode === "export") {
    console.log(JSON.stringify(await exportLatest(), null, 2));
    return;
  }
  throw new Error(`Unsupported mode ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
