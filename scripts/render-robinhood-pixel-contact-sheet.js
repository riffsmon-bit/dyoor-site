import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data", "robinhood");
const requestedSet = process.argv.find((argument) => argument.startsWith("--set="))?.split("=")[1] || "1";
const outputDirectory = requestedSet === "1" ? "contact-sheet-128" : `contact-sheet-128-${requestedSet}`;
const outputRoot = path.join(dataRoot, "pixel-pilot", outputDirectory);
const gridSize = 128;
const paletteSize = 24;
const alphaThreshold = 96;
const thinMouthThresholds = [64, 32, 1];
const minimumMouthPixels = 12;
const cellSize = 512;
const columns = 3;
const gutter = 12;

const catalog = readJson(path.join(dataRoot, "dyoor-trait-catalog.json"));
const assetManifest = readJson(path.join(dataRoot, "dyoor-trait-asset-manifest.json"));
const assetByTrait = new Map(
  assetManifest.traits.map((trait) => [`${trait.slot}::${trait.name}`, trait.localPath]),
);

const sampleSets = {
  1: [
  {
    label: "Robinhood signature",
    traits: {
      Background: "INDAHOOD",
      Droid: "Green",
      Conditions: "None",
      Clothes: "Robinhood Green Tee",
      Mouth: "Gold Grill",
      Eyes: "Robinhood Green Shades",
      Hat: "Robinhood Feather Cap",
      Accessories: "None",
      "Accessories 2": "None",
    },
  },
  {
    label: "Damaged chrome",
    traits: {
      Background: "Cynically Censored-Project M.A.D.",
      Droid: "Dark Chrome",
      Conditions: "Dirty Broken'er",
      Clothes: "Leather Jacket",
      Mouth: "Resting DYOOR mouth",
      Eyes: "Radiation Glow",
      Hat: "Antenna",
      Accessories: "Bandaid",
      "Accessories 2": "None",
    },
  },
  {
    label: "Dirty formal",
    traits: {
      Background: "Eye Sea U-Project M.A.D.",
      Droid: "Red",
      Conditions: "Dirty-Broken",
      Clothes: "Tuxedo",
      Mouth: "Cigar Mouth",
      Eyes: "Third Eye",
      Hat: "Crown",
      Accessories: "None",
      "Accessories 2": "Choker Necklace",
    },
  },
  {
    label: "S1 throwback",
    traits: {
      Background: "The Way-Project M.A.D.",
      Droid: "White",
      Conditions: "S1 Skin",
      Clothes: "DWO Black",
      Mouth: "Diamond Grill",
      Eyes: "Zombie",
      Hat: "Halo",
      Accessories: "Bandana Black",
      "Accessories 2": "None",
    },
  },
  {
    label: "Dual accessory",
    traits: {
      Background: "INDAHOOD",
      Droid: "Purple",
      Conditions: "None",
      Clothes: "White Tee",
      Mouth: "Meh",
      Eyes: "Excited",
      Hat: "Captain Hat",
      Accessories: "Bandaid",
      "Accessories 2": "Choker Necklace",
    },
  },
  {
    label: "Emo layers",
    traits: {
      Background: "Painfully Here-Project M.A.D.",
      Droid: "Pank",
      Conditions: "None",
      Clothes: "Emo Tee",
      Mouth: "Emo Sheesh",
      Eyes: "Emo Eyeliner",
      Hat: "Alternative",
      Accessories: "Bandana Pink",
      "Accessories 2": "Bandaid",
    },
  },
  {
    label: "Sealuminati chain",
    traits: {
      Background: "Soul Catcher-Project M.A.D.",
      Droid: "Gold Chrome",
      Conditions: "None",
      Clothes: "Black Tee",
      Mouth: "Braces",
      Eyes: "Cyclops",
      Hat: "Horns",
      Accessories: "Sealuminati chain",
      "Accessories 2": "None",
    },
  },
  {
    label: "Second-slot chain",
    traits: {
      Background: "Sad Cook-Project M.A.D.",
      Droid: "Blue",
      Conditions: "None",
      Clothes: "DWO White",
      Mouth: "Deep Thought",
      Eyes: "Googley Eyes",
      Hat: "Construction",
      Accessories: "None",
      "Accessories 2": "Sealuminati chain",
    },
  },
  {
    label: "Crowded pirate",
    traits: {
      Background: "Fxxk Crabs-Project M.A.D.",
      Droid: "Orange",
      Conditions: "None",
      Clothes: "Overalls",
      Mouth: "Party Horn Mouth",
      Eyes: "Eye Patch",
      Hat: "Pirate Hat",
      Accessories: "MESH Bandanna",
      "Accessories 2": "Bandaid",
    },
  },
  ],
  2: [
    {
      label: "Midnight builder",
      traits: {
        Background: "INDAHOOD",
        Droid: "Black",
        Conditions: "None",
        Clothes: "BuildAnything Tee",
        Mouth: "AHHHH",
        Eyes: "VR Headset",
        Hat: "Black Cap",
        Accessories: "None",
        "Accessories 2": "Choker Necklace",
      },
    },
    {
      label: "Golden casino",
      traits: {
        Background: "Tisumusem-Project M.A.D.",
        Droid: "Gold",
        Conditions: "None",
        Clothes: "King's Robe 2",
        Mouth: "Vamp Fangs",
        Eyes: "Intense",
        Hat: "Casino",
        Accessories: "None",
        "Accessories 2": "Bandaid",
      },
    },
    {
      label: "Chrome laser",
      traits: {
        Background: "Don't Look At The Lighthouse-Project M.A.D.",
        Droid: "Green Chrome",
        Conditions: "Dirty Broken'er",
        Clothes: "Orange Racer",
        Mouth: "Joint Mouth",
        Eyes: "Abyss Laser",
        Hat: "Glowing Antenna",
        Accessories: "Bandaid",
        "Accessories 2": "None",
      },
    },
    {
      label: "Lime tech",
      traits: {
        Background: "Simovision-Project M.A.D.",
        Droid: "Lime Green",
        Conditions: "None",
        Clothes: "Tech Bro",
        Mouth: "Gold Bar",
        Eyes: "Pit Viper",
        Hat: "DYOOR Flipped Brim",
        Accessories: "Choker Necklace",
        "Accessories 2": "None",
      },
    },
    {
      label: "Olive wormhole",
      traits: {
        Background: "The Way-Project M.A.D.",
        Droid: "Olive Chrome",
        Conditions: "None",
        Clothes: "Fur Coat Purple",
        Mouth: "Pepe Mouth",
        Eyes: "HMMMHM",
        Hat: "Wormhole",
        Accessories: "None",
        "Accessories 2": "None",
      },
    },
    {
      label: "Space cowboy",
      traits: {
        Background: "Eye Sea U-Project M.A.D.",
        Droid: "Olive",
        Conditions: "None",
        Clothes: "Hawaiian Shirt",
        Mouth: "Pipe",
        Eyes: "Sly",
        Hat: "Cowboy",
        Accessories: "Choker Necklace",
        "Accessories 2": "None",
      },
    },
    {
      label: "Optimus DWO",
      traits: {
        Background: "Painfully Here-Project M.A.D.",
        Droid: "Optimus (T3SLA Bot)",
        Conditions: "S1 Skin",
        Clothes: "Leather Jacket White Shirt W:Tie",
        Mouth: "Ayeee",
        Eyes: "Radiation Glow (Red)",
        Hat: "DWO Black Cap",
        Accessories: "Bandaid",
        "Accessories 2": "None",
      },
    },
    {
      label: "Rose PamPam",
      traits: {
        Background: "Sad Cook-Project M.A.D.",
        Droid: "Rose Chrome",
        Conditions: "None",
        Clothes: "PAMPAM Tee",
        Mouth: "Toothless Drool",
        Eyes: "Scared",
        Hat: "PamPam",
        Accessories: "None",
        "Accessories 2": "None",
      },
    },
    {
      label: "Yellow Neverland",
      traits: {
        Background: "Soul Catcher-Project M.A.D.",
        Droid: "Yellow",
        Conditions: "None",
        Clothes: "Neverland Tee",
        Mouth: "AHHH Tongue",
        Eyes: "Neverland Specs",
        Hat: "Wormhole",
        Accessories: "None",
        "Accessories 2": "Bandaid",
      },
    },
  ],
};

