import assert from "node:assert/strict";
import { before, test } from "node:test";
import { network } from "hardhat";

let ethers;
let owner;
let processor;
let holder;
let otherHolder;
let outsider;
let staking;

async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (error) => String(error).includes(errorName));
}

function bountyInput(overrides = {}) {
  return {
    label: "laser-eyes-launch",
    traitType: "Eyes",
    traitValue: "Laser Eyes",
    rewardRaw: ethers.parseUnits("500", 18),
    maxClaims: 2,
    perWalletLimit: 1,
    perTokenLimit: 1,
    actionMask: 1 | 2 | 4,
    startsAt: 1,
    endsAt: 0,
    ...overrides,
  };
}

function settlementInput(bountyId, overrides = {}) {
  return {
    bountyId,
    wallet: holder.address,
    operationId: ethers.id("operation"),
    tokenId: 1,
    action: 1,
    completedAt: 10,
    traitType: "Eyes",
    traitValue: "Laser Eyes",
    ...overrides,
  };
}

async function deployFixture() {
  const bank = await ethers.deployContract(
    "DYOOREnergyBank",
    [owner.address, staking.address],
    owner,
  );
  await bank.waitForDeployment();
  const bounties = await ethers.deployContract(
    "DYOORTraitBounties",
    [owner.address, await bank.getAddress(), processor.address],
    owner,
  );
  await bounties.waitForDeployment();
  await (
    await bank.connect(owner).grantRole(
      await bank.CREDIT_ROLE(),
      await bounties.getAddress(),
    )
  ).wait();
  return { bank, bounties };
}

before(async () => {
  ({ ethers } = await network.create());
  [owner, processor, holder, otherHolder, outsider, staking] = await ethers.getSigners();
});

test("owner creates an inactive bounty and an authorized processor settles it", async () => {
  const { bank, bounties } = await deployFixture();
  await (await bounties.connect(owner).createBounty(bountyInput())).wait();
  const bountyId = await bounties.bountyIdForLabel("laser-eyes-launch");
  const created = await bounties.getBounty(bountyId);

  assert.equal(created.active, false);
  assert.equal(created.traitType, "Eyes");
  assert.equal(created.traitValue, "Laser Eyes");
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId: ethers.id("operation-1"),
      tokenId: 10,
    })),
    "BountyClosed",
  );

  await (await bounties.connect(owner).setBountyActive(bountyId, true)).wait();
  await (
    await bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId: ethers.id("operation-1"),
      tokenId: 10,
    }))
  ).wait();

  assert.equal(
    await bank.spendableEnergy(holder.address),
    ethers.parseUnits("500", 18),
  );
  assert.equal((await bounties.getBounty(bountyId)).totalClaims, 1n);
  assert.equal(await bounties.walletClaimCount(bountyId, holder.address), 1n);
  assert.equal(await bounties.tokenClaimCount(bountyId, 10), 1n);
});

test("settlement rejects duplicate operations, wrong traits, wrong actions, and non-processors", async () => {
  const { bounties } = await deployFixture();
  await (await bounties.connect(owner).createBounty(bountyInput())).wait();
  const bountyId = await bounties.bountyIdForLabel("laser-eyes-launch");
  await (await bounties.connect(owner).setBountyActive(bountyId, true)).wait();
  const operationId = ethers.id("operation-2");

  await expectRevert(
    bounties.connect(outsider).settleBounty(settlementInput(bountyId, {
      operationId,
      tokenId: 20,
    })),
    "NotProcessor",
  );
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId,
      tokenId: 20,
      action: 8,
    })),
    "InvalidAction",
  );
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId,
      tokenId: 20,
      traitValue: "Wrong Eyes",
    })),
    "TraitDoesNotMatch",
  );

  await (
    await bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId,
      tokenId: 20,
    }))
  ).wait();
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId,
      tokenId: 20,
    })),
    "DuplicateSettlement",
  );
});

test("global, wallet, and token caps are enforced on-chain", async () => {
  const { bounties } = await deployFixture();
  await (await bounties.connect(owner).createBounty(bountyInput())).wait();
  const bountyId = await bounties.bountyIdForLabel("laser-eyes-launch");
  await (await bounties.connect(owner).setBountyActive(bountyId, true)).wait();

  await (
    await bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId: ethers.id("cap-1"),
    }))
  ).wait();
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId: ethers.id("cap-wallet"),
      tokenId: 2,
    })),
    "WalletClaimLimitReached",
  );
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      wallet: otherHolder.address,
      operationId: ethers.id("cap-token"),
    })),
    "TokenClaimLimitReached",
  );

  await (
    await bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      wallet: otherHolder.address,
      operationId: ethers.id("cap-2"),
      tokenId: 2,
    }))
  ).wait();
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      wallet: outsider.address,
      operationId: ethers.id("cap-global"),
      tokenId: 3,
    })),
    "GlobalClaimLimitReached",
  );
});

test("completion timestamp must fall inside the configured bounty window", async () => {
  const { bounties } = await deployFixture();
  await (
    await bounties.connect(owner).createBounty(
      bountyInput({ startsAt: 100, endsAt: 200 }),
    )
  ).wait();
  const bountyId = await bounties.bountyIdForLabel("laser-eyes-launch");
  await (await bounties.connect(owner).setBountyActive(bountyId, true)).wait();

  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId: ethers.id("too-early"),
      tokenId: 30,
      completedAt: 99,
    })),
    "BountyNotStarted",
  );
  await expectRevert(
    bounties.connect(processor).settleBounty(settlementInput(bountyId, {
      operationId: ethers.id("too-late"),
      tokenId: 30,
      completedAt: 201,
    })),
    "BountyEnded",
  );
});

test("bounty labels and configuration are immutable after creation", async () => {
  const { bounties } = await deployFixture();
  await (await bounties.connect(owner).createBounty(bountyInput())).wait();

  await expectRevert(
    bounties.connect(owner).createBounty(bountyInput()),
    "BountyAlreadyExists",
  );
  await expectRevert(
    bounties.connect(owner).createBounty(bountyInput({ label: "Mixed-Case" })),
    "InvalidLabel",
  );
  await expectRevert(
    bounties.connect(outsider).createBounty(bountyInput({ label: "other-bounty" })),
    "OwnableUnauthorizedAccount",
  );
});
