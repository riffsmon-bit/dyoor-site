import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getAddress,
  getBytes,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import {
  HOODYOOR_CHAIN_ID,
  assertMainnetBroadcastSafety,
  mainnetGateReport,
} from "./hoodyoor-mainnet.js";

export const HOODYOOR_SEADROP = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";
export const HOODYOOR_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const HOODYOOR_LEGACY_COLLECTION =
  "0x1Ece69C63F0b49C7a5B02eaf209059B4E2aF69a1";
export const HOODYOOR_LEGACY_REROLL_CONTROLLER =
  "0x69Ec96b8EF47e1f241389260d190b0ce61D67C2B";
export const HOODYOOR_PACKED_TRAIT_STORE =
  "0xaD7be6b27efDF619759375aF719A9D69e25818c1";
export const HOODYOOR_PIXEL_RENDERER =
  "0xb9cB0563013D9741f76a802d2F658EbF3433eE12";
export const HOODYOOR_ENERGY_BANK =
  "0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3";
export const HOODYOOR_TRAIT_RULES =
  "0xd4E7F224539e628f58c4A6159A7a0eeE27991640";

export const HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER_ACK =
  "HOODYOOR-SEADROP-V2-OWNER-ACCEPTS-UNAUDITED-MAINNET-RISK";
export const HOODYOOR_SEADROP_V2_BROADCAST_ACK =
  "HOODYOOR-SEADROP-V2-4663-IRREVERSIBLE";
export const HOODYOOR_SEADROP_V2_MANIFEST_PATH = path.join(
  "data",
  "robinhood",
  "onchain-128",
  "hoodyoor-seadrop-v2-launch-manifest.json",
);
export const HOODYOOR_SEADROP_V2_CHECKPOINT_PATH = path.join(
  "deployments",
  "robinhood",
  `hoodyoor-seadrop-v2-${HOODYOOR_CHAIN_ID}.json`,
);

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_REROLL_ENERGY = 1_000n;

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function fileRecord(projectRoot, absolutePath) {
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: path.relative(projectRoot, absolutePath),
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    keccak256: keccak256(bytes),
  };
}

