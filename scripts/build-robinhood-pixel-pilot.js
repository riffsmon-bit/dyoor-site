import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data", "robinhood");
const pilotRoot = path.join(dataRoot, "pixel-pilot");
const variantName = argumentValue("variant");
const outputRoot = variantName ? path.join(pilotRoot, variantName) : pilotRoot;
const layerOutputRoot = path.join(outputRoot, "layers");
const assetManifestPath = path.join(dataRoot, "dyoor-trait-asset-manifest.json");
const conceptArgument = argumentValue("concept");
const conceptPath = conceptArgument
  ? path.resolve(projectRoot, conceptArgument)
  : path.join(outputRoot, "hoodyoor-pixel-art-concept.png");

const gridSize = positiveInteger(argumentValue("size"), 64);
const paletteSize = positiveInteger(argumentValue("colors"), 16);
const previewSize = positiveInteger(argumentValue("preview-size"), 1024);
const alphaThreshold = boundedInteger(argumentValue("alpha-threshold"), 96, 1, 254);
const mouthName = argumentValue("mouth");
const bytecodeChunkPayload = 24_000;

if (gridSize > 256) {
  throw new Error("The packed rectangle benchmark currently supports grids up to 256x256.");
}
if (paletteSize > 32) {
  throw new Error("Use at most 32 colors per trait for this pilot.");
}
const coordinateBits = Math.max(1, Math.ceil(Math.log2(gridSize)));
const packedRectangleBytesPerRectangle = Math.ceil((coordinateBits * 4) / 8);

