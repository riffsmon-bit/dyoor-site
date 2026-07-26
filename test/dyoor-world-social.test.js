import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DYOOR_WORLD_CHANNELS,
  isWorldOwnerChannel,
  isWorldWritableChannel,
  normalizeDyoorWorldMessageReply,
  normalizeWorldMessageId,
  parseWorldMessageLink,
  worldChannelFromTag,
} from "../lib/dyoor-world.ts";
import {
  dyoorWorldSticker,
  normalizeDyoorWorldAttachment,
  normalizeDyoorWorldMediaUrl,
} from "../lib/dyoor-world-media.ts";
import {
  DYOOR_WORLD_CHAT_REWARD_DAILY_CAP,
  DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP,
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
  assert.equal(dyoorWorldDailyPrize(0), 10);
  assert.equal(dyoorWorldDailyPrize(44), 10);
  assert.equal(dyoorWorldDailyPrize(45), 25);
  assert.equal(dyoorWorldDailyPrize(69), 25);
  assert.equal(dyoorWorldDailyPrize(70), 50);
  assert.equal(dyoorWorldDailyPrize(86), 50);
  assert.equal(dyoorWorldDailyPrize(87), 100);
  assert.equal(dyoorWorldDailyPrize(94), 100);
  assert.equal(dyoorWorldDailyPrize(95), 250);
  assert.equal(dyoorWorldDailyPrize(97), 250);
  assert.equal(dyoorWorldDailyPrize(98), 500);
  assert.equal(dyoorWorldDailyPrize(99), 1_000);
  const allBuckets = Array.from({ length: 100 }, (_, sample) =>
    dyoorWorldDailyPrize(sample));
  assert.equal(Math.min(...allBuckets), 10);
  assert.equal(Math.max(...allBuckets), 1_000);
  assert.equal(allBuckets.filter((amount) => amount === 1_000).length, 1);
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
  assert.equal(DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP, 200);
  assert.equal(DYOOR_WORLD_CHAT_REWARD_DAILY_CAP, 40);
  assert.equal(DYOOR_WORLD_TIP_REWARD_ENERGY, 10);
  assert.equal(DYOOR_WORLD_TIP_REWARD_MIN_MON, "0.1");
  assert.equal(DYOOR_WORLD_TIP_REWARD_DAILY_CAP, 3);
  assert.equal(DYOOR_WORLD_TRADE_REWARD_ENERGY, 100);
  assert.equal(DYOOR_WORLD_TRADE_REWARD_DAILY_CAP, 1);
});

test("verified streams are bot-only while the trade desk remains conversational", () => {
  assert.equal(isWorldWritableChannel("announcements"), false);
  assert.equal(isWorldOwnerChannel("announcements"), true);
  assert.equal(isWorldOwnerChannel("world-lobby"), false);
  assert.equal(isWorldWritableChannel("sales-feed"), false);
  assert.equal(isWorldWritableChannel("tip-ledger"), false);
  assert.equal(isWorldWritableChannel("burn-log"), false);
  assert.equal(isWorldWritableChannel("trade-desk"), true);
  assert.equal(DYOOR_WORLD_CHANNELS.some((channel) => channel.id === "sales-feed"), true);
  assert.equal(DYOOR_WORLD_CHANNELS.some((channel) => channel.id === "trade-desk"), true);
});