export function artifactRecord(projectRoot, contractName) {
  const artifactPath = path.join(
    projectRoot,
    "contracts",
    "hoodyoor",
    "out",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  for (const [sourceName, metadata] of Object.entries(artifact.metadata?.sources || {})) {
    const sourcePath = path.join(projectRoot, "contracts", "hoodyoor", sourceName);
    const sourceHash = keccak256(fs.readFileSync(sourcePath));
    if (sourceHash.toLowerCase() !== String(metadata.keccak256 || "").toLowerCase()) {
      throw new Error(`${contractName} artifact is stale for ${sourceName}.`);
    }
  }
  const creation = artifact.bytecode?.object || artifact.bytecode;
  const runtime = artifact.deployedBytecode?.object || artifact.deployedBytecode;
  if (!creation || creation === "0x" || !runtime || runtime === "0x") {
    throw new Error(`${contractName} artifact is missing bytecode.`);
  }
  const creationHex = creation.startsWith("0x") ? creation : `0x${creation}`;
  const runtimeHex = runtime.startsWith("0x") ? runtime : `0x${runtime}`;
  return {
    contract: contractName,
    artifact: fileRecord(projectRoot, artifactPath),
    creationBytes: getBytes(creationHex).length,
    creationKeccak256: keccak256(creationHex),
    runtimeBytes: getBytes(runtimeHex).length,
    runtimeKeccak256: keccak256(runtimeHex),
    abiKeccak256: keccak256(toUtf8Bytes(JSON.stringify(artifact.abi))),
  };
}

export function sourceTreeHashes(files) {
  const canonical = files
    .map(({ path: filePath, sha256 }) => `${filePath}\0${sha256}`)
    .join("\n");
  return {
    canonicalSha256: sha256Hex(Buffer.from(canonical)),
    canonicalKeccak256: keccak256(toUtf8Bytes(canonical)),
  };
}

export function buildHoodYoorOnchainContractURI(treasury) {
  const receiver = getAddress(treasury);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32" shape-rendering="crispEdges">',
    '<rect width="32" height="32" fill="#05090d"/>',
    '<path fill="#b9ff00" d="M2 24h2v-4h2v2h2v-6h2v3h2v-8h2v5h2v-3h2v6h2v-10h2v7h2V6h2v18h4v4H2z"/>',
    '<path fill="#00b8b8" d="M10 7h12v2h3v13h-3v3H10v-3H7V9h3z"/>',
    '<path fill="#111820" d="M9 5h13v2h3v3H8V7h1zM9 12h6v4H9zm8 0h6v4h-6z"/>',
    '<path fill="#f6c744" d="M11 19h10v3H11z"/>',
    '<path fill="#ffffff" d="M10 13h4v2h-4zm8 0h4v2h-4z"/>',
    '<text x="16" y="30" fill="#b9ff00" font-family="monospace" font-size="3" text-anchor="middle">HOODYOOR</text>',
    "</svg>",
  ].join("");
  const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const metadata = {
    name: "HoodYØØR",
    description:
      "3,333 fully onchain pixel droids on Robinhood Chain. Minting earns Energy; revealed holders can reroll mutable traits with Energy, ETH, or USDG.",
    image,
    seller_fee_basis_points: 300,
    fee_recipient: receiver,
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
}

export function parsePositiveUint(value) {
  try {
    if (!/^(0|[1-9][0-9]*)$/.test(String(value || ""))) return null;
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed > MAX_UINT256 / MAX_REROLL_ENERGY) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function seaDropV2PricingAcknowledgement(weiPerEnergy, usdgUnitsPerEnergy) {
  return `HOODYOOR-SEADROP-V2-PRICING:${BigInt(weiPerEnergy)}:${BigInt(usdgUnitsPerEnergy)}`;
}

function verifyFileRecord(projectRoot, record) {
  try {
    const bytes = fs.readFileSync(path.join(projectRoot, record.path));
    return bytes.length === record.bytes
      && sha256Hex(bytes) === record.sha256
      && keccak256(bytes).toLowerCase() === record.keccak256.toLowerCase();
  } catch {
    return false;
  }
}

export function verifySeaDropV2ManifestLocal(projectRoot, manifest) {
  const checks = [];
  const add = (id, passed) => checks.push({ id, passed: Boolean(passed) });

  add("manifest-schema", manifest?.schema === "dyoor-hoodyoor-seadrop-v2-launch-v1");
  add("target-chain", manifest?.targetChain?.chainId === HOODYOOR_CHAIN_ID);
  add("broadcast-not-authorized", manifest?.broadcast?.authorized === false);
  add(
    "canonical-seadrop",
    manifest?.externalContracts?.seaDrop
      && getAddress(manifest.externalContracts.seaDrop) === getAddress(HOODYOOR_SEADROP),
  );
  add(
    "canonical-usdg",
    manifest?.externalContracts?.usdg
      && getAddress(manifest.externalContracts.usdg) === getAddress(HOODYOOR_USDG),
  );
  add(
    "legacy-collection",
    manifest?.migration?.supersededCollection
      && getAddress(manifest.migration.supersededCollection)
        === getAddress(HOODYOOR_LEGACY_COLLECTION),
  );

  const sourceFiles = manifest?.sourceTree?.files || [];
  for (const record of sourceFiles) {
    add(`source:${record.path}`, verifyFileRecord(projectRoot, record));
  }
  const sourceHashes = sourceTreeHashes(sourceFiles);
  add(
    "source-tree-sha256",
    sourceHashes.canonicalSha256 === manifest?.sourceTree?.canonicalSha256,
  );
  add(
    "source-tree-keccak256",
    sourceHashes.canonicalKeccak256.toLowerCase()
      === String(manifest?.sourceTree?.canonicalKeccak256 || "").toLowerCase(),
  );

  for (const record of manifest?.integrityFiles || []) {
    add(`payload:${record.path}`, verifyFileRecord(projectRoot, record));
  }
  for (const expected of manifest?.artifacts || []) {
    try {
      const actual = artifactRecord(projectRoot, expected.contract);
      add(`artifact-file:${expected.contract}`, verifyFileRecord(projectRoot, expected.artifact));
      add(
        `artifact-bytecode:${expected.contract}`,
        actual.creationBytes === expected.creationBytes
          && actual.runtimeBytes === expected.runtimeBytes
          && actual.creationKeccak256.toLowerCase()
            === expected.creationKeccak256.toLowerCase()
          && actual.runtimeKeccak256.toLowerCase()
            === expected.runtimeKeccak256.toLowerCase()
          && actual.abiKeccak256.toLowerCase() === expected.abiKeccak256.toLowerCase(),
      );
    } catch {
      add(`artifact-file:${expected.contract}`, false);
      add(`artifact-bytecode:${expected.contract}`, false);
    }
  }

  const blockers = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return { passed: blockers.length === 0, checks, blockers };
}

export function seaDropV2GateReport(configuredOwner, manifest, environment = process.env) {
  const base = mainnetGateReport(configuredOwner, environment);
  const weiPerEnergy = parsePositiveUint(environment.HOODYOOR_REROLL_WEI_PER_ENERGY);
  const usdgUnitsPerEnergy = parsePositiveUint(
    environment.HOODYOOR_REROLL_USDG_UNITS_PER_ENERGY,
  );
  const sourceHash = String(manifest?.sourceTree?.canonicalKeccak256 || "");
  const reviewed = environment.HOODYOOR_SEADROP_V2_SECURITY_REVIEW_APPROVED === "1";
  const waived = environment.HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER
    === HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER_ACK;
  const expectedPricingAck = weiPerEnergy && usdgUnitsPerEnergy
    ? seaDropV2PricingAcknowledgement(weiPerEnergy, usdgUnitsPerEnergy)
    : null;

  const v2Gates = [
    {
      id: "seadrop-v2-exact-source-hash",
      passed: /^0x[0-9a-f]{64}$/i.test(sourceHash)
        && String(environment.HOODYOOR_SEADROP_V2_SOURCE_HASH || "").toLowerCase()
          === sourceHash.toLowerCase(),
    },
    {
      id: "seadrop-v2-security-review-or-explicit-owner-waiver",
      passed: reviewed || waived,
    },
    { id: "reroll-wei-per-energy", passed: Boolean(weiPerEnergy) },
    { id: "reroll-usdg-units-per-energy", passed: Boolean(usdgUnitsPerEnergy) },
    {
      id: "seadrop-v2-exact-pricing-acknowledgement",
      passed: Boolean(expectedPricingAck)
        && environment.HOODYOOR_SEADROP_V2_PRICING_ACK === expectedPricingAck,
    },
    {
      id: "seadrop-v2-irreversibility-acknowledgement",
      passed: environment.HOODYOOR_SEADROP_V2_BROADCAST_ACK
        === HOODYOOR_SEADROP_V2_BROADCAST_ACK,
    },
  ];
  const gates = [...base.gates, ...v2Gates];
  return {
    ...base,
    securityReviewV2: {
      independentlyReviewed: reviewed,
      explicitOwnerWaiver: waived,
      mode: reviewed ? "independent-review" : waived ? "explicit-owner-waiver" : "unresolved",
    },
    pricing: {
      weiPerEnergy: weiPerEnergy?.toString() || null,
      usdgUnitsPerEnergy: usdgUnitsPerEnergy?.toString() || null,
      expectedAcknowledgement: expectedPricingAck,
    },
    gates,
    blockers: gates.filter(({ passed }) => !passed).map(({ id }) => id),
    ready: gates.every(({ passed }) => passed),
  };
}

export function assertSeaDropV2BroadcastSafety(
  configuredOwner,
  manifest,
  environment = process.env,
  projectRoot = process.cwd(),
) {
  const local = verifySeaDropV2ManifestLocal(projectRoot, manifest);
  if (!local.passed) {
    throw new Error(
      `HoodYØØR SeaDrop v2 broadcast is blocked: local manifest integrity failed (${local.blockers.join(", ")}).`,
    );
  }
  const base = assertMainnetBroadcastSafety(configuredOwner, environment, projectRoot);
  const report = seaDropV2GateReport(configuredOwner, manifest, environment);
  const v2Blockers = report.blockers.filter(
    (id) => !base.gates.some((gate) => gate.id === id && !gate.passed),
  );
  if (v2Blockers.length) {
    throw new Error(
      `HoodYØØR SeaDrop v2 broadcast is blocked: ${v2Blockers.join(", ")}.`,
    );
  }
  return { ...report, local, energyMigration: base.energyMigration, revealBackup: base.revealBackup };
}
