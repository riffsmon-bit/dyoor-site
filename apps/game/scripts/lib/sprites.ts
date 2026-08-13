import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hasFlag } from "./cli";
import { readJson, readJsonOrNull, writeJson, pathExists } from "./json";
import type { NormalizedMetadata } from "./metadata";
import { normalizeMetadataRecord } from "./metadata";
import {
  GAME_DATA_ROOT,
  METADATA_CACHE_ROOT,
  PIXEL_LAYER_ROOT,
  REPOSITORY_ROOT,
  SPRITE_CACHE_ROOT,
  assertPathInside,
} from "./paths";
import {
  DIRECTION_ORDER,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  SPRITE_SPEC_VERSION,
  defaultSidecar,
  validateSpriteLayout,
  type SpriteSidecar,
} from "./sprite-spec";
import type { TraitManifest } from "./traits";
import {
  METADATA_SPRITE_SPEC_VERSION,
  buildMetadataDroidVisual,
  drawMetadataDroidFrame,
} from "../../src/systems/sprites/MetadataDroidVisual";

export type SpriteGenerationResult = {
  tokenId: number;
  traitHash: string;
  outputPath: string;
  status: "ready" | "placeholder";
  cached: boolean;
  missingLayerIds: string[];
};

type SpriteCacheIndex = {
  schemaVersion: 1;
  specVersion: string;
  rendererVersion: string;
  tokens: Record<string, {
    traitHash: string;
    outputPath: string;
    status: "ready" | "placeholder";
  }>;
};

function metadataTraitHash(metadata: NormalizedMetadata) {
  return createHash("sha256").update(metadata.sourceHashInput).digest("hex");
}

export async function loadCachedMetadataToken(tokenId: number) {
  const cachePath = path.join(METADATA_CACHE_ROOT, `${tokenId}.json`);
  assertPathInside(METADATA_CACHE_ROOT, cachePath, "Metadata cache token");
  const value = await readJsonOrNull<unknown>(cachePath);
  if (!value) throw new Error(`Token ${tokenId} is not cached. Run npm run game:metadata:scan first.`);
  return normalizeMetadataRecord(tokenId, value);
}

async function cacheIndex() {
  const indexPath = path.join(SPRITE_CACHE_ROOT, "index.json");
  const value = await readJsonOrNull<SpriteCacheIndex>(indexPath);
  return value?.schemaVersion === 1
    && value.specVersion === SPRITE_SPEC_VERSION
    && value.rendererVersion === METADATA_SPRITE_SPEC_VERSION
    ? value
    : {
      schemaVersion: 1 as const,
      specVersion: SPRITE_SPEC_VERSION,
      rendererVersion: METADATA_SPRITE_SPEC_VERSION,
      tokens: {},
    };
}

function writePixel(
  pixels: Buffer,
  sheetX: number,
  sheetY: number,
  width: number,
  height: number,
  color: [number, number, number, number],
) {
  for (let y = Math.max(0, sheetY); y < Math.min(SHEET_HEIGHT, sheetY + height); y += 1) {
    for (let x = Math.max(0, sheetX); x < Math.min(SHEET_WIDTH, sheetX + width); x += 1) {
      const index = (y * SHEET_WIDTH + x) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function colorToRgba(color: string): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) throw new Error(`Metadata sprite renderer produced invalid color ${color}.`);
  const value = Number.parseInt(match[1], 16);
  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
    255,
  ];
}

async function generatePlaceholderSheet(
  outputPath: string,
  metadata: NormalizedMetadata,
) {
  const pixels = Buffer.alloc(SHEET_WIDTH * SHEET_HEIGHT * 4);
  const visual = buildMetadataDroidVisual(metadata.attributes);
  const surface = {
    rect: (x: number, y: number, width: number, height: number, color: string) => {
      writePixel(pixels, x, y, width, height, colorToRgba(color));
    },
  };
  for (let directionIndex = 0; directionIndex < DIRECTION_ORDER.length; directionIndex += 1) {
    const direction = DIRECTION_ORDER[directionIndex];
    if (!direction) continue;
    for (let frame = 0; frame < 4; frame += 1) {
      const originX = frame * FRAME_WIDTH;
      const originY = directionIndex * FRAME_HEIGHT;
      drawMetadataDroidFrame(surface, originX, originY, direction, frame, visual);
    }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(pixels, {
    raw: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 4,
    },
  }).png({
    compressionLevel: 9,
    palette: true,
    colours: 16,
    effort: 10,
  }).toFile(outputPath);
}

