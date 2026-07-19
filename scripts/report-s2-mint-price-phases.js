#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const DEFAULT_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const DEFAULT_START_BLOCK = 87616887;
const DEFAULT_TARGET_PRICES = ["450", "550"];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

function arg(name, fallback = "") {
  const prefix = `${name}=`;
  const exact = process.argv.indexOf(name);
  if (exact >= 0 && process.argv[exact + 1]) return process.argv[exact + 1];
  const inline = process.argv.find((item) => item.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows, headers) {
  const content = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, `${content}\n`);
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function formatMon(wei) {
  const formatted = ethers.formatEther(wei);
  return formatted.includes(".") ? formatted.replace(/0+$/, "").replace(/\.$/, "") : formatted;
}

async function getLogsChunked(provider, filter, fromBlock, toBlock, chunkSize) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    try {
      const chunk = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      logs.push(...chunk);
      process.stdout.write(`\rScanned blocks ${start}-${end}; mint logs ${logs.length}`);
    } catch (error) {
      if (chunkSize <= 25) throw error;
      const smaller = Math.max(25, Math.floor(chunkSize / 2));
      console.log(`\nRPC rejected ${start}-${end}; retrying with chunk ${smaller}`);
      logs.push(...await getLogsChunked(provider, filter, start, end, smaller));
    }
  }
  process.stdout.write("\n");
  return logs;
}

async function getAlchemyMintTransfers(provider, contractAddress, fromBlock, toBlock) {
  const transfers = [];
  let pageKey = "";
  do {
    const params = {
      fromBlock: ethers.toQuantity(fromBlock),
      toBlock: toBlock === "latest" ? "latest" : ethers.toQuantity(toBlock),
      fromAddress: ethers.ZeroAddress,
      contractAddresses: [contractAddress],
      category: ["erc721"],
      withMetadata: false,
      excludeZeroValue: false,
      maxCount: "0x3e8",
    };
    if (pageKey) params.pageKey = pageKey;
    const result = await provider.send("alchemy_getAssetTransfers", [params]);
    const page = Array.isArray(result?.transfers) ? result.transfers : [];
    transfers.push(...page.map((transfer) => ({
      txHash: transfer.hash,
      blockNumber: Number.parseInt(String(transfer.blockNum), 16),
      recipient: ethers.getAddress(transfer.to),
      tokenId: BigInt(transfer.erc721TokenId || transfer.tokenId).toString(),
    })));
    pageKey = result?.pageKey || "";
    process.stdout.write(`\rFetched Alchemy transfer page; mint transfers ${transfers.length}`);
  } while (pageKey);
  process.stdout.write("\n");
  return transfers;
}

async function getRawLogMintTransfers(provider, contractAddress, fromBlock, toBlock, chunkSize) {
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const zeroTopic = ethers.zeroPadValue(ethers.ZeroAddress, 32);
  const filter = {
    address: contractAddress,
    topics: [transferTopic, zeroTopic],
  };
  const logs = await getLogsChunked(provider, filter, fromBlock, toBlock, chunkSize);
  return logs.map((log) => ({
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    recipient: ethers.getAddress(`0x${log.topics[2].slice(26)}`),
    tokenId: BigInt(log.topics[3]).toString(),
  }));
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, fn, attempts = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error?.shortMessage || error?.message || "";
      const retryable = /429|rate|throughput|timeout|temporar|server|coalesce/i.test(message);
      if (!retryable || attempt === attempts) break;
      await sleep(500 * attempt * attempt);
    }
  }
  throw Object.assign(new Error(`${label} failed: ${lastError?.shortMessage || lastError?.message || lastError}`), { cause: lastError });
}

function summarizeWallets(rows) {
  const byWallet = new Map();
  for (const row of rows) {
    const current = byWallet.get(row.wallet) || {
      wallet: row.wallet,
      quantity: 0,
      txCount: 0,
      tokenIds: [],
      txHashes: [],
    };
    current.quantity += row.quantity;
    current.txCount += 1;
    current.tokenIds.push(...row.tokenIds);
    current.txHashes.push(row.txHash);
    byWallet.set(row.wallet, current);
  }
  return [...byWallet.values()].sort((a, b) => b.quantity - a.quantity || a.wallet.localeCompare(b.wallet));
}

