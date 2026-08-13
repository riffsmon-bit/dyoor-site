import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertNoLocalEnvironmentFiles,
  assertReadOnlyReleaseEnvironment,
  keylessChildEnvironment,
} from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_ROOT = path.join(ROOT, "contracts", "hoodyoor");
const LEGACY_TARGETS = [
  "src/HoodYOOR.sol",
  "src/HoodYOOREnergyBank.sol",
  "src/HoodYOORPackedTraitStore.sol",
  "src/HoodYOORPixelRenderer.sol",
  "src/HoodYOORTraitRules.sol",
  "src/HoodYOORRerollController.sol",
];
const SEADROP_ARTIFACTS = [
  ["HoodYOORSeaDrop.sol", "HoodYOORSeaDrop.json"],
  ["HoodYOORRerollControllerV2.sol", "HoodYOORRerollControllerV2.json"],
];

assertReadOnlyReleaseEnvironment();
assertNoLocalEnvironmentFiles(ROOT);

function build(args, profile) {
  const environment = keylessChildEnvironment();
  environment.FOUNDRY_PROFILE = profile;
  const result = spawnSync("forge", args, {
    cwd: CONTRACT_ROOT,
    env: environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${profile} artifact build failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

// The SeaDrop v2 freeze was produced from the complete remapped source tree,
// while the original six-contract launch freeze predates that remapping. Build
// both exact compiler contexts, then compose only their frozen artifacts.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hoodyoor-legacy-build-"));
try {
  const seaDropOut = path.join(temporaryRoot, "out");
  const seaDropCache = path.join(temporaryRoot, "cache");
  build([
    "build", "--offline", "--force",
    "--out", seaDropOut,
    "--cache-path", seaDropCache,
  ], "default");
  build(["build", "--offline", "--force", ...LEGACY_TARGETS], "legacy-launch");
  for (const [sourceDirectory, artifactName] of SEADROP_ARTIFACTS) {
    const destinationDirectory = path.join(CONTRACT_ROOT, "out", sourceDirectory);
    fs.mkdirSync(destinationDirectory, { recursive: true });
    fs.copyFileSync(
      path.join(seaDropOut, sourceDirectory, artifactName),
      path.join(destinationDirectory, artifactName),
    );
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  schema: "hoodyoor-legacy-launch-artifact-build-v1",
  mode: "KEYLESS_READ_ONLY",
  broadcastCapability: false,
  privateKeyRead: false,
  compilerContexts: [
    { foundryProfile: "legacy-launch", remappings: [], targets: LEGACY_TARGETS },
    { foundryProfile: "default", scope: "complete-source-tree", artifacts: SEADROP_ARTIFACTS },
  ],
  result: "PASS",
}, null, 2)}\n`);
