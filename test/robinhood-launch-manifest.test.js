import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { getBytes, keccak256, toUtf8Bytes } from "ethers";

const manifest = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-mainnet-launch-manifest.json",
  "utf8",
));

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function artifactBytecode(value) {
  const encoded = value?.object || value;
  return encoded.startsWith("0x") ? encoded : `0x${encoded}`;
}

test("HoodYØØR launch manifest cannot authorize or imply a mainnet deployment", () => {
  assert.equal(manifest.schema, "dyoor-hoodyoor-mainnet-launch-v2");
  assert.equal(manifest.targetChain.chainId, 4_663);
  assert.equal(manifest.broadcast.status, "not-deployed");
  assert.equal(manifest.broadcast.authorized, false);
  assert.equal(manifest.broadcast.readiness, "blocked");
  assert.equal(manifest.verification.externalDeployment, "none");
  assert.equal(manifest.verification.publicTestnetDeployment, "skipped");
  assert.doesNotMatch(JSON.stringify(manifest), /private.?key|reveal.?secret.?value/i);
});

test("HoodYØØR manifest hashes every production source and compiled artifact", () => {
  const sourceTree = manifest.sourceTree.files.map((record) => {
    const bytes = fs.readFileSync(record.path);
    assert.equal(bytes.length, record.bytes, record.path);
    assert.equal(sha256(bytes), record.sha256, record.path);
    assert.equal(keccak256(bytes), record.keccak256, record.path);
    return `${record.path}\0${record.sha256}`;
  }).join("\n");
  assert.equal(sha256(Buffer.from(sourceTree)), manifest.sourceTree.canonicalSha256);
  assert.equal(keccak256(toUtf8Bytes(sourceTree)), manifest.sourceTree.canonicalKeccak256);

  assert.equal(manifest.artifacts.length, 6);
  for (const record of manifest.artifacts) {
    const artifact = JSON.parse(fs.readFileSync(record.artifact, "utf8"));
    const creation = artifactBytecode(artifact.bytecode);
    const runtime = artifactBytecode(artifact.deployedBytecode);
    assert.equal(getBytes(creation).length, record.creationBytes, record.contract);
    assert.equal(keccak256(creation), record.creationKeccak256, record.contract);
    assert.equal(getBytes(runtime).length, record.runtimeBytes, record.contract);
    assert.equal(keccak256(runtime), record.runtimeKeccak256, record.contract);
    assert.equal(
      keccak256(toUtf8Bytes(JSON.stringify(artifact.abi))),
      record.abiKeccak256,
      record.contract,
    );
  }
});

test("HoodYØØR launch payloads match every frozen onchain hash", () => {
  const expected = {
    art: "0xe6e707009bba6080eeffee21a1dd3ef97d47da5097ef0ea7ffb7f05b71708807",
    assignments: "0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3",
    rules: "0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f",
    gtd: "0xa422f0b2443dea9c6d3d23e8ec312df7912fab929830aa435ef114923a148b68",
  };
  for (const [name, hash] of Object.entries(expected)) {
    const payload = manifest.payloads[name];
    assert.equal(payload.binaryHash, hash);
    assert.equal(keccak256(fs.readFileSync(payload.binary.path)), hash);
  }
  assert.equal(manifest.payloads.assignments.assignments, 3_333);
  assert.equal(manifest.payloads.gtd.merkleRoot, "0x915e9b6ddcfe13a197ade8f6b776d37beb8ce2f766001e6579bd0601ffc5dd31");
  assert.equal(manifest.payloads.gtd.uniqueWallets, 333);
  assert.equal(manifest.payloads.gtd.aggregateMaxMint, 733);
  assert.equal(manifest.economics.ownerReserveAllocation, 150);
  assert.equal(manifest.economics.paidAllocation, 3_183);
  assert.deepEqual(manifest.ownerReserve, {
    allocation: 150,
    recipientPolicy: "current-collection-owner",
    mintTiming: "first-gtd-activation",
    paid: false,
    countsTowardSecondaryTradingThreshold: true,
  });
  assert.equal(manifest.economics.gtdEligibleWallets, 333);
  assert.deepEqual(manifest.secondaryTrading, {
    initiallyLocked: true,
    autoUnlockMintedSupply: 1667,
    threshold: "50%-rounded-up",
    ownerCanUnlockEarly: true,
    unlockIsPermanent: true,
    newApprovalsBlockedWhileLocked: true,
    ownerReserveCountsTowardThreshold: true,
  });
  assert.equal(manifest.payloads.rules.pairs, 329);
  assert.equal(manifest.payloads.art.traits, 201);
});

