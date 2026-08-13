import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  HOODYOOR_CHAIN_ID,
  assertMainnetBroadcastSafety,
  loadHoodyoorLocalEnvironment,
  readJson,
} from "./lib/hoodyoor-mainnet.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadHoodyoorLocalEnvironment(projectRoot);
const config = readJson(path.join(
  projectRoot,
  "data",
  "robinhood",
  "dyoor-collection-config.json",
));
const execute = process.env.EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT === "1";

function runScript(script, overrides = {}) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts", script)], {
    cwd: projectRoot,
    env: { ...process.env, ...overrides },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} stopped with exit code ${result.status}.`);
  }
}

function checkpoint(name) {
  const filePath = path.join(
    projectRoot,
    "deployments",
    "robinhood",
    `${name}-${HOODYOOR_CHAIN_ID}.json`,
  );
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${name} checkpoint after its stage.`);
  return readJson(filePath);
}

if (!execute) {
  runScript("preflight-robinhood-mainnet.js");
  console.log(JSON.stringify({
    mode: "dry-run",
    broadcastAttempted: false,
    stages: [
      "deploy and freeze packed onchain art",
      "deploy collection and Energy Bank with sale closed",
      "migrate the frozen Monad Energy ledger in deterministic batches",
      "deploy and freeze reroll rules, then deploy controller",
      "wire mint Energy, load assignments, freeze irreversible configuration, and set GTD root",
    ],
    saleStateAfterFinalization: "closed",
    ownerReserveMintedAfterFinalization: false,
    executeWith: "EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT=1 npm run deploy:robinhood:mainnet",
    note: "Execution remains blocked until every preflight gate is satisfied.",
  }, null, 2));
  process.exit(0);
}

assertMainnetBroadcastSafety(config.owner);
if (!process.env.HOODYOOR_RPC_URL) throw new Error("HOODYOOR_RPC_URL is required for execution.");

runScript("deploy-robinhood-onchain-art.js", {
  EXECUTE_HOODYOOR_ART_DEPLOYMENT: "1",
});
runScript("deploy-robinhood-core.js", {
  EXECUTE_HOODYOOR_CORE_DEPLOYMENT: "1",
});

const core = checkpoint("hoodyoor-core");
runScript("migrate-robinhood-energy.js", {
  EXECUTE_HOODYOOR_ENERGY_MIGRATION: "1",
});
runScript("deploy-robinhood-reroll.js", {
  EXECUTE_HOODYOOR_REROLL_DEPLOYMENT: "1",
  HOODYOOR_COLLECTION_ADDRESS: core.collection,
  HOODYOOR_ENERGY_BANK_ADDRESS: core.energyBank,
});
runScript("finalize-robinhood-launch.js", {
  EXECUTE_HOODYOOR_LAUNCH_FINALIZATION: "1",
});

const finalization = checkpoint("hoodyoor-launch-finalization");
runScript("preflight-robinhood-mainnet.js");
console.log(JSON.stringify({
  mode: "executed",
  chainId: HOODYOOR_CHAIN_ID,
  collection: finalization.collection,
  status: finalization.status,
  saleState: "closed",
  ownerReserveMinted: false,
  openSeaContractAddress: finalization.collection,
  note: "GTD was not opened and no reserve tokens were minted by deployment.",
}, null, 2));
