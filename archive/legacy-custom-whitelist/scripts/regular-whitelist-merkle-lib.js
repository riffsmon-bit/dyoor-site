import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { encodeAbiParameters, getAddress, isAddress, keccak256 } from "viem";

export const DEFAULT_WHITELIST_SOURCE = "DYOOR_WL_Comma_Separated_Merged_Deduped.txt";
export const DEFAULT_WHITELIST_OUTPUT_DIR = "whitelist/generated";
export const DEFAULT_WHITELIST_COUNT = 12_612;
export const DEFAULT_WHITELIST_ALLOWANCE = 3n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
export const LEAF_ENCODING = ["address", "uint256"];
export const LEAF_FORMULA =
  "keccak256(bytes.concat(keccak256(abi.encode(wallet, allowance))))";

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function csvLine(line) {
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
  if (quoted) throw new Error(`Malformed CSV quoting in line: ${line}`);
  out.push(current.trim());
  return out;
}

export function parseWhitelistSource(contents) {
  const clean = contents.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  const cells = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    cells.push(...csvLine(line));
  }
  if (!cells.length) throw new Error("Whitelist source is empty.");

  const first = cells[0].trim().toLowerCase();
  const addressCells = first === "wallet" || first === "address" ? cells.slice(1) : cells;
  const invalid = [];
  const excluded = [];
  const duplicateRows = [];
  const seen = new Map();
  const entries = [];

  for (let index = 0; index < addressCells.length; index += 1) {
    const raw = addressCells[index].trim();
    if (!raw) continue;
    if (!isAddress(raw)) {
      invalid.push({ index: index + 1, value: raw, reason: "Invalid EVM address" });
      continue;
    }

    const checksum = getAddress(raw);
    const lower = checksum.toLowerCase();
    if (lower === ZERO_ADDRESS || lower === DEAD_ADDRESS) {
      excluded.push({ index: index + 1, address: checksum, reason: "Burn/null address" });
      continue;
    }
    if (seen.has(lower)) {
      duplicateRows.push({
        address: checksum,
        firstIndex: seen.get(lower),
        duplicateIndex: index + 1,
      });
      continue;
    }

    seen.set(lower, index + 1);
    entries.push({ address: checksum, lower });
  }

  entries.sort((a, b) => a.lower.localeCompare(b.lower));

  return {
    entries,
    invalid,
    excluded,
    duplicateRows,
    sourceAddressesFound: addressCells.filter((cell) => cell.trim()).length,
  };
}

export function whitelistLeaf(address, allowance = DEFAULT_WHITELIST_ALLOWANCE) {
  const checksum = getAddress(address);
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [checksum, BigInt(allowance)],
  );
  return keccak256(keccak256(encoded));
}

function sortPair(left, right) {
  return left.toLowerCase() <= right.toLowerCase() ? [left, right] : [right, left];
}

export function hashPair(left, right) {
  const [a, b] = sortPair(left, right);
  return keccak256(`${a}${b.slice(2)}`);
}

