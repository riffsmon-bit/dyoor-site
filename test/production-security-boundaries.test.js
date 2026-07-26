import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ethers } from "ethers";
import {
  ADMIN_AUTH_CHAIN_ID,
  ADMIN_AUTH_VERSION,
  adminMessage,
  adminPayloadHash,
  adminRequestPayload,
  createAdminAuthorization,
} from "../lib/adminMessage.ts";
import {
  buildTraitLabLeaderboard,
  traitLabBountiesEnabled,
  traitLabLeaderboardEnabled,
} from "../lib/s2-trait-lab-leaderboard.ts";
import {
  resolveS2ChainSupply,
  resolveS2RecordedBurnSupply,
  S2_ISSUED_SUPPLY_FALLBACK,
  S2_POST_BURN_SUPPLY_CAP,
} from "../lib/s2-supply.ts";
import { runtimeTraitOverrideKey } from "../lib/dyoor-s2-metadata.js";

function rollId(value) {
  return `0x${value.repeat(64)}`;
}

test("admin signatures bind domain, chain, route, action, and canonical payload", async () => {
  const signer = ethers.Wallet.createRandom();
  const payload = {
    recipients: [ethers.Wallet.createRandom().address.toLowerCase()],
    amountRaw: "1000000000000000000",
    campaignId: "security-test",
  };
  const timestamp = "1784682000000";
  const nonce = "82761c87-65df-48ba-ad3d-a1fb0b84744d";
  const authorization = createAdminAuthorization({
    wallet: signer.address,
    timestamp,
    nonce,
    action: "energy-airdrop",
    route: "/api/admin/energy-airdrop",
    payload,
  });
  const signature = await signer.signMessage(authorization.message);
  const { message: _message, ...authorizationFields } = authorization;

  assert.equal(authorization.authVersion, ADMIN_AUTH_VERSION);
  assert.equal(authorization.chainId, ADMIN_AUTH_CHAIN_ID);
  assert.equal(ethers.verifyMessage(authorization.message, signature), signer.address);
  assert.notEqual(
    ethers.verifyMessage(adminMessage({
      wallet: signer.address,
      timestamp,
      nonce,
      action: "energy-airdrop",
      route: "/api/admin/energy/reindex",
      payloadHash: authorization.payloadHash,
    }), signature),
    signer.address,
  );
  assert.notEqual(
    ethers.verifyMessage(adminMessage({
      wallet: signer.address,
      timestamp,
      nonce,
      action: "energy-airdrop",
      route: authorization.route,
      payloadHash: adminPayloadHash({ ...payload, amountRaw: "2000000000000000000" }),
    }), signature),
    signer.address,
  );
  assert.equal(
    adminPayloadHash({ z: 1, nested: { b: 2, a: 1 }, a: 2 }),
    adminPayloadHash({ a: 2, nested: { a: 1, b: 2 }, z: 1 }),
  );
  assert.deepEqual(adminRequestPayload({
    ...payload,
    wallet: signer.address,
    timestamp,
    nonce,
    signature,
    ...authorizationFields,
  }), payload);
});

