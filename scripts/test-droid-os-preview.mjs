// Run after starting the loopback UI harness and an isolated Chrome CDP on 9224.
// Exercises presentation only. Hosted app providers may initialize public auth/telemetry.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const tabs = await (await fetch("http://127.0.0.1:9224/json/list")).json();
const tab = tabs.find((item) => item.type === "page");
assert.ok(tab, "Start isolated Chrome CDP on port 9224 first");
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let sequence = 0;
const pending = new Map();
const exceptions = [];
const apiCalls = [];
const providerBootstrap = [];
const reviewUrl = process.env.DROID_OS_REVIEW_URL || "http://localhost:3202/droid-os";
assert.match(new URL(reviewUrl).hostname, /^(localhost|127\.0\.0\.1|deploy-preview-\d+--dyoor\.netlify\.app)$/);
socket.addEventListener("message", ({ data }) => {
  const item = JSON.parse(data);
  if (item.id) {
    const task = pending.get(item.id); if (!task) return;
    clearTimeout(task.timer); pending.delete(item.id);
    if (item.error) task.reject(Error(item.error.message)); else task.resolve(item.result);
  } else if (item.method === "Runtime.exceptionThrown") exceptions.push(item.params.exceptionDetails.text);
  else if (item.method === "Network.requestWillBeSent" && /\/api\//.test(item.params.request.url)) {
    const request = item.params.request;
    const url = new URL(request.url);
    const bootstrap =
      (url.origin === "https://auth.privy.io" && request.method === "GET" && /^\/api\/v1\/apps\/[^/]+$/.test(url.pathname)) ||
      (url.origin === "https://auth.privy.io" && request.method === "POST" && url.pathname === "/api/v1/analytics_events") ||
      (url.origin === "https://csp-report.browser-intake-datadoghq.com" && request.method === "POST" && url.pathname === "/api/v2/logs");
    (bootstrap ? providerBootstrap : apiCalls).push(`${request.method} ${url.origin}${url.pathname}`);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let index = 0; index < 100; index += 1) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`UI condition failed: ${expression}`);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function screenshot(name) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const destination = `/private/tmp/${name}.png`;
  await fs.writeFile(destination, Buffer.from(shot.data, "base64")); console.log(destination);
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: reviewUrl });
  await until('document.querySelector(".os-hero-image")?.naturalWidth > 0');
  await until('[...document.querySelectorAll(".os-roster img")].every(image => image.complete && image.naturalWidth > 0)');
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("droid-os-review-desktop");
  assert.equal(await evaluate('document.querySelector("#os-chat-input").placeholder'), "Talk to D.Y.O.O.R #11…");
  await click('[aria-label="Select D.Y.O.O.R #16"]');
  await until('document.querySelector("#os-chat-input")?.placeholder === "Talk to D.Y.O.O.R #16…"');
  await click(".os-prompt-list button:last-child");
  await until('document.querySelector(".os-chat-log")?.textContent.includes("SCRIPTED PREVIEW")');
  assert.match(await evaluate('document.querySelector(".os-chat-log").textContent'), /ASK mode/);
  await click('.os-rail [aria-label="Strategy"]');
  await until('document.querySelector("#os-reserve") !== null');
  await click(".os-detail-panel > .os-button-primary");
  await until('document.querySelector(".os-inline-notice")?.textContent.includes("No policy was saved")');
  await screenshot("droid-os-review-strategy");
  await click(".os-wallet-actions .os-button-primary");
  await until('document.querySelector("dialog")?.open === true');
  assert.match(await evaluate('document.querySelector("dialog").textContent'), /No wallet is connected/);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until('document.querySelector("dialog") === null');
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: reviewUrl });
  await until('document.querySelector(".os-hero-image")?.naturalWidth > 0');
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("droid-os-review-mobile");
  await click(".os-mobile-nav button:nth-child(2)");
  await until('document.querySelector(".os-mobile-workspace") !== null && document.querySelector(".os-mobile-nav button:nth-child(2)").getAttribute("aria-current") === "page"');
  await screenshot("droid-os-review-mobile-talk");
  await evaluate('const select = document.querySelector(".os-mobile-more select"); select.value="Missions";select.dispatchEvent(new Event("change",{bubbles:true}));');
  await until('document.querySelector("#os-mission") !== null');
  await evaluate('const input=document.querySelector("#os-mission");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Research a Monad NFT project");input.dispatchEvent(new Event("input",{bubbles:true}));');
  await until('document.querySelector(".os-mission-form button").disabled === false');
  await click(".os-mission-form button");
  await until('document.querySelector(".os-mission-list")?.textContent.includes("DRAFT · NOT RUN")');
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("droid-os-review-mobile-mission");
  for (const [width, height, label] of [[768, 1024, "tablet"], [1280, 800, "laptop"]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: reviewUrl });
    await until('document.querySelector(".os-hero-image")?.naturalWidth > 0');
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    await screenshot(`droid-os-review-${label}`);
  }
  assert.deepEqual(exceptions, []); assert.deepEqual(apiCalls, []);
  console.log("PASS: roster, scripted chat, strategy draft, modal Escape, mobile navigation, local mission draft, no overflow, no runtime errors, no application or unexpected API calls.");
  console.log("Existing public provider bootstrap/telemetry requests:", providerBootstrap.length);
} finally { socket.close(); }
