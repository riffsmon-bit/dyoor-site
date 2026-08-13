import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELEASE_CONTRACTS,
  constructorSchema,
  hashJson,
  normalizeImmutableReferences,
  sha256,
} from "./lib/release-artifacts.js";
import { assertReadOnlyReleaseEnvironment } from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "contracts", "hoodyoor", "out");

const previous = Object.freeze({
  DroidAccountV1: {
    artifactSha256: "0x09328148e911aa9293953fbd25f5df66d704483e88991a7dc67c321a3804693e",
    immutableAstIds: [21147, 21149],
  },
  DroidAccountRegistry: {
    artifactSha256: "0x50876db00cd5b7f9a7e10f6a3ad6a5c42bee4d74343ab80e7e15557258cc5e6e",
    immutableAstIds: [20672, 20674, 20676, 20678, 20680],
  },
  HoodYoorRewardsDistributor: {
    artifactSha256: "0xa5b33717867f94b8d6d8694ffa74abdaf3cadef54f3c9f88df0f32da38d576bc",
    immutableAstIds: [25370, 25373],
  },
  HoodYoorRevenueVault: {
    artifactSha256: "0x9a947708ffe169aebf7c2767df69a86cba5ffb1c218cd69d4de731976cda21fa",
    immutableAstIds: [10445],
    previousCompilerSourceId: 42,
    rebuiltCompilerSourceId: 58,
  },
  HoodYoorStrategyRegistry: {
    artifactSha256: "0xac3ca48fd66c3b366818a4989e47645c5dfc18aa3a0424ac4479c4df645be4f0",
    immutableAstIds: [26606, 26609],
  },
  HoodYoorAchievementRegistry: {
    artifactSha256: "0x53f1ccb76367f3f85f8c29652e22bb1e484e6426772cd126f1a845e3dcb8cec2",
    immutableAstIds: [22517],
  },
});

function replaceSourceId(sourceMap, from, to) {
  return sourceMap.split(";").map((entry) => {
    const fields = entry.split(":");
    if (fields[2] === String(from)) fields[2] = String(to);
    return fields.join(":");
  }).join(";");
}

