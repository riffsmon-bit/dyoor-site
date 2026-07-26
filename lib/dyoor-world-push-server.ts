import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import webpush from "web-push";
import {
  DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
  DYOOR_WORLD_PUSH_CATEGORIES,
  normalizeDyoorWorldPushPreferences,
  type DyoorWorldPushCategory,
  type DyoorWorldPushPreferences,
} from "@/lib/dyoor-world-push";
import {
  isWorldChannel,
  normalizeWorldWallet,
  type DyoorWorldChannelId,
} from "@/lib/dyoor-world";
import { createJsonStore } from "@/src/lib/storage/fileStore";

const pushStore = createJsonStore("dyoor-world");
const MAX_SUBSCRIPTIONS_PER_WALLET = 5;
const HOLDER_RECHECK_MS = 24 * 60 * 60 * 1_000;
const OUTBOX_LOCK_MS = 2 * 60 * 1_000;
const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const OUTBOX_BATCH_SIZE = 25;
const TRUSTED_PUSH_HOST_SUFFIXES = [
  ".googleapis.com",
  ".google.com",
  ".mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
];

type BrowserPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type StoredPushSubscription = BrowserPushSubscription & {
  version: 1;
  id: string;
  wallet: string;
  preferences: DyoorWorldPushPreferences;
  createdAt: string;
  updatedAt: string;
  holderVerifiedAt: string;
  userAgent: string;
};

type PushOutboxJob = {
  version: 1;
  id: string;
  category: DyoorWorldPushCategory;
  title: string;
  body: string;
  privateBody: string;
  channelId: DyoorWorldChannelId;
  url: string;
  tag: string;
  targetWallets?: string[];
  excludedWallets: string[];
  createdAt: string;
  attempts: number;
  lockedUntil?: string;
  lastError?: string;
};

