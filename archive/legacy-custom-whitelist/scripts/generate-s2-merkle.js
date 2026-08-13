#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { concatHex, getAddress, isAddress, keccak256 } from "viem";

function usage() {
  console.error(`Usage: node ${basename(process.argv[1])} --phase <team|ascension|whitelist|gtd> --input <csv-or-txt> [--output <json>]`);
  console.error("");
  console.error("Input may contain one wallet per line or CSV with wallet plus optional allowance/amount/quantity.");
  console.error("Leaf formula is fixed to the contract format: keccak256(abi.encodePacked(wallet)).");
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "");
}

function csvLine(line) {
  const out = [];
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
      out.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

function walletLeaf(address) {
  return keccak256(`0x${getAddress(address).slice(2).toLowerCase()}`);
}

function hashPair(left, right) {
  return keccak256(concatHex([left, right].sort((a, b) => a.localeCompare(b))));
}

function buildLayers(leaves) {
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(current[index + 1] ? hashPair(current[index], current[index + 1]) : current[index]);
    }
    layers.push(next);
  }
  return layers;
}

function proofForIndex(layers, leafIndex) {
  const proof = [];
  let index = leafIndex;
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const layer = layers[layerIndex];
    const sibling = index % 2 === 0 ? index + 1 : index - 1;
    if (sibling < layer.length) proof.push(layer[sibling]);
    index = Math.floor(index / 2);
  }
  return proof;
}

function parseRows(inputPath, contents) {
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error(`${inputPath} is empty.`);

  const first = csvLine(lines[0]).map((header) => header.toLowerCase());
  const hasHeader = first.includes("wallet") || first.includes("address");
  const walletIndex = hasHeader ? Math.max(first.indexOf("wallet"), first.indexOf("address")) : -1;
  const allowanceIndex = hasHeader
    ? ["allowance", "amount", "quantity"].map((name) => first.indexOf(name)).find((index) => index >= 0) ?? -1
    : -1;
  const start = hasHeader ? 1 : 0;
  const rows = [];
  const seen = new Map();

  for (let index = start; index < lines.length; index += 1) {
    const columns = csvLine(lines[index]);
    const rawWallet = hasHeader ? String(columns[walletIndex] || "").trim() : (lines[index].match(/0x[a-fA-F0-9]{40}/)?.[0] || "");
    const allowanceRaw = hasHeader && allowanceIndex >= 0 ? String(columns[allowanceIndex] || "1").trim() : "1";
    if (!isAddress(rawWallet)) throw new Error(`Invalid wallet on line ${index + 1}: ${rawWallet || "(blank)"}`);
    if (!/^\d+$/.test(allowanceRaw) || Number(allowanceRaw) <= 0) {
      throw new Error(`Invalid allowance on line ${index + 1}: ${allowanceRaw}`);
    }
    const wallet = getAddress(rawWallet);
    if (seen.has(wallet)) throw new Error(`Duplicate wallet ${wallet} on lines ${seen.get(wallet)} and ${index + 1}`);
    seen.set(wallet, index + 1);
    rows.push({ wallet, allowance: Number(allowanceRaw), sourceLine: index + 1, leaf: walletLeaf(wallet) });
  }

  return rows;
}

const phase = arg("--phase");
const input = arg("--input");
const output = arg("--output");
if (!phase || !input) {
  usage();
  process.exit(1);
}
if (!["team", "ascension", "whitelist", "gtd"].includes(phase)) {
  console.error(`Unsupported phase: ${phase}`);
  process.exit(1);
}

const contents = readFileSync(input, "utf8");
const sourceChecksum = createHash("sha256").update(contents).digest("hex");
const rows = parseRows(input, contents).sort((a, b) => a.leaf.localeCompare(b.leaf));
if (!rows.length) throw new Error("No wallets found.");

const layers = buildLayers(rows.map((row) => row.leaf));
const root = layers[layers.length - 1][0];
const wallets = rows
  .map((row, index) => ({
    wallet: row.wallet,
    allowance: row.allowance,
    sourceLine: row.sourceLine,
    leaf: row.leaf,
    proof: proofForIndex(layers, index),
  }))
  .sort((a, b) => a.wallet.localeCompare(b.wallet));

const result = {
  phase,
  generatedAt: new Date().toISOString(),
  sourceFile: input,
  sourceChecksum,
  leafFormula: "keccak256(abi.encodePacked(wallet))",
  root,
  totalWallets: wallets.length,
  totalAllocation: wallets.reduce((sum, row) => sum + row.allowance, 0),
  wallets,
};

if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Merkle output written to ${output}`);
  console.log(`Root: ${root}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
