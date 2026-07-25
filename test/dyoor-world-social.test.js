import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DYOOR_WORLD_CHANNELS,
  isWorldWritableChannel,
} from "../lib/dyoor-world.ts";
import {
  dyoorWorldSticker,
  normalizeDyoorWorldAttachment,
  normalizeDyoorWorldMediaUrl,
} from "../lib/dyoor-world-media.ts";
import {
  DYOOR_WORLD_CHAT_REWARD_DAILY_CAP,
  DYOOR_WORLD_CHAT_REWARD_ENERGY,
  DYOOR_WORLD_TIP_REWARD_DAILY_CAP,
  DYOOR_WORLD_TIP_REWARD_ENERGY,
  DYOOR_WORLD_TIP_REWARD_MIN_MON,
  DYOOR_WORLD_TRADE_REWARD_DAILY_CAP,
  DYOOR_WORLD_TRADE_REWARD_ENERGY,
  dyoorWorldDailyPrize,
  qualifiesForDyoorWorldChatReward,
} from "../lib/dyoor-world-rewards.ts";

test("daily World Energy table preserves the advertised one-percent jackpot", () => {
  assert.equal(dyoorWorldDailyPrize(0), 50);
  assert.equal(dyoorWorldDailyPrize(59), 50);
  assert.equal(dyoorWorldDailyPrize(60), 100);
  assert.equal(dyoorWorldDailyPrize(84), 100);
  assert.equal(dyoorWorldDailyPrize(85), 250);
  assert.equal(dyoorWorldDailyPrize(95), 500);
  assert.equal(dyoorWorldDailyPrize(98), 500);
  assert.equal(dyoorWorldDailyPrize(99), 1_000);
});

test("chat rewards require meaningful content instead of message spam", () => {
  assert.equal(qualifiesForDyoorWorldChatReward("gm"), false);
  assert.equal(qualifiesForDyoorWorldChatReward("!!!!!!!!!!!!!!!!!!!!!!!!!!!!"), false);
  assert.equal(
    qualifiesForDyoorWorldChatReward("The Energy flywheel strategy is looking strong today."),
    true,
  );
});

test("World media accepts direct HTTPS images and GIFs while blocking unsafe URLs", () => {
  const hostedImage = [
    "/api/dyoor-world/media",
    "0x349d8eb480c92cf75371fba5c6344a4d11b9103a",
    "00m123abcd-123e4567-e89b-42d3-a456-426614174000",
  ].join("/");
  assert.deepEqual(normalizeDyoorWorldMediaUrl(hostedImage), {
    kind: "image",
    url: hostedImage,
  });
  assert.deepEqual(normalizeDyoorWorldMediaUrl("https://cdn.example.com/droid.png?size=large"), {
    kind: "image",
    url: "https://cdn.example.com/droid.png?size=large",
  });
  assert.equal(
    normalizeDyoorWorldMediaUrl("https://media.giphy.com/media/abc123/giphy.gif")?.kind,
    "gif",
  );
  assert.equal(
    normalizeDyoorWorldMediaUrl("https://media.tenor.com/example")?.kind,
    "gif",
  );
  assert.equal(normalizeDyoorWorldMediaUrl("http://cdn.example.com/droid.png"), null);
  assert.equal(normalizeDyoorWorldMediaUrl("https://localhost/droid.png"), null);
  assert.equal(normalizeDyoorWorldMediaUrl("https://192.168.1.4/droid.png"), null);
  assert.equal(normalizeDyoorWorldMediaUrl("https://[::1]/droid.png"), null);
  assert.equal(normalizeDyoorWorldMediaUrl("https://cdn.example.com/vector.svg"), null);
  assert.equal(
    normalizeDyoorWorldMediaUrl(
      "/api/dyoor-world/media/0x349d8eb480c92cf75371fba5c6344a4d11b9103a/not-a-media-id",
    ),
    null,
  );
});

test("World stickers are curated and unknown sticker payloads are rejected", () => {
  assert.equal(dyoorWorldSticker("charged-up")?.label, "CHARGED UP");
  assert.deepEqual(normalizeDyoorWorldAttachment({
    kind: "sticker",
    stickerId: "burn-verified",
  }), {
    kind: "sticker",
    stickerId: "burn-verified",
  });
  assert.equal(normalizeDyoorWorldAttachment({
    kind: "sticker",
    stickerId: "user-controlled-html",
  }), null);
});

test("activity rewards are useful but capped against low-effort farming", () => {
  assert.equal(DYOOR_WORLD_CHAT_REWARD_ENERGY, 5);
  assert.equal(DYOOR_WORLD_CHAT_REWARD_DAILY_CAP, 5);
  assert.equal(DYOOR_WORLD_TIP_REWARD_ENERGY, 10);
  assert.equal(DYOOR_WORLD_TIP_REWARD_MIN_MON, "0.1");
  assert.equal(DYOOR_WORLD_TIP_REWARD_DAILY_CAP, 3);
  assert.equal(DYOOR_WORLD_TRADE_REWARD_ENERGY, 100);
  assert.equal(DYOOR_WORLD_TRADE_REWARD_DAILY_CAP, 1);
});

