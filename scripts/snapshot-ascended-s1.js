import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";

loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

const CHAIN_ID = 143n;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_S1_CONTRACT = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const DEFAULT_STAKING_CONTRACT = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_MAX_TOKEN_ID = 1111;
const DEFAULT_START_BLOCK = 54_985_442;
const DEFAULT_LOG_CHUNK_SIZE = 250_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_LOG_TIMEOUT_MS = 15_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ERC721_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const STAKING_ABI = [
  "function stakeInfo(uint256 tokenId) view returns (address owner,uint64 stakedAt)",
];

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function readNumber(value, fallback) {
  const parsed = Number(String(value || "").trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAddress(value) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function compareTokenIds(a, b) {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestampForFile(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.map((column) => csvEscape(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(",")),
  ].join("\n") + "\n";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function errorText(error) {
  return String(error?.shortMessage || error?.reason || error?.message || error?.error?.message || error || "");
}

function isAlchemyRpc(rpcUrl) {
  return /alchemy\.com/i.test(String(rpcUrl || ""));
}

async function retry(label, task, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const text = errorText(error);
      const rateLimited = /rate|limit|429|timeout|timed out|server error|bad response/i.test(text);
      await sleep(rateLimited ? 1000 * attempt : 250 * attempt);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${errorText(lastError)}`);
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await task(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return results;
}

async function getLogsWithSplit(provider, filter, fromBlock, toBlock) {
  try {
    const timeoutMs = readNumber(readEnv("ASCENSION_LOG_TIMEOUT_MS", "ASCENSION_SNAPSHOT_RPC_TIMEOUT_MS"), DEFAULT_LOG_TIMEOUT_MS);
    return await retry(
      `getLogs ${fromBlock}-${toBlock}`,
      () => withTimeout(provider.getLogs({ ...filter, fromBlock, toBlock }), timeoutMs, `getLogs ${fromBlock}-${toBlock}`),
      3
    );
  } catch (error) {
    if (fromBlock >= toBlock) throw error;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsWithSplit(provider, filter, fromBlock, mid);
    const right = await getLogsWithSplit(provider, filter, mid + 1, toBlock);
    return left.concat(right);
  }
}

async function scanTransferEvidence(provider, nftAddress, stakingAddress, startBlock, latestBlock, chunkSize) {
  const iface = new ethers.Interface(ERC721_ABI);
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const stakingTopic = ethers.zeroPadValue(ethers.getAddress(stakingAddress), 32);
  const depositsByToken = new Map();
  let logsScanned = 0;

  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
    const logs = await getLogsWithSplit(provider, {
      address: nftAddress,
      topics: [transferTopic, null, stakingTopic],
    }, fromBlock, toBlock);

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const tokenId = parsed.args.tokenId.toString();
      const from = normalizeAddress(parsed.args.from);
      depositsByToken.set(tokenId, {
        tokenId,
        fallbackWallet: from,
        depositTxHash: String(log.transactionHash || "").toLowerCase(),
        depositBlock: Number(log.blockNumber || 0),
      });
      logsScanned += 1;
    }

    console.log(`transfer logs ${fromBlock}-${toBlock}: ${logs.length}`);
  }

  return { depositsByToken, logsScanned };
}

async function scanAlchemyTransferEvidence(rpcUrl, nftAddress, stakingAddress, startBlock) {
  const depositsByToken = new Map();
  let pageKey = "";
  let requestCount = 0;
  let transferCount = 0;

  do {
    const params = {
      fromBlock: ethers.toQuantity(startBlock),
      toBlock: "latest",
      toAddress: stakingAddress,
      contractAddresses: [nftAddress],
      category: ["erc721"],
      withMetadata: false,
      excludeZeroValue: false,
      maxCount: "0x3e8",
      order: "asc",
    };
    if (pageKey) params.pageKey = pageKey;

    const response = await retry("alchemy_getAssetTransfers", async () => {
      const result = await withTimeout(fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [params],
        }),
      }), DEFAULT_LOG_TIMEOUT_MS, "alchemy_getAssetTransfers");
      const json = await result.json();
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      return json.result || {};
    }, 4);

    requestCount += 1;
    const transfers = Array.isArray(response.transfers) ? response.transfers : [];
    transferCount += transfers.length;

    for (const transfer of transfers) {
      const tokenHex = transfer.tokenId || transfer.erc721TokenId;
      if (!tokenHex) continue;
      const tokenId = BigInt(tokenHex).toString();
      const fallbackWallet = normalizeAddress(transfer.from);
      if (!fallbackWallet) continue;
      depositsByToken.set(tokenId, {
        tokenId,
        fallbackWallet,
        depositTxHash: String(transfer.hash || "").toLowerCase(),
        depositBlock: transfer.blockNum ? Number(BigInt(transfer.blockNum)) : 0,
      });
    }

    pageKey = String(response.pageKey || "");
    console.log(`alchemy transfers page ${requestCount}: ${transfers.length}`);
  } while (pageKey);

  return {
    depositsByToken,
    logsScanned: transferCount,
    requestCount,
  };
}

function groupTokens(tokenRows) {
  const byWallet = new Map();
  for (const token of tokenRows) {
    if (!token.wallet) continue;
    const existing = byWallet.get(token.wallet) || {
      wallet: token.wallet,
      stakedCount: 0,
      tokenIds: [],
      firstStakedAt: "",
      latestStakedAt: "",
      validationStatus: "verified",
      dataSources: new Set(),
    };
    existing.tokenIds.push(token.tokenId);
    existing.stakedCount += 1;
    existing.dataSources.add(token.source);
    if (token.validationStatus !== "verified") existing.validationStatus = "warning";
    if (token.stakedAt) {
      if (!existing.firstStakedAt || token.stakedAt < existing.firstStakedAt) existing.firstStakedAt = token.stakedAt;
      if (!existing.latestStakedAt || token.stakedAt > existing.latestStakedAt) existing.latestStakedAt = token.stakedAt;
    }
    byWallet.set(token.wallet, existing);
  }

  return Array.from(byWallet.values())
    .map((row) => ({
      wallet: row.wallet,
      stakedCount: row.stakedCount,
      tokenIds: row.tokenIds.sort(compareTokenIds),
      firstStakedAt: row.firstStakedAt,
      latestStakedAt: row.latestStakedAt,
      dataSource: Array.from(row.dataSources).sort().join("+"),
      validationStatus: row.validationStatus,
    }))
    .sort((a, b) => b.stakedCount - a.stakedCount || a.wallet.localeCompare(b.wallet));
}

async function main() {
  const rpcUrl = argValue("rpc", readEnv("ALCHEMY_MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "MONAD_RPC_URL", "RPC_URL") || DEFAULT_RPC);
  const nftAddress = ethers.getAddress(argValue("nft", readEnv("DYOOR_S1_CONTRACT", "DYOOR_S1_NFT_ADDRESS", "NEXT_PUBLIC_DYOOR_S1_CONTRACT") || DEFAULT_S1_CONTRACT));
  const stakingAddress = ethers.getAddress(argValue("staking", readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_STAKING_CONTRACT));
  const maxTokenId = readNumber(argValue("max-token-id", readEnv("DYOOR_S1_MAX_SUPPLY", "NEXT_PUBLIC_DYOOR_S1_MAX_SUPPLY")), DEFAULT_MAX_TOKEN_ID);
  const startBlock = readNumber(argValue("start-block", readEnv("ASCENSION_START_BLOCK", "NEXT_PUBLIC_DYOOR_S1_START_BLOCK")), DEFAULT_START_BLOCK);
  const logChunkSize = readNumber(argValue("log-chunk-size", readEnv("ASCENSION_LOG_CHUNK_SIZE")), DEFAULT_LOG_CHUNK_SIZE);
  const concurrency = readNumber(argValue("concurrency", readEnv("ASCENSION_SNAPSHOT_OWNER_SCAN_CONCURRENCY")), DEFAULT_CONCURRENCY);
  const outDir = argValue("out-dir", "data/snapshots");
  const useTransferFallback = !hasFlag("skip-transfer-fallback");
  const useRawLogFallback = hasFlag("with-transfer-fallback") || hasFlag("preload-transfer-logs");
  const preloadTransferLogs = hasFlag("preload-transfer-logs");

  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID));
  const network = await retry("network check", () => provider.getNetwork(), 3);
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Wrong RPC network. Expected chain ${CHAIN_ID.toString()}, got ${network.chainId.toString()}.`);
  }

  const nft = new ethers.Contract(nftAddress, ERC721_ABI, provider);
  const staking = new ethers.Contract(stakingAddress, STAKING_ABI, provider);
  const latestBlock = await retry("latest block", () => provider.getBlockNumber(), 4);
  const stakingContractBalance = Number(await retry("S1 balanceOf staking contract", () => nft.balanceOf(stakingAddress), 4));

  console.log("DYOOR Ascended S1 snapshot");
  console.log("RPC:", rpcUrl.replace(/\/v2\/.+$/, "/v2/***"));
  console.log("S1:", nftAddress);
  console.log("Staking:", stakingAddress);
  console.log("Max token ID:", maxTokenId);
  console.log("S1 balanceOf(staking):", stakingContractBalance);
  console.log("Latest block:", latestBlock);
  console.log("");

  const tokenIds = Array.from({ length: maxTokenId }, (_, index) => String(index + 1));
  const ownerFailures = [];
  const stakedTokenIds = [];

  await mapWithConcurrency(tokenIds, concurrency, async (tokenId, index) => {
    try {
      const owner = normalizeAddress(await retry(`ownerOf #${tokenId}`, () => nft.ownerOf(BigInt(tokenId)), 4));
      if (owner === normalizeAddress(stakingAddress)) stakedTokenIds.push(tokenId);
    } catch (error) {
      ownerFailures.push({ tokenId, error: errorText(error) });
    }

    if ((index + 1) % 50 === 0 || index + 1 === tokenIds.length) {
      console.log(`ownerOf scan ${index + 1}/${tokenIds.length}; staked found ${stakedTokenIds.length}/${stakingContractBalance}`);
    }
  });

  stakedTokenIds.sort(compareTokenIds);

  let depositsByToken = new Map();
  let transferLogsScanned = 0;
  if (preloadTransferLogs) {
    console.log("");
    console.log("Preloading all Transfer evidence into staking contract...");
    const evidence = await scanTransferEvidence(provider, nftAddress, stakingAddress, startBlock, latestBlock, logChunkSize);
    depositsByToken = evidence.depositsByToken;
    transferLogsScanned = evidence.logsScanned;
  }

  console.log("");
  console.log("Reading stakeInfo for staked tokens...");
  const stakeInfoFailures = [];
  const tokenRows = await mapWithConcurrency(stakedTokenIds, concurrency, async (tokenId, index) => {
    const transferEvidence = depositsByToken.get(tokenId);
    let wallet = "";
    let stakedAtRaw = "";
    let stakedAt = "";
    let source = "stakeInfo";
    let validationStatus = "verified";
    let validationNotes = "";

    try {
      const info = await retry(`stakeInfo #${tokenId}`, () => staking.stakeInfo(BigInt(tokenId)), 4);
      wallet = normalizeAddress(info?.owner ?? info?.[0]);
      stakedAtRaw = String(info?.stakedAt ?? info?.[1] ?? "");
      if (stakedAtRaw && stakedAtRaw !== "0") stakedAt = new Date(Number(stakedAtRaw) * 1000).toISOString();
    } catch (error) {
      stakeInfoFailures.push({ tokenId, error: errorText(error) });
    }

    if (!wallet || wallet === ZERO_ADDRESS) {
      wallet = transferEvidence?.fallbackWallet || "";
      source = wallet ? "transfer-log-fallback" : "unresolved";
      validationStatus = "warning";
      validationNotes = wallet
        ? "stakeInfo did not return a wallet; using latest Transfer into staking contract."
        : "stakeInfo did not return a wallet and no Transfer fallback was found.";
    }

    if (transferEvidence?.fallbackWallet && wallet && transferEvidence.fallbackWallet !== wallet) {
      validationStatus = "warning";
      validationNotes = validationNotes
        ? `${validationNotes} Transfer sender differs from stakeInfo wallet.`
        : "Transfer sender differs from stakeInfo wallet.";
    }

    if ((index + 1) % 50 === 0 || index + 1 === stakedTokenIds.length) {
      console.log(`stakeInfo ${index + 1}/${stakedTokenIds.length}`);
    }

    return {
      tokenId,
      wallet,
      stakedAtRaw,
      stakedAt,
      source,
      validationStatus,
      validationNotes,
      depositTxHash: transferEvidence?.depositTxHash || "",
      depositBlock: transferEvidence?.depositBlock || "",
    };
  });

  const warnings = [];
  const unresolvedBeforeFallback = tokenRows.filter((row) => !row.wallet);
  if (useTransferFallback && unresolvedBeforeFallback.length && !depositsByToken.size && isAlchemyRpc(rpcUrl)) {
    console.log("");
    console.log(`Resolving ${unresolvedBeforeFallback.length} token(s) with Alchemy indexed transfer fallback...`);
    const evidence = await scanAlchemyTransferEvidence(rpcUrl, nftAddress, stakingAddress, startBlock).catch((error) => {
      warnings.push(`Alchemy transfer fallback failed: ${errorText(error)}`);
      return null;
    });
    if (evidence) {
      depositsByToken = evidence.depositsByToken;
      transferLogsScanned = evidence.logsScanned;
    }
  }

  if (useRawLogFallback && unresolvedBeforeFallback.length && !depositsByToken.size) {
    console.log("");
    console.log(`Scanning Transfer logs once to resolve ${unresolvedBeforeFallback.length} token(s) missing stakeInfo wallets...`);
    const evidence = await scanTransferEvidence(provider, nftAddress, stakingAddress, startBlock, latestBlock, logChunkSize);
    depositsByToken = evidence.depositsByToken;
    transferLogsScanned = evidence.logsScanned;
  }

  if (useTransferFallback && unresolvedBeforeFallback.length) {
    let resolved = 0;
    for (const row of unresolvedBeforeFallback) {
      const transferEvidence = depositsByToken.get(row.tokenId);
      if (transferEvidence?.fallbackWallet) {
        row.wallet = transferEvidence.fallbackWallet;
        row.source = "transfer-log-fallback";
        row.validationStatus = "verified";
        row.validationNotes = "stakeInfo did not return a wallet; latest Transfer into staking contract was used.";
        row.depositTxHash = transferEvidence.depositTxHash;
        row.depositBlock = transferEvidence.depositBlock;
        resolved += 1;
      }
    }
    console.log(`Transfer-log fallback resolved ${resolved}/${unresolvedBeforeFallback.length} token(s).`);
  }

  const walletRows = groupTokens(tokenRows);
  const unresolvedAfterFallback = tokenRows.filter((row) => !row.wallet);
  if (ownerFailures.length) warnings.push(`${ownerFailures.length} ownerOf read(s) failed.`);
  if (stakeInfoFailures.length && unresolvedAfterFallback.length) warnings.push(`${stakeInfoFailures.length} stakeInfo read(s) failed.`);
  if (stakedTokenIds.length !== stakingContractBalance) {
    warnings.push(`ownerOf found ${stakedTokenIds.length} staked token(s), but balanceOf(staking) reports ${stakingContractBalance}.`);
  }
  if (unresolvedAfterFallback.length) warnings.push(`${unresolvedAfterFallback.length} staked token ID(s) could not be assigned to a wallet.`);

  const verified = warnings.length === 0;
  const generatedAt = new Date().toISOString();
  const stamp = timestampForFile(new Date(generatedAt));
  const walletCsvPath = path.join(outDir, `ascended-s1-wallets-${stamp}.csv`);
  const tokenCsvPath = path.join(outDir, `ascended-s1-tokens-${stamp}.csv`);
  const jsonPath = path.join(outDir, `ascended-s1-snapshot-${stamp}.json`);

  fs.mkdirSync(outDir, { recursive: true });

  const walletCsv = toCsv(walletRows, [
    { key: "wallet", label: "wallet" },
    { key: "stakedCount", label: "staked_count" },
    { key: "tokenIds", label: "token_ids" },
    { key: "firstStakedAt", label: "first_staked_at" },
    { key: "latestStakedAt", label: "latest_staked_at" },
    { key: "dataSource", label: "data_source" },
    { key: "validationStatus", label: "validation_status" },
  ]);

  const tokenCsv = toCsv(tokenRows.sort((a, b) => compareTokenIds(a.tokenId, b.tokenId)), [
    { key: "tokenId", label: "token_id" },
    { key: "wallet", label: "wallet" },
    { key: "stakedAt", label: "staked_at" },
    { key: "source", label: "data_source" },
    { key: "depositTxHash", label: "deposit_tx_hash" },
    { key: "depositBlock", label: "deposit_block" },
    { key: "validationStatus", label: "validation_status" },
    { key: "validationNotes", label: "validation_notes" },
  ]);

  fs.writeFileSync(walletCsvPath, walletCsv, "utf8");
  fs.writeFileSync(tokenCsvPath, tokenCsv, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt,
    verified,
    chainId: Number(CHAIN_ID),
    latestBlock,
    nftContract: nftAddress,
    stakingContract: stakingAddress,
    maxTokenId,
    startBlock,
    stakingContractBalance,
    stakedTokenCount: stakedTokenIds.length,
    walletCount: walletRows.length,
    transferLogsScanned,
    warnings,
    ownerFailures,
    stakeInfoFailures,
    wallets: walletRows,
    tokens: tokenRows.sort((a, b) => compareTokenIds(a.tokenId, b.tokenId)),
  }, null, 2) + "\n", "utf8");

  console.log("");
  console.log("Snapshot complete");
  console.log("Verified:", verified ? "yes" : "no");
  console.log("Wallets:", walletRows.length);
  console.log("Staked tokens:", stakedTokenIds.length);
  console.log("S1 balanceOf(staking):", stakingContractBalance);
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  console.log("Wallet CSV:", walletCsvPath);
  console.log("Token CSV:", tokenCsvPath);
  console.log("JSON:", jsonPath);

  if (!verified && !hasFlag("allow-unverified")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