test("legacy Blueprint bearer-token export is retired for wallet-signed admin snapshots", () => {
  assert.equal(fs.existsSync("netlify/functions/ascension-blueprint-export.js"), false);
  assert.equal(fs.existsSync("admin-ascension.js"), false);
  assert.equal(fs.existsSync("admin-ascension.html"), false);
  assert.doesNotMatch(fs.readFileSync(".env.example", "utf8"), /ASCENSION_BLUEPRINT_ADMIN_TOKEN/);

  const nextConfig = fs.readFileSync("next.config.mjs", "utf8");
  assert.match(
    nextConfig,
    /\{ source: "\/admin-ascension", destination: "\/admin", permanent: false \}/,
  );
  assert.match(
    nextConfig,
    /\{ source: "\/admin-ascension\.html", destination: "\/admin", permanent: false \}/,
  );

  const adminPage = fs.readFileSync("app/admin/page.tsx", "utf8");
  const legacyAdminRedirect = fs.readFileSync("app/admin-ascension/page.tsx", "utf8");
  const snapshotRoute = fs.readFileSync("app/api/admin/snapshots/route.ts", "utf8");
  assert.match(legacyAdminRedirect, /redirect\("\/admin"\)/);
  assert.match(adminPage, /createAdminAuthorization/);
  assert.match(adminPage, /signAdminAction\("snapshot", "\/api\/admin\/snapshots"/);
  assert.match(snapshotRoute, /verifyAdmin\(body, "snapshot"/);
});

test("Trait Lab leaderboard is default-off and aggregates completion records only", () => {
  assert.equal(traitLabLeaderboardEnabled({}), false);
  assert.equal(traitLabBountiesEnabled({}), false);
  assert.equal(traitLabLeaderboardEnabled({ DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD: "true" }), true);
  assert.equal(traitLabBountiesEnabled({ DYOOR_TRAIT_LAB_ENABLE_BOUNTIES: "1" }), true);

  const walletA = ethers.Wallet.createRandom().address.toLowerCase();
  const walletB = ethers.Wallet.createRandom().address.toLowerCase();
  const completions = [
    {
      version: 1,
      rollId: rollId("a"),
      wallet: walletA,
      tokenId: "1",
      traitType: "Eyes",
      action: "reroll",
      paymentMode: "energy",
      costRaw: "100",
      completedAt: "2026-07-22T22:00:00.000Z",
      result: { operationStatus: "completed" },
    },
    {
      version: 1,
      rollId: rollId("b"),
      wallet: walletA,
      tokenId: "1",
      traitType: "Hat",
      action: "recycle",
      paymentMode: "energy",
      costRaw: "0",
      rewardRaw: "50",
      completedAt: "2026-07-22T22:01:00.000Z",
      result: { operationStatus: "completed" },
    },
    {
      version: 1,
      rollId: rollId("c"),
      wallet: walletB,
      tokenId: "2",
      traitType: "Clothes",
      action: "unlock",
      paymentMode: "energy",
      costRaw: "100",
      completedAt: "2026-07-22T22:02:00.000Z",
      result: { operationStatus: "completed" },
    },
    {
      version: 1,
      rollId: rollId("d"),
      wallet: walletB,
      tokenId: "2",
      traitType: "Mouth",
      action: "reroll",
      paymentMode: "energy",
      costRaw: "100",
      completedAt: "",
      result: { operationStatus: "confirming" },
    },
  ];

  const rows = buildTraitLabLeaderboard(completions);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].wallet, walletA);
  assert.equal(rows[0].completedOperations, 2);
  assert.equal(rows[0].energySpentRaw, "100");
  assert.equal(rows[0].energyEarnedRaw, "50");
  assert.equal(rows[1].completedOperations, 1);
});

test("production metadata scope rejects legacy testnet configuration", () => {
  assert.throws(() => runtimeTraitOverrideKey(1, {
    NODE_ENV: "production",
    DYOOR_S2_CHAIN_ID: "10143",
  }), /Monad mainnet chain 143/);
  assert.throws(() => runtimeTraitOverrideKey(1, {
    NODE_ENV: "production",
    DYOOR_S2_CHAIN_ID: "143",
    DYOOR_S2_CONTRACT_ADDRESS: "0xce586aA467F6351bf819DbF134BC69947125CD92",
  }), /legacy Monad testnet/);
  assert.equal(
    runtimeTraitOverrideKey(1, {
      NODE_ENV: "production",
      DYOOR_S2_CHAIN_ID: "143",
      DYOOR_S2_CONTRACT_ADDRESS: "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A",
    }),
    "143:0x349d8eb480c92cf75371fba5c6344a4d11b9103a:1",
  );
});

test("public metadata GET source contains no repair writes or marketplace refreshes", () => {
  const source = fs.readFileSync("app/api/metadata/[tokenId]/route.ts", "utf8");
  assert.doesNotMatch(source, /saveRuntimeTraitOverride/);
  assert.doesNotMatch(source, /refreshOpenSeaTokenMetadata/);
  assert.doesNotMatch(source, /processDueOpenSeaMetadataRefreshes/);
});

test("S2 live supply is issued supply minus permanent burns", () => {
  assert.equal(S2_POST_BURN_SUPPLY_CAP, 555);
  assert.deepEqual(resolveS2ChainSupply(1065n, 1096n), {
    issuedSupply: 1096,
    currentSupply: 1065,
    burnedSupply: 31,
    source: "chain",
  });
  assert.deepEqual(resolveS2RecordedBurnSupply(31), {
    issuedSupply: S2_ISSUED_SUPPLY_FALLBACK,
    currentSupply: 1065,
    burnedSupply: 31,
    source: "burn-records",
  });
  assert.throws(() => resolveS2ChainSupply(1097n, 1096n), /cannot exceed issued/);
});

