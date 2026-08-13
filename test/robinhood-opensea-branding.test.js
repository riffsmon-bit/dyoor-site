import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import sharp from "sharp";

const outputRoot = "data/robinhood/branding/opensea";
const manifest = JSON.parse(fs.readFileSync(
  `${outputRoot}/opensea-branding-manifest.json`,
  "utf8",
));
const details = JSON.parse(fs.readFileSync(
  "data/robinhood/branding/opensea-collection-details.json",
  "utf8",
));
const collectionConfig = JSON.parse(fs.readFileSync(
  "data/robinhood/dyoor-collection-config.json",
  "utf8",
));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("OpenSea package uses the approved chain and launch facts", () => {
  assert.equal(manifest.schema, "dyoor-hoodyoor-opensea-branding-v1");
  assert.equal(manifest.chain, "robinhood");
  assert.equal(manifest.generationPolicy.newGenerativeArtwork, true);
  assert.equal(manifest.generationPolicy.mode, "built-in-imagegen");
  assert.match(manifest.generationPolicy.style, /pixel art/i);
  assert.equal(details.collection.chain, "robinhood");
  assert.equal(details.collection.contractAddress, null);
  assert.equal(details.collection.totalSupply, 3_333);
  assert.equal(details.creatorEarnings.contractBasisPoints, 300);
  assert.equal(details.creatorEarnings.receiver, collectionConfig.owner);
  assert.equal(collectionConfig.treasury, collectionConfig.owner);
  assert.equal(details.launch.ownerReserve, 150);
  assert.equal(details.launch.automaticTradingUnlockSupply, 1_667);
  assert.match(details.collection.description, /entirely onchain/i);
  assert.match(details.collection.disclaimer, /not affiliated/i);
});

test("OpenSea branding assets match their frozen manifest", async () => {
  const expected = new Map([
    ["banner-desktop", [3_200, 1_200]],
    ["banner-mobile", [1_920, 1_080]],
    ["banner-logo", [1_024, 1_024]],
    ["overview-background", [2_560, 1_440]],
    ["pixel-art-preview", [1_024, 1_024]],
    ["social-share", [1_200, 630]],
  ]);
  assert.equal(manifest.assets.length, expected.size);

  for (const asset of manifest.assets) {
    const dimensions = expected.get(asset.id);
    assert.ok(dimensions, asset.id);
    const bytes = fs.readFileSync(asset.path);
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height], dimensions, asset.id);
    assert.equal(asset.bytes, bytes.length, asset.id);
    assert.equal(asset.sha256, sha256(bytes), asset.id);
    assert.equal(asset.format, "png", asset.id);
    assert.ok(asset.logicalWidth > 0, asset.id);
    assert.ok(asset.logicalHeight > 0, asset.id);
    assert.ok(Number.isInteger(asset.pixelScale), asset.id);
    assert.doesNotMatch(asset.source, /robinhood-collection-(?:banner|pfp)\.png$/);
    assert.doesNotMatch(asset.source, /hoodyoor-gtd-hero-desktop\.png$/);
  }
});