async function generateComposedSheet(outputPath: string, layerPaths: string[]) {
  const transparent = {
    create: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 4 as const,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(transparent)
    .composite(layerPaths.map((input) => ({ input, blend: "over" as const })))
    .png({ compressionLevel: 9, palette: true, colours: 256, effort: 10 })
    .toFile(outputPath);
}

async function resolveLayers(metadata: NormalizedMetadata, manifest: TraitManifest) {
  const layerPaths: string[] = [];
  const missingLayerIds: string[] = [];
  for (const attribute of metadata.attributes) {
    const entry = manifest.categories[attribute.traitType]?.find((item) => item.value === attribute.value);
    if (!entry) {
      missingLayerIds.push(`${attribute.traitType}::${attribute.value}`);
      continue;
    }
    if (!entry.layerSheet || entry.spriteStatus !== "ready") {
      missingLayerIds.push(entry.layerId);
      continue;
    }
    const layerPath = path.resolve(REPOSITORY_ROOT, entry.layerSheet);
    assertPathInside(PIXEL_LAYER_ROOT, layerPath, "Pixel layer");
    if (!await pathExists(layerPath)) missingLayerIds.push(entry.layerId);
    else layerPaths.push(layerPath);
  }
  return { layerPaths, missingLayerIds };
}

export async function generateTokenSprite(
  metadata: NormalizedMetadata,
  manifest: TraitManifest,
): Promise<SpriteGenerationResult> {
  const traitHash = metadataTraitHash(metadata);
  const filename = `${metadata.tokenId}-${traitHash.slice(0, 16)}.png`;
  const outputPath = path.join(SPRITE_CACHE_ROOT, filename);
  assertPathInside(SPRITE_CACHE_ROOT, outputPath, "Sprite cache output");
  const index = await cacheIndex();
  const cached = index.tokens[String(metadata.tokenId)];
  if (
    !hasFlag("--force")
    && cached?.traitHash === traitHash
    && cached.outputPath === filename
    && await pathExists(outputPath)
  ) {
    return {
      tokenId: metadata.tokenId,
      traitHash,
      outputPath,
      status: cached.status,
      cached: true,
      missingLayerIds: [],
    };
  }

  const layers = await resolveLayers(metadata, manifest);
  const status = layers.missingLayerIds.length ? "placeholder" : "ready";
  if (status === "ready") await generateComposedSheet(outputPath, layers.layerPaths);
  else await generatePlaceholderSheet(outputPath, metadata);

  const sidecar: SpriteSidecar = {
    ...defaultSidecar(status === "placeholder"),
    traitHash,
    rendererVersion: METADATA_SPRITE_SPEC_VERSION,
    tokenId: metadata.tokenId,
    assetStatus: status === "placeholder"
      ? "metadata-driven-procedural-placeholder"
      : "approved-directional-layer-composite",
    productionReady: status === "ready",
  };
  await writeJson(outputPath.replace(/\.png$/i, ".sprite.json"), sidecar);
  index.tokens[String(metadata.tokenId)] = {
    traitHash,
    outputPath: filename,
    status,
  };
  await writeJson(path.join(SPRITE_CACHE_ROOT, "index.json"), index);

  return {
    tokenId: metadata.tokenId,
    traitHash,
    outputPath,
    status,
    cached: false,
    missingLayerIds: layers.missingLayerIds,
  };
}

export async function loadTraitManifest() {
  const manifest = await readJson<TraitManifest>(path.join(GAME_DATA_ROOT, "trait-manifest.json"));
  if (manifest.schemaVersion !== 1) throw new Error("Trait manifest version is unsupported.");
  return manifest;
}

export async function validateSpriteSheet(pngPath: string, requireSidecar = true) {
  assertPathInside(REPOSITORY_ROOT, pngPath, "Sprite validation path");
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = await fs.stat(pngPath);
  if (stats.size > 2_000_000) errors.push("PNG exceeds 2 MB.");
  const image = sharp(pngPath, { limitInputPixels: SHEET_WIDTH * SHEET_HEIGHT });
  const metadata = await image.metadata();
  if (metadata.format !== "png") errors.push("Sprite sheet must be PNG.");
  if (!metadata.hasAlpha) errors.push("Sprite sheet must preserve transparency.");
  const frameColumns = metadata.width ? metadata.width / FRAME_WIDTH : 0;
  const frameRows = metadata.height ? metadata.height / FRAME_HEIGHT : 0;

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let intermediateAlpha = 0;
  for (let index = 3; index < data.length; index += info.channels) {
    const alpha = data[index];
    if (alpha !== 0 && alpha !== 255) intermediateAlpha += 1;
  }
  if (intermediateAlpha) warnings.push(`${intermediateAlpha} semi-transparent pixel(s) may indicate anti-aliasing.`);

  let sidecar: SpriteSidecar | null = null;
  const sidecarPath = pngPath.replace(/\.png$/i, ".sprite.json");
  if (requireSidecar) {
    sidecar = await readJsonOrNull<SpriteSidecar>(sidecarPath);
    errors.push(...validateSpriteLayout({
      width: metadata.width || 0,
      height: metadata.height || 0,
      sidecar,
    }).errors);
  } else if (metadata.width !== SHEET_WIDTH || metadata.height !== SHEET_HEIGHT) {
    errors.push(`Expected ${SHEET_WIDTH}x${SHEET_HEIGHT}.`);
  }
  return {
    path: path.relative(REPOSITORY_ROOT, pngPath).split(path.sep).join("/"),
    valid: errors.length === 0,
    errors,
    warnings,
    width: metadata.width || null,
    height: metadata.height || null,
    frameCount: frameColumns * frameRows,
    placeholder: sidecar?.placeholder ?? null,
  };
}