function reconstructPreviousArtifact(rebuilt, rule) {
  const result = structuredClone(rebuilt);
  const locations = Object.values(result.deployedBytecode?.immutableReferences || {});
  if (locations.length !== rule.immutableAstIds.length) {
    throw new Error("Immutable-reference count changed; previous artifact cannot be reconstructed.");
  }
  result.deployedBytecode.immutableReferences = Object.fromEntries(
    locations.map((value, index) => [String(rule.immutableAstIds[index]), value]),
  );
  if (rule.previousCompilerSourceId !== undefined) {
    result.bytecode.sourceMap = replaceSourceId(
      result.bytecode.sourceMap,
      rule.rebuiltCompilerSourceId,
      rule.previousCompilerSourceId,
    );
    result.deployedBytecode.sourceMap = replaceSourceId(
      result.deployedBytecode.sourceMap,
      rule.rebuiltCompilerSourceId,
      rule.previousCompilerSourceId,
    );
    result.id = rule.previousCompilerSourceId;
  }
  return result;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function analyze(definition) {
  const rule = previous[definition.contract];
  const artifactPath = path.join(OUT, `${definition.contract}.sol`, `${definition.contract}.json`);
  const rebuiltBytes = fs.readFileSync(artifactPath);
  const rebuilt = JSON.parse(rebuiltBytes);
  const old = reconstructPreviousArtifact(rebuilt, rule);
  const oldBytes = Buffer.from(JSON.stringify(old));
  const reconstructedHash = sha256(oldBytes);
  if (reconstructedHash.toLowerCase() !== rule.artifactSha256.toLowerCase()) {
    throw new Error(`${definition.contract}: previous whole artifact could not be reconstructed exactly.`);
  }
  const oldImmutableKeys = Object.keys(old.deployedBytecode.immutableReferences || {});
  const newImmutableKeys = Object.keys(rebuilt.deployedBytecode.immutableReferences || {});
  const sourceMapChanged = !equal(old.bytecode.sourceMap, rebuilt.bytecode.sourceMap)
    || !equal(old.deployedBytecode.sourceMap, rebuilt.deployedBytecode.sourceMap);
  return {
    contract: definition.contract,
    source: definition.source,
    previousWholeArtifactSha256: rule.artifactSha256,
    rebuiltWholeArtifactSha256: sha256(rebuiltBytes),
    exactPreviousArtifactReconstructionPassed: true,
    changedFields: [
      {
        path: "deployedBytecode.immutableReferences.<AST declaration id keys>",
        categories: ["IMMUTABLE REFERENCES", "DEBUG INFORMATION", "BUILD METADATA"],
        previous: oldImmutableKeys,
        rebuilt: newImmutableKeys,
        semanticLocationsIdentical: equal(
          normalizeImmutableReferences(old.deployedBytecode.immutableReferences),
          normalizeImmutableReferences(rebuilt.deployedBytecode.immutableReferences),
        ),
      },
      ...(sourceMapChanged ? [{
        path: "bytecode.sourceMap / deployedBytecode.sourceMap",
        categories: ["DEBUG INFORMATION", "BUILD METADATA"],
        previousSha256: hashJson({
          creation: old.bytecode.sourceMap,
          runtime: old.deployedBytecode.sourceMap,
        }),
        rebuiltSha256: hashJson({
          creation: rebuilt.bytecode.sourceMap,
          runtime: rebuilt.deployedBytecode.sourceMap,
        }),
        change: `compiler source id ${old.id} -> ${rebuilt.id}; source ranges, jumps, and modifier depths unchanged`,
      }, {
        path: "id",
        categories: ["BUILD METADATA", "DEBUG INFORMATION"],
        previous: old.id,
        rebuilt: rebuilt.id,
      }] : []),
    ],
    verifiedUnchanged: {
      sourceSha256: sha256(fs.readFileSync(path.join(ROOT, definition.source))),
      abiSha256: hashJson(rebuilt.abi || []),
      abiExact: equal(old.abi, rebuilt.abi),
      constructorSchemaSha256: hashJson(constructorSchema(rebuilt.abi || [])),
      constructorExact: equal(constructorSchema(old.abi), constructorSchema(rebuilt.abi)),
      creationBytecodeSha256: sha256(Buffer.from(rebuilt.bytecode.object)),
      creationBytecodeExact: old.bytecode.object === rebuilt.bytecode.object,
      runtimeBytecodeSha256: sha256(Buffer.from(rebuilt.deployedBytecode.object)),
      runtimeBytecodeExact: old.deployedBytecode.object === rebuilt.deployedBytecode.object,
      compilerMetadataSha256: hashJson(rebuilt.metadata),
      compilerMetadataExact: equal(old.metadata, rebuilt.metadata),
      rawCompilerMetadataSha256: sha256(Buffer.from(rebuilt.rawMetadata || "")),
      rawCompilerMetadataExact: old.rawMetadata === rebuilt.rawMetadata,
      methodIdentifiersSha256: hashJson(rebuilt.methodIdentifiers || {}),
      methodIdentifiersExact: equal(old.methodIdentifiers, rebuilt.methodIdentifiers),
      creationLinkReferencesSha256: hashJson(rebuilt.bytecode.linkReferences || {}),
      creationLinkReferencesExact: equal(
        old.bytecode.linkReferences,
        rebuilt.bytecode.linkReferences,
      ),
      runtimeLinkReferencesSha256: hashJson(rebuilt.deployedBytecode.linkReferences || {}),
      runtimeLinkReferencesExact: equal(
        old.deployedBytecode.linkReferences,
        rebuilt.deployedBytecode.linkReferences,
      ),
      immutableReferenceLocationsSha256: hashJson(
        normalizeImmutableReferences(rebuilt.deployedBytecode.immutableReferences),
      ),
      immutableReferenceLocationsExact: equal(
        normalizeImmutableReferences(old.deployedBytecode.immutableReferences),
        normalizeImmutableReferences(rebuilt.deployedBytecode.immutableReferences),
      ),
      storageLayoutInPreviousArtifact: Object.hasOwn(old, "storageLayout"),
      storageLayoutInRebuiltArtifact: Object.hasOwn(rebuilt, "storageLayout"),
    },
    executableImpact: "NONE",
  };
}

assertReadOnlyReleaseEnvironment();
const records = RELEASE_CONTRACTS
  .filter(({ contract }) => Object.hasOwn(previous, contract))
  .map(analyze);
const result = {
  schema: "hoodyoor-artifact-drift-analysis-v1",
  status: "EXPLAINED",
  executableImpact: "NONE",
  exactPreviousArtifactHashesReconstructed: records.every(
    (record) => record.exactPreviousArtifactReconstructionPassed,
  ),
  records,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
