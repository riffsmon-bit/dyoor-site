import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

const PINATA_ENDPOINT = "/pinning/pinFileToIPFS";
const PINATA_HOST = "api.pinata.cloud";
const DEFAULT_MANIFEST_DIR = "exports/pinata-uploads";
const DEFAULT_KEYVALUES = {
  project: "DYOOR",
  collection: "Season 2",
};
const MIME_TYPES = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    name: { type: "string" },
    manifest: { type: "string" },
    "cid-version": { type: "string" },
    "dry-run": { type: "boolean" },
    "include-root": { type: "boolean" },
    keyvalues: { type: "string" },
    type: { type: "string" },
    help: { type: "boolean" },
  },
});

function printUsage() {
  console.log(`Usage:
  npm run upload:pinata -- --dir <folder> --name <pin-name>

Examples:
  npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/trait-items/images" --name dyoor-s2-trait-assets --type s2-trait-assets
  npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/images" --name dyoor-s2-final-images --type s2-final-images
  npm run upload:pinata -- --dir "/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/metadata" --name dyoor-s2-metadata-backup --type s2-metadata-backup --dry-run

Required env:
  PINATA_JWT=<Pinata API JWT>

Optional env:
  PINATA_UPLOAD_DIR=<folder>
  PINATA_UPLOAD_NAME=<pin-name>
  PINATA_UPLOAD_MANIFEST=<manifest output path>
  PINATA_GATEWAY_URL=https://your-gateway.mypinata.cloud
`);
}

function getString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseJsonObject(raw, label) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function normalizeKeyvalues(keyvalues) {
  return Object.fromEntries(
    Object.entries(keyvalues)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function sanitizeFileSegment(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "pinata-upload";
}

function getTimestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function normalizeIpfsPath(value) {
  return value.split(path.sep).join("/");
}

function escapeHeaderValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, "_");
}

function getMimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function shouldSkipFile(filePath) {
  const basename = path.basename(filePath);
  return basename === ".DS_Store" || basename.startsWith("._");
}

async function listFiles(rootDir, includeRoot) {
  const root = path.resolve(rootDir);
  const rootName = path.basename(root);
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || shouldSkipFile(absolutePath)) continue;

      const fileStat = await stat(absolutePath);
      const relativePath = normalizeIpfsPath(path.relative(root, absolutePath));
      files.push({
        absolutePath,
        ipfsPath: includeRoot ? `${rootName}/${relativePath}` : relativePath,
        size: fileStat.size,
        mimeType: getMimeType(absolutePath),
      });
    }
  }

  await walk(root);
  return files;
}

function writeChunk(request, chunk) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      request.off("error", onError);
      request.off("drain", onDrain);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onDrain() {
      cleanup();
      resolve();
    }

    request.once("error", onError);
    if (request.write(chunk)) {
      cleanup();
      resolve();
    } else {
      request.once("drain", onDrain);
    }
  });
}

function streamFile(request, file, onProgress) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file.absolutePath);

    function cleanup() {
      request.off("error", onError);
      stream.off("error", onError);
      stream.off("end", onEnd);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onEnd() {
      cleanup();
      resolve();
    }

    stream.on("data", (chunk) => {
      onProgress(chunk.length);
    });
    stream.once("error", onError);
    stream.once("end", onEnd);
    request.once("error", onError);
    stream.pipe(request, { end: false });
  });
}

async function writeField(request, boundary, name, value) {
  await writeChunk(request, `--${boundary}\r\n`);
  await writeChunk(request, `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n\r\n`);
  await writeChunk(request, `${value}\r\n`);
}

async function writeFilePart(request, boundary, file, onProgress) {
  await writeChunk(request, `--${boundary}\r\n`);
  await writeChunk(
    request,
    `Content-Disposition: form-data; name="file"; filename="${escapeHeaderValue(file.ipfsPath)}"\r\n`,
  );
  await writeChunk(request, `Content-Type: ${file.mimeType}\r\n\r\n`);
  await streamFile(request, file, onProgress);
  await writeChunk(request, "\r\n");
}

function createPinataRequest(jwt, boundary) {
  return https.request({
    hostname: PINATA_HOST,
    path: PINATA_ENDPOINT,
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
  });
}

function readResponse(request) {
  return new Promise((resolve, reject) => {
    request.on("response", (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
        });
      });
    });
    request.on("error", reject);
  });
}

