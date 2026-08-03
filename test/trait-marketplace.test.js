import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ethers } from "ethers";
import {
  S2_TRAIT_MARKETPLACE_ENERGY_PRICES,
  S2_TRAIT_MARKETPLACE_MON_PRICES,
  S2_TRAIT_MARKETPLACE_RARITIES,
  S2_TRAIT_MARKETPLACE_SLOTS,
  traitMarketplaceListingId,
  traitMarketplacePrice,
} from "../lib/s2-trait-marketplace-config.ts";
import {
  traitMarketplacePurchaseAuthorizationMessage,
  traitMarketplaceQuoteAuthorizationMessage,
} from "../lib/s2-trait-marketplace-auth.ts";

test("marketplace Energy and MON prices rise from Common through Mythic", () => {
  const prices = S2_TRAIT_MARKETPLACE_RARITIES.map((rarity) => traitMarketplacePrice(rarity));
  assert.deepEqual(S2_TRAIT_MARKETPLACE_ENERGY_PRICES, {
    Common: 300,
    Uncommon: 500,
    Rare: 750,
    "Super Rare": 1500,
    Legendary: 3000,
    Mythic: 7500,
  });
  assert.deepEqual(S2_TRAIT_MARKETPLACE_MON_PRICES, {
    Common: 6,
    Uncommon: 9,
    Rare: 14,
    "Super Rare": 75,
    Legendary: 125,
    Mythic: 300,
  });
  for (let index = 1; index < prices.length; index += 1) {
    assert.ok(prices[index].energy > prices[index - 1].energy);
    assert.ok(Number(prices[index].mon) > Number(prices[index - 1].mon));
  }
  for (const price of prices) {
    assert.equal(BigInt(price.energyRaw), BigInt(price.energy) * 10n ** 18n);
    assert.equal(BigInt(price.monRaw), BigInt(price.mon) * 10n ** 18n);
  }
});

test("marketplace only exposes optional wearable slots and uses stable trait IDs", () => {
  assert.deepEqual(S2_TRAIT_MARKETPLACE_SLOTS, [
    "Clothes",
    "Hat",
    "Accessories",
    "Accessories 2",
    "Stickers/Body art",
  ]);
  assert.equal(S2_TRAIT_MARKETPLACE_SLOTS.includes("Special"), false);
  assert.equal(S2_TRAIT_MARKETPLACE_SLOTS.includes("Eyes"), false);
  assert.equal(S2_TRAIT_MARKETPLACE_SLOTS.includes("Mouth"), false);
  assert.equal(traitMarketplaceListingId("Hat", 6009), "Hat:6009");

  const catalog = JSON.parse(fs.readFileSync("data/dyoor-s2-trait-catalog.json", "utf8"));
  const metadata = JSON.parse(fs.readFileSync("data/dyoor-s2-trait-item-metadata.json", "utf8"));
  const listingIds = [];
  for (const slot of S2_TRAIT_MARKETPLACE_SLOTS) {
    for (const trait of catalog.traits[slot]) {
      if (trait.selectable === false || trait.mutable === false || !trait.name || /^none$/i.test(trait.name)) continue;
      const item = metadata[`${slot}::${trait.name}`];
      assert.ok(Number.isSafeInteger(trait.traitId), `${slot} ${trait.name} needs a stable trait ID`);
      assert.ok(item, `${slot} ${trait.name} needs marketplace metadata`);
      assert.ok(S2_TRAIT_MARKETPLACE_RARITIES.includes(item.rarity), `${slot} ${trait.name} needs a supported rarity`);
      assert.ok(item.maxActiveSupply > 0, `${slot} ${trait.name} needs a supply cap`);
      listingIds.push(traitMarketplaceListingId(slot, trait.traitId));
    }
  }
  assert.equal(new Set(listingIds).size, listingIds.length);
  assert.equal(listingIds.length, 128);
});