async function main() {
  const rpcUrl = arg("--rpc", env("ALCHEMY_MONAD_RPC_URL", "MONAD_MAINNET_RPC_URL", "MONAD_RPC_URL", "DYOOR_S2_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL"));
  if (!rpcUrl) throw new Error("Missing RPC URL. Set ALCHEMY_MONAD_RPC_URL or MONAD_RPC_URL.");

  const contractAddress = ethers.getAddress(arg("--contract", env("DYOOR_S2_CONTRACT_ADDRESS", "NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS") || DEFAULT_CONTRACT));
  const fromBlock = parseInteger(arg("--from", env("NEXT_PUBLIC_DYOOR_S2_START_BLOCK") || DEFAULT_START_BLOCK), DEFAULT_START_BLOCK);
  const outDir = arg("--out-dir", "data/reports");
  const chunkSize = parseInteger(arg("--chunk", env("NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE") || 1000), 1000);
  const concurrency = Math.max(1, parseInteger(arg("--concurrency", 3), 3));
  const targetPrices = arg("--prices", DEFAULT_TARGET_PRICES.join(","))
    .split(",")
    .map((price) => price.trim())
    .filter(Boolean);
  const targetPriceWei = new Map(targetPrices.map((price) => [ethers.parseEther(price).toString(), price]));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const latest = await provider.getBlockNumber();
  const toBlock = parseInteger(arg("--to", latest), latest);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 143) throw new Error(`Expected Monad mainnet chain 143; got ${network.chainId}.`);

  let mintTransfers = [];
  let transferSource = "alchemy_getAssetTransfers";
  try {
    mintTransfers = await getAlchemyMintTransfers(provider, contractAddress, fromBlock, toBlock);
  } catch (error) {
    transferSource = "eth_getLogs";
    console.log(`Alchemy transfer lookup unavailable; falling back to raw logs: ${error?.shortMessage || error?.message || error}`);
    mintTransfers = await getRawLogMintTransfers(provider, contractAddress, fromBlock, toBlock, chunkSize);
  }

  const byTx = new Map();
  for (const transfer of mintTransfers) {
    const entry = byTx.get(transfer.txHash) || {
      txHash: transfer.txHash,
      blockNumber: transfer.blockNumber,
      recipients: new Map(),
      tokenIds: [],
      quantity: 0,
    };
    const recipientEntry = entry.recipients.get(transfer.recipient) || { wallet: transfer.recipient, tokenIds: [], quantity: 0 };
    recipientEntry.tokenIds.push(transfer.tokenId);
    recipientEntry.quantity += 1;
    entry.recipients.set(transfer.recipient, recipientEntry);
    entry.tokenIds.push(transfer.tokenId);
    entry.quantity += 1;
    byTx.set(transfer.txHash, entry);
  }

  const txGroups = [...byTx.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.txHash.localeCompare(b.txHash));
  const blockCache = new Map();
  const txData = await mapLimit(txGroups, concurrency, async (group) => {
    const blockPromise = blockCache.get(group.blockNumber) || withRetry(`getBlock ${group.blockNumber}`, () => provider.getBlock(group.blockNumber));
    blockCache.set(group.blockNumber, blockPromise);
    const [transaction, block] = await Promise.all([
      withRetry(`getTransaction ${group.txHash}`, () => provider.getTransaction(group.txHash)),
      blockPromise,
    ]);
    const valueWei = transaction?.value || 0n;
    const unitWei = group.quantity > 0 && valueWei % BigInt(group.quantity) === 0n
      ? valueWei / BigInt(group.quantity)
      : null;
    const unitPriceMon = unitWei === null ? "" : formatMon(unitWei);
    const targetPrice = unitWei === null ? "" : targetPriceWei.get(unitWei.toString()) || "";
    return {
      ...group,
      txFrom: transaction?.from ? ethers.getAddress(transaction.from) : "",
      valueWei,
      totalValueMon: formatMon(valueWei),
      unitWei,
      unitPriceMon,
      targetPrice,
      timestamp: block?.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : "",
    };
  });

  const priceBuckets = new Map();
  const targetRows = Object.fromEntries(targetPrices.map((price) => [price, []]));

  for (const tx of txData) {
    const priceKey = tx.unitPriceMon || "non-divisible";
    const bucket = priceBuckets.get(priceKey) || {
      unitPriceMon: priceKey,
      txCount: 0,
      quantity: 0,
      totalValueMon: "0",
      wallets: new Set(),
    };
    bucket.txCount += 1;
    bucket.quantity += tx.quantity;
    bucket.totalValueMon = formatMon(ethers.parseEther(bucket.totalValueMon) + tx.valueWei);
    for (const recipient of tx.recipients.values()) bucket.wallets.add(recipient.wallet);
    priceBuckets.set(priceKey, bucket);

    if (!tx.targetPrice) continue;
    for (const recipient of tx.recipients.values()) {
      targetRows[tx.targetPrice].push({
        priceMon: tx.targetPrice,
        txHash: tx.txHash,
        blockNumber: tx.blockNumber,
        timestamp: tx.timestamp,
        txFrom: tx.txFrom,
        wallet: recipient.wallet,
        quantity: recipient.quantity,
        tokenIds: recipient.tokenIds,
        totalValueMON: tx.totalValueMon,
        unitPriceMON: tx.unitPriceMon,
      });
    }
  }

  const buckets = [...priceBuckets.values()]
    .map((bucket) => ({ ...bucket, wallets: bucket.wallets.size }))
    .sort((a, b) => Number(a.unitPriceMon) - Number(b.unitPriceMon));

  fs.mkdirSync(outDir, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const report = {
    generatedAt: new Date().toISOString(),
    chainId: Number(network.chainId),
    contractAddress,
    fromBlock,
    toBlock,
    transferSource,
    mintTransferLogs: mintTransfers.length,
    mintTransactions: txData.length,
    priceBuckets: buckets,
    targetPrices: {},
  };

  for (const price of targetPrices) {
    const rows = targetRows[price] || [];
    const wallets = summarizeWallets(rows);
    report.targetPrices[price] = {
      walletCount: wallets.length,
      mintedQuantity: wallets.reduce((sum, row) => sum + row.quantity, 0),
      txCount: rows.length,
      walletCsv: path.join(outDir, `s2-mints-${price}-mon-wallets-${dateStamp}.csv`),
      transactionCsv: path.join(outDir, `s2-mints-${price}-mon-transactions-${dateStamp}.csv`),
    };
    writeCsv(report.targetPrices[price].walletCsv, wallets, ["wallet", "quantity", "txCount", "tokenIds", "txHashes"]);
    writeCsv(report.targetPrices[price].transactionCsv, rows, ["priceMon", "txHash", "blockNumber", "timestamp", "txFrom", "wallet", "quantity", "tokenIds", "totalValueMON", "unitPriceMON"]);
  }

  const reportPath = path.join(outDir, `s2-mint-price-phase-report-${dateStamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);

  console.log(JSON.stringify({
    reportPath,
    targetPrices: report.targetPrices,
    priceBuckets: report.priceBuckets,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
