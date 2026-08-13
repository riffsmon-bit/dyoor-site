import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethers";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data", "robinhood");
const outputRoot = path.join(dataRoot, "onchain-128");
const chunkRoot = path.join(outputRoot, "chunks");
const catalogPath = path.join(dataRoot, "dyoor-trait-catalog.json");
const assetManifestPath = path.join(dataRoot, "dyoor-trait-asset-manifest.json");

const gridSize = 128;
const coordinateBits = 7;
const paletteSize = 24;
const alphaThreshold = 96;
const thinMouthThresholds = [64, 32, 1];
const minimumMouthPixels = 12;
const chunkPayloadBytes = 24_000;

const catalog = readJson(catalogPath);
const assetManifest = readJson(assetManifestPath);
const layerIndex = new Map(catalog.renderOrder.map((slot, index) => [slot, index]));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function countOpaquePixels(data, channels, threshold) {
  let count = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    if (data[offset + 3] >= threshold) count += 1;
  }
  return count;
}

async function pixelLayer(trait) {
  const inputPath = path.join(projectRoot, trait.localPath);
  const quantized = await sharp(inputPath)
    .resize(gridSize, gridSize, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .png({ palette: true, colours: paletteSize, dither: 0, compressionLevel: 9 })
    .toBuffer();
  const { data, info } = await sharp(quantized)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let appliedAlphaThreshold = alphaThreshold;
  let opaquePixels = countOpaquePixels(data, info.channels, appliedAlphaThreshold);
  if (trait.slot === "Mouth" && opaquePixels < minimumMouthPixels) {
    for (const fallbackThreshold of thinMouthThresholds) {
      const fallbackPixels = countOpaquePixels(data, info.channels, fallbackThreshold);
      if (fallbackPixels >= minimumMouthPixels) {
        appliedAlphaThreshold = fallbackThreshold;
        opaquePixels = fallbackPixels;
        break;
      }
    }
  }
  if (opaquePixels === 0) {
    throw new Error(`${trait.slot}::${trait.name} has no visible pixels at 128x128.`);
  }

  for (let offset = 0; offset < data.length; offset += info.channels) {
    data[offset + 3] = data[offset + 3] < appliedAlphaThreshold ? 0 : 255;
  }
  return { data, channels: info.channels, appliedAlphaThreshold, opaquePixels };
}

function colorKey(data, offset) {
  return `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
}

function colorHex(key) {
  return `#${key.split(",").map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
}

function rectanglesForLayer(layer) {
  const completed = [];
  let active = new Map();

  for (let y = 0; y < gridSize; y += 1) {
    const row = [];
    let x = 0;
    while (x < gridSize) {
      const offset = (y * gridSize + x) * layer.channels;
      if (layer.data[offset + 3] === 0) {
        x += 1;
        continue;
      }
      const color = colorKey(layer.data, offset);
      let width = 1;
      while (x + width < gridSize) {
        const nextOffset = (y * gridSize + x + width) * layer.channels;
        if (
          layer.data[nextOffset + 3] === 0
          || colorKey(layer.data, nextOffset) !== color
        ) break;
        width += 1;
      }
      row.push({ color, x, y, width, height: 1 });
      x += width;
    }

    const next = new Map();
    for (const rectangle of row) {
      const key = `${rectangle.color}:${rectangle.x}:${rectangle.width}`;
      const previous = active.get(key);
      if (previous) {
        previous.height += 1;
        next.set(key, previous);
      } else {
        next.set(key, rectangle);
      }
    }
    for (const [key, rectangle] of active) {
      if (!next.has(key)) completed.push(rectangle);
    }
    active = next;
  }
  completed.push(...active.values());
  return completed;
}

function packRectangle({ x, y, width, height }) {
  const value = x
    | (y << coordinateBits)
    | ((width - 1) << (coordinateBits * 2))
    | ((height - 1) << (coordinateBits * 3));
  if (value < 0 || value > 0x0fffffff) throw new Error("Rectangle exceeds 28 packed bits.");
  return value;
}

function encodeLayer(layer) {
  const byColor = new Map();
  for (const rectangle of rectanglesForLayer(layer)) {
    if (!byColor.has(rectangle.color)) byColor.set(rectangle.color, []);
    byColor.get(rectangle.color).push(rectangle);
  }
  const groups = Array.from(byColor.entries()).sort(([left], [right]) => left.localeCompare(right));
  if (groups.length === 0 || groups.length > 32) {
    throw new Error(`Packed layer has invalid color group count ${groups.length}.`);
  }

  const buffers = [Buffer.from([groups.length])];
  const fragmentParts = [];
  let rectangleCount = 0;
  for (const [color, rectangles] of groups) {
    if (rectangles.length > 0xffff) throw new Error("A color group exceeds uint16 rectangles.");
    const [red, green, blue] = color.split(",").map(Number);
    const header = Buffer.alloc(5);
    header[0] = red;
    header[1] = green;
    header[2] = blue;
    header.writeUInt16BE(rectangles.length, 3);
    buffers.push(header);

    const rectangleBytes = Buffer.alloc(rectangles.length * 4);
    rectangles.forEach((rectangle, index) => {
      rectangleBytes.writeUInt32BE(packRectangle(rectangle), index * 4);
    });
    buffers.push(rectangleBytes);
    rectangleCount += rectangles.length;

    const commands = rectangles.map(({ x, y, width, height }) => (
      `M${x} ${y}h${width}v${height}h-${width}z`
    )).join("");
    fragmentParts.push(`<path fill="${colorHex(color)}" d="${commands}"/>`);
  }

  return {
    packed: Buffer.concat(buffers),
    fragment: fragmentParts.join(""),
    colors: groups.length,
    rectangles: rectangleCount,
  };
}

function decodePackedLayer(packed) {
  let cursor = 0;
  const colorCount = packed[cursor++];
  const fragmentParts = [];
  for (let colorIndex = 0; colorIndex < colorCount; colorIndex += 1) {
    if (cursor + 5 > packed.length) throw new Error("Truncated packed color group.");
    const color = `${packed[cursor]},${packed[cursor + 1]},${packed[cursor + 2]}`;
    cursor += 3;
    const rectangleCount = packed.readUInt16BE(cursor);
    cursor += 2;
    const commands = [];
    for (let rectangleIndex = 0; rectangleIndex < rectangleCount; rectangleIndex += 1) {
      if (cursor + 4 > packed.length) throw new Error("Truncated packed rectangle.");
      const value = packed.readUInt32BE(cursor);
      cursor += 4;
      if (value >>> 28) throw new Error("Packed rectangle uses reserved bits.");
      const x = value & 0x7f;
      const y = (value >>> 7) & 0x7f;
      const width = ((value >>> 14) & 0x7f) + 1;
      const height = ((value >>> 21) & 0x7f) + 1;
      if (x + width > gridSize || y + height > gridSize) {
        throw new Error("Packed rectangle escapes the 128x128 grid.");
      }
      commands.push(`M${x} ${y}h${width}v${height}h-${width}z`);
    }
    fragmentParts.push(`<path fill="${colorHex(color)}" d="${commands.join("")}"/>`);
  }
  if (cursor !== packed.length) throw new Error("Packed layer contains trailing bytes.");
  return fragmentParts.join("");
}

function assertCatalogCoverage(traits) {
  const manifestKeys = new Set();
  const ids = new Set();
  for (const trait of traits) {
    if (!layerIndex.has(trait.slot)) throw new Error(`Unknown slot ${trait.slot}.`);
    if (!Number.isInteger(trait.traitId) || trait.traitId <= 0 || trait.traitId > 0xffff) {
      throw new Error(`Invalid trait ID for ${trait.slot}::${trait.name}.`);
    }
    const key = `${trait.slot}::${trait.name}`;
    const idKey = `${trait.slot}::${trait.traitId}`;
    if (manifestKeys.has(key) || ids.has(idKey)) throw new Error(`Duplicate trait ${key}/${idKey}.`);
    manifestKeys.add(key);
    ids.add(idKey);
  }

  for (const slot of catalog.renderOrder) {
    for (const trait of catalog.traits[slot] || []) {
      if (trait.name !== "None" && !manifestKeys.has(`${slot}::${trait.name}`)) {
        throw new Error(`Asset manifest is missing ${slot}::${trait.name}.`);
      }
    }
  }
}

const sortedTraits = [...assetManifest.traits].sort((left, right) => (
  layerIndex.get(left.slot) - layerIndex.get(right.slot)
  || left.traitId - right.traitId
  || left.name.localeCompare(right.name)
));
assertCatalogCoverage(sortedTraits);

const payloadParts = [];
const records = [];
let payloadOffset = 0;
let totalRectangles = 0;
let fallbackMouths = 0;

for (const [index, trait] of sortedTraits.entries()) {
  const layer = await pixelLayer(trait);
  const encoded = encodeLayer(layer);
  const decodedFragment = decodePackedLayer(encoded.packed);
  if (decodedFragment !== encoded.fragment) {
    throw new Error(`Packed decoder mismatch for ${trait.slot}::${trait.name}.`);
  }

  const name = Buffer.from(trait.name, "utf8");
  const nameOffset = payloadOffset;
  payloadParts.push(name);
  payloadOffset += name.length;
  const artOffset = payloadOffset;
  payloadParts.push(encoded.packed);
  payloadOffset += encoded.packed.length;
  totalRectangles += encoded.rectangles;
  if (layer.appliedAlphaThreshold !== alphaThreshold) fallbackMouths += 1;

  records.push({
    layer: layerIndex.get(trait.slot),
    slot: trait.slot,
    traitId: trait.traitId,
    name: trait.name,
    weight: trait.weight,
    nameOffset,
    nameLength: name.length,
    artOffset,
    artLength: encoded.packed.length,
    colors: encoded.colors,
    rectangles: encoded.rectangles,
    opaquePixels: layer.opaquePixels,
    alphaThreshold: layer.appliedAlphaThreshold,
    packedSha256: sha256(encoded.packed),
    packedKeccak256: keccak256(encoded.packed),
    svgBytes: Buffer.byteLength(encoded.fragment),
    svgSha256: sha256(encoded.fragment),
    svgKeccak256: keccak256(Buffer.from(encoded.fragment)),
  });

  if ((index + 1) % 20 === 0 || index + 1 === sortedTraits.length) {
    console.log(`encoded ${index + 1}/${sortedTraits.length} traits`);
  }
}

const payload = Buffer.concat(payloadParts);
if (payload.length !== payloadOffset || payload.length > 0xffffffff) {
  throw new Error("Payload length accounting failed.");
}

const chunks = [];
for (let offset = 0; offset < payload.length; offset += chunkPayloadBytes) {
  const bytes = payload.subarray(offset, Math.min(offset + chunkPayloadBytes, payload.length));
  const index = chunks.length;
  const outputPath = path.join(chunkRoot, `chunk-${String(index).padStart(3, "0")}.bin`);
  chunks.push({
    index,
    offset,
    bytes: bytes.length,
    final: offset + bytes.length === payload.length,
    path: relative(outputPath),
    sha256: sha256(bytes),
    keccak256: keccak256(bytes),
    buffer: bytes,
  });
}

const provenance = {
  schema: "dyoor-hoodyoor-onchain-art-provenance-v1",
  gridSize,
  paletteSize,
  alphaThreshold,
  thinMouthThresholds,
  minimumMouthPixels,
  chunkPayloadBytes,
  catalogSha256: sha256(fs.readFileSync(catalogPath)),
  assetManifestSha256: sha256(fs.readFileSync(assetManifestPath)),
  payloadSha256: sha256(payload),
  payloadKeccak256: keccak256(payload),
  records: records.map((record) => ({
    layer: record.layer,
    traitId: record.traitId,
    nameOffset: record.nameOffset,
    nameLength: record.nameLength,
    artOffset: record.artOffset,
    artLength: record.artLength,
    packedKeccak256: record.packedKeccak256,
    svgKeccak256: record.svgKeccak256,
  })),
};
const provenanceJson = JSON.stringify(provenance);
const catalogHash = keccak256(Buffer.from(provenanceJson));
const recordBytes = Buffer.alloc(records.length * 17);
records.forEach((record, index) => {
  const cursor = index * 17;
  recordBytes[cursor] = record.layer;
  recordBytes.writeUInt16BE(record.traitId, cursor + 1);
  recordBytes.writeUInt32BE(record.nameOffset, cursor + 3);
  recordBytes.writeUInt16BE(record.nameLength, cursor + 7);
  recordBytes.writeUInt32BE(record.artOffset, cursor + 9);
  recordBytes.writeUInt32BE(record.artLength, cursor + 13);
});

const report = {
  schema: "dyoor-hoodyoor-onchain-art-v1",
  generatedAt: new Date().toISOString(),
  collection: "HoodYØØR",
  targetChain: assetManifest.targetChain,
  settings: {
    gridSize,
    coordinateBits,
    paletteSize,
    alphaThreshold,
    thinMouthThresholds,
    minimumMouthPixels,
    chunkPayloadBytes,
  },
  contracts: {
    traitStore: "HoodYOORPackedTraitStore",
    renderer: "HoodYOORPixelRenderer",
    expectedTraitCount: records.length,
    catalogHash,
  },
  totals: {
    traits: records.length,
    rectangles: totalRectangles,
    payloadBytes: payload.length,
    payloadSha256: sha256(payload),
    payloadKeccak256: keccak256(payload),
    chunks: chunks.length,
    fullChunks: chunks.filter((chunk) => !chunk.final).length,
    finalChunkBytes: chunks.at(-1)?.bytes || 0,
    adaptiveMouthTraits: fallbackMouths,
  },
  sources: {
    catalog: relative(catalogPath),
    catalogSha256: provenance.catalogSha256,
    assetManifest: relative(assetManifestPath),
    assetManifestSha256: provenance.assetManifestSha256,
  },
  payload: relative(path.join(outputRoot, "hoodyoor-onchain-art.bin")),
  recordTable: {
    path: relative(path.join(outputRoot, "hoodyoor-trait-records.bin")),
    recordBytes: 17,
    bytes: recordBytes.length,
    sha256: sha256(recordBytes),
    keccak256: keccak256(recordBytes),
  },
  chunks: chunks.map(({ buffer, ...chunk }) => chunk),
  records,
};

fs.mkdirSync(chunkRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "hoodyoor-onchain-art.bin"), payload);
fs.writeFileSync(path.join(outputRoot, "hoodyoor-trait-records.bin"), recordBytes);
for (const chunk of chunks) fs.writeFileSync(path.join(projectRoot, chunk.path), chunk.buffer);
fs.writeFileSync(
  path.join(outputRoot, "hoodyoor-onchain-art-manifest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputRoot, "hoodyoor-onchain-art-provenance.json"), `${provenanceJson}\n`);

console.log(JSON.stringify({
  manifest: relative(path.join(outputRoot, "hoodyoor-onchain-art-manifest.json")),
  payload: report.payload,
  catalogHash,
  totals: report.totals,
}, null, 2));
