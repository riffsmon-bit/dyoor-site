import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  hoodYoorTraitSnapshot,
  renderHoodYoorPackedSvg,
} from "../lib/hoodyoor-reroll-catalog.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assignmentRoot = path.join(projectRoot, "data", "robinhood", "onchain-128");
const outputRoot = path.join(projectRoot, "public", "assets", "robinhood", "collection");
const assignmentManifestPath = path.join(
  assignmentRoot,
  "hoodyoor-initial-assignments.json",
);
const assignmentBinaryPath = path.join(
  assignmentRoot,
  "hoodyoor-initial-assignments.bin",
);
const assignmentIds = Object.freeze([1, 420, 777, 1_337, 2_054, 3_333]);
const assignmentBytes = 18;
const renderSize = 1_024;
const revealPendingSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" '
  + 'shape-rendering="crispEdges"><rect width="128" height="128" fill="#07110c"/>'
  + '<rect x="8" y="8" width="112" height="112" fill="none" stroke="#00c805" '
  + 'stroke-width="4"/><rect x="40" y="32" width="48" height="64" fill="#00c805"/>'
  + '<rect x="48" y="20" width="32" height="12" fill="#00c805"/>'
  + '<rect x="60" y="12" width="8" height="8" fill="#00c805"/>'
  + '<rect x="48" y="48" width="12" height="12" fill="#f3fff7"/>'
  + '<rect x="68" y="48" width="12" height="12" fill="#f3fff7"/>'
  + '<rect x="52" y="52" width="8" height="8" fill="#07110c"/>'
  + '<rect x="68" y="52" width="8" height="8" fill="#07110c"/>'
  + '<rect x="52" y="76" width="24" height="4" fill="#07110c"/>'
  + '<text x="64" y="112" fill="#f3fff7" font-family="monospace" font-size="8" '
  + 'text-anchor="middle">REVEAL PENDING</text></svg>';

const assignmentManifest = JSON.parse(
  fs.readFileSync(assignmentManifestPath, "utf8"),
);
const assignmentBinary = fs.readFileSync(assignmentBinaryPath);

if (assignmentManifest.packedTraits.length !== 3_333) {
  throw new Error("The frozen HoodYØØR assignment manifest is incomplete.");
}
if (assignmentBinary.length !== assignmentManifest.packedTraits.length * assignmentBytes) {
  throw new Error("The frozen HoodYØØR assignment binary has an unexpected length.");
}

fs.mkdirSync(outputRoot, { recursive: true });
await sharp(Buffer.from(revealPendingSvg), { density: 192 })
  .resize(renderSize, renderSize, { fit: "fill", kernel: sharp.kernel.nearest })
  .png({ compressionLevel: 9, palette: true })
  .toFile(path.join(outputRoot, "hoodyoor-reveal-pending.png"));

const records = [];
for (const assignmentId of assignmentIds) {
  const packedTraits = BigInt(assignmentManifest.packedTraits[assignmentId - 1]);
  const binaryOffset = (assignmentId - 1) * assignmentBytes;
  const binaryPackedTraits = BigInt(
    `0x${assignmentBinary.subarray(binaryOffset, binaryOffset + assignmentBytes).toString("hex")}`,
  );
  if (binaryPackedTraits !== packedTraits) {
    throw new Error(`Assignment ${assignmentId} differs between the frozen manifest and binary.`);
  }

  const filename = `hoodyoor-assignment-${String(assignmentId).padStart(4, "0")}.png`;
  const outputPath = path.join(outputRoot, filename);
  const svg = renderHoodYoorPackedSvg(packedTraits);
  await sharp(Buffer.from(svg), { density: 192 })
    .resize(renderSize, renderSize, {
      fit: "fill",
      kernel: sharp.kernel.nearest,
    })
    .png({ compressionLevel: 9, palette: true })
    .toFile(outputPath);

  records.push({
    assignmentId,
    image: `/assets/robinhood/collection/${filename}`,
    packedTraits: packedTraits.toString(),
    traits: hoodYoorTraitSnapshot(packedTraits),
  });
}

const websiteManifest = {
  schema: "dyoor-hoodyoor-website-art-v1",
  source: "data/robinhood/onchain-128/hoodyoor-initial-assignments.bin",
  provenanceHash: assignmentManifest.totals.provenanceHash,
  renderSource: "lib/hoodyoor-reroll-catalog.js",
  note: "These are exact frozen assignment renders. Token-to-assignment mapping is finalized by reveal.",
  revealPendingImage: "/assets/robinhood/collection/hoodyoor-reveal-pending.png",
  records,
};

fs.writeFileSync(
  path.join(outputRoot, "artwork-manifest.json"),
  `${JSON.stringify(websiteManifest, null, 2)}\n`,
);
console.log(JSON.stringify(websiteManifest, null, 2));
