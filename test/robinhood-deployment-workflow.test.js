import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import {
  HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
  HOODYOOR_MAINNET_ACK,
  mainnetGateReport,
} from "../scripts/lib/hoodyoor-mainnet.js";

const ownerWallet = new Wallet(
  "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const resultSigner = new Wallet(
  "0x8b3a350cf5c34c9194ca3a545d4a5f0f5f0b43f38b24c814b88b9a7e0f20f9db",
).address;
const relayer = new Wallet(
  "0x0f4b1d8e6f93a66a2d7fca6a4416f43d9f8186a2d0ea8a79d8c704cbe10a5e12",
).address;

function completeEnvironment() {
  return {
    HOODYOOR_DEPLOYER_PRIVATE_KEY: ownerWallet.privateKey,
    HOODYOOR_RESULT_SIGNER: resultSigner,
    HOODYOOR_RELAYER_ADDRESS: relayer,
    HOODYOOR_REVEAL_COMMITMENT: keccak256(toUtf8Bytes("test commitment only")),
    HOODYOOR_OWNER_TREASURY_CONTROL_VERIFIED: "1",
    HOODYOOR_ENERGY_LEDGER_FROZEN: "1",
    HOODYOOR_REVEAL_BLOCKHASH_VALIDATED: "1",
    HOODYOOR_REVEAL_BACKUP_CONFIRMED: "1",
    HOODYOOR_SECURITY_REVIEW_WAIVER: HOODYOOR_SECURITY_REVIEW_WAIVER_ACK,
    HOODYOOR_MINT_ENERGY_REWARD_APPROVED: "1000",
    ALLOW_HOODYOOR_MAINNET: "1",
    HOODYOOR_MAINNET_ACK,
  };
}

test("mainnet gate requires every review, wallet, and irreversibility control", () => {
  const empty = mainnetGateReport(ownerWallet.address, {});
  assert.equal(empty.ready, false);
  assert.ok(empty.blockers.includes("security-review-or-explicit-owner-waiver"));
  assert.ok(empty.blockers.includes("paid-mint-energy-owner-approval"));
  assert.ok(empty.blockers.includes("reveal-commitment"));
  assert.ok(empty.blockers.includes("reveal-secret-offline-backup"));
  assert.ok(empty.blockers.includes("deployer-private-key"));

  const complete = mainnetGateReport(ownerWallet.address, completeEnvironment());
  assert.equal(complete.ready, true);
  assert.deepEqual(complete.blockers, []);
  assert.equal(complete.deployer, ownerWallet.address);
  assert.equal(complete.securityReview.mode, "explicit-owner-waiver");
  assert.equal(complete.securityReview.independentReviewApproved, false);
  assert.equal(complete.mintEnergyRewardApproved, true);
  assert.doesNotMatch(JSON.stringify(complete), new RegExp(ownerWallet.privateKey.slice(2), "i"));
});

test("independent review approval and explicit owner waiver remain distinct paths", () => {
  const independentlyReviewed = completeEnvironment();
  delete independentlyReviewed.HOODYOOR_SECURITY_REVIEW_WAIVER;
  independentlyReviewed.HOODYOOR_SECURITY_REVIEW_APPROVED = "1";
  const reviewed = mainnetGateReport(ownerWallet.address, independentlyReviewed);
  assert.equal(reviewed.ready, true);
  assert.equal(reviewed.securityReview.mode, "independent-review");
  assert.equal(reviewed.securityReview.independentReviewApproved, true);
  assert.equal(reviewed.securityReview.explicitOwnerWaiver, false);

  const invalidWaiver = completeEnvironment();
  invalidWaiver.HOODYOOR_SECURITY_REVIEW_WAIVER = "yes";
  const rejected = mainnetGateReport(ownerWallet.address, invalidWaiver);
  assert.equal(rejected.ready, false);
  assert.ok(rejected.blockers.includes("security-review-or-explicit-owner-waiver"));
});

test("operational deployer, result signer, and relayer must be separate", () => {
  const environment = completeEnvironment();
  environment.HOODYOOR_RELAYER_ADDRESS = resultSigner;
  const report = mainnetGateReport(ownerWallet.address, environment);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("separate-deployer-result-signer-relayer"));
});

test("the full deploy command is dry-run-only by default", () => {
  const environment = { ...process.env, HOODYOOR_PREFLIGHT_OFFLINE: "1" };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("EXECUTE_HOODYOOR_")) delete environment[key];
  }
  const result = spawnSync(process.execPath, ["scripts/deploy-robinhood-mainnet.js"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"broadcastAttempted": false/);
  assert.match(result.stdout, /"saleStateAfterFinalization": "closed"|"saleState": "closed"/);
  assert.match(result.stdout, /Execution remains blocked until every preflight gate is satisfied/);
});

test("finalization never opens GTD or mints the owner reserve", () => {
  const source = fs.readFileSync("scripts/finalize-robinhood-launch.js", "utf8");
  assert.doesNotMatch(source, /setSaleState\s*\(/);
  assert.match(source, /ownerReserveMintedAfterFinalization: false/);
  assert.match(source, /finalChecks\.totalSupply !== 0/);
  assert.match(source, /finalChecks\.secondaryTradingEnabled/);
});
