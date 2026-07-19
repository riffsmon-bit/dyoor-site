#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const DEFAULT_CONTRACT = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const DEFAULT_START_BLOCK = 87616887;
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function csvSplit(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readWalletCsv(filePath, priceMon) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const headers = csvSplit(lines.shift() || "");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = csvSplit(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const wallet = ethers.getAddress(row.wallet);
    const tokenIds = String(row.tokenIds || "").split(/\s+/).filter(Boolean);
    rows.push({
      priceMon,
      wallet,
      quantity: Number(row.quantity || tokenIds.length || 0),
      tokenIds,
      txHashes: String(row.txHashes || "").split(/\s+/).filter(Boolean),
    });
  }
  return rows;
}

async function getAlchemyTransfers(provider, contractAddress, fromBlock, toBlock) {
  const transfers = [];
  let pageKey = "";
  do {
    const params = {
      fromBlock: ethers.toQuantity(fromBlock),
      toBlock: toBlock === "latest" ? "latest" : ethers.toQuantity(toBlock),
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
      from: ethers.getAddress(transfer.from),
      to: ethers.getAddress(transfer.to),
      tokenId: BigInt(transfer.erc721TokenId || transfer.tokenId).toString(),
    })));
    pageKey = result?.pageKey || "";
    process.stdout.write(`\rFetched transfer page; transfers ${transfers.length}`);
  } while (pageKey);
  process.stdout.write("\n");
  return transfers;
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
      if (!/429|rate|throughput|timeout|temporar|server|coalesce/i.test(message) || attempt === attempts) break;
      await sleep(500 * attempt * attempt);
    }
  }
  throw Object.assign(new Error(`${label} failed: ${lastError?.shortMessage || lastError?.message || lastError}`), { cause: lastError });
}

function topicAddress(topic) {
  try {
    return ethers.getAddress(`0x${String(topic).slice(26)}`);
  } catch {
    return "";
  }
}

