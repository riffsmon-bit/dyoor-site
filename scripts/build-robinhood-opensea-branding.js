import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "data", "robinhood", "branding", "opensea");

const outputs = [
  {
    id: "banner-desktop",
    file: "opensea-banner-desktop.png",
    source: "data/robinhood/branding/robinhood-collection-banner-pixel-v2.png",
    width: 3_200,
    height: 1_200,
    logicalWidth: 800,
    logicalHeight: 300,
    fit: "cover",
    position: "east",
    purpose: "OpenSea desktop page header (8:3)",
  },
  {
    id: "banner-mobile",
    file: "opensea-banner-mobile.png",
    source: "data/robinhood/branding/robinhood-collection-mobile-trio-pixel-v3.png",
    width: 1_920,
    height: 1_080,
    logicalWidth: 640,
    logicalHeight: 360,
    fit: "cover",
    position: "centre",
    purpose: "OpenSea mobile page header (16:9)",
  },
  {
    id: "banner-logo",
    file: "opensea-banner-logo.png",
    source: "data/robinhood/branding/robinhood-collection-pfp-pixel-v2.png",
    width: 1_024,
    height: 1_024,
    logicalWidth: 256,
    logicalHeight: 256,
    fit: "cover",
    position: "centre",
    purpose: "OpenSea banner logo and collection profile image (1:1)",
  },
  {
    id: "overview-background",
    file: "opensea-overview-background.png",
    source: "data/robinhood/branding/robinhood-collection-overview-pixel-v2.png",
    width: 2_560,
    height: 1_440,
    logicalWidth: 640,
    logicalHeight: 360,
    fit: "cover",
    position: "centre",
    purpose: "OpenSea overview background media (16:9)",
  },
  {
    id: "pixel-art-preview",
    file: "opensea-pixel-art-preview.png",
    source: "data/robinhood/pixel-pilot/contact-sheet-128/sample-01-128.png",
    width: 1_024,
    height: 1_024,
    logicalWidth: 128,
    logicalHeight: 128,
    fit: "fill",
    position: "centre",
    purpose: "Pixel-faithful 8x preview of a real onchain 128x128 composition",
  },
  {
    id: "social-share",
    file: "opensea-social-share.png",
    source: "data/robinhood/branding/robinhood-collection-overview-pixel-v2.png",
    width: 1_200,
    height: 630,
    logicalWidth: 400,
    logicalHeight: 210,
    fit: "cover",
    position: "centre",
    purpose: "Collection social/share card",
  },
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

async function buildAsset(spec) {
  const sourcePath = path.join(projectRoot, spec.source);
  const outputPath = path.join(outputRoot, spec.file);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing branding source: ${spec.source}`);
  }

  const logicalPixels = await sharp(sourcePath)
    .resize(spec.logicalWidth, spec.logicalHeight, {
      fit: spec.fit,
      position: spec.position,
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  await sharp(logicalPixels)
    .resize(spec.width, spec.height, {
      fit: "fill",
      kernel: sharp.kernel.nearest,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  const bytes = fs.readFileSync(outputPath);
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== spec.width || metadata.height !== spec.height) {
    throw new Error(`${spec.file} has unexpected dimensions.`);
  }

  return {
    id: spec.id,
    purpose: spec.purpose,
    path: relative(outputPath),
    source: spec.source,
    width: metadata.width,
    height: metadata.height,
    logicalWidth: spec.logicalWidth,
    logicalHeight: spec.logicalHeight,
    pixelScale: spec.width / spec.logicalWidth,
    format: metadata.format,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

fs.mkdirSync(outputRoot, { recursive: true });
const assets = [];
for (const spec of outputs) assets.push(await buildAsset(spec));

const manifest = {
  schema: "dyoor-hoodyoor-opensea-branding-v1",
  collection: "HoodYØØR",
  chain: "robinhood",
  generationPolicy: {
    newGenerativeArtwork: true,
    mode: "built-in-imagegen",
    style: "refined HoodYØØR 128x128-era pixel art",
    promptRecord: "data/robinhood/branding/PIXEL_OPENSEA_IMAGEGEN_PROMPTS.md",
    note: "All marketplace branding uses the approved pixel collection identity; every uncovered Droid face includes a visible mouth.",
  },
  assets,
};

const manifestPath = path.join(outputRoot, "opensea-branding-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${assets.length} OpenSea branding assets in ${relative(outputRoot)}.`);
for (const asset of assets) {
  console.log(`- ${asset.id}: ${asset.width}x${asset.height}, ${asset.bytes} bytes`);
}
