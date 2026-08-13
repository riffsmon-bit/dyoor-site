import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvasSize = 4096;
const robinhoodGreen = { r: 200, g: 248, b: 8 };

const assetPath = (...segments) => path.join(projectRoot, ...segments);

const paths = {
  robinhoodLogo: assetPath("data", "robinhood", "brand", "robinhood-feather-logo.png"),
  hatBase: assetPath("dyoor-builder", "layers", "Hat", "Black Ball Cap.png"),
  shadesBase: assetPath("dyoor-builder", "layers", "Eyes", "Sunglasses.png"),
  teeBase: assetPath("dyoor-builder", "layers", "Clothes", "White Tee.png"),
  background: assetPath("data", "robinhood", "layers", "Background", "INDAHOOD.png"),
  droid: assetPath("data", "dyoor-s2-base-layers", "Droid", "Dark Chrome.webp"),
  mouth: assetPath("dyoor-builder", "layers", "Mouth", "Gold Grill.png"),
  hatOutput: assetPath("data", "robinhood", "layers", "Hat", "Robinhood Feather Cap.png"),
  shadesOutput: assetPath("data", "robinhood", "layers", "Eyes", "Robinhood Green Shades.png"),
  teeOutput: assetPath("data", "robinhood", "layers", "Clothes", "Robinhood Green Tee.png"),
  previewOutput: assetPath("data", "robinhood", "previews", "robinhood-full-droid.png"),
  previewV2Output: assetPath(
    "data", "robinhood", "previews", "robinhood-full-droid-v2.png",
  ),
};

function clamp(value, minimum = 0, maximum = 255) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - (2 * t));
}

async function readRaw(filePath) {
  return sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function averageCornerKey(data, info) {
  const points = [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
  ];
  const total = points.reduce((sum, [x, y]) => {
    const offset = ((y * info.width) + x) * 4;
    sum.r += data[offset];
    sum.g += data[offset + 1];
    sum.b += data[offset + 2];
    return sum;
  }, { r: 0, g: 0, b: 0 });

  return {
    r: Math.round(total.r / points.length),
    g: Math.round(total.g / points.length),
    b: Math.round(total.b / points.length),
  };
}

function chromaDistance(r, g, b, key) {
  return Math.hypot(r - key.r, g - key.g, b - key.b);
}

async function createLogoLayer(width, height, color) {
  const { data, info } = await readRaw(paths.robinhoodLogo);
  const key = averageCornerKey(data, info);
  const output = Buffer.alloc(data.length);

  for (let offset = 0; offset < data.length; offset += 4) {
    const distance = chromaDistance(data[offset], data[offset + 1], data[offset + 2], key);
    const coverage = smoothstep((distance - 8) / 150);
    output[offset] = color.r;
    output[offset + 1] = color.g;
    output[offset + 2] = color.b;
    output[offset + 3] = Math.round(data[offset + 3] * coverage);
  }

  return sharp(output, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(width, height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function buildHat() {
  const logo = await createLogoLayer(204, 341, robinhoodGreen);
  await sharp(paths.hatBase)
    .ensureAlpha()
    .composite([{ input: logo, left: 2093, top: 791 }])
    .png()
    .toFile(paths.hatOutput);
}

async function buildShades() {
  const { data, info } = await readRaw(paths.shadesBase);
  const output = Buffer.from(data);

  for (let y = 1680; y <= 1940; y += 1) {
    for (let x = 1720; x <= 2620; x += 1) {
      const offset = ((y * info.width) + x) * 4;
      if (output[offset + 3] === 0) continue;
      const r = output[offset];
      const g = output[offset + 1];
      const b = output[offset + 2];
      const distance = Math.hypot(r - 52, g - 51, b - 50);
      if (distance > 12) continue;
      const shade = clamp(((r + g + b) / 3) / 51, 0.8, 1.12);
      output[offset] = Math.round(clamp(robinhoodGreen.r * shade));
      output[offset + 1] = Math.round(clamp(robinhoodGreen.g * shade));
      output[offset + 2] = Math.round(clamp(robinhoodGreen.b * shade));
    }
  }

  const base = await sharp(output, { raw: info }).png().toBuffer();
  const logo = await createLogoLayer(72, 122, { r: 0, g: 0, b: 0 });
  await sharp(base)
    .composite([{ input: logo, left: 1450, top: 1728 }])
    .png()
    .toFile(paths.shadesOutput);
}

async function buildTee() {
  const { data, info } = await readRaw(paths.teeBase);
  const output = Buffer.from(data);

  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const r = output[offset];
    const g = output[offset + 1];
    const b = output[offset + 2];
    const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    if (luminance < 82) continue;
    const shade = clamp(luminance / 248, 0.28, 1.04);
    output[offset] = Math.round(clamp(robinhoodGreen.r * shade));
    output[offset + 1] = Math.round(clamp(robinhoodGreen.g * shade));
    output[offset + 2] = Math.round(clamp(robinhoodGreen.b * shade));
  }

  const base = await sharp(output, { raw: info }).png().toBuffer();
  const logo = await createLogoLayer(130, 220, { r: 20, g: 18, b: 12 });
  await sharp(base)
    .composite([{ input: logo, left: 2377, top: 3587 }])
    .png()
    .toFile(paths.teeOutput);
}

async function renderDroidPreview(tee, hat, output) {
  const size = 2048;
  const files = [
    paths.background,
    paths.droid,
    tee,
    paths.mouth,
    paths.shadesOutput,
    hat,
  ];
  const layers = await Promise.all(files.map((input) => (
    sharp(input).resize(size, size, { fit: "fill" }).png().toBuffer()
  )));

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers.map((input) => ({ input })))
    .png()
    .toFile(output);
}

async function buildPreviews() {
  await renderDroidPreview(paths.teeOutput, paths.hatOutput, paths.previewOutput);

  const robinhoodPreview = await sharp(paths.previewOutput).png().toBuffer();
  await sharp(robinhoodPreview).toFile(paths.previewV2Output);
}

async function validateOutputs() {
  const entries = await Promise.all([
    ["Hat", "Robinhood Feather Cap", paths.hatOutput],
    ["Eyes", "Robinhood Green Shades", paths.shadesOutput],
    ["Clothes", "Robinhood Green Tee", paths.teeOutput],
  ].map(async ([slot, name, filePath]) => {
    const metadata = await sharp(filePath).metadata();
    if (metadata.width !== canvasSize || metadata.height !== canvasSize || !metadata.hasAlpha) {
      throw new Error(`${name} is not a ${canvasSize}x${canvasSize} alpha layer.`);
    }
    return {
      slot,
      name,
      path: path.relative(projectRoot, filePath),
      width: metadata.width,
      height: metadata.height,
      hasAlpha: metadata.hasAlpha,
    };
  }));
  return entries;
}

await Promise.all([
  buildHat(),
  buildShades(),
  buildTee(),
]);
await buildPreviews();
const previews = await Promise.all([
  paths.previewOutput,
  paths.previewV2Output,
].map(async (filePath) => {
  const metadata = await sharp(filePath).metadata();
  return {
    path: path.relative(projectRoot, filePath),
    width: metadata.width,
    height: metadata.height,
  };
}));
console.log(JSON.stringify({
  outputs: await validateOutputs(),
  previews,
}, null, 2));