function parseErc20PaymentsToSeller(receipt, nftContract, seller) {
  const payments = [];
  for (const log of receipt.logs || []) {
    if (String(log.address).toLowerCase() === nftContract.toLowerCase()) continue;
    if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    if (topicAddress(log.topics[2]).toLowerCase() !== seller.toLowerCase()) continue;
    const value = BigInt(log.data || "0x0");
    if (value <= 0n) continue;
    payments.push({
      token: ethers.getAddress(log.address),
      from: topicAddress(log.topics[1]),
      to: topicAddress(log.topics[2]),
      amountRaw: value.toString(),
      amountFormattedAssuming18: ethers.formatEther(value),
    });
  }
  return payments;
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

async function main() {
  const rpcUrl = arg("--rpc", env("ALCHEMY_MONAD_RPC_URL", "MONAD_MAINNET_RPC_URL", "MONAD_RPC_URL", "DYOOR_S2_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL"));
  if (!rpcUrl) throw new Error("Missing RPC URL. Set ALCHEMY_MONAD_RPC_URL or MONAD_RPC_URL.");
  const contractAddress = ethers.getAddress(arg("--contract", env("DYOOR_S2_CONTRACT_ADDRESS", "NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS") || DEFAULT_CONTRACT));
  const fromBlock = parseInteger(arg("--from", env("NEXT_PUBLIC_DYOOR_S2_START_BLOCK") || DEFAULT_START_BLOCK), DEFAULT_START_BLOCK);
  const outDir = arg("--out-dir", "data/reports");
  const concurrency = Math.max(1, parseInteger(arg("--concurrency", 2), 2));
  const dateStamp = new Date().toISOString().slice(0, 10);

  const default450 = path.join(outDir, `s2-mints-450-mon-wallets-${dateStamp}.csv`);
  const default550 = path.join(outDir, `s2-mints-550-mon-wallets-${dateStamp}.csv`);
  const file450 = arg("--csv-450", default450);
  const file550 = arg("--csv-550", default550);

  const overpayRows = [
    ...readWalletCsv(file450, "450"),
    ...readWalletCsv(file550, "550"),
  ];
  const tokenToMinter = new Map();
  const walletSet = new Set();
  for (const row of overpayRows) {
    walletSet.add(row.wallet.toLowerCase());
    for (const tokenId of row.tokenIds) {
      tokenToMinter.set(tokenId, row);
    }
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 143) throw new Error(`Expected Monad mainnet chain 143; got ${network.chainId}.`);
  const latest = await provider.getBlockNumber();
  const transfers = await getAlchemyTransfers(provider, contractAddress, fromBlock, latest);

  const outgoing = transfers
    .filter((transfer) => tokenToMinter.has(transfer.tokenId))
    .filter((transfer) => transfer.from.toLowerCase() === tokenToMinter.get(transfer.tokenId).wallet.toLowerCase())
    .filter((transfer) => transfer.from.toLowerCase() !== ethers.ZeroAddress.toLowerCase())
    .sort((a, b) => a.blockNumber - b.blockNumber || a.tokenId.localeCompare(b.tokenId));

  const currentOwnerAbi = ["function ownerOf(uint256 tokenId) view returns (address)"];
  const contract = new ethers.Contract(contractAddress, currentOwnerAbi, provider);
  const uniqueTokenIds = [...tokenToMinter.keys()].sort((a, b) => Number(a) - Number(b));
  const owners = await mapLimit(uniqueTokenIds, concurrency, async (tokenId) => {
    const owner = await withRetry(`ownerOf ${tokenId}`, () => contract.ownerOf(tokenId));
    return [tokenId, ethers.getAddress(owner)];
  });
  const ownerMap = new Map(owners);

  const activity = await mapLimit(outgoing, concurrency, async (transfer) => {
    const [transaction, receipt, block] = await Promise.all([
      withRetry(`tx ${transfer.txHash}`, () => provider.getTransaction(transfer.txHash)),
      withRetry(`receipt ${transfer.txHash}`, () => provider.getTransactionReceipt(transfer.txHash)),
      withRetry(`block ${transfer.blockNumber}`, () => provider.getBlock(transfer.blockNumber)),
    ]);
    const erc20PaymentsToSeller = parseErc20PaymentsToSeller(receipt, contractAddress, transfer.from);
    const nativeValue = transaction?.value || 0n;
    const likelySale = nativeValue > 0n || erc20PaymentsToSeller.length > 0;
    return {
      ...transfer,
      priceMon: tokenToMinter.get(transfer.tokenId).priceMon,
      transactionFrom: transaction?.from ? ethers.getAddress(transaction.from) : "",
      transactionTo: transaction?.to ? ethers.getAddress(transaction.to) : "",
      transactionValueMON: ethers.formatEther(nativeValue),
      timestamp: block?.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : "",
      erc20PaymentsToSeller,
      likelySale,
      classification: likelySale ? "likely_sale" : "transfer_or_unknown",
    };
  });

  const walletSummary = new Map();
  for (const row of overpayRows) {
    const current = walletSummary.get(row.wallet) || {
      wallet: row.wallet,
      overpayMintedQuantity: 0,
      overpayTokenIds: [],
      tokensStillHeld: 0,
      tokensMovedOut: 0,
      likelySold: 0,
      transferOrUnknown: 0,
    };
    current.overpayMintedQuantity += row.quantity;
    current.overpayTokenIds.push(...row.tokenIds);
    walletSummary.set(row.wallet, current);
  }
  for (const [tokenId, row] of tokenToMinter) {
    const summary = walletSummary.get(row.wallet);
    if (ownerMap.get(tokenId)?.toLowerCase() === row.wallet.toLowerCase()) summary.tokensStillHeld += 1;
  }
  for (const event of activity) {
    const summary = walletSummary.get(tokenToMinter.get(event.tokenId).wallet);
    summary.tokensMovedOut += 1;
    if (event.likelySale) summary.likelySold += 1;
    else summary.transferOrUnknown += 1;
  }

  const walletRows = [...walletSummary.values()]
    .map((row) => ({
      ...row,
      overpayTokenIds: row.overpayTokenIds.join(" "),
    }))
    .sort((a, b) => b.likelySold - a.likelySold || b.tokensMovedOut - a.tokensMovedOut || a.wallet.localeCompare(b.wallet));

  fs.mkdirSync(outDir, { recursive: true });
  const activityCsv = path.join(outDir, `s2-overpay-secondary-activity-${dateStamp}.csv`);
  const walletCsv = path.join(outDir, `s2-overpay-secondary-wallet-summary-${dateStamp}.csv`);
  const reportPath = path.join(outDir, `s2-overpay-secondary-report-${dateStamp}.json`);

  writeCsv(activityCsv, activity.map((event) => ({
    tokenId: event.tokenId,
    priceMon: event.priceMon,
    from: event.from,
    to: event.to,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    timestamp: event.timestamp,
    classification: event.classification,
    transactionValueMON: event.transactionValueMON,
    erc20PaymentsToSeller: event.erc20PaymentsToSeller.map((payment) => `${payment.token}:${payment.amountFormattedAssuming18}`).join(" "),
    transactionFrom: event.transactionFrom,
    transactionTo: event.transactionTo,
  })), ["tokenId", "priceMon", "from", "to", "txHash", "blockNumber", "timestamp", "classification", "transactionValueMON", "erc20PaymentsToSeller", "transactionFrom", "transactionTo"]);
  writeCsv(walletCsv, walletRows, ["wallet", "overpayMintedQuantity", "tokensStillHeld", "tokensMovedOut", "likelySold", "transferOrUnknown", "overpayTokenIds"]);

  const report = {
    generatedAt: new Date().toISOString(),
    chainId: Number(network.chainId),
    contractAddress,
    fromBlock,
    toBlock: latest,
    overpayWalletCount: walletSet.size,
    overpayTokenCount: uniqueTokenIds.length,
    movedOutTokenCount: activity.length,
    likelySoldTokenCount: activity.filter((event) => event.likelySale).length,
    transferOrUnknownTokenCount: activity.filter((event) => !event.likelySale).length,
    walletSummary: walletRows,
    activity,
    files: { activityCsv, walletCsv },
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
  console.log(JSON.stringify({
    reportPath,
    activityCsv,
    walletCsv,
    overpayWalletCount: report.overpayWalletCount,
    overpayTokenCount: report.overpayTokenCount,
    movedOutTokenCount: report.movedOutTokenCount,
    likelySoldTokenCount: report.likelySoldTokenCount,
    transferOrUnknownTokenCount: report.transferOrUnknownTokenCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
