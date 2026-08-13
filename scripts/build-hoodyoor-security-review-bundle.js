import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  projectRoot,
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-mainnet-launch-manifest.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sourceTreeHash = manifest.sourceTree?.canonicalKeccak256;
if (!/^0x[0-9a-f]{64}$/i.test(sourceTreeHash || "")) {
  throw new Error("Launch manifest is missing its canonical production-source hash.");
}

const bundleRoot = path.join(
  projectRoot,
  "data",
  "robinhood",
  "security-review",
  `hoodyoor-mainnet-${sourceTreeHash.slice(2, 18).toLowerCase()}`,
);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function relative(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function filesUnder(relativeDirectory, predicate = () => true) {
  const root = path.join(projectRoot, relativeDirectory);
  if (!fs.existsSync(root)) return [];
  const pending = [root];
  const files = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile() && predicate(absolutePath)) files.push(relative(absolutePath));
    }
  }
  return files.sort();
}

const reviewFiles = new Set([
  ".env.example",
  "package.json",
  "package-lock.json",
  "data/robinhood/dyoor-collection-config.json",
  "contracts/hoodyoor/foundry.toml",
  "contracts/hoodyoor/README.md",
  "contracts/hoodyoor/src/HoodYOORBlockhashCanary.sol",
  "scripts/lib/hoodyoor-mainnet.js",
  "scripts/build-hoodyoor-security-review-bundle.js",
  ...manifest.sourceTree.files.map(({ path: filePath }) => filePath),
  ...manifest.artifacts.map(({ artifact }) => artifact),
  ...filesUnder("contracts/hoodyoor/test", (filePath) => filePath.endsWith(".sol")),
  ...filesUnder("contracts/hoodyoor/docs", (filePath) => filePath.endsWith(".md") || filePath.endsWith(".json")),
  ...filesUnder("data/robinhood/onchain-128"),
  ...filesUnder("test", (filePath) => /robinhood-.*\.test\.js$/.test(filePath)),
  ...filesUnder("scripts", (filePath) => (
    filePath.endsWith(".js")
    && /(robinhood|hoodyoor)/i.test(path.basename(filePath))
  )),
  ...filesUnder("lib", (filePath) => /hoodyoor-reroll/i.test(path.basename(filePath))),
  ...filesUnder("app/api/robinhood", (filePath) => /\.(?:ts|tsx|js)$/.test(filePath)),
]);

const canaryCheckpoint = "deployments/robinhood/hoodyoor-blockhash-canary-4663.json";
if (fs.existsSync(path.join(projectRoot, canaryCheckpoint))) reviewFiles.add(canaryCheckpoint);
const ownerDecisionsCheckpoint = "deployments/robinhood/hoodyoor-owner-launch-decisions-4663.json";
if (fs.existsSync(path.join(projectRoot, ownerDecisionsCheckpoint))) {
  reviewFiles.add(ownerDecisionsCheckpoint);
}

