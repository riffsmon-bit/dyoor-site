"use strict";

const WORLD_HOME = "/dyoor-world";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "dYOOR World",
      body: event.data ? event.data.text() : "A new holder signal is waiting.",
    };
  }

  const title = String(payload.title || "dYOOR World").slice(0, 80);
  const body = String(payload.body || "A new holder signal is waiting.").slice(0, 240);
  const tag = String(payload.tag || "dyoor-world-signal").slice(0, 80);
  const url = /^\/dyoor-world(?:[/?#]|$)/.test(String(payload.url || ""))
    ? String(payload.url)
    : WORLD_HOME;

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/dyoor-world-icon.svg",
    badge: "/dyoor-world-icon.svg",
    tag,
    renotify: true,
    timestamp: Date.parse(payload.createdAt || "") || Date.now(),
    data: {
      url,
      category: String(payload.category || ""),
    },
    actions: [
      {
        action: "open-world",
        title: "Open dYOOR World",
      },
    ],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action && event.action !== "open-world") return;

  const relativeUrl = /^\/dyoor-world(?:[/?#]|$)/.test(
    String(event.notification.data?.url || ""),
  )
    ? String(event.notification.data.url)
    : WORLD_HOME;
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client) await client.navigate(targetUrl);
      await client.focus();
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
