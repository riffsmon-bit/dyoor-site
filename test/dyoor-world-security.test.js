import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ethers } from "ethers";
import {
  formatWorldName,
  resolveWorldNameClaims,
  validateWorldLabel,
} from "../lib/dyoor-world.ts";
import {
  createDyoorWorldSessionToken,
  dyoorWorldChallengeMessage,
  verifyDyoorWorldSessionToken,
} from "../lib/dyoor-world-auth.ts";
import {
  dyoorWorldNamePng,
  dyoorWorldNameSvg,
} from "../lib/dyoor-world-name-image.ts";

process.env.DYOOR_WORLD_SESSION_SECRET = "test-only-dyoor-world-secret-with-32-characters";

function claim(id, wallet, label, createdAt) {
  return { version: 1, id, wallet: wallet.toLowerCase(), label, createdAt };
}

test("dYOOR labels have one canonical lowercase representation", () => {
  assert.deepEqual(validateWorldLabel("  RiFFs  "), { ok: true, label: "riffs" });
  assert.equal(formatWorldName("RiFFs"), "riffs.dYOOR");
  assert.equal(validateWorldLabel("ri--ffs").ok, false);
  assert.equal(validateWorldLabel("-riffs").ok, false);
  assert.equal(validateWorldLabel("official").ok, false);
  assert.equal(validateWorldLabel("ab").ok, false);
});

test("immutable name claims resolve deterministically one-to-one", () => {
  const walletA = ethers.Wallet.createRandom().address;
  const walletB = ethers.Wallet.createRandom().address;
  const claims = [
    claim("0002", walletA, "second", "2026-07-23T04:00:02.000Z"),
    claim("0001", walletA, "riffs", "2026-07-23T04:00:00.000Z"),
    claim("0003", walletB, "riffs", "2026-07-23T04:00:01.000Z"),
    claim("0004", walletB, "second", "2026-07-23T04:00:03.000Z"),
  ];
  const resolved = resolveWorldNameClaims(claims);

  assert.equal(resolved.byWallet.get(walletA.toLowerCase())?.label, "riffs");
  assert.equal(resolved.byWallet.get(walletB.toLowerCase())?.label, "second");
  assert.equal(resolved.byLabel.get("riffs")?.wallet, walletA.toLowerCase());
  assert.equal(resolved.accepted.length, 2);
});

test("holder challenge signatures bind wallet, host, chain, contract, nonce, and expiry", async () => {
  const wallet = ethers.Wallet.createRandom();
  const input = {
    wallet: wallet.address,
    nonce: "4a778c03-66d3-45eb-b83f-88d3bd15369f",
    audience: "preview.example.netlify.app",
    issuedAt: "2026-07-23T04:00:00.000Z",
    expiresAt: "2026-07-23T04:05:00.000Z",
  };
  const message = dyoorWorldChallengeMessage(input);
  const signature = await wallet.signMessage(message);

  assert.equal(ethers.verifyMessage(message, signature), wallet.address);
  assert.notEqual(
    ethers.verifyMessage(dyoorWorldChallengeMessage({ ...input, audience: "evil.example" }), signature),
    wallet.address,
  );
  assert.match(message, /Chain ID: 143/);
  assert.match(message, /0x349d8eb480c92cf75371fba5c6344a4d11b9103a/);
});

test("holder sessions reject tampering and expiry", () => {
  const wallet = ethers.Wallet.createRandom().address;
  const now = Date.parse("2026-07-23T04:00:00.000Z");
  const token = createDyoorWorldSessionToken(wallet, now);

  assert.equal(verifyDyoorWorldSessionToken(token, now + 1_000)?.wallet, wallet.toLowerCase());
  assert.equal(verifyDyoorWorldSessionToken(`${token}x`, now + 1_000), null);
  assert.equal(verifyDyoorWorldSessionToken(token, now + (13 * 60 * 60 * 1000)), null);
});

test("World name metadata uses marketplace-compatible hosted PNG artwork", async () => {
  const wallet = ethers.Wallet.createRandom().address.toLowerCase();
  const svg = dyoorWorldNameSvg({
    displayName: "riffs.dYOOR",
    wallet,
  });
  assert.match(svg, /riffs\.dYOOR/);
  assert.match(svg, new RegExp(wallet));
  assert.match(svg, /SOULBOUND HOLDER IDENTITY/);
  assert.match(svg, /S2 HOLDER VERIFIED/);
  assert.doesNotMatch(svg, /<script/i);

  const png = await dyoorWorldNamePng({
    displayName: "riffs.dYOOR",
    wallet,
  });
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(png.readUInt32BE(16), 3_000);
  assert.equal(png.readUInt32BE(20), 3_000);

  const metadataSource = fs.readFileSync(
    "app/api/dyoor-world/names/metadata/[tokenId]/route.ts",
    "utf8",
  );
  assert.match(metadataSource, /\/api\/dyoor-world\/names\/image\/.*\.png/);
  assert.doesNotMatch(metadataSource, /data:image/);

  const imageRouteSource = fs.readFileSync(
    "app/api/dyoor-world/names/image/[tokenId]/route.ts",
    "utf8",
  );
  assert.match(imageRouteSource, /image\/png/);
  assert.match(imageRouteSource, /dyoorWorldNamePng/);
  assert.match(imageRouteSource, /getDyoorWorldNameToken/);
});

test("World APIs enforce holder sessions and the nav icon is eligibility-gated", () => {
  for (const file of [
    "app/api/dyoor-world/messages/route.ts",
    "app/api/dyoor-world/names/availability/route.ts",
    "app/api/dyoor-world/profile/route.ts",
  ]) {
    assert.match(fs.readFileSync(file, "utf8"), /requireDyoorWorldRequest/);
  }
  const navSource = fs.readFileSync("components/dyoor-world/DyoorWorldDiscovery.tsx", "utf8");
  assert.match(navSource, /data\?\.eligible === true/);
  assert.match(navSource, /if \(!address \|\| eligibleWallet !== address\) return null/);

  const worldClientSource = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  assert.match(worldClientSource, /if \(!liveConfig\.claimsOpen\)/);
  assert.match(worldClientSource, /Claims closed/);
  assert.match(worldClientSource, /const latest = await loadProfile\(\)/);
  assert.match(worldClientSource, /\/api\/dyoor-world\/names\/availability\?label=/);
  assert.match(worldClientSource, /await waitForTransaction\(txHash\)/);
  assert.match(worldClientSource, /readableWorldNameClaimError/);

  const profileRouteSource = fs.readFileSync("app/api/dyoor-world/profile/route.ts", "utf8");
  assert.match(profileRouteSource, /dyoorWorldConfigForWallet\(wallet\)/);
  assert.match(profileRouteSource, /config/);

  const worldServerSource = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");
  assert.match(worldServerSource, /export async function getDyoorWorldNameAvailability/);
  assert.match(worldServerSource, /contract\.isAvailable\(label\)/);
  assert.match(worldServerSource, /Each holder wallet can claim one \.dYOOR name/);

  const contractSource = fs.readFileSync("contracts/DYOORWorldNames.sol", "utf8");
  assert.match(contractSource, /S2_COLLECTION\.balanceOf\(wallet\)/);
  assert.match(contractSource, /revert SoulboundName\(\)/);
});