async function uploadFolder({ jwt, files, pinataMetadata, pinataOptions }) {
  const boundary = `----dyoor-pinata-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request = createPinataRequest(jwt, boundary);
  const responsePromise = readResponse(request);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let uploadedBytes = 0;
  let lastProgressAt = 0;

  function printProgress(increment) {
    uploadedBytes += increment;
    const now = Date.now();
    if (now - lastProgressAt < 1000 && uploadedBytes !== totalBytes) return;
    lastProgressAt = now;
    const pct = totalBytes > 0 ? ((uploadedBytes / totalBytes) * 100).toFixed(1) : "100.0";
    process.stdout.write(`\rUploading ${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)} (${pct}%)`);
  }

  await writeField(request, boundary, "pinataMetadata", JSON.stringify(pinataMetadata));
  await writeField(request, boundary, "pinataOptions", JSON.stringify(pinataOptions));

  for (const file of files) {
    await writeFilePart(request, boundary, file, printProgress);
  }

  await writeChunk(request, `--${boundary}--\r\n`);
  request.end();

  const response = await responsePromise;
  process.stdout.write("\n");

  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    data = { rawBody: response.body };
  }

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Pinata upload failed with HTTP ${response.statusCode}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function writeManifest(manifestPath, manifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  if (values.help) {
    printUsage();
    return;
  }

  const jwt = getString(process.env.PINATA_JWT);
  const sourceDir = getString(values.dir)
    || getString(positionals[0])
    || getString(process.env.PINATA_UPLOAD_DIR);
  const uploadName = getString(values.name)
    || getString(positionals[1])
    || getString(process.env.PINATA_UPLOAD_NAME)
    || (sourceDir ? path.basename(path.resolve(sourceDir)) : "");
  const uploadType = getString(values.type) || "dyoor-asset-folder";
  const cidVersion = Number.parseInt(getString(values["cid-version"]) || "1", 10);
  const includeRoot = Boolean(values["include-root"]);
  const gatewayUrl = getString(process.env.PINATA_GATEWAY_URL).replace(/\/+$/, "");
  const manifestPath = getString(values.manifest)
    || getString(process.env.PINATA_UPLOAD_MANIFEST)
    || path.join(DEFAULT_MANIFEST_DIR, `${sanitizeFileSegment(uploadName)}-${getTimestampSlug()}.json`);

  if (!sourceDir || !uploadName) {
    printUsage();
    throw new Error("Missing upload directory or pin name");
  }
  if (!jwt && !values["dry-run"]) {
    throw new Error("Missing PINATA_JWT. Add it to .env.local or export it in your shell.");
  }
  if (!Number.isInteger(cidVersion) || cidVersion < 0 || cidVersion > 1) {
    throw new Error("--cid-version must be 0 or 1");
  }

  const rootStat = await stat(sourceDir);
  if (!rootStat.isDirectory()) {
    throw new Error(`Upload source is not a directory: ${sourceDir}`);
  }

  const files = await listFiles(sourceDir, includeRoot);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (!files.length) {
    throw new Error(`No files found under ${sourceDir}`);
  }

  const extraKeyvalues = {
    ...parseJsonObject(getString(process.env.PINATA_KEYVALUES), "PINATA_KEYVALUES"),
    ...parseJsonObject(getString(values.keyvalues), "--keyvalues"),
  };
  const pinataMetadata = {
    name: uploadName,
    keyvalues: normalizeKeyvalues({
      ...DEFAULT_KEYVALUES,
      ...extraKeyvalues,
      type: uploadType,
      fileCount: files.length,
    }),
  };
  const pinataOptions = { cidVersion };

  console.log(JSON.stringify({
    uploadName,
    sourceDir: path.resolve(sourceDir),
    fileCount: files.length,
    totalSize: formatBytes(totalBytes),
    includeRoot,
    cidVersion,
    firstPaths: files.slice(0, 10).map((file) => file.ipfsPath),
    manifestPath,
  }, null, 2));

  if (values["dry-run"]) {
    console.log("Dry run only. Remove --dry-run to upload to Pinata.");
    return;
  }

  const pinataResponse = await uploadFolder({
    jwt,
    files,
    pinataMetadata,
    pinataOptions,
  });
  const cid = pinataResponse.IpfsHash || pinataResponse.cid;
  const manifest = {
    uploadedAt: new Date().toISOString(),
    uploadName,
    uploadType,
    sourceDir: path.resolve(sourceDir),
    includeRoot,
    cidVersion,
    fileCount: files.length,
    totalBytes,
    ipfsBaseUri: cid ? `ipfs://${cid}/` : null,
    gatewayBaseUrl: cid && gatewayUrl ? `${gatewayUrl}/ipfs/${cid}/` : null,
    pinataResponse,
    samplePaths: files.slice(0, 25).map((file) => file.ipfsPath),
  };

  await writeManifest(manifestPath, manifest);
  console.log(JSON.stringify({
    cid,
    ipfsBaseUri: manifest.ipfsBaseUri,
    gatewayBaseUrl: manifest.gatewayBaseUrl,
    manifestPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