const pilotLayers = [
  {
    slot: "Background",
    name: "INDAHOOD",
    localPath: "data/robinhood/layers/Background/INDAHOOD.png",
  },
  {
    slot: "Droid",
    name: "Green",
    localPath: "data/robinhood/layers/Droid/Green.webp",
  },
  {
    slot: "Clothes",
    name: "Robinhood Green Tee",
    localPath: "data/robinhood/layers/Clothes/Robinhood Green Tee.png",
  },
  ...(mouthName ? [{
    slot: "Mouth",
    name: mouthName,
    localPath: `data/robinhood/layers/Mouth/${mouthName}.png`,
  }] : []),
  {
    slot: "Eyes",
    name: "Robinhood Green Shades",
    localPath: "data/robinhood/layers/Eyes/Robinhood Green Shades.png",
  },
  {
    slot: "Hat",
    name: "Robinhood Feather Cap",
    localPath: "data/robinhood/layers/Hat/Robinhood Feather Cap.png",
  },
];

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

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = positiveInteger(value, fallback);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}, received ${parsed}.`);
  }
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rgbaKey(red, green, blue) {
  return `${red},${green},${blue}`;
}

function hexColor(key) {
  return `#${key
    .split(",")
    .map((component) => Number(component).toString(16).padStart(2, "0"))
    .join("")}`;
}

async function pixelateImage(inputPath, colors = paletteSize) {
  const quantized = await sharp(inputPath)
    .resize(gridSize, gridSize, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .png({
      palette: true,
      colours: colors,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();

  const { data, info } = await sharp(quantized)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    data[offset + 3] = data[offset + 3] < alphaThreshold ? 0 : 255;
  }

  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function pngFromPixels(pixels, colors = paletteSize) {
  return sharp(pixels.data, {
    raw: {
      width: pixels.width,
      height: pixels.height,
      channels: pixels.channels,
    },
  })
    .png({
      palette: true,
      colours: colors,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();
}

function rowRuns(pixels, y) {
  const runs = [];
  let x = 0;

  while (x < pixels.width) {
    const offset = (y * pixels.width + x) * pixels.channels;
    const alpha = pixels.data[offset + 3];
    if (alpha === 0) {
      x += 1;
      continue;
    }

    const color = rgbaKey(
      pixels.data[offset],
      pixels.data[offset + 1],
      pixels.data[offset + 2],
    );
    let width = 1;
    while (x + width < pixels.width) {
      const nextOffset = (y * pixels.width + x + width) * pixels.channels;
      const nextColor = rgbaKey(
        pixels.data[nextOffset],
        pixels.data[nextOffset + 1],
        pixels.data[nextOffset + 2],
      );
      if (pixels.data[nextOffset + 3] === 0 || nextColor !== color) break;
      width += 1;
    }

    runs.push({ color, x, y, width, height: 1 });
    x += width;
  }

  return runs;
}

function mergedRectangles(pixels) {
  const finalized = [];
  let active = new Map();

  for (let y = 0; y < pixels.height; y += 1) {
    const next = new Map();
    for (const run of rowRuns(pixels, y)) {
      const key = `${run.color}:${run.x}:${run.width}`;
      const previous = active.get(key);
      if (previous) {
        previous.height += 1;
        next.set(key, previous);
      } else {
        next.set(key, run);
      }
    }

    for (const [key, rectangle] of active) {
      if (!next.has(key)) finalized.push(rectangle);
    }
    active = next;
  }

  finalized.push(...active.values());
  return finalized;
}

function encodedLayer(pixels) {
  const rectangles = mergedRectangles(pixels);
  const byColor = new Map();
  for (const rectangle of rectangles) {
    if (!byColor.has(rectangle.color)) byColor.set(rectangle.color, []);
    byColor.get(rectangle.color).push(rectangle);
  }

  const colorEntries = Array.from(byColor.entries()).sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  const fragment = colorEntries
    .map(([color, colorRectangles]) => {
      const commands = colorRectangles
        .map(({ x, y, width, height }) => (
          `M${x} ${y}h${width}v${height}h-${width}z`
        ))
        .join("");
      return `<path fill="${hexColor(color)}" d="${commands}"/>`;
    })
    .join("");

  // Benchmark format: one-byte palette count, RGB palette entries, a uint16
  // rectangle count per color, then four equally sized x/y/w/h bit fields.
  const packedRectangleBytes = 1 + (colorEntries.length * 3)
    + (colorEntries.length * 2)
    + (rectangles.length * packedRectangleBytesPerRectangle);

  return {
    fragment,
    colors: colorEntries.length,
    rectangles: rectangles.length,
    svgFragmentBytes: byteLength(fragment),
    packedRectangleBytes,
  };
}

async function compositePng(layerBuffers) {
  return sharp({
    create: {
      width: gridSize,
      height: gridSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layerBuffers.map((input) => ({ input })))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function upscaledPreview(input) {
  return sharp(input)
    .resize(previewSize, previewSize, {
      fit: "fill",
      kernel: sharp.kernel.nearest,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function compareSvgToPng(svg, png) {
  const [svgPixels, pngPixels] = await Promise.all([
    sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    svgPixels.info.width !== pngPixels.info.width
    || svgPixels.info.height !== pngPixels.info.height
    || svgPixels.info.channels !== pngPixels.info.channels
  ) {
    return {
      exactMatch: false,
      mismatchedPixels: null,
      error: `Dimension mismatch: SVG ${svgPixels.info.width}x${svgPixels.info.height}, PNG ${pngPixels.info.width}x${pngPixels.info.height}.`,
    };
  }

  let mismatchedPixels = 0;
  for (let offset = 0; offset < svgPixels.data.length; offset += svgPixels.info.channels) {
    let pixelMatches = true;
    for (let channel = 0; channel < svgPixels.info.channels; channel += 1) {
      if (svgPixels.data[offset + channel] !== pngPixels.data[offset + channel]) {
        pixelMatches = false;
        break;
      }
    }
    if (!pixelMatches) mismatchedPixels += 1;
  }
  return {
    exactMatch: mismatchedPixels === 0,
    mismatchedPixels,
    totalPixels: svgPixels.info.width * svgPixels.info.height,
  };
}

function chunkCount(sizes) {
  let chunks = 0;
  let used = 0;
  for (const size of sizes) {
    if (!chunks || used + size > bytecodeChunkPayload) {
      chunks += 1;
      used = 0;
    }
    used += size;
  }
  return chunks;
}

function emptySlotSummary() {
  return {
    traitCount: 0,
    sourceRasterBytes: 0,
    colors: 0,
    rectangles: 0,
    svgFragmentBytes: 0,
    packedRectangleBytes: 0,
  };
}

async function catalogEstimate(manifest, cachedPixels) {
  const traits = [];
  const bySlot = {};

  for (const trait of manifest.traits) {
    const absolutePath = path.join(projectRoot, trait.localPath);
    const cacheKey = absolutePath;
    let pixels = cachedPixels.get(cacheKey);
    if (!pixels) {
      pixels = await pixelateImage(absolutePath);
      cachedPixels.set(cacheKey, pixels);
    }
    const encoded = encodedLayer(pixels);
    const sourceRasterBytes = fs.statSync(absolutePath).size;
    const summary = {
      slot: trait.slot,
      traitId: trait.traitId,
      name: trait.name,
      localPath: trait.localPath,
      sourceRasterBytes,
      colors: encoded.colors,
      rectangles: encoded.rectangles,
      svgFragmentBytes: encoded.svgFragmentBytes,
      packedRectangleBytes: encoded.packedRectangleBytes,
    };
    traits.push(summary);

    bySlot[trait.slot] ||= emptySlotSummary();
    bySlot[trait.slot].traitCount += 1;
    bySlot[trait.slot].sourceRasterBytes += sourceRasterBytes;
    bySlot[trait.slot].colors += encoded.colors;
    bySlot[trait.slot].rectangles += encoded.rectangles;
    bySlot[trait.slot].svgFragmentBytes += encoded.svgFragmentBytes;
    bySlot[trait.slot].packedRectangleBytes += encoded.packedRectangleBytes;
  }

  const totals = traits.reduce((summary, trait) => ({
    traitCount: summary.traitCount + 1,
    sourceRasterBytes: summary.sourceRasterBytes + trait.sourceRasterBytes,
    colors: summary.colors + trait.colors,
    rectangles: summary.rectangles + trait.rectangles,
    svgFragmentBytes: summary.svgFragmentBytes + trait.svgFragmentBytes,
    packedRectangleBytes: summary.packedRectangleBytes + trait.packedRectangleBytes,
  }), emptySlotSummary());

  return {
    totals: {
      ...totals,
      svgBytecodeChunks: chunkCount(traits.map((trait) => trait.svgFragmentBytes)),
      packedRectangleBytecodeChunks: chunkCount(
        traits.map((trait) => trait.packedRectangleBytes),
      ),
      bytecodeChunkPayload,
    },
    bySlot,
    traits,
  };
}

async function writeComparison(leftImage, rightImage, outputPath) {
  const comparison = await sharp({
    create: {
      width: previewSize * 2,
      height: previewSize,
      channels: 4,
      background: { r: 7, g: 10, b: 6, alpha: 1 },
    },
  })
    .composite([
      { input: leftImage, left: 0, top: 0 },
      { input: rightImage, left: previewSize, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(outputPath, comparison);
}

fs.mkdirSync(layerOutputRoot, { recursive: true });
const manifest = readJson(assetManifestPath);
const cachedPixels = new Map();
const renderedPilotLayers = [];
const pilotReport = [];

for (const [index, layer] of pilotLayers.entries()) {
  const absolutePath = path.join(projectRoot, layer.localPath);
  const pixels = await pixelateImage(absolutePath);
  cachedPixels.set(absolutePath, pixels);
  const png = await pngFromPixels(pixels);
  const encoded = encodedLayer(pixels);
  const slug = `${String(index + 1).padStart(2, "0")}-${layer.slot}-${layer.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const outputPath = path.join(layerOutputRoot, `${slug}-${gridSize}.png`);
  fs.writeFileSync(outputPath, png);
  renderedPilotLayers.push(png);
  pilotReport.push({
    ...layer,
    pixelLayer: relative(outputPath),
    sourceRasterBytes: fs.statSync(absolutePath).size,
    colors: encoded.colors,
    rectangles: encoded.rectangles,
    svgFragmentBytes: encoded.svgFragmentBytes,
    packedRectangleBytes: encoded.packedRectangleBytes,
    svgFragmentSha256: sha256(encoded.fragment),
    fragment: encoded.fragment,
  });
}

