import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { getAddress } from "ethers";
import {
  HOODYOOR_APPROVED_MINT_ENERGY_REWARD,
  HOODYOOR_CHAIN_ID,
  HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
} from "./lib/hoodyoor-mainnet.js";

const DECISION_ACK = "HOODYOOR-1000-ENERGY-AND-UNAUDITED-RISK-ACCEPTED";
if (process.env.CONFIRM_HOODYOOR_OWNER_DECISIONS !== DECISION_ACK) {
  throw new Error(`Set CONFIRM_HOODYOOR_OWNER_DECISIONS=${DECISION_ACK} to record both owner decisions.`);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateEnvironmentPath = path.join(
  projectRoot,
  "data",
  "game",
  "private",
  "hoodyoor-mainnet.env",
);
const config = JSON.parse(fs.readFileSync(
  path.join(projectRoot, "data", "robinhood", "dyoor-collection-config.json"),
  "utf8",
));
const manifest = JSON.parse(fs.readFileSync(
  path.join(
    projectRoot,
    "data",
    "robinhood",
    "onchain-128",
    "hoodyoor-mainnet-launch-manifest.json",
  ),
  "utf8",
));
if (
  config.targetChain.chainId !== HOODYOOR_CHAIN_ID
  || config.reroll?.mintEnergy?.rewardPerPaidToken !== HOODYOOR_APPROVED_MINT_ENERGY_REWARD
  || manifest.sourceTree?.canonicalKeccak256 !== "0xe1d826b0509fa93d8373e9f8cea20fac2b8015f8dfcebc3d670824923794598c"
) throw new Error("Owner decisions do not match the frozen HoodYØØR launch build.");

let contents = fs.readFileSync(privateEnvironmentPath, "utf8");
const parsed = parseEnv(contents);
if (parsed.HOODYOOR_SECURITY_REVIEW_APPROVED === "1") {
  throw new Error("Independent review is marked approved; refusing to replace it with a waiver.");
}
const updates = {
  HOODYOOR_SECURITY_REVIEW_WAIVER: HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
  HOODYOOR_MINT_ENERGY_REWARD_APPROVED: String(HOODYOOR_APPROVED_MINT_ENERGY_REWARD),
};
for (const [name, value] of Object.entries(updates)) {
  const expression = new RegExp(`^${name}=.*$`, "m");
  if (expression.test(contents)) contents = contents.replace(expression, `${name}=${value}`);
  else contents += `${contents.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
}
const temporaryEnvironmentPath = `${privateEnvironmentPath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryEnvironmentPath, contents, { mode: 0o600, flag: "wx" });
fs.renameSync(temporaryEnvironmentPath, privateEnvironmentPath);
fs.chmodSync(privateEnvironmentPath, 0o600);

const checkpointPath = path.join(
  projectRoot,
  "deployments",
  "robinhood",
  `hoodyoor-owner-launch-decisions-${HOODYOOR_CHAIN_ID}.json`,
);
const checkpoint = {
  schema: "dyoor-hoodyoor-owner-launch-decisions-v1",
  chainId: HOODYOOR_CHAIN_ID,
  owner: getAddress(config.owner),
  sourceTreeKeccak256: manifest.sourceTree.canonicalKeccak256,
  paidMintEnergy: {
    rewardPerToken: HOODYOOR_APPROVED_MINT_ENERGY_REWARD,
    approved: true,
  },
  securityReview: {
    independentlyReviewed: false,
    explicitOwnerWaiver: true,
    acknowledgement: HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
    statement: "Owner explicitly accepts unaudited smart-contract mainnet deployment risk. This waiver is not an audit or independent security approval.",
  },
  recordedAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
const temporaryCheckpointPath = `${checkpointPath}.tmp-${process.pid}`;
fs.writeFileSync(
  temporaryCheckpointPath,
  `${JSON.stringify(checkpoint, null, 2)}\n`,
  { mode: 0o600, flag: "wx" },
);
fs.renameSync(temporaryCheckpointPath, checkpointPath);

console.log(JSON.stringify({
  chainId: HOODYOOR_CHAIN_ID,
  owner: checkpoint.owner,
  sourceTreeKeccak256: checkpoint.sourceTreeKeccak256,
  mintEnergyRewardApproved: HOODYOOR_APPROVED_MINT_ENERGY_REWARD,
  independentReviewApproved: false,
  explicitOwnerSecurityReviewWaiver: true,
  waiverRepresentedAsAudit: false,
  checkpoint: path.relative(projectRoot, checkpointPath),
}, null, 2));
