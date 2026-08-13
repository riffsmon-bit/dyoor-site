import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { argValue, positiveIntegerArg } from "./lib/cli";
import { writeJson } from "./lib/json";
import { PILOT_SPRITE_ROOT, assertPathInside } from "./lib/paths";
import {
  DIRECTION_ORDER,
  FOOT_ANCHOR,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  FRAMES_PER_DIRECTION,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  defaultSidecar,
} from "./lib/sprite-spec";

type PixelBuffer = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const inputValue = argValue("--input");
const tokenId = positiveIntegerArg("--token-id", 0, 3_333);
const assetIdValue = argValue("--asset-id").trim().toLowerCase();
const assetId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetIdValue)
  ? assetIdValue
  : "";
if (!inputValue) throw new Error("Provide the generated concept sheet with --input <png-path>.");
if (!tokenId && !assetId) {
  throw new Error(
    "Provide either a token ID from 1 through 3333 with --token-id <id> "
    + "or a safe local asset slug with --asset-id <slug>.",
  );
}
if (assetIdValue && !assetId) {
  throw new Error("Asset ID must contain lowercase letters, numbers, and single hyphens only.");
}
if (tokenId && assetId) {
  throw new Error("Use --token-id or --asset-id, not both.");
}

const inputPath = path.resolve(inputValue);
const outputIdentity = tokenId ? String(tokenId) : assetId;
const outputPath = assertPathInside(
  PILOT_SPRITE_ROOT,
  path.join(PILOT_SPRITE_ROOT, `dyoor-${outputIdentity}-walk-v1.png`),
  "Pilot sprite output",
);

function channelAt(image: PixelBuffer, x: number, y: number, channel: number) {
  return image.data[(y * image.width + x) * image.channels + channel] || 0;
}

function sampleBorderKey(image: PixelBuffer) {
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 128));
  for (let x = 0; x < image.width; x += step) {
    samples.push([
      channelAt(image, x, 0, 0),
      channelAt(image, x, 0, 1),
      channelAt(image, x, 0, 2),
    ]);
    samples.push([
      channelAt(image, x, image.height - 1, 0),
      channelAt(image, x, image.height - 1, 1),
      channelAt(image, x, image.height - 1, 2),
    ]);
  }
  for (let y = 0; y < image.height; y += step) {
    samples.push([
      channelAt(image, 0, y, 0),
      channelAt(image, 0, y, 1),
      channelAt(image, 0, y, 2),
    ]);
    samples.push([
      channelAt(image, image.width - 1, y, 0),
      channelAt(image, image.width - 1, y, 1),
      channelAt(image, image.width - 1, y, 2),
    ]);
  }
  const sum = samples.reduce(
    (total, color) => [total[0] + color[0], total[1] + color[1], total[2] + color[2]],
    [0, 0, 0],
  );
  return sum.map((value) => Math.round(value / samples.length)) as [number, number, number];
}

function removeChroma(image: PixelBuffer, key: [number, number, number]) {
  const output = Buffer.from(image.data);
  for (let offset = 0; offset < output.length; offset += image.channels) {
    const red = output[offset] || 0;
    const green = output[offset + 1] || 0;
    const blue = output[offset + 2] || 0;
    const distance = Math.hypot(red - key[0], green - key[1], blue - key[2]);
    const magentaFamily = red > 155 && blue > 155 && green < 125 && Math.abs(red - blue) < 85;
    const transparent = distance <= 105 || magentaFamily;
    output[offset + 3] = transparent ? 0 : 255;
  }
  return { ...image, data: output };
}

function cellEdges(index: number, size: number) {
  const start = Math.round(index * size / FRAMES_PER_DIRECTION);
  const end = Math.round((index + 1) * size / FRAMES_PER_DIRECTION);
  return { start, end };
}

