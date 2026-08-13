import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

const operational = /^(airdrop-manifests\/|wallet-list-exports\/|launchd\/|data\/reports\/|data\/energy-reconciliation|hoodyoor-mainnet-.*\.tar\.gz$)/;
const localGenerated = /(^|\/)\.DS_Store$|^data\/robinhood\/(security-review|generations|previews|pixel-pilot|source-art)\//;
const documentation = /^docs\//;
const generatedButRequired = /^(deployments\/|data\/robinhood\/onchain-128\/|data\/robinhood\/branding\/|data\/robinhood\/layers\/|public\/assets\/robinhood\/)/;
const unrelated = /^(apps\/(game|discord)\/|docs\/game\/|data\/game\/|archive\/|netlify\/functions\/discord-|test\/dyoor-world-social\.test\.js$)/;

function classify(path) {
  if (operational.test(path)) return { classification: "SHOULD NOT SHIP", disposition: "EXCLUDE" };
  if (localGenerated.test(path)) return { classification: "LOCAL/DEVELOPER", disposition: "EXCLUDE" };
  if (documentation.test(path)) return { classification: "DOCUMENTATION ONLY", disposition: "INCLUDE" };
  if (unrelated.test(path)) return { classification: "UNRELATED", disposition: "INCLUDE" };
  if (generatedButRequired.test(path)) return { classification: "GENERATED", disposition: "INCLUDE" };
  return { classification: "REQUIRED FOR RELEASE", disposition: "INCLUDE" };
}

const tracked = git(["diff", "--name-status", "--no-renames"])
  .trim().split("\n").filter(Boolean).map((line) => {
    const [status, ...parts] = line.split("\t");
    const filePath = parts.join("\t");
    return { path: filePath, status: `TRACKED_${status}`, ...classify(filePath) };
  });
const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
  .split("\0").filter(Boolean).map((filePath) => ({
    path: filePath,
    status: "UNTRACKED",
    ...classify(filePath),
  }));
const files = [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path));
const counts = {};
for (const file of files) {
  const key = `${file.classification}:${file.disposition}`;
  counts[key] = (counts[key] || 0) + 1;
}
const result = {
  schema: "hoodyoor-release-worktree-classification-v1",
  baseCommit: git(["rev-parse", "HEAD"]).trim(),
  branch: git(["branch", "--show-current"]).trim(),
  filesInspected: files.length,
  counts,
  policy: {
    excluded: "Operational exports, local archives, duplicated review bundles, and generated visual working sets are preserved in the authoring worktree but excluded from the release commit.",
    unrelatedIncluded: "Existing game/Discord work is included so the complete repository remains buildable and can be validated, but it is outside the smart-contract audit scope.",
  },
  files,
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  const target = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
