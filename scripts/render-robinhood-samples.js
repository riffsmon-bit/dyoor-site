import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data", "robinhood");
const outputRoot = path.join(dataRoot, "generations");
const catalog = readJson(path.join(dataRoot, "dyoor-trait-catalog.json"));
const assetManifest = readJson(path.join(dataRoot, "dyoor-trait-asset-manifest.json"));

const mode = argumentValue("mode") || "one-of-one";
if (!new Set(["one-of-one", "indahood"]).has(mode)) {
  throw new Error(`Unsupported generation mode: ${mode}`);
}
const sampleCount = positiveInteger(argumentValue("count"), mode === "indahood" ? 9 : 6);
const renderSize = 1024;
const samplesPerRow = positiveInteger(argumentValue("columns"), 3);
const seed = positiveInteger(argumentValue("seed"), mode === "indahood" ? 3334 : 3333);
const outputPrefix = mode === "indahood" ? "hoodyoor-indahood" : "robinhood-sample";

const robinhoodExclusiveWearables = new Set([
  "Robinhood Green Tee",
  "Robinhood Green Shades",
  "Robinhood Feather Cap",
]);
const excludedRobinhoodExclusiveTraits = new Set([
  ...robinhoodExclusiveWearables,
  ...(mode === "one-of-one" ? ["INDAHOOD"] : []),
]);

function argumentValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function positiveInteger(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function mulberry32(initialSeed) {
  let state = initialSeed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedChoice(options, random) {
  const weighted = options
    .map((option) => ({ ...option, weight: Math.max(0, Number(option.weight) || 0) }))
    .filter((option) => option.weight > 0);
  const totalWeight = weighted.reduce((sum, option) => sum + option.weight, 0);
  if (!totalWeight) throw new Error("Cannot sample from an empty weighted trait set.");

  let cursor = random() * totalWeight;
  for (const option of weighted) {
    cursor -= option.weight;
    if (cursor < 0) return option;
  }
  return weighted.at(-1);
}

function slotOptions(slot) {
  let traits = (catalog.traits?.[slot] || [])
    .filter((trait) => trait?.name !== "None")
    .filter((trait) => !excludedRobinhoodExclusiveTraits.has(trait?.name));
  if (slot === "Background" && mode === "indahood") {
    traits = traits.filter((trait) => trait.name === "INDAHOOD");
  }
  traits = traits
    .map((trait) => ({ name: trait.name, weight: trait.weight }));
  const none = catalog.none?.[slot];
  if (none?.enabled && Number(none.weight) > 0) {
    traits.push({ name: "None", weight: none.weight });
  }
  return traits;
}

function violatesCompatibility(selection) {
  if (
    selection.Accessories !== "None"
    && selection.Accessories === selection["Accessories 2"]
  ) return true;

  return (catalog.incompatibilityRules || []).some((rule) => {
    if (rule?.enabled === false) return false;
    const triggered = Object.entries(rule?.if || {}).every(([slot, names]) => (
      Array.isArray(names) && names.includes(selection[slot])
    ));
    if (!triggered) return false;
    return Object.entries(rule?.cannot || {}).some(([slot, names]) => (
      Array.isArray(names) && names.includes(selection[slot])
    ));
  });
}

function sampleSelection(random, seen, usedOneOfOneBackgrounds) {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const selection = Object.fromEntries(
      catalog.renderOrder.map((slot) => [slot, weightedChoice(slotOptions(slot), random).name]),
    );
    const key = catalog.renderOrder.map((slot) => selection[slot]).join("|");
    const backgroundCount = Number(catalog.exactTraitCounts?.Background?.[selection.Background] || 0);
    if (
      seen.has(key)
      || violatesCompatibility(selection)
      || (backgroundCount === 1 && usedOneOfOneBackgrounds.has(selection.Background))
    ) continue;
    seen.add(key);
    if (backgroundCount === 1) usedOneOfOneBackgrounds.add(selection.Background);
    return selection;
  }
  throw new Error("Unable to sample a unique compatible Robinhood droid.");
}

const assetByTrait = new Map(
  assetManifest.traits.map((trait) => [`${trait.slot}::${trait.name}`, trait.localPath]),
);

async function normalizedLayer(slot, name) {
  const relativePath = assetByTrait.get(`${slot}::${name}`);
  if (!relativePath) throw new Error(`Missing retained layer for ${slot}::${name}`);
  return sharp(path.join(projectRoot, relativePath))
    .resize(renderSize, renderSize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function renderSample(index, selection) {
  const layers = [];
  for (const slot of catalog.renderOrder) {
    const name = selection[slot];
    if (!name || name === "None") continue;
    layers.push({ input: await normalizedLayer(slot, name) });
  }

  const filename = `${outputPrefix}-${String(index + 1).padStart(2, "0")}.png`;
  const outputPath = path.join(outputRoot, filename);
  await sharp({
    create: {
      width: renderSize,
      height: renderSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(layers).png({ compressionLevel: 9 }).toFile(outputPath);

  return {
    sample: index + 1,
    image: path.relative(projectRoot, outputPath),
    traits: selection,
  };
}

async function renderContactSheet(samples) {
  const rows = Math.ceil(samples.length / samplesPerRow);
  const composites = samples.map((sample, index) => ({
    input: path.join(projectRoot, sample.image),
    left: (index % samplesPerRow) * renderSize,
    top: Math.floor(index / samplesPerRow) * renderSize,
  }));
  const outputPath = path.join(outputRoot, `${outputPrefix}-contact-sheet.png`);
  await sharp({
    create: {
      width: samplesPerRow * renderSize,
      height: rows * renderSize,
      channels: 4,
      background: { r: 8, g: 8, b: 8, alpha: 1 },
    },
  }).composite(composites).png({ compressionLevel: 9 }).toFile(outputPath);
  return path.relative(projectRoot, outputPath);
}

fs.mkdirSync(outputRoot, { recursive: true });
const random = mulberry32(seed);
const seen = new Set();
const usedOneOfOneBackgrounds = new Set();
const selections = Array.from(
  { length: sampleCount },
  () => sampleSelection(random, seen, usedOneOfOneBackgrounds),
);
const samples = [];
for (const [index, selection] of selections.entries()) {
  samples.push(await renderSample(index, selection));
}
const contactSheet = await renderContactSheet(samples);
const report = {
  schema: "dyoor-robinhood-sample-generations-v1",
  mode,
  seed,
  maxSupply: catalog.maxSupply,
  sourceCatalog: "data/robinhood/dyoor-trait-catalog.json",
  excludedRobinhoodExclusiveTraits: Array.from(excludedRobinhoodExclusiveTraits),
  contactSheet,
  samples,
};
writeJson(path.join(outputRoot, `${outputPrefix}-generations.json`), report);
console.log(JSON.stringify(report, null, 2));
