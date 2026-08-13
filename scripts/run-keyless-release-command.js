import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertNoLocalEnvironmentFiles,
  assertReadOnlyReleaseEnvironment,
  findRepositoryRoot,
  keylessChildEnvironment,
} from "./lib/release-safety.js";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : "";
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
if (!command) throw new Error("Usage: node scripts/run-keyless-release-command.js -- <command> [...args]");
if (args.includes("--broadcast") || args.includes("--private-key") || args.includes("--mnemonic")) {
  throw new Error("Keyless release commands cannot accept signing or broadcast arguments.");
}

assertReadOnlyReleaseEnvironment();
const root = findRepositoryRoot();
assertNoLocalEnvironmentFiles(root);

const environment = keylessChildEnvironment();
const sentinel = path.join(path.dirname(fileURLToPath(import.meta.url)), "secret-access-sentinel.js");
environment.NODE_OPTIONS = `${environment.NODE_OPTIONS || ""} --import=${sentinel}`.trim();

const result = spawnSync(command, args, {
  cwd: root,
  env: environment,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else process.stdout.write("SECRET_ACCESS_SENTINEL=PASS\n");