test("quote and purchase signatures bind the Droid, exact trait, payment mode, and price", async () => {
  const signer = ethers.Wallet.createRandom();
  const quoteInput = {
    wallet: signer.address,
    tokenId: 143,
    listingId: "Hat:6009",
    traitType: "Hat",
    traitValue: "BOB Mask",
    paymentMode: "energy",
    timestamp: "1785686400000",
    nonce: "quote-nonce",
  };
  const quoteMessage = traitMarketplaceQuoteAuthorizationMessage(quoteInput);
  const quoteSignature = await signer.signMessage(quoteMessage);
  assert.equal(ethers.verifyMessage(quoteMessage, quoteSignature), signer.address);
  assert.notEqual(
    ethers.verifyMessage(traitMarketplaceQuoteAuthorizationMessage({ ...quoteInput, paymentMode: "mon" }), quoteSignature),
    signer.address,
  );
  assert.notEqual(
    ethers.verifyMessage(traitMarketplaceQuoteAuthorizationMessage({ ...quoteInput, listingId: "Hat:6001", traitValue: "Antenna" }), quoteSignature),
    signer.address,
  );

  const purchaseInput = {
    wallet: signer.address,
    tokenId: 143,
    quoteId: `0x${"a".repeat(64)}`,
    listingId: "Hat:6009",
    traitType: "Hat",
    traitValue: "BOB Mask",
    paymentMode: "energy",
    costLabel: "7500 Energy",
    costRaw: "7500000000000000000000",
    expiresAt: "2026-08-02T12:10:00.000Z",
    nonce: "purchase-nonce",
  };
  const purchaseMessage = traitMarketplacePurchaseAuthorizationMessage(purchaseInput);
  const purchaseSignature = await signer.signMessage(purchaseMessage);
  assert.equal(ethers.verifyMessage(purchaseMessage, purchaseSignature), signer.address);
  assert.notEqual(
    ethers.verifyMessage(traitMarketplacePurchaseAuthorizationMessage({ ...purchaseInput, costRaw: "300000000000000000000" }), purchaseSignature),
    signer.address,
  );
});

test("marketplace settlement enforces live supply and exact one-use MON payments", () => {
  const source = fs.readFileSync("lib/s2-trait-marketplace.ts", "utf8");
  const energyRoute = fs.readFileSync("app/api/energy/[wallet]/route.ts", "utf8");
  const client = fs.readFileSync("components/s2/TraitMarketplaceClient.tsx", "utf8");
  const previewRoute = fs.readFileSync("app/api/s2/trait-marketplace/preview/route.ts", "utf8");
  const nextConfig = fs.readFileSync("next.config.mjs", "utf8");

  assert.match(source, /getTraitSupplyAvailabilityLedger/);
  assert.match(source, /availableSupply = Math\.max\(0, listing\.maxActiveSupply - reservedActiveSupply\)/);
  assert.match(source, /saveTraitSupplyReservation/);
  assert.match(source, /assertSupplyDeltasAvailable\(supplyDeltas, record\.quoteId\)/);
  assert.match(source, /verifyS2TokenOwner/);
  assert.match(source, /tx\.value !== BigInt\(quote\.costMonRaw\)/);
  assert.match(source, /String\(tx\.data \|\| "0x"\)\.toLowerCase\(\) !== "0x"/);
  assert.match(source, /provider\.getBlock\(receipt\.blockNumber\)/);
  assert.match(source, /paymentMinedAt < quoteCreatedAt - MON_PAYMENT_CLOCK_SKEW_MS/);
  assert.match(source, /paymentMinedAt > quoteExpiresAt \+ MON_PAYMENT_EXPIRY_GRACE_MS/);
  assert.doesNotMatch(source, /DYOOR Trait Marketplace:/);
  assert.match(source, /normalizeWallet\(tx\.from\) !== quote\.wallet/);
  assert.match(source, /normalizeWallet\(tx\.to\).*treasuryWallet/);
  assert.match(source, /claimTraitMarketplaceMonPayment/);
  assert.match(source, /claimTraitLabEnergyDebit/);
  assert.match(source, /extendTraitSupplyReservation/);
  assert.match(source, /createTraitMarketplaceLivePreview/);
  assert.match(source, /dryRun: true/);
  assert.match(fs.readFileSync("lib/s2-trait-lab.ts", "utf8"), /selectedHatTakesLayerPriority/);
  assert.match(energyRoute, /serverSettledEnergyDebitRaw/);
  assert.match(client, /availableSupply\.toLocaleString/);
  assert.match(client, /\/api\/s2\/trait-marketplace\/preview/);
  assert.match(client, /Pay Energy/);
  assert.match(client, /Pay MON/);
  assert.doesNotMatch(client, /data: payment\.data/);
  assert.match(previewRoute, /marketplace-live-preview/);
  assert.match(nextConfig, /\/api\/s2\/trait-marketplace\/preview/);
  assert.match(nextConfig, /\/api\/s2\/trait-marketplace\/quote/);
  assert.match(nextConfig, /\/api\/s2\/trait-marketplace\/purchase/);
});
