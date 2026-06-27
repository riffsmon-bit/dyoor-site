import assert from "node:assert/strict";
import { before, test } from "node:test";
import { network } from "hardhat";

let ethers;
let owner;
let user;
let otherUser;
let treasury;

async function deploySuite() {
  const droids = await ethers.deployContract("DyoorDroids", [owner.address, treasury.address], owner);
  await droids.waitForDeployment();

  const traits = await ethers.deployContract("DyoorTraits", [owner.address, "ipfs://traits/{id}.json"], owner);
  await traits.waitForDeployment();

  const manager = await ethers.deployContract(
    "DyoorTraitManager",
    [owner.address, await droids.getAddress(), await traits.getAddress()],
    owner,
  );
  await manager.waitForDeployment();

  await (await droids.connect(owner).setTraitManager(await manager.getAddress())).wait();
  await (await traits.connect(owner).setTraitManager(await manager.getAddress())).wait();

  return { droids, traits, manager };
}

async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (error) => String(error).includes(errorName));
}

before(async () => {
  ({ ethers } = await network.create());
  [owner, user, otherUser, treasury] = await ethers.getSigners();
});

test("public mint works and tracks wallet mint count", async () => {
  const { droids } = await deploySuite();

  await (await droids.connect(owner).setMintSettings(true, ethers.parseEther("1"), 2)).wait();
  await (await droids.connect(user).publicMint(2, { value: ethers.parseEther("2") })).wait();

  assert.equal(await droids.ownerOf(1), user.address);
  assert.equal(await droids.ownerOf(2), user.address);
  assert.equal(await droids.totalMinted(), 2n);
  assert.equal(await droids.mintedCount(user.address), 2n);
});

test("max supply is enforced", async () => {
  const { droids } = await deploySuite();

  let remaining = 3333;
  while (remaining > 0) {
    const quantity = Math.min(100, remaining);
    await (await droids.connect(owner).ownerMint(owner.address, quantity)).wait();
    remaining -= quantity;
  }

  assert.equal(await droids.totalMinted(), 3333n);
  await expectRevert(droids.connect(owner).ownerMint(owner.address, 1), "MaxSupplyExceeded");
});

test("max per wallet is enforced", async () => {
  const { droids } = await deploySuite();

  await (await droids.connect(owner).setMintSettings(true, ethers.parseEther("0.1"), 1)).wait();
  await (await droids.connect(user).publicMint(1, { value: ethers.parseEther("0.1") })).wait();

  await expectRevert(
    droids.connect(user).publicMint(1, { value: ethers.parseEther("0.1") }),
    "MaxPerWalletExceeded",
  );
});

test("owner mint works", async () => {
  const { droids } = await deploySuite();

  await (await droids.connect(owner).ownerMint(user.address, 3)).wait();

  assert.equal(await droids.ownerOf(1), user.address);
  assert.equal(await droids.ownerOf(2), user.address);
  assert.equal(await droids.ownerOf(3), user.address);
});

test("withdraw sends mint proceeds to treasury", async () => {
  const { droids } = await deploySuite();

  await (await droids.connect(owner).setMintSettings(true, ethers.parseEther("1"), 1)).wait();
  await (await droids.connect(user).publicMint(1, { value: ethers.parseEther("1") })).wait();

  const beforeBalance = await ethers.provider.getBalance(treasury.address);
  await (await droids.connect(owner).withdraw()).wait();
  const afterBalance = await ethers.provider.getBalance(treasury.address);

  assert.equal(afterBalance - beforeBalance, ethers.parseEther("1"));
});

test("owner can create and mint ERC1155 traits", async () => {
  const { traits } = await deploySuite();

  await (await traits.connect(owner).createTrait(1001, 1, 2, 10)).wait();
  await (await traits.connect(owner).mintTrait(user.address, 1001, 4)).wait();

  const info = await traits.getTraitInfo(1001);
  assert.equal(info.slot, 1n);
  assert.equal(info.rarity, 2n);
  assert.equal(info.exists, true);
  assert.equal(info.maxSupply, 10n);
  assert.equal(info.mintedSupply, 4n);
  assert.equal(await traits.balanceOf(user.address, 1001), 4n);
});

