import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { network } from "hardhat";
import { buildRecipientList } from "../scripts/airdrop-energy.js";

let ethers;
let admin;
let user;
let otherUser;
let thirdUser;
let nonAdmin;
let ascensionStaking;
let tempDir;

const CAMPAIGN_ID_LABEL = "DYOOR_STAKE_BY_JUNE_9_2026_25000_ENERGY";

async function deployEnergyBank() {
  const bank = await ethers.deployContract(
    "DYOOREnergyBank",
    [admin.address, ascensionStaking.address],
    admin,
  );
  await bank.waitForDeployment();
  return bank;
}

async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (error) => String(error).includes(errorName));
}

before(async () => {
  ({ ethers } = await network.create());
  [admin, user, otherUser, thirdUser, nonAdmin, ascensionStaking] = await ethers.getSigners();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyoor-airdrop-"));
});

after(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("admin can airdrop 25,000 Energy to all recipients", async () => {
  const bank = await deployEnergyBank();
  const amount = ethers.parseEther("25000");
  const campaignId = ethers.id(CAMPAIGN_ID_LABEL);
  const recipients = [user.address, otherUser.address, thirdUser.address];

  const tx = await bank.connect(admin).airdropEnergy(recipients, amount, campaignId);
  const receipt = await tx.wait();

  assert.equal(await bank.usedAirdropCampaign(campaignId), true);

  let totalDistributed = 0n;
  for (const recipient of recipients) {
    assert.equal(await bank.spendableEnergy(recipient), amount);
    assert.equal(await bank.lifetimeEnergy(recipient), amount);
    totalDistributed += await bank.spendableEnergy(recipient);
  }

  const events = receipt.logs
    .map((log) => {
      try {
        return bank.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((event) => event?.name === "EnergyAirdropped");

  assert.equal(events.length, recipients.length);
  assert.equal(totalDistributed, BigInt(recipients.length) * amount);
});

test("non-admin cannot airdrop", async () => {
  const bank = await deployEnergyBank();
  const amount = ethers.parseEther("25000");
  const campaignId = ethers.id(CAMPAIGN_ID_LABEL);

  await expectRevert(
    bank.connect(nonAdmin).airdropEnergy([user.address], amount, campaignId),
    "AccessControlUnauthorizedAccount",
  );
});

test("same airdrop campaign cannot be reused", async () => {
  const bank = await deployEnergyBank();
  const amount = ethers.parseEther("25000");
  const campaignId = ethers.id(CAMPAIGN_ID_LABEL);

  await (await bank.connect(admin).airdropEnergy([user.address], amount, campaignId)).wait();

  await expectRevert(
    bank.connect(admin).airdropEnergy([otherUser.address], amount, campaignId),
    "CampaignAlreadyUsed",
  );
});

test("zero address recipient reverts", async () => {
  const bank = await deployEnergyBank();
  const amount = ethers.parseEther("25000");
  const campaignId = ethers.id(CAMPAIGN_ID_LABEL);

  await expectRevert(
    bank.connect(admin).airdropEnergy([user.address, ethers.ZeroAddress], amount, campaignId),
    "ZeroAddress",
  );
});

test("wallet file parser dedupes duplicate recipients before airdrop", () => {
  const walletPath = path.join(tempDir, "wallets.txt");

  fs.writeFileSync(
    walletPath,
    [
      user.address,
      otherUser.address.toLowerCase(),
      user.address.toLowerCase(),
      "",
      thirdUser.address,
    ].join("\n"),
  );

  const recipients = buildRecipientList(ethers, walletPath);

  assert.deepEqual(recipients, [
    ethers.getAddress(user.address),
    ethers.getAddress(otherUser.address),
    ethers.getAddress(thirdUser.address),
  ]);
});