const samples = sampleSets[requestedSet];
if (!samples) throw new Error(`Unknown sample set ${requestedSet}. Expected one of: ${Object.keys(sampleSets).join(", ")}.`);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function assertSelections() {
  const violations = [];
  for (const [index, sample] of samples.entries()) {
    for (const slot of catalog.renderOrder) {
      const name = sample.traits[slot];
      if (!name) throw new Error(`Sample ${index + 1} is missing ${slot}.`);
      if (name === "None") continue;
      const retained = (catalog.traits[slot] || []).some((trait) => trait.name === name);
      if (!retained) throw new Error(`Sample ${index + 1} uses missing ${slot} trait ${name}.`);
      if (!assetByTrait.has(`${slot}::${name}`)) {
        throw new Error(`Sample ${index + 1} has no asset for ${slot}::${name}.`);
      }
    }

    if (
      sample.traits.Accessories !== "None"
      && sample.traits.Accessories === sample.traits["Accessories 2"]
    ) {
      violations.push({ sample: index + 1, rule: "Duplicate accessory slots" });
    }

    for (const rule of catalog.incompatibilityRules || []) {
      if (rule.enabled === false) continue;
      const triggered = Object.entries(rule.if || {}).every(([slot, names]) => (
        Array.isArray(names) && names.includes(sample.traits[slot])
      ));
      if (!triggered) continue;
      const conflict = Object.entries(rule.cannot || {}).find(([slot, names]) => (
        Array.isArray(names) && names.includes(sample.traits[slot])
      ));
      if (conflict) {
        violations.push({
          sample: index + 1,
          rule: rule.name,
          slot: conflict[0],
          trait: sample.traits[conflict[0]],
        });
      }
    }
  }

  if (violations.length) {
    throw new Error(`Curated selections violate compatibility rules:\n${JSON.stringify(violations, null, 2)}`);
  }
}

