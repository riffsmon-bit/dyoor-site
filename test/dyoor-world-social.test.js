import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DYOOR_WORLD_CHANNELS,
  isWorldWritableChannel,
} from "../lib/dyoor-world.ts";
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