type PushDelivery = {
  sent: number;
  skipped: number;
  removed: number;
  failed: number;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function envFlag(...names: string[]) {
  return /^(1|true|yes|on)$/i.test(readEnv(...names));
}

function vapidConfig() {
  const publicKey = readEnv("DYOOR_WORLD_VAPID_PUBLIC_KEY");
  const privateKey = readEnv("DYOOR_WORLD_VAPID_PRIVATE_KEY");
  const subject = readEnv("DYOOR_WORLD_VAPID_SUBJECT") || "https://dyoor.netlify.app";
  const enabled = envFlag("DYOOR_WORLD_PUSH_ENABLED");
  const configured = Boolean(
    enabled
      && /^[A-Za-z0-9_-]{80,100}$/.test(publicKey)
      && /^[A-Za-z0-9_-]{40,60}$/.test(privateKey)
      && /^(mailto:|https:\/\/)/i.test(subject),
  );
  return { configured, enabled, privateKey, publicKey, subject };
}

export function dyoorWorldPushPublicConfig() {
  const config = vapidConfig();
  return {
    enabled: config.configured,
    publicKey: config.configured ? config.publicKey : "",
  };
}

function subscriptionPrefix(wallet?: string) {
  return `push/subscriptions/${wallet ? `${wallet}/` : ""}`;
}

function outboxPrefix() {
  return "push/outbox/";
}

function subscriptionId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

function subscriptionKey(wallet: string, endpoint: string) {
  return `${subscriptionPrefix(wallet)}${subscriptionId(endpoint)}.json`;
}

function outboxKey(id: string) {
  return `${outboxPrefix()}${id}.json`;
}

function normalizePushEndpoint(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2_048) return "";
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const trustedPushService = TRUSTED_PUSH_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    );
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !hostname
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || isIP(hostname) !== 0
      || !trustedPushService
    ) {
      return "";
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeSubscriptionKey(value: unknown, minimumLength: number) {
  const key = String(value || "").trim();
  return key.length >= minimumLength
    && key.length <= 256
    && /^[A-Za-z0-9_-]+$/.test(key)
    ? key
    : "";
}

function normalizeBrowserSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = input.keys && typeof input.keys === "object" && !Array.isArray(input.keys)
    ? input.keys as Record<string, unknown>
    : {};
  const endpoint = normalizePushEndpoint(input.endpoint);
  const p256dh = normalizeSubscriptionKey(keys.p256dh, 64);
  const auth = normalizeSubscriptionKey(keys.auth, 16);
  const expirationTime = input.expirationTime == null
    ? null
    : Number(input.expirationTime);
  if (
    !endpoint
      || !p256dh
      || !auth
      || (
        expirationTime !== null
          && (!Number.isSafeInteger(expirationTime) || expirationTime <= Date.now())
      )
  ) {
    return null;
  }
  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

function validStoredSubscription(
  value: StoredPushSubscription | null,
): value is StoredPushSubscription {
  return Boolean(
    value
      && value.version === 1
      && normalizeWorldWallet(value.wallet) === value.wallet
      && normalizeBrowserSubscription(value)
      && value.id === subscriptionId(value.endpoint)
      && Number.isFinite(Date.parse(value.createdAt))
      && Number.isFinite(Date.parse(value.updatedAt))
      && Number.isFinite(Date.parse(value.holderVerifiedAt)),
  );
}

async function loadWalletSubscriptions(wallet: string) {
  const keys = await pushStore.listKeys(subscriptionPrefix(wallet));
  const records = await Promise.all(
    keys.map((key) => pushStore.getJsonStrict<StoredPushSubscription>(key)),
  );
  return records.filter(validStoredSubscription);
}

async function loadAllSubscriptions() {
  const keys = await pushStore.listKeys(subscriptionPrefix());
  const records = await Promise.all(
    keys.map((key) => pushStore.getJsonStrict<StoredPushSubscription>(key)),
  );
  return records.filter(validStoredSubscription);
}

function requireConfiguredPush() {
  const config = vapidConfig();
  if (!config.configured) {
    throw Object.assign(
      new Error("dYOOR World notifications are not configured yet."),
      { status: 503 },
    );
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}

export async function dyoorWorldPushStatus(
  walletValue: unknown,
  endpointValue?: unknown,
) {
  const wallet = normalizeWorldWallet(walletValue);
  if (!wallet) throw Object.assign(new Error("Invalid holder wallet."), { status: 400 });
  const endpoint = normalizePushEndpoint(endpointValue);
  const subscriptions = await loadWalletSubscriptions(wallet);
  const current = endpoint
    ? subscriptions.find((record) => record.endpoint === endpoint)
    : null;
  return {
    config: dyoorWorldPushPublicConfig(),
    subscriptionCount: subscriptions.length,
    subscribed: Boolean(current),
    preferences: current?.preferences || {
      ...DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
    },
  };
}

export async function subscribeDyoorWorldPush(input: {
  wallet: unknown;
  subscription: unknown;
  preferences?: unknown;
  userAgent?: unknown;
}) {
  requireConfiguredPush();
  const wallet = normalizeWorldWallet(input.wallet);
  const subscription = normalizeBrowserSubscription(input.subscription);
  if (!wallet) throw Object.assign(new Error("Invalid holder wallet."), { status: 400 });
  if (!subscription) {
    throw Object.assign(new Error("The browser push subscription is invalid."), { status: 400 });
  }
  const key = subscriptionKey(wallet, subscription.endpoint);
  const existing = await pushStore.getJsonStrict<StoredPushSubscription>(key);
  const now = new Date().toISOString();
  const record: StoredPushSubscription = {
    version: 1,
    id: subscriptionId(subscription.endpoint),
    wallet,
    ...subscription,
    preferences: normalizeDyoorWorldPushPreferences(
      input.preferences || existing?.preferences,
    ),
    createdAt: validStoredSubscription(existing) ? existing.createdAt : now,
    updatedAt: now,
    holderVerifiedAt: now,
    userAgent: String(input.userAgent || "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .slice(0, 240),
  };
  await pushStore.setJson(key, record);

  const all = (await loadWalletSubscriptions(wallet))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  await Promise.all(
    all.slice(MAX_SUBSCRIPTIONS_PER_WALLET)
      .map((stale) => pushStore.deleteJson(
        subscriptionKey(wallet, stale.endpoint),
      )),
  );
  return {
    subscribed: true,
    preferences: record.preferences,
    subscriptionCount: Math.min(all.length, MAX_SUBSCRIPTIONS_PER_WALLET),
  };
}

export async function updateDyoorWorldPushPreferences(input: {
  wallet: unknown;
  endpoint: unknown;
  preferences: unknown;
}) {
  requireConfiguredPush();
  const wallet = normalizeWorldWallet(input.wallet);
  const endpoint = normalizePushEndpoint(input.endpoint);
  if (!wallet || !endpoint) {
    throw Object.assign(new Error("The browser push subscription is invalid."), { status: 400 });
  }
  const key = subscriptionKey(wallet, endpoint);
  const existing = await pushStore.getJsonStrict<StoredPushSubscription>(key);
  if (!validStoredSubscription(existing)) {
    throw Object.assign(new Error("Enable notifications on this browser first."), { status: 404 });
  }
  const preferences = normalizeDyoorWorldPushPreferences(input.preferences);
  await pushStore.setJson(key, {
    ...existing,
    preferences,
    updatedAt: new Date().toISOString(),
  });
  return { subscribed: true, preferences };
}

export async function unsubscribeDyoorWorldPush(
  walletValue: unknown,
  endpointValue: unknown,
) {
  const wallet = normalizeWorldWallet(walletValue);
  const endpoint = normalizePushEndpoint(endpointValue);
  if (!wallet || !endpoint) {
    throw Object.assign(new Error("The browser push subscription is invalid."), { status: 400 });
  }
  await pushStore.deleteJson(subscriptionKey(wallet, endpoint));
  return { subscribed: false };
}

function pushPayload(job: PushOutboxJob, previews: boolean) {
  return JSON.stringify({
    title: job.title,
    body: previews ? job.body : job.privateBody,
    icon: "/dyoor-world-icon.svg",
    badge: "/dyoor-world-icon.svg",
    tag: job.tag,
    url: job.url,
    category: job.category,
    createdAt: job.createdAt,
  });
}

async function sendPush(
  record: StoredPushSubscription,
  job: PushOutboxJob,
) {
  requireConfiguredPush();
  try {
    await webpush.sendNotification(
      {
        endpoint: record.endpoint,
        expirationTime: record.expirationTime,
        keys: record.keys,
      },
      pushPayload(job, record.preferences.previews),
      {
        TTL: job.category === "announcements" ? 86_400 : 3_600,
        urgency: ["replies", "directMessages", "tips", "trades"].includes(job.category)
          ? "high"
          : "normal",
        topic: job.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
      },
    );
    return { sent: true, remove: false };
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      await pushStore.deleteJson(subscriptionKey(record.wallet, record.endpoint));
      return { sent: false, remove: true };
    }
    console.error("dYOOR World push delivery failed", {
      category: job.category,
      statusCode,
      subscriptionId: record.id,
    });
    return { sent: false, remove: false };
  }
}

async function dispatchPushJob(
  job: PushOutboxJob,
  verifyHolder?: (wallet: string) => Promise<boolean>,
): Promise<PushDelivery> {
  const targetWallets = new Set(job.targetWallets || []);
  const excludedWallets = new Set(job.excludedWallets);
  const records = await loadAllSubscriptions();
  const eligible: StoredPushSubscription[] = [];
  let skipped = 0;

  for (const record of records) {
    if (
      (targetWallets.size > 0 && !targetWallets.has(record.wallet))
        || excludedWallets.has(record.wallet)
        || record.preferences[job.category] !== true
    ) {
      skipped += 1;
      continue;
    }
    if (
      verifyHolder
        && Date.now() - Date.parse(record.holderVerifiedAt) >= HOLDER_RECHECK_MS
    ) {
      try {
        if (!await verifyHolder(record.wallet)) {
          await pushStore.deleteJson(subscriptionKey(record.wallet, record.endpoint));
          skipped += 1;
          continue;
        }
        record.holderVerifiedAt = new Date().toISOString();
        await pushStore.setJson(
          subscriptionKey(record.wallet, record.endpoint),
          record,
        );
      } catch {
        skipped += 1;
        continue;
      }
    }
    eligible.push(record);
  }

  const result: PushDelivery = { sent: 0, skipped, removed: 0, failed: 0 };
  for (let index = 0; index < eligible.length; index += 20) {
    const deliveries = await Promise.all(
      eligible.slice(index, index + 20).map((record) => sendPush(record, job)),
    );
    for (const delivery of deliveries) {
      if (delivery.sent) result.sent += 1;
      else if (delivery.remove) result.removed += 1;
      else result.failed += 1;
    }
  }
  return result;
}

export async function sendDyoorWorldTestPush(
  walletValue: unknown,
  endpointValue: unknown,
) {
  const wallet = normalizeWorldWallet(walletValue);
  const endpoint = normalizePushEndpoint(endpointValue);
  if (!wallet || !endpoint) {
    throw Object.assign(new Error("The browser push subscription is invalid."), { status: 400 });
  }
  const record = await pushStore.getJsonStrict<StoredPushSubscription>(
    subscriptionKey(wallet, endpoint),
  );
  if (!validStoredSubscription(record)) {
    throw Object.assign(new Error("Enable notifications on this browser first."), { status: 404 });
  }
  const delivery = await sendPush(record, {
    version: 1,
    id: `test-${randomUUID()}`,
    category: "announcements",
    title: "dYOOR World signal received",
    body: "Push notifications are live for this holder device.",
    privateBody: "Push notifications are live for this holder device.",
    channelId: "announcements",
    url: "/dyoor-world?channel=announcements",
    tag: `world-test-${Date.now()}`,
    targetWallets: [wallet],
    excludedWallets: [],
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  if (!delivery.sent) {
    throw Object.assign(
      new Error(delivery.remove
        ? "This browser subscription expired. Enable notifications again."
        : "The push service did not accept the test notification."),
      { status: delivery.remove ? 410 : 502 },
    );
  }
  return { sent: true };
}

export async function enqueueDyoorWorldPush(input: {
  category: DyoorWorldPushCategory;
  title: unknown;
  body: unknown;
  privateBody?: unknown;
  channelId: unknown;
  url?: unknown;
  tag: unknown;
  targetWallets?: unknown[];
  excludedWallets?: unknown[];
}) {
  if (!vapidConfig().configured) return { queued: false, reason: "disabled" };
  if (!DYOOR_WORLD_PUSH_CATEGORIES.includes(input.category)) {
    return { queued: false, reason: "category" };
  }
  const channelId = String(input.channelId || "");
  if (!isWorldChannel(channelId)) return { queued: false, reason: "channel" };
  const title = String(input.title || "").trim().slice(0, 80);
  const body = String(input.body || "").trim().slice(0, 220);
  if (!title || !body) return { queued: false, reason: "content" };
  const targetWallets = input.targetWallets
    ? Array.from(new Set(input.targetWallets.map(normalizeWorldWallet).filter(Boolean)))
    : undefined;
  const excludedWallets = Array.from(new Set(
    (input.excludedWallets || []).map(normalizeWorldWallet).filter(Boolean),
  ));
  if (input.targetWallets && targetWallets?.length === 0) {
    return { queued: false, reason: "recipients" };
  }
  const now = new Date();
  const id = `${now.getTime().toString().padStart(13, "0")}-${randomUUID()}`;
  const rawUrl = String(input.url || "").trim();
  const url = /^\/dyoor-world(?:[/?#]|$)/.test(rawUrl)
    ? rawUrl.slice(0, 500)
    : `/dyoor-world?channel=${encodeURIComponent(channelId)}`;
  const job: PushOutboxJob = {
    version: 1,
    id,
    category: input.category,
    title,
    body,
    privateBody: String(input.privateBody || "New holder activity is waiting in dYOOR World.")
      .trim()
      .slice(0, 180),
    channelId,
    url,
    tag: String(input.tag || `${input.category}-${id}`)
      .replace(/[^A-Za-z0-9._:-]/g, "")
      .slice(0, 80),
    ...(targetWallets ? { targetWallets } : {}),
    excludedWallets,
    createdAt: now.toISOString(),
    attempts: 0,
  };
  await pushStore.setJson(outboxKey(id), job);
  return { queued: true, id };
}

function validPushJob(value: PushOutboxJob | null): value is PushOutboxJob {
  return Boolean(
    value
      && value.version === 1
      && /^[A-Za-z0-9._:-]{1,180}$/.test(value.id)
      && DYOOR_WORLD_PUSH_CATEGORIES.includes(value.category)
      && isWorldChannel(value.channelId)
      && /^\/dyoor-world(?:[/?#]|$)/.test(value.url)
      && Number.isFinite(Date.parse(value.createdAt))
      && Array.isArray(value.excludedWallets),
  );
}

export async function processDyoorWorldPushOutbox(input?: {
  verifyHolder?: (wallet: string) => Promise<boolean>;
}) {
  requireConfiguredPush();
  const keys = (await pushStore.listKeys(outboxPrefix()))
    .slice(0, OUTBOX_BATCH_SIZE);
  const summary = {
    inspected: keys.length,
    processed: 0,
    sent: 0,
    skipped: 0,
    removed: 0,
    failed: 0,
  };
  for (const key of keys) {
    const job = await pushStore.getJsonStrict<PushOutboxJob>(key);
    if (!validPushJob(job)) {
      await pushStore.deleteJson(key);
      continue;
    }
    if (Date.now() - Date.parse(job.createdAt) > OUTBOX_MAX_AGE_MS) {
      await pushStore.deleteJson(key);
      continue;
    }
    if (job.lockedUntil && Date.parse(job.lockedUntil) > Date.now()) continue;
    const locked: PushOutboxJob = {
      ...job,
      attempts: job.attempts + 1,
      lockedUntil: new Date(Date.now() + OUTBOX_LOCK_MS).toISOString(),
    };
    await pushStore.setJson(key, locked);
    try {
      const delivery = await dispatchPushJob(locked, input?.verifyHolder);
      summary.processed += 1;
      summary.sent += delivery.sent;
      summary.skipped += delivery.skipped;
      summary.removed += delivery.removed;
      summary.failed += delivery.failed;
      await pushStore.deleteJson(key);
    } catch (error) {
      if (locked.attempts >= 5) {
        await pushStore.deleteJson(key);
      } else {
        await pushStore.setJson(key, {
          ...locked,
          lockedUntil: "",
          lastError: String((error as Error)?.message || "Push delivery failed.")
            .slice(0, 240),
        });
      }
    }
  }
  return summary;
}
