import dotenv from "dotenv";
import { getStore } from "@netlify/blobs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const STORE_NAME = "dyoor-robinhood-gtd";
const SUBMISSION_PREFIX = "submissions/";
const LOCAL_SUBMISSIONS_DIR = path.join(process.cwd(), "data", "runtime", STORE_NAME, "submissions");
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "wallet-list-exports", "robinhood-gtd");

function readEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function normalizeWallet(value) {
  const wallet = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function outputStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function blobStore() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");
  if (!siteID || !token) {
    throw new Error("Blob export requires NETLIFY_BLOBS_SITE_ID and NETLIFY_BLOBS_TOKEN in the environment.");
  }
  return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function readBlobSubmissions() {
  const store = blobStore();
  const keys = [];
  for await (const page of store.list({ prefix: SUBMISSION_PREFIX, paginate: true })) {
    keys.push(...page.blobs.map((blob) => blob.key).filter((key) => key.endsWith(".json")));
  }
  return await mapLimit(keys.sort(), 12, async (key) => {
    return await store.get(key, { type: "json", consistency: "strong" });
  });
}

async function readLocalSubmissions() {
  const entries = await readdir(LOCAL_SUBMISSIONS_DIR, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  return await Promise.all(files.map(async (entry) => {
    const value = await readFile(path.join(LOCAL_SUBMISSIONS_DIR, entry.name), "utf8");
    return JSON.parse(value);
  }));
}

function normalizedRows(records) {
  const byWallet = new Map();
  for (const record of records) {
    const wallet = normalizeWallet(record?.wallet);
    if (!wallet) continue;
    const row = {
      wallet,
      createdAt: String(record?.createdAt || ""),
      campaign: String(record?.campaign || ""),
      destinationChain: String(record?.destinationChain?.name || "Robinhood Chain"),
      destinationChainId: Number(record?.destinationChain?.chainId || 4663),
    };
    const existing = byWallet.get(wallet);
    if (!existing || row.createdAt < existing.createdAt) byWallet.set(wallet, row);
  }
  return Array.from(byWallet.values()).sort((left, right) => {
    return left.createdAt.localeCompare(right.createdAt) || left.wallet.localeCompare(right.wallet);
  });
}

async function main() {
  const requestedSource = argValue("--source") || "auto";
  if (!["auto", "blob", "local"].includes(requestedSource)) {
    throw new Error("--source must be auto, blob, or local.");
  }

  let source = requestedSource;
  if (source === "auto") {
    source = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID")
      && readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN")
      ? "blob"
      : "local";
  }

  const records = source === "blob" ? await readBlobSubmissions() : await readLocalSubmissions();
  const rows = normalizedRows(records);
  const outputDir = path.resolve(argValue("--output-dir") || DEFAULT_OUTPUT_DIR);
  const stamp = outputStamp();
  const csvPath = path.join(outputDir, `hoodyoor-gtd-wallets-${stamp}.csv`);
  const jsonPath = path.join(outputDir, `hoodyoor-gtd-wallets-${stamp}.json`);
  const headers = ["wallet", "createdAt", "campaign", "destinationChain", "destinationChainId"];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(csvPath, `${csv}\n`, "utf8"),
    writeFile(jsonPath, `${JSON.stringify({
      schema: "hoodyoor-robinhood-gtd-export-v1",
      exportedAt: new Date().toISOString(),
      source,
      count: rows.length,
      wallets: rows,
    }, null, 2)}\n`, "utf8"),
  ]);

  console.log(`Exported ${rows.length} HoodYØØR GTD wallet${rows.length === 1 ? "" : "s"} from ${source}.`);
  console.log(csvPath);
  console.log(jsonPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
