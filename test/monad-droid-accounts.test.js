import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  canonicalDroidId,
  canonicalDroidKey,
} from "../lib/droid-economy/identity.ts";

const MONAD_CHAIN_ID = 143;
const MONAD_COLLECTION = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";

function source(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("Monad Droid identity is chain and collection qualified", () => {
  const monad = {
    chainId: MONAD_CHAIN_ID,
    collectionAddress: MONAD_COLLECTION,
    tokenId: "420",
  };
  const robinhood = {
    chainId: 4663,
    collectionAddress: "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25",
    tokenId: "420",
  };

  assert.equal(
    canonicalDroidId(monad),
    "143:0x349d8eb480c92cf75371fba5c6344a4d11b9103a:420",
  );
  assert.notEqual(canonicalDroidKey(monad), canonicalDroidKey(robinhood));
  assert.notEqual(
    canonicalDroidKey(monad),
    canonicalDroidKey({ ...monad, collectionAddress: robinhood.collectionAddress }),
  );
});

test("Monad reuses common Droid services and UI without a parallel application", () => {
  const config = source("lib/droid-accounts/config.ts");
  const accountRoute = source("app/api/droid-accounts/route.ts");
  const economyRoute = source("app/api/droid-economy/route.ts");
  const squadPage = source("app/monad/droids/page.tsx");
  const profilePage = source("app/monad/droids/[tokenId]/page.tsx");
  const profile = source("components/robinhood/droids/DroidAccountClient.tsx");

  assert.match(config, /DYOOR_MONAD_MAINNET_COLLECTION_ADDRESS/);
  assert.match(config, /0x349D8eb480c92cF75371fbA5C6344A4d11b9103A/);
  assert.match(config, /controllerPolicy: "DIRECT_ERC721_OWNER"/);
  assert.match(config, /parentTokenBurnable: true/);
  assert.match(config, /imageUrlTemplate: "\/api\/dyoor-world\/pfp-image\/\{tokenId\}"/);
  assert.match(accountRoute, /handleDroidAccountsRequest/);
  assert.match(economyRoute, /handleDroidEconomyRequest/);
  assert.match(squadPage, /DroidSquadClient/);
  assert.match(squadPage, /chainId=\{MONAD_MAINNET_CHAIN_ID\}/);
  assert.match(profilePage, /DroidAccountClient/);
  assert.match(profilePage, /chainId=\{MONAD_MAINNET_CHAIN_ID\}/);
  assert.match(profile, /config\.nativeCurrencySymbol/);
});

test("Season 2 controller policy cannot borrow Season 1 staking records", () => {
  const plan = source("docs/monad-dyoor-droid-integration-plan.md");
  const forkTest = source("contracts/hoodyoor/test/DroidAccountMonadFork.t.sol");
  const account = source("contracts/hoodyoor/src/droid/DroidAccountV1.sol");

  assert.match(account, /IERC721Owner\(tokenContract\)\.ownerOf\(tokenId\)/);
  assert.match(plan, /Ascension is a custody staking contract for the separate Season 1 collection/i);
  assert.match(plan, /same token ID/i);
  assert.match(forkTest, /address private constant COLLECTION = 0x349D8eb/);
  assert.match(forkTest, /S1_COLLECTION/);
  assert.match(forkTest, /ASCENSION/);
  assert.match(forkTest, /S2 unexpectedly held by Ascension/);
  assert.match(forkTest, /S1 custody absent/);
});

test("official burn flow fails closed for incomplete, active, or funded Droid reads", () => {
  const traitLab = source("components/s2/TraitLabClient.tsx");
  const solidityTest = source("contracts/hoodyoor/test/DroidAccountV1.t.sol");

  assert.match(traitLab, /Droid Wallet safety could not be verified\. Burn is blocked/);
  assert.match(traitLab, /partialErrors\.length > 0/);
  assert.match(traitLab, /asset discovery was incomplete\. Burn is blocked/);
  assert.match(traitLab, /droidData\.droid\.active \|\| hasDetectedAssets/);
  assert.match(traitLab, /permanently remove its controller/);
  assert.match(solidityTest, /testParentBurnFailsClosedAndLeavesNoStaleAuthority/);
});

test("Monad account preflight is intentionally incapable of broadcasting", () => {
  const preflight = source("scripts/preflight-monad-droid-accounts.js");
  assert.match(preflight, /broadcastCapability: false/);
  assert.match(preflight, /privateKeyRead: false/);
  assert.doesNotMatch(preflight, /new Wallet\s*\(/);
  assert.doesNotMatch(preflight, /sendTransaction\s*\(/);

  const result = spawnSync(process.execPath, ["scripts/preflight-monad-droid-accounts.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EXECUTE_MONAD_DROID_DEPLOYMENT: "1",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /(?:read-only and has no broadcast mode|cannot be enabled in read-only mode)/,
  );
});

test("Monad feature gates preserve Energy and keep bridge and agents disabled", () => {
  const env = source(".env.example");
  const config = source("lib/droid-accounts/config.ts");
  const preflight = source("scripts/preflight-monad-droid-accounts.js");
  const dashboard = source("components/droids/MultiChainDroidDashboard.tsx");

  assert.match(env, /MONAD_DROIDS_ENABLED=false/);
  assert.match(env, /NEXT_PUBLIC_MONAD_DROIDS_ENABLED=false/);
  assert.match(env, /CROSS_CHAIN_BRIDGE_ENABLED=false/);
  assert.match(env, /DROID_AGENT_ENABLED=false/);
  assert.match(config, /energyDecimals: 18/);
  assert.match(preflight, /non-transferable progression utility; no price assigned/);
  assert.match(preflight, /CROSS_CHAIN_BRIDGE_ENABLED must remain false/);
  assert.match(preflight, /DROID_AGENT_ENABLED must remain false/);
  assert.match(dashboard, /MONAD/);
  assert.match(dashboard, /Separate native collection/);
});

test("Monad deployment checkpoint and security hold point are explicit", () => {
  const checkpoint = JSON.parse(source(
    "deployments/monad/droid-accounts-preflight-143.json",
  ));
  const report = source("docs/monad-dyoor-droid-deployment-report.md");
  const security = source("docs/monad-dyoor-droid-security.md");

  assert.equal(checkpoint.chainId, MONAD_CHAIN_ID);
  assert.equal(checkpoint.broadcastCapability, false);
  assert.equal(checkpoint.broadcastAttempted, false);
  assert.equal(checkpoint.privateKeyRead, false);
  assert.equal(checkpoint.collection.address, MONAD_COLLECTION);
  assert.equal(checkpoint.controllerResolution.season2BalanceAtAscension, 0);
  assert.equal(checkpoint.canonicalRegistry.present, false);
  assert.equal(checkpoint.artifacts.implementation.verifiedRobinhoodV1LogicMatch, true);
  assert.equal(checkpoint.gas.total, "1910306");
  assert.match(report, /hold production deployment/i);
  assert.match(report, /1\.157645436 MON/);
  assert.match(report, /Trait rerolls.*continue to work/i);
  assert.match(security, /not independently audited/i);
  assert.match(security, /Parent burn risk/);
  assert.match(security, /no project-admin withdrawal/i);
});