test("owner announcements are server-authorized, non-rewarding, and support safe links", () => {
  assert.deepEqual(
    parseWorldMessageLink("https://x.com/dyoor_/status/123456789."),
    {
      href: "https://x.com/dyoor_/status/123456789",
      label: "https://x.com/dyoor_/status/123456789",
      trailing: ".",
    },
  );
  assert.equal(parseWorldMessageLink("http://x.com/dyoor_"), null);
  assert.equal(parseWorldMessageLink("javascript:alert(1)"), null);
  assert.equal(parseWorldMessageLink("https://user:password@example.com/post"), null);

  const server = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  const profileRoute = fs.readFileSync("app/api/dyoor-world/profile/route.ts", "utf8");

  assert.match(server, /canPostDyoorWorldAnnouncements\(wallet\)/);
  assert.match(server, /Only the D\.Y\.O\.O\.R owner wallet can post announcements/);
  assert.match(server, /kind: ownerChannel \? "announcement" : "user"/);
  assert.match(server, /ownerChannel\s*\?\s*Promise\.resolve\(null\)/);
  assert.match(server, /DYOOR_WORLD_OWNER_WALLET/);
  assert.match(server, /new ethers\.Contract\(dyoorS2Contract, OWNABLE_ABI/);
  assert.match(profileRoute, /dyoorWorldConfigForWallet\(wallet\)/);
  assert.match(client, /canPostAnnouncements: boolean/);
  assert.match(client, /selectedChannelCanPost/);
  assert.match(client, /HTTPS links become clickable/);
  assert.match(client, /rel="noopener noreferrer"/);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML/);
  assert.equal(
    fs.existsSync("app/api/dyoor-world/automation/x/route.ts"),
    false,
  );
});

test("World thread tags resolve only known channels", () => {
  assert.equal(worldChannelFromTag("#world-lobby"), "world-lobby");
  assert.equal(worldChannelFromTag("TRAIT-LAB"), "trait-lab");
  assert.equal(worldChannelFromTag("#not-a-world-thread"), null);
});

test("World reply snapshots require safe IDs and server-shaped context", () => {
  const messageId = "1753480000000-123e4567-e89b-42d3-a456-426614174000";
  assert.equal(normalizeWorldMessageId(messageId), messageId);
  assert.equal(normalizeWorldMessageId("../../names/claims/admin"), "");
  assert.equal(normalizeWorldMessageId("message..json"), "");
  assert.deepEqual(normalizeDyoorWorldMessageReply({
    messageId,
    wallet: "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A",
    author: "riffs.dYOOR",
    content: "Check the #trait-lab thread.",
    attachmentKind: "image",
  }), {
    messageId,
    wallet: "0x349d8eb480c92cf75371fba5c6344a4d11b9103a",
    author: "riffs.dYOOR",
    content: "Check the #trait-lab thread.",
    attachmentKind: "image",
  });
  assert.equal(normalizeDyoorWorldMessageReply({
    messageId,
    wallet: "not-a-wallet",
    author: "forged",
    content: "forged quote",
  }), null);
});