test("public product copy contains no revenue-sharing references", () => {
  const prohibited = /rev(?:enue)?[-_ ]?shar(?:e|ing)|quarterly rewards for staked droids/i;
  for (const file of ["app/page.tsx", "app/whitepaper/page.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), prohibited, file);
  }
  const homeSource = fs.readFileSync("app/page.tsx", "utf8");
  assert.match(homeSource, /S2SupplyStat/);
  assert.match(homeSource, /Droid Burn Cap/);
  assert.doesNotMatch(homeSource, /Ascended S1 Allocation/);
  assert.match(homeSource, /deflationary dynamic NFT/i);
  assert.match(homeSource, /Energy Flywheel/i);
});

test("Trait Lab rerolls settle without Energy transactions or broad historical log scans", () => {
  const source = fs.readFileSync("lib/s2-trait-lab.ts", "utf8");
  assert.doesNotMatch(source, /TRAIT_LAB_SPEND_LOOKBACK_BLOCKS/);
  assert.doesNotMatch(source, /findExistingTraitLabEnergySpend/);

  const start = source.indexOf("async function debitTraitLabEnergy(");
  const end = source.indexOf("async function creditTraitLabRecycleEnergy(", start);
  assert.ok(start >= 0 && end > start);
  const spendSource = source.slice(start, end);
  assert.doesNotMatch(spendSource, /\.getLogs\(/);
  assert.doesNotMatch(spendSource, /spendEnergy|sendTransaction|getTransactionCount|\.wait\(/);
  assert.match(spendSource, /claimTraitLabEnergyDebit/);
  assert.match(source, /receiptContainsTraitLabEnergySpend/);

  for (const route of [
    "app/api/s2/trait-lab/preview/route.ts",
    "app/api/s2/trait-lab/confirm/route.ts",
    "app/api/s2/trait-lab/forfeit/route.ts",
  ]) {
    assert.match(fs.readFileSync(route, "utf8"), /traitLabPublicErrorMessage/);
  }
});

test("Trait Lab gacha flow keeps only one server-authorized result per Droid", () => {
  const traitLabSource = fs.readFileSync("lib/s2-trait-lab.ts", "utf8");
  const storeSource = fs.readFileSync("src/lib/storage/s2TraitLabStore.ts", "utf8");
  const clientSource = fs.readFileSync("components/s2/TraitLabClient.tsx", "utf8");
  const forfeitRoute = fs.readFileSync("app/api/s2/trait-lab/forfeit/route.ts", "utf8");

  assert.match(storeSource, /ACTIVE_ROLL_PREFIX = "trait-lab\/active-rolls"/);
  assert.match(storeSource, /"superseded"/);
  assert.match(storeSource, /"forfeited"/);
  assert.match(traitLabSource, /activateTraitLabRoll\(chargedRoll\)/);
  assert.match(traitLabSource, /await assertTraitLabRollIsCurrent\(paidRoll\)/);
  assert.match(traitLabSource, /Only the latest roll is valid/);
  assert.match(
    traitLabSource,
    /!FINALIZING_TRAIT_LAB_ROLL_STATUSES\.has\(roll\.status\)\s*&& Date\.now\(\) > Date\.parse\(roll\.expiresAt\)/,
  );
  assert.match(traitLabSource, /export async function forfeitTraitLabPreview/);
  assert.match(forfeitRoute, /forfeitTraitLabPreview/);
  assert.match(clientSource, /This is crash protection, not roll history/);
  assert.match(clientSource, /Leave Result/);
  assert.doesNotMatch(clientSource, /Close Preview \(Saved\)/);
  const pendingHelperStart = clientSource.indexOf("function currentPendingTraitLabOperations(");
  const pendingHelperEnd = clientSource.indexOf("function normalizeAddress(", pendingHelperStart);
  assert.ok(pendingHelperStart >= 0 && pendingHelperEnd > pendingHelperStart);
  assert.doesNotMatch(clientSource.slice(pendingHelperStart, pendingHelperEnd), /expiresAt/);
});