export function buildLayers(leaves) {
  if (!leaves.length) throw new Error("Cannot build a Merkle tree without leaves.");
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

export function proofForIndex(layers, leafIndex) {
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

export function verifyProof({ proof, root, leaf }) {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

function gitCommitHash() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function buildWhitelistMerkle({
  contents,
  sourceFile = DEFAULT_WHITELIST_SOURCE,
  expectedCount = DEFAULT_WHITELIST_COUNT,
  allowance = DEFAULT_WHITELIST_ALLOWANCE,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (contents === undefined) throw new Error("contents is required.");
  const parsed = parseWhitelistSource(contents);
  const sourceSha256 = sha256Hex(contents);
  const canonicalEntries = parsed.entries.map((entry) => entry.lower).join("\n") + "\n";
  const canonicalEntriesSha256 = sha256Hex(canonicalEntries);

  if (parsed.invalid.length) {
    throw new Error(`Invalid whitelist addresses: ${parsed.invalid.length}`);
  }
  if (parsed.excluded.length) {
    throw new Error(`Excluded burn/null addresses found: ${parsed.excluded.length}`);
  }
  if (parsed.duplicateRows.length) {
    throw new Error(`Duplicate whitelist addresses after normalization: ${parsed.duplicateRows.length}`);
  }
  if (parsed.entries.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} unique wallets; found ${parsed.entries.length}.`);
  }

  const rows = parsed.entries.map((entry) => ({
    address: entry.address,
    lower: entry.lower,
    allowance: BigInt(allowance),
    leaf: whitelistLeaf(entry.address, allowance),
  }));
  const layers = buildLayers(rows.map((row) => row.leaf));
  const root = layers[layers.length - 1][0];
  const proofs = {};

  rows.forEach((row, index) => {
    const proof = proofForIndex(layers, index);
    proofs[row.lower] = {
      address: row.address,
      allowance: row.allowance.toString(),
      leaf: row.leaf,
      proof,
    };
  });

  const common = {
    phase: "whitelist",
    root,
    walletCount: rows.length,
    defaultAllowance: BigInt(allowance).toString(),
    leafEncoding: LEAF_ENCODING,
    leafFormula: LEAF_FORMULA,
    sourceFile: basename(sourceFile),
    sourceSha256,
    canonicalEntriesSha256,
    generatedAt,
    generatorVersion: 1,
  };

  const rootFile = {
    ...common,
  };

  const manifest = {
    ...common,
    collection: "D.Y.O.O.R Season 2",
    chain: "Monad",
    maxSupply: "3333",
    priceWei: "350000000000000000000",
    sortStrategy: "canonical lower-case address ascending; sorted pair hashing",
    merkleLibrary: "repo StandardMerkleTree-compatible generator",
    openZeppelinMerkleTreePackageVersion: null,
    gitCommit: gitCommitHash(),
    sourceAddressesFound: parsed.sourceAddressesFound,
    invalidAddresses: parsed.invalid.length,
    duplicateAddressesAfterNormalization: parsed.duplicateRows.length,
    excludedBurnOrNullAddresses: parsed.excluded.length,
    entries: rows.map((row) => ({
      address: row.address,
      normalizedAddress: row.lower,
      allowance: row.allowance.toString(),
      leaf: row.leaf,
    })),
  };

  const csv = `address,allowance\n${rows.map((row) => `${row.address},${row.allowance}`).join("\n")}\n`;

  return {
    ...common,
    rows,
    proofs,
    rootFile,
    manifest,
    csv,
    sourceAddressesFound: parsed.sourceAddressesFound,
    duplicateRows: parsed.duplicateRows,
    invalid: parsed.invalid,
    excluded: parsed.excluded,
  };
}

export function writeWhitelistOutputs(result, outputDir = DEFAULT_WHITELIST_OUTPUT_DIR) {
  mkdirSync(outputDir, { recursive: true });
  const paths = {
    root: join(outputDir, "regular-whitelist-root.json"),
    proofs: join(outputDir, "regular-whitelist-proofs.json"),
    entriesCsv: join(outputDir, "regular-whitelist-entries.csv"),
    manifest: join(outputDir, "regular-whitelist-manifest.json"),
  };

  writeFileSync(paths.root, `${JSON.stringify(result.rootFile, null, 2)}\n`);
  writeFileSync(paths.proofs, `${JSON.stringify(result.proofs, null, 2)}\n`);
  writeFileSync(paths.entriesCsv, result.csv);
  writeFileSync(paths.manifest, `${JSON.stringify(result.manifest, null, 2)}\n`);
  return paths;
}

export function readAndBuildWhitelistMerkle(options = {}) {
  const sourceFile = options.sourceFile || DEFAULT_WHITELIST_SOURCE;
  const contents = readFileSync(sourceFile, "utf8");
  return buildWhitelistMerkle({ ...options, contents, sourceFile });
}
