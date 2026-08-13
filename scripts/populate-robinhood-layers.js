import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-trait-asset-manifest.json",
);
const outputRoot = path.join(projectRoot, "data", "robinhood", "layers");
const reportPath = path.join(projectRoot, "data", "robinhood", "dyoor-layer-population.json");
const canvasSize = 4096;
const concurrency = 4;
const ipfsGateways = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeSegment(value, label) {
  const segment = String(value || "").normalize("NFKC");
  if (!segment || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
  }
  return segment;
}

function extensionFor(trait) {
  const source = trait.localPath || trait.remoteUri;
  const pathname = String(source || "").split(/[?#]/, 1)[0];
  const extension = path.extname(pathname).toLowerCase();
  return extension && extension.length <= 8 ? extension : ".png";
}

function destinationFor(trait) {
  const slot = safeSegment(trait.slot, "slot");
  const name = safeSegment(trait.name, "trait name");
  return path.join(outputRoot, slot, `${name}${extensionFor(trait)}`);
}

function remoteCandidates(uri) {
  if (/^https?:\/\//i.test(uri)) return [uri];
  if (!uri.startsWith("ipfs://")) {
    throw new Error(`Unsupported remote URI: ${uri}`);
  }
  const ipfsPath = uri.slice("ipfs://".length);
  return ipfsGateways.map((gateway) => `${gateway}${ipfsPath}`);
}

async function fetchRemote(uri) {
  const failures = [];

  for (const url of remoteCandidates(uri)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "DYOOR-Robinhood-Layer-Populator/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100) throw new Error(`Response is only ${buffer.length} bytes`);
      return { buffer, url };
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Unable to download ${uri}\n${failures.join("\n")}`);
}

async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const results = new Array(items.length);
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function validateLayer(filePath, trait) {
  const metadata = await sharp(filePath).metadata();
  if (!metadata.width || !metadata.height || metadata.width !== metadata.height) {
    throw new Error(
      `${trait.slot}::${trait.name} is not a valid square layer: ${metadata.width}x${metadata.height}`,
    );
  }
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: Boolean(metadata.hasAlpha),
    canonicalCanvas: metadata.width === canvasSize && metadata.height === canvasSize,
  };
}

const manifest = readJson(manifestPath);
const excludedPattern = new RegExp(`(${manifest.exclusionTerms.join("|")})`, "i");
const removedSlots = new Set(["Special", "Stickers/Body art"]);
const activeTraits = manifest.traits || [];

for (const trait of activeTraits) {
  if (removedSlots.has(trait.slot) || excludedPattern.test(trait.name)) {
    throw new Error(`Filtered trait reached population: ${trait.slot}::${trait.name}`);
  }
}

const records = [];
const remoteGroups = new Map();

for (const trait of activeTraits) {
  const destination = destinationFor(trait);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (trait.localPath) {
    const source = path.join(projectRoot, trait.localPath);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing local source for ${trait.slot}::${trait.name}: ${trait.localPath}`);
    }
    if (path.resolve(source) !== path.resolve(destination)) fs.copyFileSync(source, destination);
    records.push({ trait, destination, sourceType: "local", source: source });
    continue;
  }

  if (!trait.remoteUri) {
    throw new Error(`No source for ${trait.slot}::${trait.name}`);
  }
  const group = remoteGroups.get(trait.remoteUri) || [];
  group.push({ trait, destination });
  remoteGroups.set(trait.remoteUri, group);
}

const remoteDownloads = await mapWithConcurrency(
  Array.from(remoteGroups.entries()),
  concurrency,
  async ([remoteUri, targets]) => {
    const { buffer, url } = await fetchRemote(remoteUri);
    for (const { destination } of targets) {
      const temporaryPath = `${destination}.download`;
      fs.writeFileSync(temporaryPath, buffer);
      fs.renameSync(temporaryPath, destination);
    }
    for (const target of targets) {
      records.push({
        ...target,
        sourceType: "remote",
        source: remoteUri,
        resolvedUrl: url,
      });
    }
    return { remoteUri, resolvedUrl: url, bytes: buffer.length, targets: targets.length };
  },
);

const validations = await mapWithConcurrency(records, 8, async (record) => ({
  ...record,
  validation: await validateLayer(record.destination, record.trait),
}));
validations.sort((left, right) => (
  left.trait.slot.localeCompare(right.trait.slot)
  || left.trait.name.localeCompare(right.trait.name)
));

const report = {
  schema: "dyoor-robinhood-layer-population-v1",
  sourceManifest: path.relative(projectRoot, manifestPath),
  outputRoot: path.relative(projectRoot, outputRoot),
  exclusions: {
    terms: manifest.exclusionTerms,
    slots: Array.from(removedSlots),
  },
  summary: {
    activeTraitLayers: activeTraits.length,
    populatedTraitLayers: validations.length,
    copiedFromLocal: validations.filter((entry) => entry.sourceType === "local").length,
    downloadedTraitLayers: validations.filter((entry) => entry.sourceType === "remote").length,
    uniqueRemoteDownloads: remoteDownloads.length,
    resolutions: validations.reduce((counts, entry) => {
      const key = `${entry.validation.width}x${entry.validation.height}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    invalid: [],
  },
  remoteDownloads,
  layers: validations.map((entry) => ({
    slot: entry.trait.slot,
    traitId: entry.trait.traitId,
    name: entry.trait.name,
    path: path.relative(projectRoot, entry.destination),
    sourceType: entry.sourceType,
    source: path.isAbsolute(entry.source)
      ? path.relative(projectRoot, entry.source)
      : entry.source,
    ...entry.validation,
  })),
};

writeJson(reportPath, report);
console.log(JSON.stringify({
  report: path.relative(projectRoot, reportPath),
  ...report.summary,
}, null, 2));
