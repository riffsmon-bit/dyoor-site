import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { ethers } from "ethers";

if (process.env.ACTIVATE_DYOOR_WORLD_SOCIAL_PREVIEW !== "1") {
  throw new Error(
    "Refusing to prepare live preview values. Set ACTIVATE_DYOOR_WORLD_SOCIAL_PREVIEW=1 explicitly.",
  );
}

const root = process.cwd();
const localPath = path.join(root, ".env");
const functionsPath = path.join(root, "netlify-dyoor-world-functions.env");
const buildsPath = path.join(root, "netlify-dyoor-world-builds.env");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function read(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function upsert(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.replace(/\s*$/, "")}\n${line}\n`;
}

function secureWrite(filePath, source) {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, source, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, filePath);
  chmodSync(filePath, 0o600);
}

const address = ethers.getAddress(
  argValue("--escrow") || process.env.DYOOR_WORLD_TRADE_ESCROW_ADDRESS || "",
);
const block = Number(argValue("--block") || process.env.DYOOR_WORLD_TRADE_ESCROW_START_BLOCK);
if (!Number.isSafeInteger(block) || block <= 0) {
  throw new Error("--block must be the confirmed Monad deployment block.");
}

let localSource = read(localPath);
let functionsSource = read(functionsPath);
let buildsSource = read(buildsPath);
const localValues = parse(localSource);
const functionsValues = parse(functionsSource);
const automationSecret = String(
  functionsValues.DYOOR_WORLD_AUTOMATION_SECRET
    || localValues.DYOOR_WORLD_AUTOMATION_SECRET
    || randomBytes(32).toString("hex"),
);
const rewardSecret = String(
  functionsValues.DYOOR_WORLD_REWARD_SECRET
    || localValues.DYOOR_WORLD_REWARD_SECRET
    || randomBytes(32).toString("hex"),
);

for (const [key, value] of Object.entries({
  DYOOR_WORLD_AUTOMATION_SECRET: automationSecret,
  DYOOR_WORLD_REWARD_SECRET: rewardSecret,
  DYOOR_WORLD_REWARDS_ENABLED: "true",
  DYOOR_WORLD_SALES_BOT_ENABLED: "true",
})) {
  localSource = upsert(localSource, key, value);
  functionsSource = upsert(functionsSource, key, value);
}
for (const [key, value] of Object.entries({
  DYOOR_WORLD_TRADE_ESCROW_ADDRESS: address,
  DYOOR_WORLD_TRADE_ESCROW_START_BLOCK: String(block),
  NEXT_PUBLIC_DYOOR_WORLD_TRADE_ESCROW_ADDRESS: address,
})) {
  localSource = upsert(localSource, key, value);
}
buildsSource = upsert(
  buildsSource,
  "NEXT_PUBLIC_DYOOR_WORLD_TRADE_ESCROW_ADDRESS",
  address,
);

secureWrite(localPath, localSource);
secureWrite(functionsPath, functionsSource);
secureWrite(buildsPath, buildsSource);

console.log(JSON.stringify({
  ok: true,
  escrow: address,
  deploymentBlock: block,
  rewardsEnabled: true,
  salesBotEnabled: true,
  functionsFile: path.relative(root, functionsPath),
  buildsFile: path.relative(root, buildsPath),
  secretsPrinted: false,
}, null, 2));
