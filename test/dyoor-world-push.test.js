import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
  normalizeDyoorWorldPushPreferences,
} from "../lib/dyoor-world-push.ts";

test("World push preferences default to useful private alerts without noisy feeds", () => {
  assert.deepEqual(normalizeDyoorWorldPushPreferences(null), {
    announcements: true,
    replies: true,
    directMessages: true,
    tips: true,
    trades: true,
    chat: false,
    sales: false,
    burns: false,
    previews: false,
  });
  assert.equal(DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES.previews, false);
  assert.deepEqual(normalizeDyoorWorldPushPreferences({
    chat: true,
    sales: true,
    previews: true,
    ignored: true,
  }), {
    announcements: true,
    replies: true,
    directMessages: true,
    tips: true,
    trades: true,
    chat: true,
    sales: true,
    burns: false,
    previews: true,
  });
});

test("push subscriptions are holder-gated, bounded, and restricted to browser services", () => {
  const route = fs.readFileSync("app/api/dyoor-world/push/route.ts", "utf8");
  const server = fs.readFileSync("lib/dyoor-world-push-server.ts", "utf8");
  const component = fs.readFileSync(
    "components/dyoor-world/DyoorWorldNotifications.tsx",
    "utf8",
  );

  assert.match(route, /requireDyoorWorldRequest/);
  assert.match(route, /action === "subscribe"/);
  assert.match(route, /action === "test"/);
  assert.match(server, /MAX_SUBSCRIPTIONS_PER_WALLET = 5/);
  assert.match(server, /TRUSTED_PUSH_HOST_SUFFIXES/);
  assert.match(server, /\.push\.apple\.com/);
  assert.match(server, /\.googleapis\.com/);
  assert.match(server, /isIP\(hostname\) !== 0/);
  assert.match(server, /HOLDER_RECHECK_MS/);
  assert.doesNotMatch(component, /DYOOR_WORLD_VAPID_PRIVATE_KEY/);
  assert.match(component, /Lock-screen previews/);
  assert.match(component, /Off by default for holder privacy/);
});

test("World notifications use a durable outbox and a non-caching PWA worker", () => {
  const server = fs.readFileSync("lib/dyoor-world-push-server.ts", "utf8");
  const worker = fs.readFileSync("public/dyoor-world-sw.js", "utf8");
  const automation = fs.readFileSync(
    "app/api/dyoor-world/automation/push/route.ts",
    "utf8",
  );
  const scheduled = fs.readFileSync(
    "netlify/functions/dyoor-world-push.js",
    "utf8",
  );
  const manifest = fs.readFileSync("app/manifest.ts", "utf8");

  assert.match(server, /push\/outbox\//);
  assert.match(server, /lockedUntil/);
  assert.match(server, /processDyoorWorldPushOutbox/);
  assert.match(automation, /requireDyoorWorldAutomationRequest/);
  assert.match(scheduled, /schedule: "\* \* \* \* \*"/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /event\.waitUntil\(self\.skipWaiting\(\)\)/);
  assert.doesNotMatch(worker, /addEventListener\("fetch"/);
  assert.match(manifest, /start_url: "\/dyoor-world"/);
  assert.match(manifest, /display: "standalone"/);
});

test("World alert registration reuses the active worker and retries browser update races", () => {
  const component = fs.readFileSync(
    "components/dyoor-world/DyoorWorldNotifications.tsx",
    "utf8",
  );
  const netlify = fs.readFileSync("netlify.toml", "utf8");

  assert.match(component, /getRegistration\(\s*WORLD_WORKER_SCOPE/);
  assert.match(component, /registrationUsesWorldWorker/);
  assert.match(component, /updateViaCache:\s*"none"/);
  assert.match(component, /caught\.name !== "AbortError"/);
  assert.match(component, /workerRegistrationRef/);
  assert.match(component, /window\.addEventListener\("load", start/);
  assert.match(netlify, /for = "\/dyoor-world-sw\.js"/);
  assert.match(netlify, /Service-Worker-Allowed = "\/"/);
});

test("direct messages are participant-only and create private push jobs", () => {
  const route = fs.readFileSync(
    "app/api/dyoor-world/direct-messages/route.ts",
    "utf8",
  );
  const server = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");
  const client = fs.readFileSync(
    "components/dyoor-world/DyoorWorldDirectMessages.tsx",
    "utf8",
  );
  const worldClient = fs.readFileSync(
    "components/dyoor-world/DyoorWorldClient.tsx",
    "utf8",
  );

  assert.match(route, /requireDyoorWorldRequest/);
  assert.match(route, /listDyoorWorldDirectMessages\(\{ wallet, otherWallet \}\)/);
  assert.match(
    server,
    /function directConversationId\(leftWallet: string, rightWallet: string\)/,
  );
  assert.match(server, /\[leftWallet, rightWallet\]\.sort\(\)\.join\(":"\)/);
  assert.match(server, /Direct messages can only be sent to a current S2 holder/);
  assert.match(server, /category: "directMessages"/);
  assert.match(server, /targetWallets: \[recipient\]/);
  assert.match(client, /not end-to-end encrypted/i);
  assert.match(client, /\/api\/dyoor-world\/direct-messages/);
  assert.match(worldClient, /Direct message \$\{message\.author\}/);
  assert.doesNotMatch(server, /createDyoorWorldChatReward\(wallet, message\).*direct/i);
});

test("retired Verify and Checker pages leave navigation and redirect safely", () => {
  const navigation = fs.readFileSync("components/layout/SiteNav.tsx", "utf8");
  const redirects = fs.readFileSync("next.config.mjs", "utf8");
  const home = fs.readFileSync("app/page.tsx", "utf8");
  const whitepaper = fs.readFileSync("app/whitepaper/page.tsx", "utf8");

  assert.equal(fs.existsSync("app/verify/page.tsx"), false);
  assert.equal(fs.existsSync("app/blueprint-checker/page.tsx"), false);
  assert.doesNotMatch(navigation, /href: "\/verify"|href: "\/blueprint-checker"/);
  assert.doesNotMatch(home, /href="\/verify"|href="\/blueprint-checker"/);
  assert.doesNotMatch(whitepaper, /href="\/verify"|href="\/blueprint-checker"/);
  assert.match(redirects, /source: "\/verify", destination: "\/"/);
  assert.match(redirects, /source: "\/blueprint-checker", destination: "\/"/);
});
