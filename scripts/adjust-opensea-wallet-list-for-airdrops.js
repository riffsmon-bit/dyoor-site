#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { config } from "dotenv";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

config({ path: ".env.local" });
config({ path: ".env" });

const NFT_ABI = [
  "function totalSupply() view returns (uint256)",
  "function totalSeaDropMinted() view returns (uint256)",
  "function remainingSeaDropSupply() view returns (uint256)",
  "function numberMinted(address wallet) view returns (uint256)",
  "function balanceOf(address wallet) view returns (uint256)",
];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, fn) {
  let lastError;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = [
        error?.message,
        error?.shortMessage,
        error?.info?.error?.message,
        error?.error?.message,
      ].filter(Boolean).join(" ");
      const retryable = /request limit|rate|429|too many|timeout|network/i.test(message);
      if (!retryable || attempt === 6) break;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`${label} failed: ${lastError?.shortMessage || lastError?.message || String(lastError)}`);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  if (quoted) throw new Error(`Malformed quoted CSV row: ${line}`);
  return values;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function parsePositiveWholeNumber(value, context) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${context} must be a positive whole number; got "${raw}".`);
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw new Error(`${context} must be greater than zero.`);
  return parsed;
}

function findColumn(headers, patterns, fallbackIndex = -1) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  for (const pattern of patterns) {
    const index = normalized.findIndex((header) => pattern.test(header));
    if (index >= 0) return index;
  }
  return fallbackIndex;
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

async function main() {
  const input = arg("--input");
  const outputDir = arg("--output-dir", "wallet-list-exports/opensea");
  const output = arg("--output", input ? join(outputDir, `${basename(input, ".csv")}-adjusted-for-airdrops.csv`) : "");
  const reportPath = arg("--report", input ? join(outputDir, `${basename(input, ".csv")}-adjusted-for-airdrops-report.json`) : "");
  const defaultLimitRaw = arg("--default-limit", "");
  const defaultPrice = arg("--default-price", "");
  const concurrency = Number(arg("--concurrency", env("OPENSEA_ADJUST_CONCURRENCY", "4")));
  const dedupeDuplicates = hasFlag("--dedupe-duplicates");
  const includeBalance = hasFlag("--include-balance");
  const openseaUploadFormat = hasFlag("--opensea-upload-format");
  const rpcUrl = env("MONAD_MAINNET_RPC_URL", env("MONAD_RPC_URL", env("NEXT_PUBLIC_MONAD_RPC_URL", "")));
  const deploymentPath = arg("--deployment", "deployments/dyoor-s2-seadrop-mainnet.latest.json");
  const deployment = existsSync(deploymentPath) ? JSON.parse(readFileSync(deploymentPath, "utf8")) : {};
  const contractAddress = getAddress(arg("--contract", deployment.contractAddress || env("DYOOR_S2_MAINNET_CONTRACT_ADDRESS", "")));

  if (!input) throw new Error("--input is required.");
  if (!existsSync(input)) throw new Error(`Input CSV not found: ${input}`);
  if (!rpcUrl) throw new Error("MONAD_MAINNET_RPC_URL, MONAD_RPC_URL, or NEXT_PUBLIC_MONAD_RPC_URL is required.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error("--concurrency must be an integer from 1 to 64.");
  }

  const contents = readFileSync(input, "utf8").replace(/^\uFEFF/, "");
  const lines = contents.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must include a header and at least one wallet row.");

  const headers = parseCsvLine(lines[0]);
  const walletIndex = findColumn(headers, [/^wallet address$/, /^wallet$/, /^address$/], 0);
  const limitIndex = findColumn(headers, [/custom mint limit/, /maxmintable/, /^limit$/, /^quantity$/]);
  const priceIndex = findColumn(headers, [/custom price/, /^price$/]);
  if (walletIndex < 0) throw new Error("Could not identify wallet column.");
  if (limitIndex < 0 && !defaultLimitRaw) {
    throw new Error("Could not identify mint-limit column. Pass --default-limit if the CSV has no limit column.");
  }
  const defaultLimit = defaultLimitRaw ? parsePositiveWholeNumber(defaultLimitRaw, "--default-limit") : null;

  const parsedRows = lines.slice(1).map((line, index) => {
    const columns = parseCsvLine(line);
    const wallet = getAddress(columns[walletIndex]);
    const desiredAdditional = limitIndex >= 0
      ? parsePositiveWholeNumber(columns[limitIndex], `Limit on line ${index + 2}`)
      : defaultLimit;
    return {
      lineNumber: index + 2,
      columns,
      wallet,
      desiredAdditional,
      originalLimit: limitIndex >= 0 ? String(columns[limitIndex] ?? "").trim() : "",
      originalPrice: priceIndex >= 0 ? String(columns[priceIndex] ?? "").trim() : "",
    };
  });

  const seen = new Map();
  const duplicateRows = [];
  const rows = [];
  for (const row of parsedRows) {
    const key = row.wallet.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, row);
      rows.push(row);
      continue;
    }
    duplicateRows.push({
      wallet: row.wallet,
      keptLine: existing.lineNumber,
      duplicateLine: row.lineNumber,
      keptLimit: existing.desiredAdditional.toString(),
      duplicateLimit: row.desiredAdditional.toString(),
    });
    if (!dedupeDuplicates) throw new Error(`Duplicate wallet row: ${row.wallet}`);
    if (row.desiredAdditional > existing.desiredAdditional) {
      existing.desiredAdditional = row.desiredAdditional;
      existing.originalLimit = row.originalLimit;
      if (limitIndex >= 0) existing.columns[limitIndex] = row.originalLimit;
    }
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== 143n) throw new Error(`Expected Monad mainnet chain 143; got ${network.chainId}.`);
  const contract = new Contract(contractAddress, NFT_ABI, provider);
  const [currentTotalSupply, totalSeaDropMinted, remainingSeaDropSupply] = await Promise.all([
    withRetry("totalSupply", () => contract.totalSupply()),
    withRetry("totalSeaDropMinted", () => contract.totalSeaDropMinted()),
    withRetry("remainingSeaDropSupply", () => contract.remainingSeaDropSupply()),
  ]);

  const adjusted = await mapLimit(rows, concurrency, async (row) => {
    const numberMinted = await withRetry(`numberMinted(${row.wallet})`, () => contract.numberMinted(row.wallet));
    const balance = includeBalance
      ? await withRetry(`balanceOf(${row.wallet})`, () => contract.balanceOf(row.wallet))
      : null;
    const uploadLimit = numberMinted + row.desiredAdditional;
    return {
      ...row,
      numberMinted,
      balance,
      uploadLimit,
    };
  });

  const outputLines = openseaUploadFormat
    ? [
        "Wallet address,Custom mint limit (optional),Custom price in native token e.g. ETH (optional)",
        ...adjusted.map((row) => [row.wallet, row.uploadLimit.toString(), defaultPrice || row.originalPrice]
          .map(csvEscape)
          .join(",")),
        "",
      ]
    : [
        headers.map(csvEscape).join(","),
        ...adjusted.map((row) => {
          const columns = [...row.columns];
          columns[walletIndex] = row.wallet;
          if (limitIndex >= 0) columns[limitIndex] = row.uploadLimit.toString();
          if (priceIndex >= 0) columns[priceIndex] = row.originalPrice;
          return headers.map((_header, index) => csvEscape(columns[index] ?? "")).join(",");
        }),
        "",
      ];

  const totalDesiredAdditional = adjusted.reduce((total, row) => total + row.desiredAdditional, 0n);
  const adjustedWallets = adjusted.filter((row) => row.numberMinted > 0n);
  const report = {
    generatedAt: new Date().toISOString(),
    source: input,
    sourceSha256: sha256(contents),
    output,
    outputSha256: sha256(outputLines.join("\n")),
    contractAddress,
    chainId: network.chainId.toString(),
    walletCount: adjusted.length,
    duplicateRowsRemoved: duplicateRows.length,
    duplicateRows,
    walletsWithPriorMints: adjustedWallets.length,
    totalDesiredAdditional: totalDesiredAdditional.toString(),
    currentTotalSupply: currentTotalSupply.toString(),
    projectedSupplyIfFullyMinted: (currentTotalSupply + totalDesiredAdditional).toString(),
    totalSeaDropMinted: totalSeaDropMinted.toString(),
    remainingSeaDropSupply: remainingSeaDropSupply.toString(),
    maxAdjustedMintLimit: adjusted.reduce((max, row) => row.uploadLimit > max ? row.uploadLimit : max, 0n).toString(),
    columns: {
      wallet: headers[walletIndex],
      limit: limitIndex >= 0 ? headers[limitIndex] : null,
      price: priceIndex >= 0 ? headers[priceIndex] : null,
    },
    outputFormat: openseaUploadFormat ? "opensea-upload" : "source-columns",
      rowsWithPriorMints: adjustedWallets.map((row) => ({
      wallet: row.wallet,
      currentNumberMinted: row.numberMinted.toString(),
      currentBalance: row.balance === null ? null : row.balance.toString(),
      sourceDesiredAdditionalLimit: row.desiredAdditional.toString(),
      uploadCustomMintLimit: row.uploadLimit.toString(),
      originalPrice: row.originalPrice,
    })),
  };

  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(output, outputLines.join("\n"));
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