const orderedFiles = [...reviewFiles].sort();
for (const filePath of orderedFiles) {
  if (
    filePath !== ".env.example"
    && (/(^|\/)\.env(?:\.|$)/.test(filePath) || filePath.startsWith("data/game/private/"))
  ) throw new Error(`Refusing to package private launch material: ${filePath}`);
  const absolutePath = path.join(projectRoot, filePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Review input is missing: ${filePath}`);
  }
}

const sourceRecords = manifest.sourceTree.files.map((record) => {
  const bytes = fs.readFileSync(path.join(projectRoot, record.path));
  const actual = sha256(bytes);
  if (actual !== record.sha256) {
    throw new Error(`Production source changed after manifest generation: ${record.path}`);
  }
  return record;
});
const canonicalSourceTree = sourceRecords
  .map(({ path: filePath, sha256: hash }) => `${filePath}\0${hash}`)
  .join("\n");
if (sha256(Buffer.from(canonicalSourceTree)) !== manifest.sourceTree.canonicalSha256) {
  throw new Error("Production source tree does not match the frozen launch manifest.");
}

fs.mkdirSync(bundleRoot, { recursive: true });
for (const filePath of orderedFiles) {
  const source = path.join(projectRoot, filePath);
  const destination = path.join(bundleRoot, "repository", filePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const canary = fs.existsSync(path.join(projectRoot, canaryCheckpoint))
  ? JSON.parse(fs.readFileSync(path.join(projectRoot, canaryCheckpoint), "utf8"))
  : null;
const reviewScope = {
  schema: "dyoor-hoodyoor-security-review-scope-v1",
  collection: manifest.collection,
  targetChain: manifest.targetChain,
  productionSourceTree: manifest.sourceTree,
  productionArtifacts: manifest.artifacts,
  frozenPayloads: Object.fromEntries(Object.entries(manifest.payloads).map(([name, payload]) => [
    name,
    {
      binary: payload.binary,
      binaryHash: payload.binaryHash,
      ...(payload.provenanceHash ? { provenanceHash: payload.provenanceHash } : {}),
      ...(payload.rulesHash ? { rulesHash: payload.rulesHash } : {}),
      ...(payload.merkleRoot ? { merkleRoot: payload.merkleRoot } : {}),
    },
  ])),
  economics: manifest.economics,
  ownerReserve: manifest.ownerReserve,
  secondaryTrading: manifest.secondaryTrading,
  ownerDecisions: manifest.ownerDecisions,
  publicBlockhashCanary: canary ? {
    status: canary.status,
    chainId: canary.chainId,
    address: canary.canary,
    deploymentTransaction: canary.deploymentTransaction,
    targetBlock: canary.targetBlock,
    observedBlockHash: canary.observedBlockHash || null,
    observationTransaction: canary.observationTransaction || null,
  } : null,
  approvalPolicy: {
    automaticApproval: false,
    required: "Independent reviewer approval must name this exact production source-tree hash and resolve every reported finding before HOODYOOR_SECURITY_REVIEW_APPROVED may be set to 1.",
    productionSourceTreeKeccak256: sourceTreeHash,
  },
  packagedFiles: orderedFiles.length,
};

const readme = `# HoodYØØR exact-source security review bundle

This bundle scopes the Robinhood Chain mainnet collection build whose canonical
production-source hash is \`${sourceTreeHash}\`.

Nothing in this bundle constitutes an independent audit. The owner has explicitly
waived independent review and accepted unaudited deployment risk; that waiver must
never be described as a security approval. An independent reviewer should record
all findings and explicitly name the source-tree hash above in a final attestation.
Any source change invalidates that approval and requires a regenerated bundle.

## Primary review targets

- ERC-721 ownership, approvals, safe minting, withdrawals, royalties, and reentrancy.
- Paid GTD/public mint limits and atomic 1,000-Energy-per-token crediting; the free
  150-token owner reserve must never earn mint Energy.
- Supply accounting and the permanent secondary-market unlock at total supply 1,667.
- Assignment freeze, reveal commitment, Nitro/Ethereum-parent blockhash timing,
  expiration recovery, and the 16-round bijective token permutation.
- Immutable bytecode-backed art storage, renderer bounds, metadata, and freeze order.
- Reroll EIP-712/ERC-1271 signatures, nonces, deadlines, result authority, Energy
  spending, trait locks, compatibility enforcement, and atomic state transitions.
- Ownership, roles, pause behavior, replay protection, irreversible configuration,
  deployment order, resumability, and every mainnet broadcast gate.

Start with \`REVIEW_SCOPE.json\`, then inspect the mirrored files under
\`repository/\`. Verify every file against \`CHECKSUMS.sha256\`. The included
\`REVIEW_ATTESTATION_TEMPLATE.md\` is intentionally blank and must be completed by
the independent reviewer; generating this bundle does not satisfy the review gate.
`;

const attestation = `# HoodYØØR independent security review attestation

- Reviewer / organization:
- Review completion date:
- Production source-tree Keccak-256: \`${sourceTreeHash}\`
- Bundle checksum-file SHA-256:
- Methods and tools used:
- Findings resolved:
- Accepted informational findings:
- Final conclusion:
- Reviewer signature or verifiable publication URL:

This template is not an approval until an independent reviewer completes it and
explicitly confirms the exact source-tree hash above.
`;

fs.writeFileSync(path.join(bundleRoot, "REVIEW_SCOPE.json"), `${JSON.stringify(reviewScope, null, 2)}\n`);
fs.writeFileSync(path.join(bundleRoot, "README.md"), readme);
fs.writeFileSync(path.join(bundleRoot, "REVIEW_ATTESTATION_TEMPLATE.md"), attestation);

const checksumFiles = filesUnder(relative(bundleRoot));
const checksumLines = checksumFiles
  .filter((filePath) => !filePath.endsWith("/CHECKSUMS.sha256"))
  .map((filePath) => {
    const bundleRelative = path.relative(bundleRoot, path.join(projectRoot, filePath)).split(path.sep).join("/");
    return `${sha256(fs.readFileSync(path.join(projectRoot, filePath)))}  ${bundleRelative}`;
  });
const checksumContents = `${checksumLines.join("\n")}\n`;
fs.writeFileSync(path.join(bundleRoot, "CHECKSUMS.sha256"), checksumContents);

console.log(JSON.stringify({
  output: relative(bundleRoot),
  sourceTreeKeccak256: sourceTreeHash,
  packagedFiles: orderedFiles.length,
  checksumEntries: checksumLines.length,
  checksumsSha256: sha256(Buffer.from(checksumContents)),
  independentlyApproved: false,
}, null, 2));