const composite64 = await compositePng(renderedPilotLayers);
const composite64Path = path.join(outputRoot, `hoodyoor-pixel-layer-composite-${gridSize}.png`);
fs.writeFileSync(composite64Path, composite64);

const compositePreview = await upscaledPreview(composite64);
const compositePreviewPath = path.join(outputRoot, "hoodyoor-pixel-layer-composite-preview.png");
fs.writeFileSync(compositePreviewPath, compositePreview);

const composedSvg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${gridSize}" height="${gridSize}" viewBox="0 0 ${gridSize} ${gridSize}" shape-rendering="crispEdges">`,
  ...pilotReport.map((layer) => layer.fragment),
  "</svg>",
].join("");
const composedSvgPath = path.join(outputRoot, "hoodyoor-pixel-layer-composite.svg");
fs.writeFileSync(composedSvgPath, composedSvg);
const svgValidation = await compareSvgToPng(composedSvg, composite64);

let concept = null;
if (fs.existsSync(conceptPath)) {
  const conceptPixels = await pixelateImage(conceptPath, 24);
  const concept64 = await pngFromPixels(conceptPixels, 24);
  const concept64Path = path.join(outputRoot, `hoodyoor-pixel-art-concept-${gridSize}.png`);
  fs.writeFileSync(concept64Path, concept64);
  const conceptPreview = await upscaledPreview(concept64);
  const conceptPreviewPath = path.join(outputRoot, "hoodyoor-pixel-art-concept-preview.png");
  fs.writeFileSync(conceptPreviewPath, conceptPreview);
  const comparisonPath = path.join(outputRoot, "hoodyoor-pixel-pilot-comparison.png");
  await writeComparison(conceptPreview, compositePreview, comparisonPath);
  concept = {
    generatedSource: relative(conceptPath),
    pixelGrid: relative(concept64Path),
    preview: relative(conceptPreviewPath),
    comparison: relative(comparisonPath),
  };
}

