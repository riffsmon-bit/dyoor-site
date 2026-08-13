import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { keccak256 } from "ethers";

export const RELEASE_CONTRACTS = Object.freeze([
  {
    contract: "DroidAccountV1",
    source: "contracts/hoodyoor/src/droid/DroidAccountV1.sol",
    chains: [143],
  },
  {
    contract: "DroidAccountRegistry",
    source: "contracts/hoodyoor/src/droid/DroidAccountRegistry.sol",
    chains: [143],
  },
  {
    contract: "HoodYoorDroidRegistry",
    source: "contracts/hoodyoor/src/economic/HoodYoorDroidRegistry.sol",
    chains: [4663],
  },
  {
    contract: "HoodYoorAssetRegistry",
    source: "contracts/hoodyoor/src/economic/HoodYoorAssetRegistry.sol",
    chains: [4663],
  },
  {
    contract: "HoodYoorRewardsDistributor",
    source: "contracts/hoodyoor/src/economic/HoodYoorRewardsDistributor.sol",
    chains: [4663],
  },
  {
    contract: "HoodYoorRevenueVault",
    source: "contracts/hoodyoor/src/economic/HoodYoorRevenueVault.sol",
    chains: [4663],
  },
  {
    contract: "HoodYoorStrategyRegistry",
    source: "contracts/hoodyoor/src/economic/HoodYoorStrategyRegistry.sol",
    chains: [4663],
  },
  {
    contract: "HoodYoorAchievementRegistry",
    source: "contracts/hoodyoor/src/economic/HoodYoorAchievementRegistry.sol",
    chains: [4663],
  },
]);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

export function hashJson(value) {
  return sha256(stableJson(value));
}

function normalizeTypeId(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/t_struct\(([^)]+)\)\d+(_(?:storage|memory|calldata)(?:_ptr)?)?/g, "t_struct($1)$2")
    .replace(/t_enum\(([^)]+)\)\d+/g, "t_enum($1)")
    .replace(/t_contract\(([^)]+)\)\d+/g, "t_contract($1)")
    .replace(/t_userDefinedValueType\(([^)]+)\)\d+/g, "t_userDefinedValueType($1)");
}

function normalizeStorageValue(value) {
  if (Array.isArray(value)) return value.map(normalizeStorageValue);
  if (!value || typeof value !== "object") return normalizeTypeId(value);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "astId") continue;
    result[key] = normalizeStorageValue(child);
  }
  return result;
}

export function normalizeStorageLayout(layout) {
  if (!layout || typeof layout !== "object") return { storage: [], types: {} };
  const storage = (layout.storage || []).map(normalizeStorageValue);
  const types = {};
  for (const [key, value] of Object.entries(layout.types || {})) {
    types[normalizeTypeId(key)] = normalizeStorageValue(value);
  }
  return { storage, types };
}

export function normalizeImmutableReferences(references = {}) {
  return Object.values(references)
    .map((locations) => locations
      .map(({ start, length }) => ({ start, length }))
      .sort((a, b) => a.start - b.start || a.length - b.length))
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
}

export function constructorSchema(abi = []) {
  const constructor = abi.find((entry) => entry.type === "constructor");
  return constructor || { type: "constructor", inputs: [], stateMutability: "nonpayable" };
}

export function canonicalArtifact(artifact) {
  return {
    schema: "hoodyoor-canonical-solidity-artifact-v1",
    abi: artifact.abi || [],
    constructor: constructorSchema(artifact.abi || []),
    creationBytecode: artifact.bytecode?.object || "0x",
    runtimeBytecode: artifact.deployedBytecode?.object || "0x",
    creationLinkReferences: artifact.bytecode?.linkReferences || {},
    runtimeLinkReferences: artifact.deployedBytecode?.linkReferences || {},
    immutableReferences: normalizeImmutableReferences(
      artifact.deployedBytecode?.immutableReferences || {},
    ),
    methodIdentifiers: artifact.methodIdentifiers || {},
    compilerMetadata: artifact.metadata || null,
    storageLayout: normalizeStorageLayout(artifact.storageLayout),
  };
}

export function artifactRecord(root, outDirectory, definition) {
  const artifactPath = path.join(
    outDirectory,
    `${definition.contract}.sol`,
    `${definition.contract}.json`,
  );
  const artifactBytes = fs.readFileSync(artifactPath);
  const artifact = JSON.parse(artifactBytes);
  const sourceBytes = fs.readFileSync(path.join(root, definition.source));
  const canonical = canonicalArtifact(artifact);
  const creation = artifact.bytecode?.object || "0x";
  const runtime = artifact.deployedBytecode?.object || "0x";
  return {
    contract: definition.contract,
    source: definition.source,
    chainTargets: definition.chains,
    sourceSha256: sha256(sourceBytes),
    wholeArtifactSha256: sha256(artifactBytes),
    canonicalArtifactSha256: hashJson(canonical),
    abiSha256: hashJson(artifact.abi || []),
    constructorSchema: constructorSchema(artifact.abi || []),
    constructorSchemaSha256: hashJson(constructorSchema(artifact.abi || [])),
    creationBytecodeHash: keccak256(creation),
    runtimeBytecodeHash: keccak256(runtime),
    creationBytecodeBytes: (creation.length - 2) / 2,
    runtimeBytecodeBytes: (runtime.length - 2) / 2,
    storageLayoutSha256: hashJson(canonical.storageLayout),
    linkReferencesSha256: hashJson({
      creation: canonical.creationLinkReferences,
      runtime: canonical.runtimeLinkReferences,
    }),
    immutableReferencesSha256: hashJson(canonical.immutableReferences),
    compiler: artifact.metadata?.compiler || null,
    compilerSettings: artifact.metadata?.settings || null,
    sourceMapDebugSha256: hashJson({
      creation: artifact.bytecode?.sourceMap || "",
      runtime: artifact.deployedBytecode?.sourceMap || "",
      compilerSourceId: artifact.id ?? null,
    }),
  };
}
