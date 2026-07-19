#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const DEFAULT_BASE_PRICE_MON = "333";
const DEFAULT_REFUND_PRICES = ["450", "550"];

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

function formatMon(wei) {
  const formatted = ethers.formatEther(wei);
  return formatted.includes(".") ? formatted.replace(/0+$/, "").replace(/\.$/, "") : formatted;
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function readWalletCsv(filePath, priceMon) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing wallet CSV for ${priceMon} MON mints: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const headers = csvSplit(lines.shift() || "");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = csvSplit(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const wallet = ethers.getAddress(row.wallet);
    const quantity = Number.parseInt(String(row.quantity || "0"), 10);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for ${wallet} in ${filePath}: ${row.quantity}`);
    }
    rows.push({
      priceMon,
      wallet,
      quantity,
      tokenIds: String(row.tokenIds || "").split(/\s+/).filter(Boolean),
      txHashes: String(row.txHashes || "").split(/\s+/).filter(Boolean),
    });
  }
  return rows;
}

function readSecondarySummary(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const headers = csvSplit(lines.shift() || "");
  const rows = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = csvSplit(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    rows.set(ethers.getAddress(row.wallet).toLowerCase(), {
      tokensStillHeld: Number.parseInt(row.tokensStillHeld || "0", 10) || 0,
      tokensMovedOut: Number.parseInt(row.tokensMovedOut || "0", 10) || 0,
      likelySold: Number.parseInt(row.likelySold || "0", 10) || 0,
      transferOrUnknown: Number.parseInt(row.transferOrUnknown || "0", 10) || 0,
    });
  }
  return rows;
}

function buildRefunds({ outDir, dateStamp, prices, basePriceMon }) {
  const baseWei = ethers.parseEther(basePriceMon);
  const secondarySummary = readSecondarySummary(path.join(outDir, `s2-overpay-secondary-wallet-summary-${dateStamp}.csv`));
  const byWallet = new Map();
  const sourceRows = [];

  for (const priceMon of prices) {
    const priceWei = ethers.parseEther(priceMon);
    if (priceWei <= baseWei) {
      throw new Error(`Refund price ${priceMon} must be greater than base price ${basePriceMon}.`);
    }
    const unitRefundWei = priceWei - baseWei;
    const filePath = path.join(outDir, `s2-mints-${priceMon}-mon-wallets-${dateStamp}.csv`);
    for (const row of readWalletCsv(filePath, priceMon)) {
      const current = byWallet.get(row.wallet.toLowerCase()) || {
        wallet: row.wallet,
        totalQuantity: 0,
        refundWei: 0n,
        refundMON: "0",
        priceBreakdown: [],
        tokenIds: [],
        txHashes: [],
        tokensStillHeld: "",
        tokensMovedOut: "",
        likelySold: "",
        transferOrUnknown: "",
      };
      const rowRefundWei = unitRefundWei * BigInt(row.quantity);
      current.totalQuantity += row.quantity;
      current.refundWei += rowRefundWei;
      current.refundMON = formatMon(current.refundWei);
      current.priceBreakdown.push(`${priceMon}x${row.quantity}=${formatMon(rowRefundWei)}`);
      current.tokenIds.push(...row.tokenIds);
      current.txHashes.push(...row.txHashes);
      byWallet.set(row.wallet.toLowerCase(), current);
      sourceRows.push({
        wallet: row.wallet,
        priceMon,
        quantity: row.quantity,
        unitRefundMON: formatMon(unitRefundWei),
        rowRefundMON: formatMon(rowRefundWei),
        tokenIds: row.tokenIds.join(" "),
      });
    }
  }

  const refunds = [...byWallet.values()]
    .map((row) => {
      const secondary = secondarySummary.get(row.wallet.toLowerCase()) || {};
      return {
        ...row,
        priceBreakdown: row.priceBreakdown.join(" | "),
        tokenIds: row.tokenIds.join(" "),
        txHashes: [...new Set(row.txHashes)].join(" "),
        tokensStillHeld: secondary.tokensStillHeld ?? "",
        tokensMovedOut: secondary.tokensMovedOut ?? "",
        likelySold: secondary.likelySold ?? "",
        transferOrUnknown: secondary.transferOrUnknown ?? "",
      };
    })
    .sort((a, b) => BigInt(b.refundWei) > BigInt(a.refundWei) ? 1 : BigInt(b.refundWei) < BigInt(a.refundWei) ? -1 : a.wallet.localeCompare(b.wallet));

  const totalRefundWei = refunds.reduce((sum, row) => sum + BigInt(row.refundWei), 0n);
  return {
    refunds,
    sourceRows,
    totalRefundWei,
    totalQuantity: refunds.reduce((sum, row) => sum + row.totalQuantity, 0),
  };
}

function main() {
  const outDir = arg("--out-dir", "data/reports");
  const dateStamp = arg("--date", new Date().toISOString().slice(0, 10));
  const basePriceMon = arg("--base-price", DEFAULT_BASE_PRICE_MON);
  const prices = arg("--prices", DEFAULT_REFUND_PRICES.join(","))
    .split(",")
    .map((price) => price.trim())
    .filter(Boolean);
  if (!prices.length) throw new Error("No refund prices supplied.");

  const { refunds, sourceRows, totalRefundWei, totalQuantity } = buildRefunds({ outDir, dateStamp, prices, basePriceMon });
  fs.mkdirSync(outDir, { recursive: true });

  const csvPath = path.join(outDir, `s2-overpay-refunds-${dateStamp}.csv`);
  const transferCsvPath = path.join(outDir, `s2-overpay-refund-transfers-${dateStamp}.csv`);
  const manifestPath = path.join(outDir, `s2-overpay-refund-manifest-${dateStamp}.json`);

  writeCsv(csvPath, refunds, [
    "wallet",
    "refundMON",
    "refundWei",
    "totalQuantity",
    "priceBreakdown",
    "tokenIds",
    "txHashes",
    "tokensStillHeld",
    "tokensMovedOut",
    "likelySold",
    "transferOrUnknown",
  ]);
  writeCsv(transferCsvPath, refunds.map((row) => ({
    wallet: row.wallet,
    amountMON: row.refundMON,
    amountWei: row.refundWei,
  })), ["wallet", "amountMON", "amountWei"]);

  const manifest = {
    generatedAt: new Date().toISOString(),
    basePriceMon,
    refundPrices: prices,
    walletCount: refunds.length,
    totalMintQuantity: totalQuantity,
    totalRefundMON: formatMon(totalRefundWei),
    totalRefundWei: totalRefundWei.toString(),
    confirmationPhrase: `REFUND ${formatMon(totalRefundWei)} MON TO ${refunds.length} WALLETS`,
    files: {
      csv: csvPath,
      transferCsv: transferCsvPath,
      manifest: manifestPath,
    },
    refunds,
    sourceRows,
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, bigintJson, 2)}\n`);
  console.log(JSON.stringify({
    manifestPath,
    csvPath,
    transferCsvPath,
    walletCount: manifest.walletCount,
    totalMintQuantity: manifest.totalMintQuantity,
    totalRefundMON: manifest.totalRefundMON,
    confirmationPhrase: manifest.confirmationPhrase,
  }, null, 2));
}

main();