test("World social APIs remain holder-gated and financial relays verify chain receipts", () => {
  for (const file of [
    "app/api/dyoor-world/media/[wallet]/[mediaId]/route.ts",
    "app/api/dyoor-world/media/upload/route.ts",
    "app/api/dyoor-world/direct-messages/route.ts",
    "app/api/dyoor-world/profile/route.ts",
    "app/api/dyoor-world/push/route.ts",
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
  assert.match(server, /DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP/);
  assert.match(server, /chatEnergyToday \+ DYOOR_WORLD_CHAT_REWARD_ENERGY/);
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

test("World image uploads are holder-only, bounded, and sanitized", () => {
  const client = fs.readFileSync(
    "components/dyoor-world/DyoorWorldMediaComposer.tsx",
    "utf8",
  );
  const upload = fs.readFileSync(
    "app/api/dyoor-world/media/upload/route.ts",
    "utf8",
  );
  const store = fs.readFileSync("lib/dyoor-world-media-store.ts", "utf8");
  assert.match(client, /Upload image/);
  assert.match(client, /World stickers/);
  assert.doesNotMatch(client, /Tenor|Search GIFs/);
  assert.equal(fs.existsSync("app/api/dyoor-world/media/tenor/route.ts"), false);
  assert.match(upload, /file\.size > 5 \* 1024 \* 1024/);
  assert.match(upload, /saveDyoorWorldImage/);
  assert.match(store, /limitInputPixels: MAX_INPUT_PIXELS/);
  assert.match(store, /\.webp\(\{ quality: 82/);
  assert.match(store, /MAX_UPLOADS_PER_WALLET = 40/);
});

test("World mobile side drawers and atomic trade desk stay streamlined", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  const gate = fs.readFileSync("components/dyoor-world/DyoorWorldGate.tsx", "utf8");
  const siteNav = fs.readFileSync("components/layout/SiteNav.tsx", "utf8");
  const siteFooter = fs.readFileSync("components/footer/SiteFooter.tsx", "utf8");
  const tradesRoute = fs.readFileSync("app/api/dyoor-world/trades/route.ts", "utf8");
  const server = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");

  assert.match(client, /id="world-mobile-threads"/);
  assert.match(client, /id="world-mobile-identity"/);
  assert.match(client, /fixed inset-0 z-\[100\] lg:hidden/);
  assert.match(client, /fixed inset-y-0 right-0 z-\[110\]/);
  assert.match(client, /setMobileIdentityOpen\(true\)/);
  assert.match(client, /Identity \+ Energy/);
  assert.match(client, /world-channel-context hidden .* sm:block/);
  assert.match(client, /Current thread: \$\{selectedChannel\.label\}/);
  assert.match(client, /sticky top-0 z-\[90\]/);
  assert.match(client, /h-\[calc\(100dvh-4rem\)\]/);
  assert.match(client, /Eject from dYOOR World to the main D\.Y\.O\.O\.R site/);
  assert.match(gate, /Standalone holder app/);
  assert.match(gate, /↗ Eject/);
  assert.match(siteNav, /if \(isWorldApp\) return null/);
  assert.match(siteFooter, /pathname\.startsWith\(\"\/dyoor-world\"\)/);
  assert.match(client, /hidden border-r .* lg:block/);
  assert.match(client, /function OwnedDroidPicker/);
  assert.match(client, /Choose the Droid you send/);
  assert.match(client, /Accept atomic swap/);
  assert.match(client, /BigInt\(trade\.monRequestedWei \|\| "0"\)/);
  assert.match(client, /channelId === "trade-desk"\s*\?\s*"h-auto min-h-0"/);
  assert.match(client, /min-w-0 max-w-full overflow-hidden border-b/);
  assert.match(client, /snap-x snap-mandatory/);
  assert.match(client, /min-\[380px\]:grid-cols-2/);
  assert.doesNotMatch(client, /tradeAcceptMon|tradeAcceptToken/);
  assert.match(tradesRoute, /getDyoorWorldTrade\(tradeId\)/);
  assert.match(server, /export async function getDyoorWorldTrade/);
  assert.match(server, /monRequestedWei: BigInt\(trade\.monRequested\)\.toString\(\)/);
  assert.match(server, /expired: expiresAt <= Math\.floor\(Date\.now\(\) \/ 1_000\)/);
});

test("World trades skip redundant approvals and preflight every wallet transaction", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");

  assert.match(client, /function readableWorldTradeError/);
  assert.match(client, /method: "eth_call"/);
  assert.match(client, /functionName: "getApproved"/);
  assert.match(client, /if \(normalizeAddress\(approved\) === normalizeAddress\(escrow\)\) return/);
  assert.match(client, /await preflightWorldTrade\(request\)/);
  assert.match(client, /Season 2 transfer security has not authorized this escrow route/);
});

test("trade validator setup preserves level 3 and copies the active OpenSea list", () => {
  const script = fs.readFileSync(
    "scripts/configure-dyoor-world-trade-validator.js",
    "utf8",
  );

  assert.match(script, /EXPECTED_SECURITY_LEVEL = 3/);
  assert.match(script, /createListCopy\("DYOOR World \+ OpenSea"/);
  assert.match(script, /addAccountsToWhitelist\(targetListId, \[escrowAddress\]\)/);
  assert.match(script, /applyListToCollection\(collection, targetListId\)/);
  assert.match(script, /copied list does not preserve the active OpenSea entries/);
  assert.match(script, /Production escrow simulation passed/);
  assert.match(script, /EXECUTE_DYOOR_WORLD_TRADE_VALIDATOR === "1"/);
});

test("World chat uses directional motion bubbles and contained smooth scrolling", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  const styles = fs.readFileSync("app/globals.css", "utf8");

  assert.match(client, /world-message-stream/);
  assert.match(client, /world-message-own/);
  assert.match(client, /world-message-peer/);
  assert.match(client, /world-message-system/);
  assert.match(client, /messageList\.scrollTo/);
  assert.match(styles, /@keyframes world-message-arrive-left/);
  assert.match(styles, /@keyframes world-message-arrive-right/);
  assert.match(styles, /world-message-signal-scan/);
  assert.match(styles, /scrollbar-color/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("World chat supports verified replies, thread tags, and smart latest-message navigation", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  const route = fs.readFileSync("app/api/dyoor-world/messages/route.ts", "utf8");
  const server = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");

  assert.match(route, /replyToMessageId: body\?\.replyToMessageId/);
  assert.match(server, /version: 4/);
  assert.match(server, /normalizeWorldMessageId\(rawReplyToMessageId\)/);
  assert.match(server, /That message is no longer available in this World thread/);
  assert.match(server, /normalizeDyoorWorldMessageReply/);
  assert.match(client, /Replying to \{replyingTo\.author\}/);
  assert.match(client, /replyToMessageId: replyingTo\?\.id/);
  assert.match(client, /role="listbox"/);
  assert.match(client, /type # to tag a thread/);
  assert.match(client, /WorldMessageContent/);
  assert.match(client, /new message\$\{newMessageCount === 1 \? "" : "s"\} ↓/);
  assert.match(client, /Jump to latest ↓/);
  assert.match(client, /distanceFromBottom <= 96/);
});

test("another holder's username opens the direct MON tip flow", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");

  assert.match(client, /aria-label=\{`Tip \$\{message\.author\} in MON`\}/);
  assert.match(client, /isSystem \|\| isOwn/);
  assert.match(client, /ref=\{tipAmountRef\}/);
  assert.match(client, /void sendTip\(\)/);
  assert.doesNotMatch(client, />\s*Tip MON\s*</);
});

test("desktop Enter sends World messages while Shift+Enter keeps a newline", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");

  assert.match(client, /window\.matchMedia\("\(min-width: 768px\)"\)\.matches/);
  assert.match(client, /event\.nativeEvent\.isComposing/);
  assert.match(client, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(client, /Enter sends · Shift\+Enter newline/);
});

test("World wheel UI exposes the full reward range and polished spin treatment", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  const styles = fs.readFileSync("app/globals.css", "utf8");

  assert.match(client, /WORLD_WHEEL_PRIZES = \[10, 25, 50, 100, 250, 500, 1_000\]/);
  assert.match(client, /1% jackpot/);
  assert.match(client, /Every spin awards at least 10/);
  assert.match(client, /200 Energy daily cap/);
  assert.match(styles, /world-energy-wheel-disc/);
  assert.match(styles, /@keyframes world-energy-wheel-spin/);
  assert.match(styles, /world-energy-wheel-aura/);
});

test("the website links to the canonical D.Y.O.O.R OpenSea collection", () => {
  for (const file of [
    "app/page.tsx",
    "components/footer/SiteFooter.tsx",
    "index.html",
  ]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /https:\/\/opensea\.io\/collection\/d-y-o-o-r/);
    assert.doesNotMatch(source, /https:\/\/opensea\.io\/collection\/dyoor-154958357/);
  }
});

test("the whitepaper positions dYOOR World as the holder home and social apps as onboarding", () => {
  const whitepaper = fs.readFileSync("app/whitepaper/page.tsx", "utf8");
  const gate = fs.readFileSync("components/dyoor-world/DyoorWorldGate.tsx", "utf8");
  const footer = fs.readFileSync("components/footer/SiteFooter.tsx", "utf8");

  assert.match(whitepaper, /id="dyoor-world"/);
  assert.match(whitepaper, /Holder-Exclusive Community Layer/);
  assert.match(whitepaper, /owner-only announcements stream/);
  assert.match(whitepaper, /Discord \+ Telegram/);
  assert.match(whitepaper, /Public onboarding/);
  assert.match(gate, /holder-exclusive community layer/);
  assert.match(gate, /Discord and Telegram remain the public onboarding path/);
  assert.match(footer, /Discord Onboarding/);
  assert.match(footer, /Telegram Onboarding/);
});