test("cannot mint undefined traits", async () => {
  const { traits } = await deploySuite();

  await expectRevert(traits.connect(owner).mintTrait(user.address, 9999, 1), "UndefinedTrait");
});

test("cannot exceed trait maxSupply", async () => {
  const { traits } = await deploySuite();

  await (await traits.connect(owner).createTrait(1001, 1, 2, 2)).wait();
  await (await traits.connect(owner).mintTrait(user.address, 1001, 2)).wait();

  await expectRevert(traits.connect(owner).mintTrait(user.address, 1001, 1), "MaxSupplyExceeded");
});

test("user can equip owned trait, burns one item, and updates Droid dynamic trait", async () => {
  const { droids, traits, manager } = await deploySuite();

  await (await droids.connect(owner).ownerMint(user.address, 1)).wait();
  await (await traits.connect(owner).createTrait(1001, 1, 2, 10)).wait();
  await (await traits.connect(owner).mintTrait(user.address, 1001, 2)).wait();

  await (await manager.connect(user).equipTrait(1, 1001)).wait();

  const droidTraits = await droids.getTraits(1);
  assert.equal(droidTraits.eyes, 1001n);
  assert.equal(await traits.balanceOf(user.address, 1001), 1n);
});

test("user cannot equip trait they do not own", async () => {
  const { droids, traits, manager } = await deploySuite();

  await (await droids.connect(owner).ownerMint(user.address, 1)).wait();
  await (await traits.connect(owner).createTrait(1001, 1, 2, 10)).wait();

  await expectRevert(manager.connect(user).equipTrait(1, 1001), "InsufficientTraitBalance");
});

test("user cannot equip trait to Droid they do not own", async () => {
  const { droids, traits, manager } = await deploySuite();

  await (await droids.connect(owner).ownerMint(otherUser.address, 1)).wait();
  await (await traits.connect(owner).createTrait(1001, 1, 2, 10)).wait();
  await (await traits.connect(owner).mintTrait(user.address, 1001, 1)).wait();

  await expectRevert(manager.connect(user).equipTrait(1, 1001), "NotDroidOwner");
});

test("TraitManager cannot update locked Background or Droid", async () => {
  const { droids, traits, manager } = await deploySuite();

  await (await droids.connect(owner).ownerMint(user.address, 1)).wait();
  await (await droids.connect(owner).setInitialLockedTraits(1, 77, 88)).wait();
  await (await traits.connect(owner).createTrait(1001, 0, 2, 10)).wait();
  await (await traits.connect(owner).mintTrait(user.address, 1001, 1)).wait();
  await (await manager.connect(user).equipTrait(1, 1001)).wait();

  const droidTraits = await droids.getTraits(1);
  assert.equal(droidTraits.background, 77n);
  assert.equal(droidTraits.droid, 88n);
  assert.equal(droidTraits.condition, 1001n);
});

test("locked traits cannot be changed after set", async () => {
  const { droids } = await deploySuite();

  await (await droids.connect(owner).ownerMint(user.address, 1)).wait();
  await (await droids.connect(owner).setInitialLockedTraits(1, 77, 88)).wait();

  await expectRevert(droids.connect(owner).setInitialLockedTraits(1, 1, 2), "LockedTraitsAlreadySet");
});

test("metadata lock prevents baseURI changes", async () => {
  const { droids } = await deploySuite();

  await (await droids.connect(owner).setBaseURI("ipfs://before/")).wait();
  await (await droids.connect(owner).lockMetadataForever()).wait();

  await expectRevert(droids.connect(owner).setBaseURI("ipfs://after/"), "MetadataIsLocked");
});
