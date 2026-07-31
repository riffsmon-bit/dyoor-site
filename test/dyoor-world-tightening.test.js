import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("World message polling rejects stale channel responses and recovers expired sessions", () => {
  const client = read("components/dyoor-world/DyoorWorldClient.tsx");
  const directMessages = read(
    "components/dyoor-world/DyoorWorldDirectMessages.tsx",
  );
  const requestClient = read("lib/dyoor-world-client.ts");
  const messagesRoute = read("app/api/dyoor-world/messages/route.ts");

  assert.match(client, /messageRequestRef/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /DYOOR_WORLD_SESSION_EXPIRED_EVENT/);
  assert.match(client, /Connect holder wallet/);
  assert.match(directMessages, /conversationRequestRef/);
  assert.match(directMessages, /new AbortController\(\)/);
  assert.match(requestClient, /response\.status === 401/);
  assert.match(requestClient, /window\.dispatchEvent/);
  assert.match(messagesRoute, /assertDyoorWorldRateLimit/);
  assert.match(messagesRoute, /world-message-read/);
});

test("World GIF search is optional, holder-gated, rate-limited, and keeps its key server-side", () => {
  const route = read("app/api/dyoor-world/media/gifs/route.ts");
  const composer = read(
    "components/dyoor-world/DyoorWorldMediaComposer.tsx",
  );

  assert.match(route, /requireDyoorWorldRequest\(request\)/);
  assert.match(route, /assertDyoorWorldRateLimit/);
  assert.match(route, /KLIPY_API_KEY/);
  assert.match(route, /https:\/\/api\.klipy\.com\/v2\/search/);
  assert.match(route, /contentfilter", "medium"/);
  assert.match(route, /AbortSignal\.timeout/);
  assert.doesNotMatch(route, /apiKey[,}]\s*$/m);
  assert.match(composer, /Search KLIPY/);
  assert.match(composer, /Powered by KLIPY/);
});

test("World mobile shell is route-scoped, width-locked, and uses a compact composer", () => {
  const page = read("app/dyoor-world/page.tsx");
  const css = read("app/globals.css");
  const client = read("components/dyoor-world/DyoorWorldClient.tsx");

  assert.match(page, /maximumScale: 1/);
  assert.match(page, /userScalable: false/);
  assert.match(page, /interactiveWidget: "resizes-content"/);
  assert.match(page, /className="dyoor-world-app"/);
  assert.match(css, /body:has\(\.dyoor-world-app\)/);
  assert.match(css, /overscroll-behavior: none/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(client, /className="min-h-10 flex-1 resize-none/);
  assert.match(client, /rows=\{1\}/);
  assert.match(client, /className="btn-primary min-h-9/);
});

test("World operator setup and curated sticker upload paths are documented", () => {
  const envTemplate = read("dyoor-world.netlify.env.example");
  const envGuide = read("docs/DYOOR_WORLD_NETLIFY_ENV.md");
  const stickerGuide = read("public/dyoor-world/stickers/README.md");

  assert.match(envTemplate, /DYOOR_WORLD_SESSION_SECRET=/);
  assert.match(envTemplate, /DYOOR_WORLD_REWARDS_ENABLED=true/);
  assert.match(envTemplate, /ENERGY_BANK_OPERATOR_PRIVATE_KEY=/);
  assert.match(envTemplate, /KLIPY_API_KEY=/);
  assert.match(envGuide, /Do not use the owner\/deployer wallet/);
  assert.match(stickerGuide, /512 × 512 pixels/);
  assert.match(stickerGuide, /gm-droid\.webp/);
  assert.match(stickerGuide, /burn-verified\.webp/);
});

test("curated World sticker artwork is genuine, compact WebP", () => {
  for (const name of [
    "gm-droid.webp",
    "charged-up.webp",
    "diamond-droid.webp",
    "burn-verified.webp",
    "send-it.webp",
  ]) {
    const image = fs.readFileSync(`public/dyoor-world/stickers/${name}`);
    assert.equal(image.subarray(0, 4).toString("ascii"), "RIFF", name);
    assert.equal(image.subarray(8, 12).toString("ascii"), "WEBP", name);
    assert.ok(image.byteLength < 350 * 1024, `${name} exceeds 350 KB`);
  }
});
