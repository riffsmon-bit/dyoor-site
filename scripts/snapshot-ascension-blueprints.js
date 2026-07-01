import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";

loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

const STORE_NAME = "ascension-blueprints";
const BLUEPRINTS_KEY = "ascension-blueprints.json";
const LOCAL_BLUEPRINTS_PATH = "data/ascension-blueprints.json";
const DEFAULT_OUT_DIR = "data/snapshots";
const NONE_VALUE = "None";

const TRAIT_COLUMNS = [
  ["background", "Background"],
  ["droid", "Droid"],
  ["eyes", "Eyes"],
  ["clothes", "Clothes"],
  ["mouth", "Mouth"],
  ["hat", "Hat"],
  ["special", "Special"],
  ["accessories", "Accessories"],
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

function normalizeAddress(value) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
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

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  return String(value ?? "").trim();
}

function normalizeDate(value) {
  const text = safeString(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dateScore(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function traitValue(traits, key) {
  const direct = safeString(traits?.[key]);
  if (direct) return direct;

  const titleKey = TRAIT_COLUMNS.find(([normalized]) => normalized === key)?.[1];
  const title = safeString(traits?.[titleKey]);
  if (title) return title;

  if (key === "accessories") {
    return safeString(traits?.["accessories 2"] || traits?.accessories2 || traits?.Accessories2 || traits?.["Accessories 2"]) || NONE_VALUE;
  }

  return NONE_VALUE;
}

function normalizeTraits(record) {
  const traits = isObject(record?.traits)
    ? record.traits
    : isObject(record?.build?.traits)
      ? record.build.traits
      : isObject(record?.build?.selectedTraits)
        ? record.build.selectedTraits
        : {};

  return Object.fromEntries(TRAIT_COLUMNS.map(([key, label]) => [label, traitValue(traits, key)]));
}

function blueprintHash(wallet, traits) {
  return crypto.createHash("sha256").update(JSON.stringify({ wallet, traits })).digest("hex");
}

function fallbackBlueprintId(record, index) {
  const value = safeString(record?.blueprintId || record?.blueprintID || record?.id);
  if (value) return value;
  const rank = Number(record?.rank || index + 1);
  return Number.isSafeInteger(rank) && rank > 0 ? `AB-${String(rank).padStart(4, "0")}` : "";
}

function blueprintImage(record) {
  return safeString(
    record?.imageUrl ||
    record?.imageURL ||
    record?.image ||
    record?.imagePath ||
    record?.build?.imageUrl ||
    record?.build?.imageURL ||
    record?.build?.image ||
    record?.build?.previewUrl ||
    record?.build?.previewURL
  );
}

function normalizeRecord(record, index, dataSource) {
  const wallet = normalizeAddress(record?.wallet || record?.address || record?.owner);
  const traits = normalizeTraits(record);
  const createdAt = normalizeDate(record?.createdAt || record?.savedAt || record?.timestamp || record?.date);
  const updatedAt = normalizeDate(record?.updatedAt || record?.lastUpdatedAt || record?.modifiedAt) || createdAt;
  const rank = Number(record?.rank || index + 1);
  const blueprintId = fallbackBlueprintId(record, index);
  const image = blueprintImage(record);
  const hash = safeString(record?.blueprintHash || record?.hash || record?.traitHash) || blueprintHash(wallet, traits);
  const notes = [];

  if (!wallet) notes.push("invalid or missing wallet");
  if (!createdAt) notes.push("missing saved timestamp");
  for (const [, label] of TRAIT_COLUMNS) {
    if (traits[label] === NONE_VALUE) notes.push(`missing ${label}`);
  }

  return {
    rowIndex: index + 1,
    wallet,
    savedBlueprint: wallet ? "yes" : "no",
    rank: Number.isSafeInteger(rank) && rank > 0 ? rank : "",
    blueprintId,
    blueprintHash: hash,
    savedTimestamp: createdAt,
    lastUpdatedTimestamp: updatedAt,
    blueprintImage: image,
    Background: traits.Background,
    Droid: traits.Droid,
    Eyes: traits.Eyes,
    Clothes: traits.Clothes,
    Mouth: traits.Mouth,
    Hat: traits.Hat,
    Special: traits.Special,
    Accessories: traits.Accessories,
    dataSource,
    validationStatus: notes.length ? "warning" : "verified",
    validationNotes: notes.join("; "),
    raw: record,
  };
}

function chooseLatest(records) {
  return records.slice().sort((a, b) => {
    const dateDiff = dateScore(b.lastUpdatedTimestamp || b.savedTimestamp) - dateScore(a.lastUpdatedTimestamp || a.savedTimestamp);
    if (dateDiff) return dateDiff;
    return Number(b.rank || 0) - Number(a.rank || 0);
  })[0];
}

async function readFromBlob() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv("NETLIFY_BLOBS_TOKEN", "NETLIFY_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN");
  const options = siteID && token
    ? { name: STORE_NAME, siteID, token, consistency: "strong" }
    : { name: STORE_NAME, consistency: "strong" };
  const store = getStore(options);
  const value = await store.get(BLUEPRINTS_KEY, { type: "json", consistency: "strong" });
  return Array.isArray(value) ? value : [];
}

async function readFromFile(inputPath) {
  const text = fs.readFileSync(inputPath, "utf8");
  const value = JSON.parse(text || "[]");
  if (!Array.isArray(value)) throw new Error(`${inputPath} must contain a JSON array.`);
  return value;
}

async function readBlueprints(source, inputPath) {
  if (source === "file") {
    return { records: await readFromFile(inputPath), dataSource: `file:${inputPath}`, errors: [] };
  }

  if (source === "blob") {
    return { records: await readFromBlob(), dataSource: `netlify-blob:${STORE_NAME}/${BLUEPRINTS_KEY}`, errors: [] };
  }

  const errors = [];
  try {
    const records = await readFromBlob();
    return { records, dataSource: `netlify-blob:${STORE_NAME}/${BLUEPRINTS_KEY}`, errors };
  } catch (error) {
    errors.push(`Netlify Blob read failed: ${error?.message || error}`);
  }

  try {
    const records = await readFromFile(inputPath);
    return { records, dataSource: `file:${inputPath}`, errors };
  } catch (error) {
    errors.push(`Local file read failed: ${error?.message || error}`);
    return { records: [], dataSource: "none", errors };
  }
}

async function main() {
  const source = argValue("source", "auto").toLowerCase();
  if (!["auto", "blob", "file"].includes(source)) throw new Error("--source must be auto, blob, or file.");

  const inputPath = argValue("input", LOCAL_BLUEPRINTS_PATH);
  const outDir = argValue("out-dir", DEFAULT_OUT_DIR);
  const { records, dataSource, errors } = await readBlueprints(source, inputPath);

  const normalized = records.map((record, index) => normalizeRecord(record, index, dataSource));
  const valid = normalized.filter((record) => record.wallet);
  const invalid = normalized.filter((record) => !record.wallet);
  const byWallet = new Map();

  for (const record of valid) {
    const bucket = byWallet.get(record.wallet) || [];
    bucket.push(record);
    byWallet.set(record.wallet, bucket);
  }

  const latestRows = Array.from(byWallet.entries())
    .map(([wallet, versions]) => {
      const latest = chooseLatest(versions);
      return {
        wallet,
        savedBlueprint: "yes",
        blueprintCount: versions.length,
        rank: latest.rank,
        blueprintId: latest.blueprintId,
        blueprintHash: latest.blueprintHash,
        savedTimestamp: latest.savedTimestamp,
        lastUpdatedTimestamp: latest.lastUpdatedTimestamp,
        blueprintImage: latest.blueprintImage,
        Background: latest.Background,
        Droid: latest.Droid,
        Eyes: latest.Eyes,
        Clothes: latest.Clothes,
        Mouth: latest.Mouth,
        Hat: latest.Hat,
        Special: latest.Special,
        Accessories: latest.Accessories,
        dataSource,
        validationStatus: versions.some((record) => record.validationStatus !== "verified") ? "warning" : "verified",
        validationNotes: [
          ...new Set(versions.flatMap((record) => record.validationNotes ? [record.validationNotes] : [])),
          versions.length > 1 ? `duplicate wallet versions: ${versions.length}` : "",
        ].filter(Boolean).join("; "),
      };
    })
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0) || a.wallet.localeCompare(b.wallet));

  const duplicateWallets = latestRows.filter((row) => row.blueprintCount > 1).length;
  const warnings = [
    ...errors,
    invalid.length ? `${invalid.length} invalid wallet row(s) skipped from wallet CSV.` : "",
    duplicateWallets ? `${duplicateWallets} wallet(s) have multiple blueprint records; CSV uses latest per wallet.` : "",
    latestRows.some((row) => row.validationStatus !== "verified") ? "One or more latest blueprint rows have validation warnings." : "",
  ].filter(Boolean);
  const verified = warnings.length === 0 && latestRows.length > 0;

  if (!latestRows.length && !hasFlag("allow-empty")) {
    warnings.push("No blueprint wallet rows found. Use --allow-empty only if that is expected.");
  }

  const generatedAt = new Date().toISOString();
  const stamp = timestampForFile(new Date(generatedAt));
  const walletCsvPath = path.join(outDir, `ascension-blueprint-wallets-${stamp}.csv`);
  const jsonPath = path.join(outDir, `ascension-blueprint-snapshot-${stamp}.json`);

  fs.mkdirSync(outDir, { recursive: true });

  const walletCsv = toCsv(latestRows, [
    { key: "wallet", label: "wallet" },
    { key: "savedBlueprint", label: "saved_blueprint" },
    { key: "blueprintCount", label: "blueprint_count" },
    { key: "rank", label: "rank" },
    { key: "blueprintId", label: "blueprint_id" },
    { key: "blueprintHash", label: "blueprint_hash" },
    { key: "savedTimestamp", label: "saved_timestamp" },
    { key: "lastUpdatedTimestamp", label: "last_updated_timestamp" },
    { key: "blueprintImage", label: "blueprint_image" },
    { key: "Background", label: "Background" },
    { key: "Droid", label: "Droid" },
    { key: "Eyes", label: "Eyes" },
    { key: "Clothes", label: "Clothes" },
    { key: "Mouth", label: "Mouth" },
    { key: "Hat", label: "Hat" },
    { key: "Special", label: "Special" },
    { key: "Accessories", label: "Accessories" },
    { key: "dataSource", label: "data_source" },
    { key: "validationStatus", label: "validation_status" },
    { key: "validationNotes", label: "validation_notes" },
  ]);

  fs.writeFileSync(walletCsvPath, walletCsv, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt,
    verified,
    dataSource,
    totals: {
      rawRecords: records.length,
      validRecords: valid.length,
      invalidRecords: invalid.length,
      wallets: latestRows.length,
      duplicateWallets,
    },
    warnings,
    latestByWallet: latestRows,
    allVersions: valid,
    invalidRows: invalid,
  }, null, 2) + "\n", "utf8");

  console.log("DYOOR Ascension Blueprint snapshot");
  console.log("Data source:", dataSource);
  console.log("Raw records:", records.length);
  console.log("Wallets:", latestRows.length);
  console.log("Duplicate wallet versions:", duplicateWallets);
  console.log("Verified:", verified ? "yes" : "no");
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  console.log("Wallet CSV:", walletCsvPath);
  console.log("JSON:", jsonPath);

  if ((!verified || !latestRows.length) && !hasFlag("allow-unverified") && !hasFlag("allow-empty")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
