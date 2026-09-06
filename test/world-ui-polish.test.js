import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { worldChannelPresentation } from "../lib/world-channel-presentation.ts";

test("World room presentation names existing IDs without altering access or routing", () => {
  assert.equal(worldChannelPresentation("world-lobby").title, "The commons");
  assert.equal(worldChannelPresentation("season-1").group, "Holder rooms");
  assert.equal(worldChannelPresentation("sales-feed").group, "On-chain activity");
  assert.equal(worldChannelPresentation("unknown-room").title, "unknown room");
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  assert.match(client, /config\.channels\.filter/);
  assert.match(client, /channels\.filter\(\(channel\) => worldChannelPresentation/);
  assert.match(client, /onClick=\{\(\) => onSelect\(channel\.id\)\}/);
  assert.match(client, /aria-current=\{active \? "page" : undefined\}/);
});

test("World mobile dialogs contain keyboard focus and restore the trigger", () => {
  const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
  assert.match(client, /event\.key === "Tab"/);
  assert.match(client, /panel\?\.contains\(document\.activeElement\)/);
  assert.match(client, /returnFocus\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(client, /desktop\.removeEventListener\("change", closeOnDesktop\)/);
  assert.match(client, /aria-modal=\{mobileIdentityOpen \? true : undefined\}/);
});

test("World presentation respects zoom, motion preferences, and unchanged reward proportions", () => {
  const page = fs.readFileSync("app/dyoor-world/page.tsx", "utf8");
  const css = fs.readFileSync("app/dyoor-world/world.css", "utf8");
  assert.doesNotMatch(page, /userScalable: false|maximumScale: 1/);
  assert.match(page, /authenticateDyoorWorldToken\(token\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /world-workspace \.world-sidepanel \{ overflow-y: auto/);
  assert.match(css, /98% 99%, #fff0aa 99% 100%/);
  assert.match(css, /world-mobile-panel-trigger \{ min-height: 44px/);
});

test("World uses the main site's charcoal, cyan, and purple palette", () => {
  const css = fs.readFileSync("app/dyoor-world/world.css", "utf8");
  const page = fs.readFileSync("app/dyoor-world/page.tsx", "utf8");
  assert.match(css, /--world-bg: #07070b/);
  assert.match(css, /--world-ink: #f4f3f7/);
  assert.match(css, /--world-accent: #39ffe2/);
  assert.match(css, /#836ef9/);
  assert.doesNotMatch(css, /#bce9ce|#101514|#253529/);
  assert.match(page, /themeColor: "#07070b"/);
});

test("World entrance retains holder signatures and makes no new auth bypass", () => {
  const gate = fs.readFileSync("components/dyoor-world/DyoorWorldGate.tsx", "utf8");
  assert.match(gate, /wallet\.signMessage/);
  assert.match(gate, /Boolean\(address && eligible !== true\)/);
  assert.match(gate, /\/api\/dyoor-world\/challenge/);
  assert.match(gate, /\/api\/dyoor-world\/session/);
  assert.match(gate, /no transaction approval, and no network switch/);
});
