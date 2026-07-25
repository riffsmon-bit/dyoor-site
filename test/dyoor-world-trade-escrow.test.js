import assert from "node:assert/strict";
import { before, test } from "node:test";
import { network } from "hardhat";

let ethers;
let owner;
let maker;
let taker;
let outsider;
let treasury;

async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (error) => String(error).includes(errorName));
}

async function deployFixture() {
  const droids = await ethers.deployContract(
    "DyoorDroids",
    [owner.address, treasury.address],
    owner,
  );
  await droids.waitForDeployment();
  const escrow = await ethers.deployContract(
    "DYOORWorldTradeEscrow",
    [await droids.getAddress()],
    owner,
  );
  await escrow.waitForDeployment();
  await (await droids.connect(owner).ownerMint(maker.address, 1)).wait();
  await (await droids.connect(owner).ownerMint(taker.address, 1)).wait();
  await (await droids.connect(owner).ownerMint(outsider.address, 1)).wait();
  return { droids, escrow };
}

async function futureTimestamp(seconds = 3_600) {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block.timestamp + seconds);
}

before(async () => {
  ({ ethers } = await network.create());
  [owner, maker, taker, outsider, treasury] = await ethers.getSigners();
});

test("World escrow atomically swaps S2 Droids and MON without a custodial bot", async () => {
  const { droids, escrow } = await deployFixture();
  const escrowAddress = await escrow.getAddress();
  const offeredMon = ethers.parseEther("1");
  const requestedMon = ethers.parseEther("0.25");

  await (await droids.connect(maker).approve(escrowAddress, 1)).wait();
  await (await escrow.connect(maker).createTrade(
    taker.address,
    1,
    2,
    requestedMon,
    await futureTimestamp(),
    { value: offeredMon },
  )).wait();

  assert.equal(await droids.ownerOf(1), escrowAddress);
  assert.equal(await ethers.provider.getBalance(escrowAddress), offeredMon);
  await expectRevert(
    escrow.connect(outsider).acceptTrade(1, { value: requestedMon }),
    "Unauthorized",
  );

  await (await droids.connect(taker).approve(escrowAddress, 2)).wait();
  const makerBefore = await ethers.provider.getBalance(maker.address);
  await (await escrow.connect(taker).acceptTrade(1, { value: requestedMon })).wait();

  assert.equal(await droids.ownerOf(1), taker.address);
  assert.equal(await droids.ownerOf(2), maker.address);
  assert.equal(await ethers.provider.getBalance(escrowAddress), 0n);
  assert.equal(await ethers.provider.getBalance(maker.address), makerBefore + requestedMon);
  assert.equal((await escrow.trades(1)).status, 2n);
});

test("maker can cancel and recover the exact escrowed assets", async () => {
  const { droids, escrow } = await deployFixture();
  const escrowAddress = await escrow.getAddress();
  const offeredMon = ethers.parseEther("0.5");
  await (await droids.connect(maker).approve(escrowAddress, 1)).wait();
  await (await escrow.connect(maker).createTrade(
    ethers.ZeroAddress,
    1,
    2,
    0,
    await futureTimestamp(),
    { value: offeredMon },
  )).wait();

  await expectRevert(escrow.connect(taker).cancelTrade(1), "Unauthorized");
  await (await escrow.connect(maker).cancelTrade(1)).wait();
  assert.equal(await droids.ownerOf(1), maker.address);
  assert.equal(await ethers.provider.getBalance(escrowAddress), 0n);
  assert.equal((await escrow.trades(1)).status, 3n);
});

test("expired trades can be recovered without admin authority", async () => {
  const { droids, escrow } = await deployFixture();
  const escrowAddress = await escrow.getAddress();
  await (await droids.connect(maker).approve(escrowAddress, 1)).wait();
  await (await escrow.connect(maker).createTrade(
    taker.address,
    1,
    2,
    0,
    await futureTimestamp(301),
  )).wait();

  await expectRevert(escrow.connect(outsider).expireTrade(1), "TradeNotExpired");
  await ethers.provider.send("evm_increaseTime", [302]);
  await ethers.provider.send("evm_mine", []);
  await (await escrow.connect(outsider).expireTrade(1)).wait();

  assert.equal(await droids.ownerOf(1), maker.address);
  assert.equal((await escrow.trades(1)).status, 4n);
});

test("escrow rejects unsolicited NFT deposits and direct MON", async () => {
  const { droids, escrow } = await deployFixture();
  const escrowAddress = await escrow.getAddress();
  await expectRevert(
    droids.connect(maker)["safeTransferFrom(address,address,uint256)"](
      maker.address,
      escrowAddress,
      1,
    ),
    "UnexpectedNftDeposit",
  );
  await expectRevert(
    maker.sendTransaction({ to: escrowAddress, value: 1n }),
    "DirectMonDisabled",
  );
});

test("a recipient that rejects MON cannot strand either traded Droid", async () => {
  const { droids, escrow } = await deployFixture();
  const escrowAddress = await escrow.getAddress();
  const actor = await ethers.deployContract("RejectingWorldTrader", [], owner);
  await actor.waitForDeployment();
  const actorAddress = await actor.getAddress();
  await (await droids.connect(owner).ownerMint(actorAddress, 1)).wait();

  const offeredMon = ethers.parseEther("0.75");
  await (await droids.connect(maker).approve(escrowAddress, 1)).wait();
  await (await escrow.connect(maker).createTrade(
    actorAddress,
    1,
    4,
    0,
    await futureTimestamp(),
    { value: offeredMon },
  )).wait();
  await (await actor.approveDroid(await droids.getAddress(), escrowAddress, 4)).wait();
  await (await actor.accept(escrowAddress, 1)).wait();

  assert.equal(await droids.ownerOf(1), actorAddress);
  assert.equal(await droids.ownerOf(4), maker.address);
  assert.equal(await escrow.claimableMon(actorAddress), offeredMon);
  assert.equal(await ethers.provider.getBalance(escrowAddress), offeredMon);

  const recipientBefore = await ethers.provider.getBalance(outsider.address);
  await (await actor.withdrawDeferredMon(escrowAddress, outsider.address)).wait();
  assert.equal(await ethers.provider.getBalance(outsider.address), recipientBefore + offeredMon);
  assert.equal(await escrow.claimableMon(actorAddress), 0n);
  assert.equal(await ethers.provider.getBalance(escrowAddress), 0n);
});
