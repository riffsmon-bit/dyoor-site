import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import sharp from "sharp";
import { normalizeWorldWallet } from "@/lib/dyoor-world";

const STORE_NAME = "dyoor-world-media";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SAVED_BYTES = 4 * 1024 * 1024;
const MAX_UPLOADS_PER_WALLET = 40;
const MAX_INPUT_PIXELS = 25_000_000;
const MAX_OUTPUT_DIMENSION = 1_600;
const MEDIA_ID_PATTERN = /^[a-z0-9]{10}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SUPPORTED_UPLOAD_FORMATS = new Set(["avif", "jpeg", "png", "webp"]);

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function mediaStore() {
  const siteID = readEnv("NETLIFY_BLOBS_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID");
  const token = readEnv(
    "NETLIFY_BLOBS_TOKEN",
    "NETLIFY_ACCESS_TOKEN",
    "NETLIFY_AUTH_TOKEN",
  );
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
  }
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function safeMediaId(value: unknown) {
  const mediaId = String(value || "").trim().toLowerCase();
  return MEDIA_ID_PATTERN.test(mediaId) ? mediaId : "";
}

function mediaKey(wallet: string, mediaId: string) {
  return `uploads/${wallet}/${mediaId}.webp`;
}

function localMediaDirectory(wallet: string) {
  return path.join(process.cwd(), "data", "runtime", "dyoor-world-media", wallet);
}

function localMediaPath(wallet: string, mediaId: string) {
  return path.join(localMediaDirectory(wallet), `${mediaId}.webp`);
}

async function pruneBlobUploads(wallet: string) {
  const store = mediaStore();
  const listed = await store.list({ prefix: `uploads/${wallet}/` });
  const keys = listed.blobs.map((blob) => blob.key).sort();
  const removeCount = Math.max(0, keys.length - MAX_UPLOADS_PER_WALLET + 1);
  await Promise.all(keys.slice(0, removeCount).map((key) => store.delete(key)));
}

async function pruneLocalUploads(wallet: string) {
  const directory = localMediaDirectory(wallet);
  const names = await fs.readdir(directory).catch(() => []);
  const saved = names.filter((name) => name.endsWith(".webp")).sort();
  const removeCount = Math.max(0, saved.length - MAX_UPLOADS_PER_WALLET + 1);
  await Promise.all(
    saved.slice(0, removeCount).map((name) => fs.unlink(path.join(directory, name))),
  );
}

async function normalizeUploadedImage(input: Buffer) {
  if (!input.length || input.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error("Choose an image no larger than 5 MB."), { status: 400 });
  }

  let pipeline: sharp.Sharp;
  try {
    pipeline = sharp(input, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const metadata = await pipeline.metadata();
    if (
      !metadata.format
      || !SUPPORTED_UPLOAD_FORMATS.has(metadata.format)
      || !metadata.width
      || !metadata.height
    ) {
      throw new Error("unsupported");
    }
    if (Number(metadata.pages || 1) > 1) {
      throw Object.assign(
        new Error("Upload a static image; animated GIF uploads are not supported."),
        { status: 400 },
      );
    }
  } catch (error) {
    if (Number((error as { status?: number })?.status) === 400) throw error;
    throw Object.assign(
      new Error("Upload a valid PNG, JPG, WEBP, or AVIF image."),
      { status: 400 },
    );
  }

  const output = await pipeline
    .rotate()
    .resize({
      width: MAX_OUTPUT_DIMENSION,
      height: MAX_OUTPUT_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, alphaQuality: 90, effort: 4 })
    .toBuffer();
  if (output.length > MAX_SAVED_BYTES) {
    throw Object.assign(
      new Error("That image is still too large after optimization. Choose a smaller image."),
      { status: 400 },
    );
  }
  return output;
}

export async function saveDyoorWorldImage(walletValue: unknown, input: Buffer) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) {
    throw Object.assign(new Error("A valid holder wallet is required."), { status: 400 });
  }
  const image = await normalizeUploadedImage(input);
  const mediaId = `${Date.now().toString(36).padStart(10, "0")}-${randomUUID()}`;

  if (process.env.NODE_ENV === "production") {
    await pruneBlobUploads(wallet);
    const body = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer;
    await mediaStore().set(mediaKey(wallet, mediaId), body, {
      metadata: {
        contentType: "image/webp",
        createdAt: new Date().toISOString(),
        wallet,
      },
    });
  } else {
    await fs.mkdir(localMediaDirectory(wallet), { recursive: true });
    await pruneLocalUploads(wallet);
    await fs.writeFile(localMediaPath(wallet, mediaId), image);
  }

  return {
    mediaId,
    wallet,
    byteLength: image.length,
    url: `/api/dyoor-world/media/${wallet}/${mediaId}`,
  };
}

export async function readDyoorWorldImage(
  walletValue: unknown,
  mediaIdValue: unknown,
) {
  const wallet = normalizeWorldWallet(walletValue);
  const mediaId = safeMediaId(mediaIdValue);
  if (!wallet || !mediaId) return null;

  if (process.env.NODE_ENV === "production") {
    const value = await mediaStore()
      .get(mediaKey(wallet, mediaId), { type: "arrayBuffer", consistency: "strong" })
      .catch(() => null);
    return value ? Buffer.from(value) : null;
  }
  return await fs.readFile(localMediaPath(wallet, mediaId)).catch(() => null);
}
