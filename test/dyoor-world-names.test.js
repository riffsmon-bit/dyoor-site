import assert from "node:assert/strict";
import { before, test } from "node:test";
import { network } from "hardhat";

let ethers;
let owner;
let holder;
let otherHolder;
let outsider;
let treasury;

async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (error) => String(error).includes(errorName));
}

async function deployWorldNames() {
  const droids = await ethers.deployContract("DyoorDroids", [owner.address, treasury.address], owner);
  await droids.waitForDeployment();
  const names = await ethers.deployContract(
    "DYOORWorldNames",
    [owner.address, await droids.getAddress(), "https://dyoor.netlify.app/api/dyoor-world/names/metadata/"],
    owner,
  );
  await names.waitForDeployment();
  await (await droids.connect(owner).ownerMint(holder.address, 1)).wait();
  await (await droids.connect(owner).ownerMint(otherHolder.address, 1)).wait();
  return { droids, names };
}

before(async () => {
  ({ ethers } = await network.create());
  [owner, holder, otherHolder, outsider, treasury] = await ethers.getSigners();
});

test("only an S2 holder can claim a unique lowercase dYOOR World name", async () => {
  const { names } = await deployWorldNames();
  await (await names.connect(owner).setClaimsOpen(true)).wait();

  await expectRevert(names.connect(outsider).claim("outsider"), "HolderRequired");
  await (await names.connect(holder).claim("riffs")).wait();

  assert.equal(await names.nameOf(holder.address), "riffs.dYOOR");
  assert.equal(await names.ownerOfName("riffs"), holder.address);
  assert.equal(await names.resolve(await names.nodeForLabel("riffs")), holder.address);
  assert.equal(await names.labelOfToken(await names.tokenOf(holder.address)), "riffs");
  assert.equal(await names.totalNames(), 1n);
  assert.equal(await names.isAvailable("riffs"), false);
  assert.equal(await names.isAvailable("another"), true);
  const record = await names.recordOf(holder.address);
  assert.equal(record.label, "riffs");
  assert.equal(record.displayName, "riffs.dYOOR");
  assert.equal(record.node, await names.nodeForLabel("riffs"));
});

test("one wallet cannot claim twice and one label cannot be claimed twice", async () => {
  const { names } = await deployWorldNames();
  await (await names.connect(owner).setClaimsOpen(true)).wait();
  await (await names.connect(holder).claim("riffs")).wait();

  await expectRevert(names.connect(holder).claim("second"), "WalletAlreadyNamed");
  await expectRevert(names.connect(otherHolder).claim("riffs"), "NameAlreadyClaimed");
});

test("reserved, malformed, and mixed-case labels are rejected", async () => {
  const { names } = await deployWorldNames();
  await (await names.connect(owner).setReservedLabels(["official", "support"], true)).wait();
  await (await names.connect(owner).setClaimsOpen(true)).wait();

  await expectRevert(names.connect(holder).claim("official"), "LabelReservedForProtocol");
  await expectRevert(names.connect(otherHolder).claim("support"), "LabelReservedForProtocol");
  await expectRevert(names.connect(holder).claim("RiFFs"), "InvalidLabel");
  await expectRevert(names.connect(holder).claim("-riffs"), "InvalidLabel");
  await expectRevert(names.connect(holder).claim("ri--ffs"), "InvalidLabel");
});

test("World names are soulbound and cannot be transferred to a non-holder", async () => {
  const { names } = await deployWorldNames();
  await (await names.connect(owner).setClaimsOpen(true)).wait();
  await (await names.connect(holder).claim("riffs")).wait();
  const tokenId = await names.tokenOf(holder.address);

  await expectRevert(
    names.connect(holder).transferFrom(holder.address, outsider.address, tokenId),
    "SoulboundName",
  );
  assert.equal(await names.ownerOf(tokenId), holder.address);
});

test("name metadata can be permanently locked", async () => {
  const { names } = await deployWorldNames();
  await (await names.connect(owner).lockMetadataForever()).wait();

  await expectRevert(
    names.connect(owner).setMetadataBaseURI("https://example.com/changed/"),
    "MetadataIsLocked",
  );
});