const catalog = await catalogEstimate(manifest, cachedPixels);
const pilotSvgBytes = byteLength(composedSvg);
const pilotPackedRectangleBytes = pilotReport.reduce(
  (total, layer) => total + layer.packedRectangleBytes,
  0,
);
const metadata = JSON.stringify({
  name: "HoodYØØR Pixel Pilot",
  description: "A fully on-chain pixel-layer feasibility pilot for HoodYØØR.",
  image: `data:image/svg+xml;base64,${Buffer.from(composedSvg).toString("base64")}`,
  attributes: pilotLayers.map((layer) => ({ trait_type: layer.slot, value: layer.name })),
});
const tokenUri = `data:application/json;base64,${Buffer.from(metadata).toString("base64")}`;

const report = {
  schema: "dyoor-hoodyoor-pixel-pilot-v2",
  generatedAt: new Date().toISOString(),
  purpose: "Feasibility benchmark before converting all retained HoodYØØR traits.",
  scope: {
    pilotTraits: pilotLayers.length,
    fullCatalogTraits: manifest.traits.length,
    note: "The pilot traits do not reduce the intended collection scope; all retained traits remain planned.",
  },
  settings: {
    variantName: variantName || null,
    gridSize,
    paletteSize,
    alphaThreshold,
    mouthName: mouthName || null,
    previewSize,
    coordinateBits,
    packedRectangleBytesPerRectangle,
    bytecodeChunkPayload,
  },
  outputs: {
    concept,
    layerCompositeGrid: relative(composite64Path),
    layerCompositePreview: relative(compositePreviewPath),
    layerCompositeSvg: relative(composedSvgPath),
  },
  pilot: {
    svgBytes: pilotSvgBytes,
    packedRectangleBytes: pilotPackedRectangleBytes,
    tokenUriBytes: byteLength(tokenUri),
    svgSha256: sha256(composedSvg),
    svgValidation,
    layers: pilotReport.map(({ fragment, ...layer }) => layer),
  },
  fullCatalogEstimate: catalog,
  caveats: [
    "This benchmark automatically reduces the existing raster layers; final hand-authored pixel art should improve silhouettes and usually compress better.",
    "Packed rectangle totals measure art payloads only and exclude deployment wrappers, lookup tables, trait names, and renderer bytecode.",
    "The token URI benchmark uses plain SVG fragments. A production renderer can choose stored SVG fragments or decode packed rectangles from bytecode.",
  ],
};

const reportPath = path.join(outputRoot, "hoodyoor-pixel-pilot-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  report: relative(reportPath),
  comparison: concept?.comparison || null,
  pilot: report.pilot,
  fullCatalogEstimate: report.fullCatalogEstimate.totals,
}, null, 2));
