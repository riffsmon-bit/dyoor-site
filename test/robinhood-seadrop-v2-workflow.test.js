import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import {
  HOODYOOR_MAINNET_ACK,
  HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
} from "../scripts/lib/hoodyoor-mainnet.js";
import {
  HOODYOOR_SEADROP,
  HOODYOOR_SEADROP_V2_BROADCAST_ACK,
  HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER_ACK,
  HOODYOOR_USDG,
  parsePositiveUint,
  seaDropV2GateReport,
  seaDropV2PricingAcknowledgement,
  verifySeaDropV2ManifestLocal,
} from "../scripts/lib/hoodyoor-seadrop-v2.js";

const manifestPath =
  "data/robinhood/onchain-128/hoodyoor-seadrop-v2-launch-manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const ownerWallet = new Wallet(
  "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const resultSigner = new Wallet(
  "0x8b3a350cf5c34c9194ca3a545d4a5f0f5f0b43f38b24c814b88b9a7e0f20f9db",
).address;
const relayer = new Wallet(
  "0x0f4b1d8e6f93a66a2d7fca6a4416f43d9f8186a2d0ea8a79d8c704cbe10a5e12",
).address;
const testWeiPerEnergy = "1000000000000";
const testUSDGUnitsPerEnergy = "1000";

function completeEnvironment() {
  return {
    HOODYOOR_DEPLOYER_PRIVATE_KEY: ownerWallet.privateKey,
    HOODYOOR_RESULT_SIGNER: resultSigner,
    HOODYOOR_RELAYER_ADDRESS: relayer,
    HOODYOOR_REVEAL_COMMITMENT: keccak256(toUtf8Bytes("v2 test commitment only")),
    HOODYOOR_OWNER_TREASURY_CONTROL_VERIFIED: "1",
    HOODYOOR_ENERGY_LEDGER_FROZEN: "1",
    HOODYOOR_REVEAL_BLOCKHASH_VALIDATED: "1",
    HOODYOOR_REVEAL_BACKUP_CONFIRMED: "1",
    HOODYOOR_SECURITY_REVIEW_WAIVER: HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
    HOODYOOR_MINT_ENERGY_REWARD_APPROVED: "1000",
    ALLOW_HOODYOOR_MAINNET: "1",
    HOODYOOR_MAINNET_ACK,
    HOODYOOR_SEADROP_V2_SOURCE_HASH: manifest.sourceTree.canonicalKeccak256,
    HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER:
      HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER_ACK,
    HOODYOOR_REROLL_WEI_PER_ENERGY: testWeiPerEnergy,
    HOODYOOR_REROLL_USDG_UNITS_PER_ENERGY: testUSDGUnitsPerEnergy,
    HOODYOOR_SEADROP_V2_PRICING_ACK: seaDropV2PricingAcknowledgement(
      testWeiPerEnergy,
      testUSDGUnitsPerEnergy,
    ),
    HOODYOOR_SEADROP_V2_BROADCAST_ACK,
  };
}

test("SeaDrop v2 manifest freezes the exact source, bytecode, payloads, and onchain metadata", () => {
  const local = verifySeaDropV2ManifestLocal(process.cwd(), manifest);
  assert.equal(local.passed, true, local.blockers.join(", "));
  assert.equal(manifest.broadcast.authorized, false);
  assert.equal(manifest.externalContracts.seaDrop, HOODYOOR_SEADROP);
  assert.equal(manifest.externalContracts.usdg, HOODYOOR_USDG);
  assert.equal(manifest.allowlist.legacyRootReusableWithSeaDrop, false);
  assert.deepEqual(Object.keys(manifest.rerolls.paymentMethods), ["Energy", "ETH", "USDG"]);
  assert.equal(manifest.rerolls.pricing.weiPerEnergy, null);
  assert.equal(manifest.rerolls.pricing.usdgUnitsPerEnergy, null);

  const collection = manifest.artifacts.find(({ contract }) => contract === "HoodYOORSeaDrop");
  const controller = manifest.artifacts.find(
    ({ contract }) => contract === "HoodYOORRerollControllerV2",
  );
  assert.ok(collection.runtimeBytes < 24_576);
  assert.ok(controller.runtimeBytes < 24_576);

  assert.match(manifest.metadata.contractURI, /^data:application\/json;base64,/);
  const metadata = JSON.parse(Buffer.from(
    manifest.metadata.contractURI.split(",", 2)[1],
    "base64",
  ).toString("utf8"));
  assert.equal(metadata.name, "HoodYØØR");
  assert.equal(metadata.seller_fee_basis_points, 300);
  assert.match(metadata.image, /^data:image\/svg\+xml;base64,/);
});