function removeSmallComponents(image: PixelBuffer) {
  const output = Buffer.from(image.data);
  const visited = new Uint8Array(image.width * image.height);
  let removedComponents = 0;
  let removedPixels = 0;

  for (let row = 0; row < DIRECTION_ORDER.length; row += 1) {
    const vertical = cellEdges(row, image.height);
    for (let column = 0; column < FRAMES_PER_DIRECTION; column += 1) {
      const horizontal = cellEdges(column, image.width);
      const components: Array<{
        pixels: number[];
        left: number;
        right: number;
        top: number;
        bottom: number;
      }> = [];
      for (let y = vertical.start; y < vertical.end; y += 1) {
        for (let x = horizontal.start; x < horizontal.end; x += 1) {
          const pixelIndex = y * image.width + x;
          if (visited[pixelIndex] || output[pixelIndex * image.channels + 3] === 0) continue;
          visited[pixelIndex] = 1;
          const component: number[] = [];
          let componentLeft = x;
          let componentRight = x;
          let componentTop = y;
          let componentBottom = y;
          const queue = [pixelIndex];
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor];
            if (current === undefined) continue;
            component.push(current);
            const currentX = current % image.width;
            const currentY = Math.floor(current / image.width);
            componentLeft = Math.min(componentLeft, currentX);
            componentRight = Math.max(componentRight, currentX);
            componentTop = Math.min(componentTop, currentY);
            componentBottom = Math.max(componentBottom, currentY);
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
              for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                if (offsetX === 0 && offsetY === 0) continue;
                const nextX = currentX + offsetX;
                const nextY = currentY + offsetY;
                if (
                  nextX < horizontal.start
                  || nextX >= horizontal.end
                  || nextY < vertical.start
                  || nextY >= vertical.end
                ) continue;
                const next = nextY * image.width + nextX;
                if (visited[next] || output[next * image.channels + 3] === 0) continue;
                visited[next] = 1;
                queue.push(next);
              }
            }
          }
          components.push({
            pixels: component,
            left: componentLeft,
            right: componentRight,
            top: componentTop,
            bottom: componentBottom,
          });
        }
      }

      const largestComponent = components.reduce<(typeof components)[number] | null>(
        (largest, component) => !largest || component.pixels.length > largest.pixels.length
          ? component
          : largest,
        null,
      );
      if (!largestComponent) continue;
      const minimumArea = Math.max(64, Math.ceil(largestComponent.pixels.length * 0.015));
      const maximumGap = Math.round((horizontal.end - horizontal.start) * 0.14);
      for (const component of components) {
        const horizontalGap = Math.max(
          0,
          largestComponent.left - component.right,
          component.left - largestComponent.right,
        );
        const verticalGap = Math.max(
          0,
          largestComponent.top - component.bottom,
          component.top - largestComponent.bottom,
        );
        const closeToCharacter = Math.hypot(horizontalGap, verticalGap) <= maximumGap;
        if (
          component === largestComponent
          || (component.pixels.length >= minimumArea && closeToCharacter)
        ) continue;
        removedComponents += 1;
        removedPixels += component.pixels.length;
        for (const pixelIndex of component.pixels) output[pixelIndex * image.channels + 3] = 0;
      }
    }
  }

  return {
    image: { ...image, data: output },
    removedComponents,
    removedPixels,
  };
}

function contentBounds(image: PixelBuffer, column: number, row: number): Bounds {
  const horizontal = cellEdges(column, image.width);
  const vertical = cellEdges(row, image.height);
  const occupiedX: number[] = [];
  const occupiedY: number[] = [];
  for (let y = vertical.start; y < vertical.end; y += 1) {
    for (let x = horizontal.start; x < horizontal.end; x += 1) {
      const alpha = channelAt(image, x, y, 3);
      if (alpha === 0) continue;
      occupiedX.push(x);
      occupiedY.push(y);
    }
  }
  if (!occupiedX.length || !occupiedY.length) {
    throw new Error(`No sprite pixels found in row ${row}, column ${column}.`);
  }
  occupiedX.sort((a, b) => a - b);
  occupiedY.sort((a, b) => a - b);
  const trim = Math.floor(occupiedX.length * 0.005);
  const last = occupiedX.length - 1 - trim;
  const padding = 2;
  const left = Math.max(horizontal.start, (occupiedX[trim] || horizontal.start) - padding);
  const right = Math.min(horizontal.end - 1, (occupiedX[last] || horizontal.end - 1) + padding);
  const top = Math.max(vertical.start, (occupiedY[trim] || vertical.start) - padding);
  const bottom = Math.min(vertical.end - 1, (occupiedY[last] || vertical.end - 1) + padding);
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function copyIntoSheet(
  sheet: Buffer,
  frame: PixelBuffer,
  destinationX: number,
  destinationY: number,
) {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const sourceOffset = (y * frame.width + x) * frame.channels;
      if ((frame.data[sourceOffset + 3] || 0) === 0) continue;
      const sheetX = destinationX + x;
      const sheetY = destinationY + y;
      if (sheetX < 0 || sheetX >= SHEET_WIDTH || sheetY < 0 || sheetY >= SHEET_HEIGHT) continue;
      const destinationOffset = (sheetY * SHEET_WIDTH + sheetX) * 4;
      sheet[destinationOffset] = frame.data[sourceOffset] || 0;
      sheet[destinationOffset + 1] = frame.data[sourceOffset + 1] || 0;
      sheet[destinationOffset + 2] = frame.data[sourceOffset + 2] || 0;
      sheet[destinationOffset + 3] = frame.data[sourceOffset + 3] || 0;
    }
  }
}

