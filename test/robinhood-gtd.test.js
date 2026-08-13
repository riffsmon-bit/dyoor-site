import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, hexlify, keccak256 } from "ethers";

const snapshot = JSON.parse(fs.readFileSync(
  "data/robinhood/snapshots/hoodyoor-s2-holders-block-93374159.json",
  "utf8",
));
const openSeaSource = fs.readFileSync(
  "data/robinhood/gtd-sources/opensea-top-holders-block-32071198.csv",
  "utf8",
).trim().split(/\r?\n/).map((line) => {
  const [address, maxMint, price] = line.split(",");
  return { address: getAddress(address), maxMint: Number(maxMint), price };
});
const manifest = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.json",
  "utf8",
));
const treeDump = JSON.parse(fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-gtd-tree.json",
  "utf8",
));
const binary = fs.readFileSync(
  "data/robinhood/onchain-128/hoodyoor-gtd-allowlist.bin",
);

const records = Array.from({ length: binary.length / 22 }, (_, index) => {
  const cursor = index * 22;
  return {
    address: getAddress(hexlify(binary.subarray(cursor, cursor + 20))),
    maxMint: binary.readUInt16BE(cursor + 20),
  };
});

test("HoodYØØR combines Monad holders and the supplied Robinhood allowlist", () => {
  assert.equal(manifest.schema, "dyoor-hoodyoor-gtd-allowlist-v1");
  assert.deepEqual(manifest.targetChain, { name: "Robinhood Chain", chainId: 4663 });
  assert.equal(manifest.policy.mintType, "paid-gtd");
  assert.equal(manifest.policy.freeMint, false);
  assert.equal(manifest.policy.mintPriceWei, "2500000000000000");
  assert.equal(manifest.policy.importedOpenSeaZeroPriceIgnored, true);
  assert.equal(manifest.totals.monadHolderWallets, 133);
  assert.equal(manifest.totals.monadLiveSourceTokens, 1_038);
  assert.equal(manifest.totals.robinhoodTopHolderWallets, 200);
  assert.equal(manifest.totals.overlapWallets, 0);
  assert.equal(manifest.totals.uniqueWallets, 333);
  assert.equal(manifest.totals.aggregateMaxMint, 733);
});

test("Monad ownership grants one mint while the imported list preserves its limit of three", () => {
  const byWallet = new Map(manifest.entries.map((entry) => [entry.address.toLowerCase(), entry]));
  for (const holder of snapshot.holders) {
    const entry = byWallet.get(holder.address.toLowerCase());
    assert.ok(entry, holder.address);
    assert.ok(entry.sources.includes("monad-dyoor-holder"), holder.address);
    assert.equal(entry.maxMint, 1, holder.address);
    assert.equal(entry.monadSourceTokenCount, holder.quantity, holder.address);
  }
  for (const source of openSeaSource) {
    assert.equal(source.maxMint, 3, source.address);
    assert.equal(source.price, "0", source.address);
    const entry = byWallet.get(source.address.toLowerCase());
    assert.ok(entry, source.address);
    assert.ok(entry.sources.includes("robinhood-top-holder-import"), source.address);
    assert.equal(entry.maxMint, 3, source.address);
  }
});

test("combined GTD binary and every OpenZeppelin proof are reproducible", () => {
  assert.equal(binary.length, 333 * 22);
  assert.deepEqual(records, manifest.entries.map(({ address, maxMint }) => ({ address, maxMint })));
  assert.equal(
    crypto.createHash("sha256").update(binary).digest("hex"),
    "d059fed126035f9f5f0f39d52e9273e1bb8c12e3f84584f4ed652f5c5dd627b1",
  );
  assert.equal(
    keccak256(binary),
    "0xa422f0b2443dea9c6d3d23e8ec312df7912fab929830aa435ef114923a148b68",
  );
  const tree = StandardMerkleTree.load(treeDump);
  assert.equal(tree.root, "0x915e9b6ddcfe13a197ade8f6b776d37beb8ce2f766001e6579bd0601ffc5dd31");
  assert.equal(tree.root, manifest.merkleTree.root);
  for (const entry of manifest.entries) {
    assert.equal(StandardMerkleTree.verify(
      tree.root,
      ["address", "uint256"],
      [entry.address, String(entry.maxMint)],
      entry.proof,
    ), true, entry.address);
  }
});