function countOpaquePixels(data, channels, threshold) {
  let count = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    if (data[offset + 3] >= threshold) count += 1;
  }
  return count;
}

async function pixelLayer(inputPath, slot) {
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
  if (slot === "Mouth" && opaquePixels < minimumMouthPixels) {
    for (const fallbackThreshold of thinMouthThresholds) {
      const fallbackPixels = countOpaquePixels(data, info.channels, fallbackThreshold);
      if (fallbackPixels >= minimumMouthPixels) {
        appliedAlphaThreshold = fallbackThreshold;
        opaquePixels = fallbackPixels;
        break;
      }
    }
  }
  for (let offset = 0; offset < data.length; offset += info.channels) {
    data[offset + 3] = data[offset + 3] < appliedAlphaThreshold ? 0 : 255;
  }
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ palette: true, colours: paletteSize, dither: 0, compressionLevel: 9 })
    .toBuffer();
  return { data, info, png, appliedAlphaThreshold, opaquePixels };
}

function colorKey(data, offset) {
  return `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
}

function colorHex(key) {
  return `#${key
    .split(",")
    .map((value) => Number(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rectanglesForLayer(layer) {
  const completed = [];
  let active = new Map();
  for (let y = 0; y < gridSize; y += 1) {
    const row = [];
    let x = 0;
    while (x < gridSize) {
      const offset = (y * gridSize + x) * layer.info.channels;
      if (layer.data[offset + 3] === 0) {
        x += 1;
        continue;
      }
      const color = colorKey(layer.data, offset);
      let width = 1;
      while (x + width < gridSize) {
        const nextOffset = (y * gridSize + x + width) * layer.info.channels;
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

function svgFragment(layer) {
  const byColor = new Map();
  for (const rectangle of rectanglesForLayer(layer)) {
    if (!byColor.has(rectangle.color)) byColor.set(rectangle.color, []);
    byColor.get(rectangle.color).push(rectangle);
  }
  return Array.from(byColor.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([color, rectangles]) => {
      const pathData = rectangles.map(({ x, y, width, height }) => (
        `M${x} ${y}h${width}v${height}h-${width}z`
      )).join("");
      return `<path fill="${colorHex(color)}" d="${pathData}"/>`;
    })
    .join("");
}

async function exactSvgMatch(svg, png) {
  const [rendered, expected] = await Promise.all([
    sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  let mismatchedPixels = 0;
  for (let offset = 0; offset < rendered.data.length; offset += rendered.info.channels) {
    for (let channel = 0; channel < rendered.info.channels; channel += 1) {
      if (rendered.data[offset + channel] !== expected.data[offset + channel]) {
        mismatchedPixels += 1;
        break;
      }
    }
  }
  return {
    exactMatch: mismatchedPixels === 0,
    mismatchedPixels,
    totalPixels: gridSize * gridSize,
  };
}

assertSelections();
fs.mkdirSync(outputRoot, { recursive: true });
const layerCache = new Map();
const renderedSamples = [];

for (const [sampleIndex, sample] of samples.entries()) {
  const layers = [];
  const fragments = [];
  for (const slot of catalog.renderOrder) {
    const name = sample.traits[slot];
    if (name === "None") continue;
    const localPath = assetByTrait.get(`${slot}::${name}`);
    const absolutePath = path.join(projectRoot, localPath);
    if (!layerCache.has(absolutePath)) layerCache.set(absolutePath, await pixelLayer(absolutePath, slot));
    const layer = layerCache.get(absolutePath);
    if (slot === "Mouth" && layer.opaquePixels < minimumMouthPixels) {
      throw new Error(`Mouth ${name} has only ${layer.opaquePixels} visible pixels in sample ${sampleIndex + 1}.`);
    }
    layers.push({ input: layer.png });
    fragments.push(svgFragment(layer));
  }

  const composite = await sharp({
    create: {
      width: gridSize,
      height: gridSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(layers).png({ compressionLevel: 9 }).toBuffer();
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${gridSize}" height="${gridSize}" viewBox="0 0 ${gridSize} ${gridSize}" shape-rendering="crispEdges">`,
    ...fragments,
    "</svg>",
  ].join("");
  const validation = await exactSvgMatch(svg, composite);
  if (!validation.exactMatch) throw new Error(`SVG mismatch in sample ${sampleIndex + 1}.`);

  const number = String(sampleIndex + 1).padStart(2, "0");
  const gridPath = path.join(outputRoot, `sample-${number}-${gridSize}.png`);
  const previewPath = path.join(outputRoot, `sample-${number}-preview.png`);
  const svgPath = path.join(outputRoot, `sample-${number}.svg`);
  fs.writeFileSync(gridPath, composite);
  fs.writeFileSync(svgPath, svg);
  const preview = await sharp(composite)
    .resize(cellSize, cellSize, { fit: "fill", kernel: sharp.kernel.nearest })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(previewPath, preview);
  renderedSamples.push({
    sample: sampleIndex + 1,
    label: sample.label,
    traits: sample.traits,
    gridImage: relative(gridPath),
    preview: relative(previewPath),
    svg: relative(svgPath),
    svgBytes: byteLength(svg),
    svgSha256: sha256(svg),
    validation,
    previewBuffer: preview,
  });
}

const rows = Math.ceil(renderedSamples.length / columns);
const sheetWidth = (columns * cellSize) + ((columns + 1) * gutter);
const sheetHeight = (rows * cellSize) + ((rows + 1) * gutter);
const sheetPath = path.join(outputRoot, `hoodyoor-128-contact-sheet-${requestedSet}.png`);
await sharp({
  create: {
    width: sheetWidth,
    height: sheetHeight,
    channels: 4,
    background: { r: 7, g: 10, b: 6, alpha: 1 },
  },
})
  .composite(renderedSamples.map((sample, index) => ({
    input: sample.previewBuffer,
    left: gutter + ((index % columns) * (cellSize + gutter)),
    top: gutter + (Math.floor(index / columns) * (cellSize + gutter)),
  })))
  .png({ compressionLevel: 9 })
  .toFile(sheetPath);

const slotCoverage = Object.fromEntries(catalog.renderOrder.map((slot) => {
  const values = samples.map((sample) => sample.traits[slot]).filter((name) => name !== "None");
  return [slot, {
    exercised: values.length > 0,
    sampleCount: values.length,
    distinctTraits: Array.from(new Set(values)),
  }];
}));
const report = {
  schema: "dyoor-hoodyoor-pixel-contact-sheet-v2",
  generatedAt: new Date().toISOString(),
  settings: {
    sampleSet: requestedSet,
    gridSize,
    paletteSize,
    alphaThreshold,
    thinMouthThresholds,
    minimumMouthPixels,
    cellSize,
    columns,
    gutter,
  },
  contactSheet: relative(sheetPath),
  validation: {
    compatibleSelections: true,
    allNineSlotsExercised: Object.values(slotCoverage).every((slot) => slot.exercised),
    exactSvgSamples: renderedSamples.filter((sample) => sample.validation.exactMatch).length,
    sampleCount: renderedSamples.length,
  },
  slotCoverage,
  samples: renderedSamples.map(({ previewBuffer, ...sample }) => sample),
};
const reportPath = path.join(outputRoot, `hoodyoor-128-contact-sheet-${requestedSet}-report.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  contactSheet: report.contactSheet,
  report: relative(reportPath),
  validation: report.validation,
  slotCoverage,
}, null, 2));