test("fresh v2 source, security, exact pricing, and broadcast gates are all mandatory", () => {
  const empty = seaDropV2GateReport(ownerWallet.address, manifest, {});
  assert.equal(empty.ready, false);
  assert.ok(empty.blockers.includes("seadrop-v2-exact-source-hash"));
  assert.ok(empty.blockers.includes("seadrop-v2-security-review-or-explicit-owner-waiver"));
  assert.ok(empty.blockers.includes("reroll-wei-per-energy"));
  assert.ok(empty.blockers.includes("reroll-usdg-units-per-energy"));
  assert.ok(empty.blockers.includes("seadrop-v2-exact-pricing-acknowledgement"));
  assert.ok(empty.blockers.includes("seadrop-v2-irreversibility-acknowledgement"));

  const complete = seaDropV2GateReport(
    ownerWallet.address,
    manifest,
    completeEnvironment(),
  );
  assert.equal(complete.ready, true);
  assert.deepEqual(complete.blockers, []);
  assert.equal(complete.pricing.weiPerEnergy, testWeiPerEnergy);
  assert.equal(complete.pricing.usdgUnitsPerEnergy, testUSDGUnitsPerEnergy);
  assert.equal(complete.securityReviewV2.mode, "explicit-owner-waiver");
  assert.doesNotMatch(
    JSON.stringify(complete),
    new RegExp(ownerWallet.privateKey.slice(2), "i"),
  );
});

test("a v1 waiver, approximate price acknowledgement, or malformed rate cannot authorize v2", () => {
  const environment = completeEnvironment();
  delete environment.HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER;
  environment.HOODYOOR_SEADROP_V2_PRICING_ACK = "looks good";
  environment.HOODYOOR_REROLL_USDG_UNITS_PER_ENERGY = "1.5";
  const report = seaDropV2GateReport(ownerWallet.address, manifest, environment);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("seadrop-v2-security-review-or-explicit-owner-waiver"));
  assert.ok(report.blockers.includes("reroll-usdg-units-per-energy"));
  assert.ok(report.blockers.includes("seadrop-v2-exact-pricing-acknowledgement"));
  assert.equal(parsePositiveUint("0"), null);
  assert.equal(parsePositiveUint("-1"), null);
  assert.equal(parsePositiveUint("1.5"), null);
  assert.equal(parsePositiveUint("1000"), 1000n);
});

test("the SeaDrop v2 deploy command is non-broadcasting by default", () => {
  const environment = {
    ...process.env,
    HOODYOOR_SEADROP_V2_SOURCE_HASH: "blocked",
    HOODYOOR_SEADROP_V2_SECURITY_REVIEW_APPROVED: "blocked",
    HOODYOOR_SEADROP_V2_SECURITY_REVIEW_WAIVER: "blocked",
    HOODYOOR_REROLL_WEI_PER_ENERGY: "blocked",
    HOODYOOR_REROLL_USDG_UNITS_PER_ENERGY: "blocked",
    HOODYOOR_SEADROP_V2_PRICING_ACK: "blocked",
    HOODYOOR_SEADROP_V2_BROADCAST_ACK: "blocked",
  };
  delete environment.EXECUTE_HOODYOOR_SEADROP_V2_DEPLOYMENT;
  const result = spawnSync(process.execPath, ["scripts/deploy-robinhood-seadrop-v2.js"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"broadcastAttempted": false/);
  assert.match(result.stdout, /"Energy",\s+"ETH",\s+"USDG"/);
  assert.match(result.stdout, /No transaction was sent/);
});

test("deployment keeps mint closed and migrates obsolete Energy roles only at the end", () => {
  const source = fs.readFileSync("scripts/deploy-robinhood-seadrop-v2.js", "utf8");
  const replacementVerified = source.indexOf(
    'checkpoint.status = "replacement-verified-before-role-migration"',
  );
  const revokeCollection = source.indexOf("revoke-superseded-collection-credit-role");
  const revokeController = source.indexOf("revoke-superseded-controller-spender-role");
  assert.ok(replacementVerified > 0);
  assert.ok(revokeCollection > replacementVerified);
  assert.ok(revokeController > revokeCollection);
  assert.doesNotMatch(source, /\.mintOwnerReserve\s*\(/);
  assert.doesNotMatch(source, /\.updatePublicDrop\s*\(/);
  assert.doesNotMatch(source, /\.updateAllowList\s*\(/);
  assert.match(source, /finalState\.totalSupply !== 0n/);
  assert.match(source, /finalState\.ownerReserveMinted/);
  assert.match(source, /finalState\.secondaryTradingEnabled/);
});

test("manifest generation is deterministic for the exact v2 source tree", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-robinhood-seadrop-v2-manifest.js"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const regenerated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(
    regenerated.sourceTree.canonicalKeccak256,
    manifest.sourceTree.canonicalKeccak256,
  );
  assert.equal(regenerated.metadata.contractURI, manifest.metadata.contractURI);
  assert.equal(regenerated.broadcast.authorized, false);
});