test("HoodYØØR manifest keeps every mainnet gate and completed ledger explicit", () => {
  const statusByGate = new Map(manifest.blockers.map(({ id, status }) => [id, status]));
  const blockers = new Set(statusByGate.keys());
  assert.deepEqual(blockers, new Set([
    "verify-owner-and-treasury-control-on-robinhood",
    "final-energy-migration-ledger",
    "result-signer-relayer-and-deployer-addresses",
    "public-chain-reveal-blockhash-validation",
    "reveal-secret-offline-backup",
    "paid-mint-energy-owner-approval",
    "independent-smart-contract-security-review",
  ]));
  assert.equal(statusByGate.get("final-energy-migration-ledger"), "complete");
  assert.equal(statusByGate.get("public-chain-reveal-blockhash-validation"), "complete");
  assert.equal(statusByGate.get("reveal-secret-offline-backup"), "complete");
  assert.equal(statusByGate.get("paid-mint-energy-owner-approval"), "complete");
  assert.equal(statusByGate.get("independent-smart-contract-security-review"), "waived");
  for (const id of blockers) {
    if (
      id !== "final-energy-migration-ledger"
      && id !== "public-chain-reveal-blockhash-validation"
      && id !== "reveal-secret-offline-backup"
      && id !== "paid-mint-energy-owner-approval"
      && id !== "independent-smart-contract-security-review"
    ) assert.equal(statusByGate.get(id), "open", id);
  }
  assert.equal(manifest.verification.publicMainnetBlockhashCanary.status, "pass");
  assert.equal(
    manifest.verification.publicMainnetBlockhashCanary.address,
    "0x3f38DBe5d52f824f3f4738Fe7db5D58dfD1A2216",
  );
  assert.equal(
    manifest.payloads.energyMigration.binaryHash,
    "0x9b334fcd14b1bd4de1f9d2787124f9d30775e977dfca5e8e6c887ef592a5bf4f",
  );
  assert.equal(manifest.economics.paidMintEnergyReward, 1000);
  assert.equal(manifest.economics.ownerReserveEarnsMintEnergy, false);
  assert.deepEqual(manifest.ownerDecisions.securityReview, {
    status: "explicit-owner-waiver",
    independentlyReviewed: false,
    explicitOwnerWaiver: true,
    note: "Owner explicitly accepted unaudited mainnet deployment risk. This is a waiver, not an audit or independent security approval.",
  });
  assert.equal(manifest.ownerDecisions.mintEnergy.status, "approved");
  assert.doesNotMatch(JSON.stringify(manifest), /reveal-secret-4663|offlineBackupConfirmedAt/);
  const rehearsal = fs.readFileSync(
    "contracts/hoodyoor/test/HoodYOORLaunchRehearsal.t.sol",
    "utf8",
  );
  assert.match(rehearsal, /VM\.chainId\(TARGET_CHAIN_ID\)/);
  assert.match(rehearsal, /_validateGtdAllowlist/);
  assert.match(rehearsal, /collection\.mintGTD/);
  assert.match(rehearsal, /finalizeMintingAndRequestReveal/);
  assert.match(rehearsal, /controller\.confirmReroll/);

  const collection = fs.readFileSync("contracts/hoodyoor/src/HoodYOOR.sol", "utf8");
  assert.doesNotMatch(collection, /function\s+airdrop\b/);
  assert.match(collection, /OWNER_RESERVE_ALLOCATION\s*=\s*150/);
  assert.match(collection, /PAID_ALLOCATION\s*=\s*MAX_SUPPLY\s*-\s*OWNER_RESERVE_ALLOCATION/);
  assert.match(collection, /function _mintOwnerReserve\(\) private/);
  assert.match(collection, /SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY\s*=\s*1_667/);
  assert.match(collection, /function unlockSecondaryTrading\(\) external onlyOwner/);
  assert.doesNotMatch(
    collection,
    /function\s+(?:lockSecondaryTrading|setSecondaryTrading)\b/,
  );
  assert.doesNotMatch(JSON.stringify(manifest), /snapshot-airdrop|airdropAllocation/);
});