test("verified streams are bot-only while the trade desk remains conversational", () => {
  assert.equal(isWorldWritableChannel("sales-feed"), false);
  assert.equal(isWorldWritableChannel("tip-ledger"), false);
  assert.equal(isWorldWritableChannel("burn-log"), false);
  assert.equal(isWorldWritableChannel("trade-desk"), true);
  assert.equal(DYOOR_WORLD_CHANNELS.some((channel) => channel.id === "sales-feed"), true);
  assert.equal(DYOOR_WORLD_CHANNELS.some((channel) => channel.id === "trade-desk"), true);
});

test("World social APIs remain holder-gated and financial relays verify chain receipts", () => {
  for (const file of [
    "app/api/dyoor-world/media/[wallet]/[mediaId]/route.ts",
    "app/api/dyoor-world/media/tenor/route.ts",
    "app/api/dyoor-world/media/upload/route.ts",
    "app/api/dyoor-world/profile/route.ts",
    "app/api/dyoor-world/rewards/route.ts",
    "app/api/dyoor-world/tips/route.ts",
    "app/api/dyoor-world/trades/route.ts",
  ]) {
    assert.match(fs.readFileSync(file, "utf8"), /requireDyoorWorldRequest/);
  }
  const server = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");
  assert.match(server, /getTransactionReceipt\(txHash\)/);
  assert.match(server, /transaction\.value <= 0n/);
  assert.match(server, /DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS/);
  assert.match(server, /DYOOR_WORLD_CHAT_REWARD_DAILY_CAP/);
  assert.match(server, /qualifiesForDyoorWorldChatReward\(message\.content\)/);
  assert.match(server, /normalizeDyoorWorldAttachment\(input\.attachment\)/);
  assert.match(server, /BigInt\(record\.amountWei\) < ethers\.parseEther\(DYOOR_WORLD_TIP_REWARD_MIN_MON\)/);
  assert.match(server, /parsed\.name === "TradeCompleted"/);
  assert.match(server, /processDyoorWorldBurns/);
  assert.match(server, /verifyExplorerBurnOnChain/);
  assert.match(server, /ENERGY_BANK_OPERATOR_PRIVATE_KEY/);
  assert.match(server, /dyoor-world:\$\{purpose\}:v1/);
  assert.match(server, /DEFAULT_WORLD_NAMES_CONTRACT/);
  assert.match(server, /DEFAULT_WORLD_TRADE_ESCROW/);
  assert.match(
    fs.readFileSync("app/api/dyoor-world/automation/burns/route.ts", "utf8"),
    /requireDyoorWorldAutomationRequest/,
  );

  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  assert.doesNotMatch(client, /DYOOR_WORLD_REWARD_SECRET/);
  assert.doesNotMatch(client, /ENERGY_BANK_OPERATOR_PRIVATE_KEY/);
  assert.match(client, /Wallet-to-wallet on Monad/);
});

test("World media search and uploads keep provider keys server-side and sanitize files", () => {
  const client = fs.readFileSync(
    "components/dyoor-world/DyoorWorldMediaComposer.tsx",
    "utf8",
  );
  const tenor = fs.readFileSync(
    "app/api/dyoor-world/media/tenor/route.ts",
    "utf8",
  );
  const upload = fs.readFileSync(
    "app/api/dyoor-world/media/upload/route.ts",
    "utf8",
  );
  const store = fs.readFileSync("lib/dyoor-world-media-store.ts", "utf8");
  const envTemplate = fs.readFileSync(
    "netlify-dyoor-world-social.env.example",
    "utf8",
  );

  assert.match(client, /Search Tenor/);
  assert.match(client, /Powered by Tenor/);
  assert.doesNotMatch(client, /TENOR_API_KEY|GOOGLE_TENOR_API_KEY/);
  assert.match(tenor, /https:\/\/tenor\.googleapis\.com\/v2/);
  assert.match(tenor, /contentfilter: "high"/);
  assert.match(tenor, /"registershare"/);
  assert.match(upload, /file\.size > 5 \* 1024 \* 1024/);
  assert.match(upload, /saveDyoorWorldImage/);
  assert.match(store, /limitInputPixels: MAX_INPUT_PIXELS/);
  assert.match(store, /\.webp\(\{ quality: 82/);
  assert.match(store, /MAX_UPLOADS_PER_WALLET = 40/);
  assert.match(envTemplate, /TENOR_API_KEY=CHANGE_ME/);
});

test("World mobile threads and atomic trade desk stay streamlined", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  const tradesRoute = fs.readFileSync("app/api/dyoor-world/trades/route.ts", "utf8");
  const server = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");

  assert.match(client, /id="world-mobile-threads"/);
  assert.match(client, /fixed inset-0 z-\[80\] lg:hidden/);
  assert.match(client, /hidden border-r .* lg:block/);
  assert.match(client, /function OwnedDroidPicker/);
  assert.match(client, /Choose the Droid you send/);
  assert.match(client, /Accept atomic swap/);
  assert.match(client, /BigInt\(trade\.monRequestedWei \|\| "0"\)/);
  assert.doesNotMatch(client, /tradeAcceptMon|tradeAcceptToken/);
  assert.match(tradesRoute, /getDyoorWorldTrade\(tradeId\)/);
  assert.match(server, /export async function getDyoorWorldTrade/);
  assert.match(server, /monRequestedWei: BigInt\(trade\.monRequested\)\.toString\(\)/);
  assert.match(server, /expired: expiresAt <= Math\.floor\(Date\.now\(\) \/ 1_000\)/);
});