async function main() {
  const source = sharp(inputPath, { limitInputPixels: 4_000 * 4_000 });
  const metadata = await source.metadata();
  if (metadata.format !== "png") throw new Error("Pilot source must be a PNG.");
  if (!metadata.width || !metadata.height) throw new Error("Pilot source dimensions are unavailable.");
  if (metadata.width < 512 || metadata.height < 512) {
    throw new Error("Pilot source is too small for safe 4x4 frame extraction.");
  }

  const raw = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image: PixelBuffer = {
    data: raw.data,
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels,
  };
  const keyColor = sampleBorderKey(image);
  const keyedSource = removeChroma(image, keyColor);
  const cleanup = removeSmallComponents(keyedSource);
  const keyed = cleanup.image;
  const bounds = Array.from({ length: DIRECTION_ORDER.length }, (_, row) =>
    Array.from({ length: FRAMES_PER_DIRECTION }, (_, column) => contentBounds(keyed, column, row))
  );
  const allBounds = bounds.flat();
  const maximumWidth = Math.max(...allBounds.map((entry) => entry.width));
  const maximumHeight = Math.max(...allBounds.map((entry) => entry.height));
  const scale = Math.min(54 / maximumWidth, 56 / maximumHeight);
  const sheet = Buffer.alloc(SHEET_WIDTH * SHEET_HEIGHT * 4);

  for (let row = 0; row < DIRECTION_ORDER.length; row += 1) {
    for (let column = 0; column < FRAMES_PER_DIRECTION; column += 1) {
      const frameBounds = bounds[row]?.[column];
      if (!frameBounds) throw new Error(`Missing frame bounds for row ${row}, column ${column}.`);
      const targetWidth = Math.max(1, Math.round(frameBounds.width * scale));
      const targetHeight = Math.max(1, Math.round(frameBounds.height * scale));
      const frame = await sharp(keyed.data, {
        raw: {
          width: keyed.width,
          height: keyed.height,
          channels: 4,
        },
      })
        .extract(frameBounds)
        .resize(targetWidth, targetHeight, {
          kernel: sharp.kernel.nearest,
          fit: "fill",
        })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const destinationX = column * FRAME_WIDTH + Math.floor((FRAME_WIDTH - targetWidth) / 2);
      const destinationY = row * FRAME_HEIGHT + FOOT_ANCHOR.y - targetHeight;
      copyIntoSheet(
        sheet,
        {
          data: frame.data,
          width: frame.info.width,
          height: frame.info.height,
          channels: frame.info.channels,
        },
        destinationX,
        destinationY,
      );
    }
  }

  await fs.mkdir(PILOT_SPRITE_ROOT, { recursive: true });
  await sharp(sheet, {
    raw: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 4,
    },
  }).png({
    compressionLevel: 9,
    palette: true,
    colours: 256,
    effort: 10,
  }).toFile(outputPath);
  await writeJson(outputPath.replace(/\.png$/i, ".sprite.json"), {
    ...defaultSidecar(true),
    ...(tokenId ? { tokenId } : { assetId }),
    assetStatus: "ai-assisted-pilot",
    productionReady: false,
    sourceDimensions: {
      width: image.width,
      height: image.height,
    },
    sourceGrid: {
      columns: FRAMES_PER_DIRECTION,
      rows: DIRECTION_ORDER.length,
    },
    sampledKeyColor: keyColor,
    removedArtifactComponents: cleanup.removedComponents,
    removedArtifactPixels: cleanup.removedPixels,
  });

  console.log(JSON.stringify({
    ...(tokenId ? { tokenId } : { assetId }),
    inputPath,
    outputPath,
    sampledKeyColor: keyColor,
    sourceDimensions: {
      width: image.width,
      height: image.height,
    },
    sourceMaximumCharacterBounds: {
      width: maximumWidth,
      height: maximumHeight,
    },
    scale,
    outputDimensions: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
    },
    frameDimensions: {
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    },
    footAnchor: FOOT_ANCHOR,
    status: "ai-assisted-pilot",
    productionReady: false,
  }, null, 2));
}

await main();
