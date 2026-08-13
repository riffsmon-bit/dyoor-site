import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, getBytes, keccak256 } from "ethers";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "snapshots",
  "hoodyoor-s2-holders-block-93374159.json",
);
const openSeaPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "gtd-sources",
  "opensea-top-holders-block-32071198.csv",
);
const openSeaSummaryPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "gtd-sources",
  "opensea-top-holders-block-32071198-summary.json",
);
const outputRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const outputManifestPath = path.join(outputRoot, "hoodyoor-gtd-allowlist.json");
const outputTreePath = path.join(outputRoot, "hoodyoor-gtd-tree.json");
const outputCsvPath = path.join(outputRoot, "hoodyoor-gtd-allowlist.csv");
const outputBinaryPath = path.join(outputRoot, "hoodyoor-gtd-allowlist.bin");
const leafEncoding = ["address", "uint256"];
const hoodYoorMintPriceWei = "2500000000000000";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourceRecord(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: path.relative(projectRoot, filePath),
    bytes: bytes.length,
    sha256: sha256(bytes),
    keccak256: keccak256(bytes),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const snapshotBytes = fs.readFileSync(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
const openSeaBytes = fs.readFileSync(openSeaPath);
const openSeaSummaryBytes = fs.readFileSync(openSeaSummaryPath);
const openSeaSummary = JSON.parse(openSeaSummaryBytes.toString("utf8"));

const openSeaRows = openSeaBytes.toString("utf8").trim().split(/\r?\n/).map((line, index) => {
  const columns = line.split(",").map((value) => value.trim());
  if (columns.length !== 3) throw new Error(`OpenSea row ${index + 1} must contain three columns.`);
  const address = getAddress(columns[0]);
  const maxMint = Number(columns[1]);
  if (!Number.isSafeInteger(maxMint) || maxMint <= 0 || maxMint > 65_535) {
    throw new Error(`Invalid OpenSea max mint at row ${index + 1}.`);
  }
  if (columns[2] !== "0") throw new Error(`Unexpected OpenSea custom price at row ${index + 1}.`);
  return { address, maxMint, importedCustomPriceEth: columns[2] };
});

if (openSeaRows.length !== openSeaSummary.uniqueWallets) {
  throw new Error("OpenSea allowlist count does not match its frozen summary.");
}
if (sha256(openSeaBytes) !== openSeaSummary.files["opensea-allowlist.csv"].sha256) {
  throw new Error("OpenSea allowlist hash does not match its frozen summary.");
}
if (new Set(openSeaRows.map(({ address }) => address.toLowerCase())).size !== openSeaRows.length) {
  throw new Error("OpenSea allowlist contains duplicate wallets.");
}

const entriesByAddress = new Map();

function mergeEntry(candidate) {
  const key = candidate.address.toLowerCase();
  const existing = entriesByAddress.get(key);
  if (!existing) {
    entriesByAddress.set(key, {
      address: candidate.address,
      maxMint: candidate.maxMint,
      sources: [candidate.source],
      monadSourceTokenCount: candidate.monadSourceTokenCount || 0,
      monadSourceWasContract: Boolean(candidate.monadSourceWasContract),
    });
    return;
  }
  existing.maxMint = Math.max(existing.maxMint, candidate.maxMint);
  if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source);
  existing.monadSourceTokenCount = Math.max(
    existing.monadSourceTokenCount,
    candidate.monadSourceTokenCount || 0,
  );
  existing.monadSourceWasContract ||= Boolean(candidate.monadSourceWasContract);
}

for (const [index, holder] of snapshot.holders.entries()) {
  const address = getAddress(holder.address);
  const sourceTokenCount = Number(holder.quantity);
  if (!Number.isSafeInteger(sourceTokenCount) || sourceTokenCount <= 0) {
    throw new Error(`Invalid Monad holding at snapshot row ${index + 1}.`);
  }
  if (!Array.isArray(holder.sourceTokenIds) || holder.sourceTokenIds.length !== sourceTokenCount) {
    throw new Error(`Monad source-token reconciliation failed for ${address}.`);
  }
  mergeEntry({
    address,
    maxMint: 1,
    source: "monad-dyoor-holder",
    monadSourceTokenCount: sourceTokenCount,
    monadSourceWasContract: holder.isContract,
  });
}

for (const row of openSeaRows) {
  mergeEntry({
    address: row.address,
    maxMint: row.maxMint,
    source: "robinhood-top-holder-import",
  });
}

const entries = Array.from(entriesByAddress.values()).sort((left, right) => (
  left.address.toLowerCase().localeCompare(right.address.toLowerCase())
));
const values = entries.map(({ address, maxMint }) => [address, String(maxMint)]);
const tree = StandardMerkleTree.of(values, leafEncoding);
const proofByWallet = new Map();
for (const [treeIndex, [address, maxMint]] of tree.entries()) {
  const proof = tree.getProof(treeIndex);
  if (!StandardMerkleTree.verify(tree.root, leafEncoding, [address, maxMint], proof)) {
    throw new Error(`Generated Merkle proof failed for ${address}.`);
  }
  proofByWallet.set(address.toLowerCase(), proof);
}

const binary = Buffer.concat(entries.map(({ address, maxMint }) => {
  const record = Buffer.alloc(22);
  Buffer.from(getBytes(address)).copy(record, 0);
  record.writeUInt16BE(maxMint, 20);
  return record;
}));
const openSeaWalletSet = new Set(openSeaRows.map(({ address }) => address.toLowerCase()));
const monadWalletSet = new Set(snapshot.holders.map(({ address }) => getAddress(address).toLowerCase()));
const overlapWallets = Array.from(monadWalletSet).filter((address) => openSeaWalletSet.has(address));
const enrichedEntries = entries.map((entry) => ({
  ...entry,
  proof: proofByWallet.get(entry.address.toLowerCase()),
}));
const treeDump = tree.dump();
const csvHeaders = [
  "address",
  "maxMint",
  "sources",
  "monadSourceTokenCount",
  "monadSourceWasContract",
];
const csv = [
  csvHeaders.join(","),
  ...enrichedEntries.map((entry) => csvHeaders.map((header) => (
    csvCell(header === "sources" ? entry.sources.join("|") : entry[header])
  )).join(",")),
].join("\n");

const manifest = {
  schema: "dyoor-hoodyoor-gtd-allowlist-v1",
  collection: "HoodYØØR",
  targetChain: { name: "Robinhood Chain", chainId: 4663 },
  policy: {
    mintType: "paid-gtd",
    mintPriceWei: hoodYoorMintPriceWei,
    freeMint: false,
    monadHolderMaxMint: 1,
    monadHoldingRule: "one GTD mint per unique holder with a positive balance at the frozen snapshot",
    robinhoodTopHolderMaxMint: 3,
    duplicateRule: "take the highest source allowance; never add overlapping allowances",
    importedOpenSeaZeroPriceIgnored: true,
  },
  sources: {
    monadHolderSnapshot: sourceRecord(snapshotPath),
    monad: {
      chainId: snapshot.source.chainId,
      contract: snapshot.source.contract,
      blockNumber: snapshot.source.blockNumber,
      blockHash: snapshot.source.blockHash,
    },
    robinhoodTopHolderAllowlist: sourceRecord(openSeaPath),
    robinhoodTopHolderSummary: sourceRecord(openSeaSummaryPath),
    robinhood: {
      chainId: openSeaSummary.snapshot.chainId,
      blockNumber: openSeaSummary.snapshot.blockNumber,
      blockHash: openSeaSummary.snapshot.blockHash,
    },
  },
  totals: {
    monadHolderWallets: monadWalletSet.size,
    monadLiveSourceTokens: snapshot.summary.liveSourceTokens,
    robinhoodTopHolderWallets: openSeaWalletSet.size,
    overlapWallets: overlapWallets.length,
    uniqueWallets: entries.length,
    aggregateMaxMint: entries.reduce((sum, entry) => sum + entry.maxMint, 0),
    monadSourceContractWallets: snapshot.holders.filter(({ isContract }) => isContract).length,
    bytes: binary.length,
    binarySha256: sha256(binary),
    binaryKeccak256: keccak256(binary),
  },
  encoding: {
    bytesPerRecord: 22,
    addressBytes: 20,
    maxMintBytes: 2,
    byteOrder: "big-endian",
  },
  merkleTree: {
    library: "@openzeppelin/merkle-tree",
    format: treeDump.format,
    leafEncoding,
    root: tree.root,
    treeDump: path.relative(projectRoot, outputTreePath),
  },
  entries: enrichedEntries,
};

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(outputBinaryPath, binary);
fs.writeFileSync(outputCsvPath, `${csv}\n`);
fs.writeFileSync(outputTreePath, `${JSON.stringify(treeDump, null, 2)}\n`);
fs.writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  outputManifest: path.relative(projectRoot, outputManifestPath),
  outputTree: path.relative(projectRoot, outputTreePath),
  outputCsv: path.relative(projectRoot, outputCsvPath),
  outputBinary: path.relative(projectRoot, outputBinaryPath),
  merkleRoot: tree.root,
  ...manifest.totals,
}, null, 2));
