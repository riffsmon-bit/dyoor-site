import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RELEASE_CONTRACTS, artifactRecord } from "./lib/release-artifacts.js";
import {
  assertNoLocalEnvironmentFiles,
  assertReadOnlyReleaseEnvironment,
  keylessChildEnvironment,
} from "./lib/release-safety.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_ROOT = path.join(ROOT, "contracts", "hoodyoor");

function option(name, fallback) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function absolute(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || keylessChildEnvironment(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return String(result.stdout || result.stderr || "").trim();
}

assertReadOnlyReleaseEnvironment();
assertNoLocalEnvironmentFiles(ROOT);

const outDirectory = absolute(option("--out", "contracts/hoodyoor/out-release"));
const cacheDirectory = absolute(option("--cache", "contracts/hoodyoor/cache-release"));
const reportPath = option("--report", "");
const environment = keylessChildEnvironment();
environment.FOUNDRY_PROFILE = "release";

run("forge", [
  "build",
  "--offline",
  "--force",
  "src/droid",
  "src/economic",
  "--out",
  outDirectory,
  "--cache-path",
  cacheDirectory,
], { cwd: CONTRACT_ROOT, env: environment });

const records = RELEASE_CONTRACTS.map((definition) =>
  artifactRecord(ROOT, outDirectory, definition));
const report = {
  schema: "hoodyoor-release-contract-build-v1",
  mode: "KEYLESS_READ_ONLY",
  broadcastCapability: false,
  privateKeyRead: false,
  compilerScope: ["src/droid", "src/economic"],
  foundryProfile: "release",
  forgeVersion: run("forge", ["--version"], { env: environment }),
  contracts: records,
};

if (reportPath) {
  const target = absolute(reportPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
