import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_RPC_URL,
  robinhoodChainDetails,
  switchProviderToRobinhoodChain,
} from "../lib/robinhood-chain.ts";

function source(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("Robinhood wallet switching uses the documented chain and verifies completion", async () => {
  let chainId = "0x1";
  let added = false;
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "wallet_switchEthereumChain") {
        if (!added) throw Object.assign(new Error("Unknown chain"), { code: 4902 });
        chainId = request.params[0].chainId;
      }
      if (request.method === "wallet_addEthereumChain") added = true;
      if (request.method === "eth_chainId") return chainId;
      return null;
    },
  };

  await switchProviderToRobinhoodChain(provider, ROBINHOOD_MAINNET_CHAIN_ID);
  const add = calls.find((request) => request.method === "wallet_addEthereumChain");
  assert.equal(add.params[0].chainId, "0x1237");
  assert.equal(add.params[0].rpcUrls[0], ROBINHOOD_MAINNET_RPC_URL);
  assert.deepEqual(add.params[0].nativeCurrency, {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  });
  assert.equal(chainId, "0x1237");
  assert.equal(robinhoodChainDetails(ROBINHOOD_MAINNET_CHAIN_ID).chainId, 4663);
});

test("Droid deployment is non-broadcasting by default and mainnet needs exact gates", () => {
  const environment = { ...process.env };
  delete environment.EXECUTE_HOODYOOR_DROID_DEPLOYMENT;
  delete environment.PREFLIGHT_HOODYOOR_DROID_DEPLOYMENT;
  delete environment.ALLOW_HOODYOOR_DROID_MAINNET;
  delete environment.HOODYOOR_DROID_MAINNET_ACK;
  delete environment.HOODYOOR_DROID_TESTNET_COLLECTION_ADDRESS;
  environment.HOODYOOR_DROID_DEPLOYMENT_TARGET = "testnet";
  const result = spawnSync(process.execPath, ["scripts/deploy-robinhood-droid-accounts.js"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"broadcastAttempted": false/);
  assert.match(result.stdout, /"expectedChainId": 46630/);
  assert.match(result.stdout, /No transaction was sent/);

  const deployment = source("scripts/deploy-robinhood-droid-accounts.js");
  assert.match(deployment, /ALLOW_HOODYOOR_DROID_MAINNET/);
  assert.match(deployment, /HOODYOOR-DROID-ACCOUNTS-4663-V1-IRREVERSIBLE/);
  assert.match(deployment, /Mainnet controlling collection is not the canonical HoodYØØR V2/);

  const mainnetDryRun = spawnSync(
    process.execPath,
    ["scripts/deploy-robinhood-droid-accounts.js"],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        HOODYOOR_DROID_DEPLOYMENT_TARGET: "mainnet",
      },
      encoding: "utf8",
    },
  );
  assert.equal(mainnetDryRun.status, 0, mainnetDryRun.stderr);
  assert.match(mainnetDryRun.stdout, /"expectedChainId": 4663/);
  assert.match(mainnetDryRun.stdout, /"broadcastAttempted": false/);
  assert.match(mainnetDryRun.stdout, /ALLOW_HOODYOOR_DROID_MAINNET/);

  const blockedMainnetExecution = spawnSync(
    process.execPath,
    ["scripts/deploy-robinhood-droid-accounts.js"],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        HOODYOOR_DROID_DEPLOYMENT_TARGET: "mainnet",
        EXECUTE_HOODYOOR_DROID_DEPLOYMENT: "1",
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(blockedMainnetExecution.status, 0);
  assert.match(blockedMainnetExecution.stderr, /Deployment configuration is incomplete/);

  const refused = spawnSync(process.execPath, ["scripts/deploy-robinhood-droid-accounts.js"], {
    cwd: process.cwd(),
    env: {
      ...environment,
      HOODYOOR_DROID_DEPLOYMENT_TARGET: "local",
      HOODYOOR_DROID_LOCAL_CHAIN_ID: "4663",
    },
    encoding: "utf8",
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Local Droid deployment is restricted/);
});

test("V1 authority is live NFT ownership with no admin or agent executor", () => {
  const account = source("contracts/hoodyoor/src/droid/DroidAccountV1.sol");
  const registry = source("contracts/hoodyoor/src/droid/DroidAccountRegistry.sol");
  assert.match(account, /IERC721Owner\(tokenContract\)\.ownerOf\(tokenId\)/);
  assert.match(account, /msg\.sender != currentOwner/);
  assert.match(account, /UnsupportedOperation\(operation\)/);
  assert.doesNotMatch(account, /delegatecall\s*\(/i);
  assert.doesNotMatch(account, /sessionKey|agentExecute|adminWithdraw/i);
  assert.doesNotMatch(registry, /onlyOwner|upgradeTo|setImplementation|adminWithdraw/i);
  assert.match(registry, /msg\.sender != currentOwner/);
});

test("Droid OS exposes transfer warnings and unavailable values without fake prices", () => {
  const warning = source(
    "components/robinhood/droids/DroidAssetTransferWarning.tsx",
  );
  const dashboard = source("components/robinhood/droids/DroidAccountClient.tsx");
  const types = source("lib/droid-accounts/types.ts");
  assert.match(warning, /transfers control of its Droid Account/i);
  assert.match(warning, /Assets are not automatically returned/i);
  assert.match(dashboard, /Value unavailable/);
  assert.match(dashboard, /Current owner only/);
  assert.match(dashboard, /Connect to activate/);
  assert.match(dashboard, /Switch to chain/);
  assert.match(dashboard, /Inventory bay empty/);
  assert.match(dashboard, /Partial data notice/);
  assert.match(dashboard, /Agent authority/);
  assert.match(dashboard, /No equipment installed/);
  assert.match(types, /fiatValue: null/);
  assert.match(types, /agentAuthority: "ZERO"/);
  assert.doesNotMatch(dashboard, /\$0(?:\.00)?/);
});

test("mainnet Droid bindings and the HoodYØØR page use verified production data", () => {
  const checkpoint = JSON.parse(source(
    "deployments/robinhood/droid-accounts-4663.json",
  ));
  const verification = JSON.parse(source(
    "deployments/robinhood/droid-accounts-verification-4663.json",
  ));
  const artwork = JSON.parse(source(
    "public/assets/robinhood/collection/artwork-manifest.json",
  ));
  const config = source("lib/droid-accounts/config.ts");
  const server = source("lib/droid-accounts/server.ts");
  const page = source("components/robinhood/RobinhoodGtdClient.tsx");
  const collectionInfo = source(
    "components/robinhood/HoodYoorCollectionInfo.tsx",
  );

  assert.equal(checkpoint.chainId, 4663);
  assert.equal(checkpoint.environment, "mainnet");
  assert.equal(checkpoint.implementation, "0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A");
  assert.equal(checkpoint.registry, "0x190602Aa70199ec3623ad3bc97a10B534b26fE48");
  assert.equal(checkpoint.startBlock, 33_356_761);
  assert.equal(verification.contracts.implementation.verified, true);
  assert.equal(verification.contracts.registry.verified, true);
  assert.equal(verification.independentAudit, false);
  assert.match(config, /HOODYOOR_MAINNET_DROID_IMPLEMENTATION_ADDRESS/);
  assert.match(config, /HOODYOOR_MAINNET_DROID_REGISTRY_ADDRESS/);
  assert.match(config, /33_356_761/);
  assert.match(server, /collection\.tokenURI\(tokenId\)/);
  assert.match(server, /hoodyoor-reveal-pending\.png/);
  assert.doesNotMatch(server, /hoodyoor-robinhood-droid\.png/);

  assert.equal(artwork.records.length, 6);
  assert.equal(
    artwork.provenanceHash,
    "0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3",
  );
  for (const record of artwork.records) {
    assert.equal(fs.existsSync(`public${record.image}`), true, record.image);
  }
  assert.equal(fs.existsSync(`public${artwork.revealPendingImage}`), true);
  assert.match(page, /Droids have wallets/);
  assert.match(page, /hoodyoor-assignment-2054\.png/);
  assert.doesNotMatch(page, /hoodyoor-gtd-hero-(?:desktop|mobile)\.png/);
  assert.match(collectionInfo, /Trait rerolls remain live/);
  assert.match(collectionInfo, /transfers control of its Droid Account/i);
  assert.match(collectionInfo, /not represented as independently audited/i);
});

test("Droid documentation records lifecycle, threats, and unaudited status", () => {
  for (const filePath of [
    "docs/droid-account-implementation-plan.md",
    "docs/droid-accounts.md",
    "docs/droid-account-security.md",
  ]) assert.equal(fs.existsSync(filePath), true, `${filePath} missing`);
  const architecture = source("docs/droid-accounts.md");
  const security = source("docs/droid-account-security.md");
  assert.match(architecture, /No Droid private key|no private key/i);
  assert.match(architecture, /version and upgrade strategy/i);
  assert.match(security, /raw `transferFrom`/);
  assert.match(security, /unaudited/i);
  assert.match(security, /Agent authority is zero/);
});
