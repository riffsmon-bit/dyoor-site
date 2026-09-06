import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { OS_VIEWS, PREVIEW_DROIDS, droidDisplayName, previewReply } from "../lib/droid-os/preview.ts";
import { droidOsPreviewEnabled } from "../lib/droid-os/preview-config.mjs";

test("preview builds cannot enable the Droid OS demo on production or branch deployments", () => {
  assert.equal(droidOsPreviewEnabled({}), false);
  assert.equal(droidOsPreviewEnabled({ DROID_OS_UI_PREVIEW: "true", CONTEXT: "deploy-preview" }), true);
  assert.equal(droidOsPreviewEnabled({ DROID_OS_UI_PREVIEW: "true" }), true);
  for (const context of ["production", "branch-deploy", "unknown"]) {
    assert.equal(droidOsPreviewEnabled({ DROID_OS_UI_PREVIEW: "true", CONTEXT: context }), false);
  }
});

test("canonical token label replaces fictional nicknames in chat and selection", () => {
  for (const droid of PREVIEW_DROIDS) assert.equal(droidDisplayName(droid), `D.Y.O.O.R #${droid.id}`);
  assert.match(previewReply("hello", PREVIEW_DROIDS[0]), /I’m D\.Y\.O\.O\.R #11/);
  const chat = fs.readFileSync("components/droid-os/DroidTalk.tsx", "utf8");
  assert.match(chat, /placeholder=\{`Talk to \$\{displayName\}…`\}/);
  assert.doesNotMatch(chat, /Atlas|Pulse|Nova|Echo|droid\.name/);
});

test("Droid OS review data is explicitly fictional and uses distinct sample identities", () => {
  assert.equal(new Set(PREVIEW_DROIDS.map((droid) => droid.id)).size, 4);
  for (const droid of PREVIEW_DROIDS) {
    assert.match(droid.id, /^\d+$/);
    assert.ok(droid.interests.length);
    const image = fs.readFileSync(`public/droid-os/droid-${droid.id}.png`);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
});

test("scripted financial requests never claim a quote, simulation or execution", () => {
  for (const action of ["buy", "sell", "swap", "withdraw", "mint", "snipe", "send"]) {
    const result = previewReply(`${action} now`, PREVIEW_DROIDS[0]);
    assert.match(result, /haven’t moved anything/);
    assert.match(result, /no wallet connection, live quote, simulation, or execution/);
  }
});

test("preview conversations label research and balances as demonstrations", () => {
  assert.match(previewReply("portfolio", PREVIEW_DROIDS[1]), /demonstration amounts/);
  assert.match(previewReply("what is new", PREVIEW_DROIDS[1]), /scripted for the design review/);
  assert.match(previewReply("rules", PREVIEW_DROIDS[0]), /only your explicit permissions/);
});

test("review route is opt-in and components have no wallet, provider or API execution imports", () => {
  const page = fs.readFileSync("app/droid-os/page.tsx", "utf8");
  assert.match(page, /process\.env\.DROID_OS_UI_PREVIEW !== "true"\) notFound\(\)/);
  const source = fs.readdirSync("components/droid-os").filter((name) => name.endsWith(".tsx")).map((name) => fs.readFileSync(`components/droid-os/${name}`, "utf8")).join("\n");
  assert.doesNotMatch(source, /useWalletService|usePrivy|sendTransaction|writeContract|signMessage|eth_sendTransaction|fetch\(/);
  assert.match(source, /Sample roster & balances/);
  assert.match(source, /SCRIPTED PREVIEW/);
});

test("mobile exposes every section and uses native modal focus boundaries", () => {
  const source = fs.readFileSync("components/droid-os/DroidOsPreview.tsx", "utf8");
  assert.match(source, /More Droid sections/);
  assert.match(source, /OS_VIEWS\.filter/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /onCancel=\{close\}/);
  for (const name of ["Talk", "Portfolio", "Strategy", "Missions", "Opportunities", "Activity", "Achievements", "Energy", "Trait Lab", "Settings"]) assert.ok(OS_VIEWS.includes(name));
  const css = fs.readFileSync("app/droid-os/droid-os.css", "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("local harness is loopback-only and permits only public artwork reads", () => {
  const server = fs.readFileSync("scripts/preview-droid-os-ui.mjs", "utf8");
  assert.match(server, /connect-src 'self'/);
  assert.match(server, /ARTWORK_TOKEN_IDS.includes\(id\)/);
  assert.match(server, /readLiveArtwork\(id\)/);
  assert.match(server, /request\.method !== "GET"/);
  assert.match(server, /server\.listen\(port, "127\.0\.0\.1"/);
  assert.doesNotMatch(server.replace('"process.env.NODE_ENV"', ""), /dotenv|privateKey|process\.env/);
});
