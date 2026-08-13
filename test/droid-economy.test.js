import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  canonicalDroidId,
  canonicalDroidKey,
  rewardAllocationLeaf,
} from "../lib/droid-economy/identity.ts";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

const ROBINHOOD_COLLECTION = "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const EPOCH = `0x${"ab".repeat(32)}`;
const ZERO_STRATEGY = `0x${"00".repeat(32)}`;

test("canonical Droid identity includes chain, collection, and token", () => {
  const robinhood = {
    chainId: 4663,
    collectionAddress: ROBINHOOD_COLLECTION,
    tokenId: "420",
  };
  assert.equal(
    canonicalDroidId(robinhood),
    "4663:0x8277f8126722b11d7b44c5c453bcf62a78aafa25:420",
  );
  assert.equal(
    canonicalDroidKey(robinhood),
    "0xb2354a32092a1c22a3caa097d6e782154f39059153048b01608621ea46c981e8",
  );
  assert.notEqual(canonicalDroidKey({ ...robinhood, chainId: 143 }), canonicalDroidKey(robinhood));
  assert.notEqual(canonicalDroidKey({ ...robinhood, tokenId: "421" }), canonicalDroidKey(robinhood));
});

test("Monad and staged Robinhood token 123 cannot collide in identity, routes, or storage", () => {
  const monad = {
    chainId: 143,
    collectionAddress: "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A",
    tokenId: "123",
  };
  const robinhood = {
    chainId: 4663,
    collectionAddress: ROBINHOOD_COLLECTION,
    tokenId: "123",
  };
  assert.notEqual(canonicalDroidId(monad), canonicalDroidId(robinhood));
  assert.notEqual(canonicalDroidKey(monad), canonicalDroidKey(robinhood));

  const storage = source("src/lib/storage/droidEconomyStore.ts");
  const migration = source("supabase/migrations/202608110001_hoodyoor_economic_droids.sql");
  const dashboard = source("components/droids/MultiChainDroidDashboard.tsx");
  assert.match(storage, /reward-epochs\/\$\{chainId\}\//);
  assert.match(migration, /primary key \(chain_id, collection_address, token_id\)/);
  assert.match(migration, /primary key \(chain_id, epoch_id\)/);
  assert.match(dashboard, /\/monad\/droids\/\$\{droid\.tokenId\}/);
  assert.match(dashboard, /\/robinhood\/droids\/\$\{droid\.tokenId\}/);
});

test("reward leaves bind every security-relevant allocation field", () => {
  const base = {
    chainId: 4663,
    collectionAddress: ROBINHOOD_COLLECTION,
    tokenId: "420",
    accountVersion: 1,
    droidAccount: ACCOUNT,
    strategyId: ZERO_STRATEGY,
    rewardWeight: "100",
    amount: "5000000",
  };
  const leaf = rewardAllocationLeaf(EPOCH, base);
  for (const changed of [
    { ...base, chainId: 143 },
    { ...base, tokenId: "421" },
    { ...base, accountVersion: 2 },
    { ...base, droidAccount: "0x2222222222222222222222222222222222222222" },
    { ...base, strategyId: `0x${"11".repeat(32)}` },
    { ...base, rewardWeight: "101" },
    { ...base, amount: "5000001" },
  ]) assert.notEqual(rewardAllocationLeaf(EPOCH, changed), leaf);
});

test("economic contracts are additive, versioned, and never couple Energy to money", () => {
  const registry = source("contracts/hoodyoor/src/economic/HoodYoorDroidRegistry.sol");
  const rewards = source("contracts/hoodyoor/src/economic/HoodYoorRewardsDistributor.sol");
  const vault = source("contracts/hoodyoor/src/economic/HoodYoorRevenueVault.sol");
  const strategy = source("contracts/hoodyoor/src/economic/HoodYoorStrategyRegistry.sol");
  const achievement = source("contracts/hoodyoor/src/economic/HoodYoorAchievementRegistry.sol");
  const combined = [registry, rewards, vault, strategy, achievement].join("\n");

  assert.match(registry, /AccountVersionAlreadyRegistered/);
  assert.match(rewards, /DroidAccountNotActive/);
  assert.match(rewards, /NotCurrentDroidOwner/);
  assert.match(rewards, /MerkleProof\.verifyCalldata/);
  assert.match(rewards, /ClaimExceedsRemainingAllocation/);
  assert.match(vault, /ExactTransferRequired/);
  assert.match(vault, /RevenueIdAlreadyUsed/);
  assert.match(
    vault,
    /accounted\s*=\s*treasuryAccrued\[asset\]\s*\+\s*rewardsAccrued\[asset\]\s*\+\s*otherAccrued\[asset\]/,
  );
  assert.match(vault, /function releaseOtherAllocation/);
  assert.match(vault, /totalBps != BPS_DENOMINATOR/);
  assert.match(strategy, /This contract never moves assets/);
  assert.match(achievement, /MAX_TOTAL_MODIFIER_BPS = 2_000/);
  assert.doesNotMatch(combined, /IHoodYOOREnergyBank|energyBalance|energyTo|EnergyPrice/);
  assert.doesNotMatch(combined, /delegatecall|agentExecute|adminWithdrawUserFunds/i);
});

test("bridge and agent paths remain code-locked while rewards default off", () => {
  const flags = source("lib/droid-economy/feature-flags.ts");
  const config = source("lib/droid-economy/config.ts");
  const environment = source(".env.example");
  assert.match(flags, /crossChainBridgeEnabled: false/);
  assert.match(flags, /droidAgentEnabled: false/);
  assert.match(config, /DROID_REWARDS_ENABLED, false/);
  assert.match(config, /DROID_STRATEGIES_ENABLED, false/);
  assert.match(environment, /CROSS_CHAIN_BRIDGE_ENABLED=false/);
  assert.match(environment, /DROID_AGENT_ENABLED=false/);
  assert.match(environment, /NEXT_PUBLIC_DROID_REWARDS_ENABLED=false/);
  assert.match(environment, /ROBINHOOD_DROIDS_ENABLED=false/);
  assert.match(environment, /NEXT_PUBLIC_ROBINHOOD_DROIDS_ENABLED=false/);
  assert.match(environment, /HOODYOOR_APPROVED_ASSETS=\[\]/);
  assert.match(environment, /HOODYOOR_TREASURY_BPS=\n/);
});

test("reward manifest tooling validates official accounts and cannot broadcast", () => {
  const manifest = source("lib/droid-economy/manifest.ts");
  const admin = source("app/api/admin/droid-economy/route.ts");
  const page = source("app/admin/droid-economy/page.tsx");
  const storage = source("src/lib/storage/droidEconomyStore.ts");
  assert.match(manifest, /StandardMerkleTree\.of/);
  assert.match(manifest, /Duplicate reward allocation/);
  assert.match(admin, /resolver\.account\(allocation\.tokenId\)/);
  assert.match(admin, /verifyAdmin\(body, "droid-economy"/);
  assert.match(admin, /RewardEpochCreated/);
  assert.doesNotMatch(admin, /sendTransaction|broadcastTransaction|privateKey/i);
  assert.match(admin, /listRewardEpochManifestSummaries/);
  assert.match(storage, /allocation proofs remain in the protected manifest/);
  assert.match(page, /no broadcast/i);
  assert.match(page, /Broadcast enabled: NEVER/);
});

test("database and UI keep chain identity, Energy, and real rewards separate", () => {
  const migration = source("supabase/migrations/202608110001_hoodyoor_economic_droids.sql");
  const profile = source("components/robinhood/droids/DroidEconomyPanel.tsx");
  const dashboard = source("components/droids/MultiChainDroidDashboard.tsx");
  const collectionPage = source("components/robinhood/HoodYoorCollectionInfo.tsx");
  assert.match(migration, /primary key \(chain_id, collection_address, token_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(profile, /Separate from Energy/);
  assert.match(profile, /It is not tokenized, assigned a dollar value/);
  assert.match(profile, /Changing this preference never sells, bridges, or reallocates/);
  assert.match(dashboard, /Separate native collections/);
  assert.match(dashboard, /Bridge disabled · no mirrored NFT implied/);
  assert.match(collectionPage, /Economic Droid upgrade · staged, not live/);
  assert.match(collectionPage, /Rewards are never guaranteed by NFT ownership/);
  assert.doesNotMatch(profile, /\$0(?:\.00)?/);
});

test("economic audit and deployment hold point are documented", () => {
  const report = source("docs/hoodyoor-economic-droid-impact-report.md");
  const architecture = source("docs/hoodyoor-economic-droids.md");
  const security = source("docs/hoodyoor-economic-droid-security.md");
  const deployment = source("docs/hoodyoor-economic-droid-deployment-report.md");
  assert.match(report, /KEEP — byte-for-byte/);
  assert.match(report, /Nothing identified in this audit requires replacement/);
  assert.match(report, /Stop before any broadcast/);
  assert.match(report, /Energy and real assets have independent ledgers and units/);
  assert.match(architecture, /Token ID alone is never a canonical identifier/);
  assert.match(security, /independently unaudited/);
  assert.match(deployment, /This document is a deployment plan, not deployment authorization/);
});
