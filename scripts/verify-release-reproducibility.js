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

function option(name, fallback = "") {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    env: keylessChildEnvironment(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return String(result.stdout || "").trim();
}

function critical(record) {
  return {
    contract: record.contract,
    sourceSha256: record.sourceSha256,
    wholeArtifactSha256: record.wholeArtifactSha256,
    canonicalArtifactSha256: record.canonicalArtifactSha256,
    abiSha256: record.abiSha256,
    constructorSchemaSha256: record.constructorSchemaSha256,
    creationBytecodeHash: record.creationBytecodeHash,
    runtimeBytecodeHash: record.runtimeBytecodeHash,
    storageLayoutSha256: record.storageLayoutSha256,
    linkReferencesSha256: record.linkReferencesSha256,
    immutableReferencesSha256: record.immutableReferencesSha256,
  };
}

function cleanGitStatus() {
  return run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
}

assertReadOnlyReleaseEnvironment();
assertNoLocalEnvironmentFiles(ROOT);
const status = cleanGitStatus();
if (status) throw new Error(`Reproducibility requires a clean worktree:\n${status}`);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hoodyoor-release-repro-"));
const buildRoot = path.join(temporaryRoot, "scratch");
const reportFile = path.join(temporaryRoot, "build.json");

function build(label) {
  fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.rmSync(reportFile, { force: true });
  const output = path.join(buildRoot, "out");
  const cache = path.join(buildRoot, "cache");
  run(process.execPath, [
    "scripts/build-release-contracts.js",
    "--out",
    output,
    "--cache",
    cache,
    "--report",
    reportFile,
  ]);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const records = report.contracts.map(critical);
  fs.rmSync(buildRoot, { recursive: true, force: true });
  return { label, records };
}

try {
  const runA = build("RUN_A");
  const runB = build("RUN_B");
  const identical = JSON.stringify(runA.records) === JSON.stringify(runB.records);
  if (!identical) throw new Error("Release-critical artifacts differ between scratch builds A and B.");
  const result = {
    schema: "hoodyoor-release-reproducibility-v1",
    sourceCommit: run("git", ["rev-parse", "HEAD"]),
    branch: run("git", ["branch", "--show-current"]),
    worktreeClean: true,
    localEnvironmentFilesAbsent: true,
    signingVariablesAbsent: true,
    buildOutputDeletedBetweenRuns: true,
    runA,
    runB,
    canonicalOutputsIdentical: true,
    wholeArtifactJsonIdentical: runA.records.every((record, index) =>
      record.wholeArtifactSha256 === runB.records[index].wholeArtifactSha256),
    result: "PASS",
  };
  const requestedReport = option("--report");
  if (requestedReport) {
    const target = path.isAbsolute(requestedReport)
      ? requestedReport
      : path.resolve(ROOT, requestedReport);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
