"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
  type DyoorWorldPushPreferences,
} from "@/lib/dyoor-world-push";

type PushStatusResponse = {
  config?: {
    enabled?: boolean;
    publicKey?: string;
  };
  subscribed?: boolean;
  subscriptionCount?: number;
  preferences?: DyoorWorldPushPreferences;
  error?: string;
};

type BrowserState =
  | "loading"
  | "unconfigured"
  | "unsupported"
  | "prompt"
  | "denied"
  | "subscribed";

const PREFERENCE_OPTIONS: Array<{
  key: Exclude<keyof DyoorWorldPushPreferences, "previews">;
  label: string;
  description: string;
}> = [
  {
    key: "announcements",
    label: "Announcements",
    description: "Official owner dispatches",
  },
  {
    key: "directMessages",
    label: "Direct messages",
    description: "Private holder signals",
  },
  {
    key: "replies",
    label: "Replies",
    description: "Replies to your posts",
  },
  {
    key: "tips",
    label: "MON tips",
    description: "Verified incoming tips",
  },
  {
    key: "trades",
    label: "Trade updates",
    description: "Escrow activity involving you",
  },
  {
    key: "chat",
    label: "All World chat",
    description: "High-volume public messages",
  },
  {
    key: "sales",
    label: "Sales",
    description: "OpenSea sales relay",
  },
  {
    key: "burns",
    label: "Burns",
    description: "Permanent S2 burns",
  },
];

function decodeApplicationServerKey(value: string) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function keysMatch(subscription: PushSubscription, publicKey: string) {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = decodeApplicationServerKey(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isIosDevice() {
  return /iPad|iPhone|iPod/i.test(window.navigator.userAgent)
    || (
      window.navigator.platform === "MacIntel"
        && window.navigator.maxTouchPoints > 1
    );
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

async function readResponse<T extends { error?: string }>(response: Response) {
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export function DyoorWorldNotifications() {
  const [browserState, setBrowserState] = useState<BrowserState>("loading");
  const [publicKey, setPublicKey] = useState("");
  const [preferences, setPreferences] = useState<DyoorWorldPushPreferences>({
    ...DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
  });
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [iosInstallRequired, setIosInstallRequired] = useState(false);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  const registerWorker = useCallback(async () => {
    return await window.navigator.serviceWorker.register(
      "/dyoor-world-sw.js",
      { scope: "/" },
    );
  }, []);

  const synchronize = useCallback(async () => {
    if (
      !window.isSecureContext
        || !("serviceWorker" in window.navigator)
        || !("PushManager" in window)
        || !("Notification" in window)
    ) {
      setBrowserState("unsupported");
      return;
    }
    setIosInstallRequired(isIosDevice() && !isStandaloneApp());
    try {
      const registration = await registerWorker();
      let subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint || "";
      const response = await fetch(
        `/api/dyoor-world/push${endpoint
          ? `?endpoint=${encodeURIComponent(endpoint)}`
          : ""}`,
        { cache: "no-store" },
      );
      const data = await readResponse<PushStatusResponse>(response);
      const nextPublicKey = String(data.config?.publicKey || "");
      setPublicKey(nextPublicKey);
      setSubscriptionCount(Math.max(0, Number(data.subscriptionCount || 0)));
      setPreferences(data.preferences || {
        ...DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
      });
      if (!data.config?.enabled || !nextPublicKey) {
        setBrowserState("unconfigured");
        return;
      }
      if (subscription && !keysMatch(subscription, nextPublicKey)) {
        await subscription.unsubscribe().catch(() => false);
        subscription = null;
      }
      subscriptionRef.current = subscription;
      if (window.Notification.permission === "denied") {
        setBrowserState("denied");
        return;
      }
      if (!subscription) {
        setBrowserState("prompt");
        return;
      }
      if (!data.subscribed) {
        const syncResponse = await fetch("/api/dyoor-world/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            subscription: subscription.toJSON(),
            preferences: data.preferences,
          }),
        });
        const synced = await readResponse<PushStatusResponse>(syncResponse);
        setSubscriptionCount(Math.max(1, Number(synced.subscriptionCount || 1)));
        setPreferences(synced.preferences || {
          ...DYOOR_WORLD_DEFAULT_PUSH_PREFERENCES,
        });
      }
      setBrowserState("subscribed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not initialize notifications.");
      setBrowserState("prompt");
    }
  }, [registerWorker]);

  useEffect(() => {
    const timer = window.setTimeout(() => void synchronize(), 0);
    return () => window.clearTimeout(timer);
  }, [synchronize]);

  async function enableNotifications() {
    if (!publicKey || busy) return;
    if (isIosDevice() && !isStandaloneApp()) {
      setIosInstallRequired(true);
      setMessage("On iPhone: open this page in Safari, Share → Add to Home Screen, then enable alerts from the installed app.");
      return;
    }
    setBusy("enable");
    setError("");
    setMessage("");
    try {
      const permission = await window.Notification.requestPermission();
      if (permission !== "granted") {
        setBrowserState(permission === "denied" ? "denied" : "prompt");
        return;
      }
      const registration = await registerWorker();
      const existing = await registration.pushManager.getSubscription();
      if (existing && !keysMatch(existing, publicKey)) {
        await existing.unsubscribe().catch(() => false);
      }
      const subscription = (
        await registration.pushManager.getSubscription()
      ) || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(publicKey),
      });
      const response = await fetch("/api/dyoor-world/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          subscription: subscription.toJSON(),
          preferences,
        }),
      });
      const data = await readResponse<PushStatusResponse>(response);
      subscriptionRef.current = subscription;
      setPreferences(data.preferences || preferences);
      setSubscriptionCount(Math.max(1, Number(data.subscriptionCount || 1)));
      setBrowserState("subscribed");
      setMessage("Holder alerts are active on this device.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not enable notifications.");
    } finally {
      setBusy("");
    }
  }

  async function savePreferences(next: DyoorWorldPushPreferences) {
    const subscription = subscriptionRef.current;
    if (!subscription || busy) return;
    const previous = preferences;
    setPreferences(next);
    setBusy("preferences");
    setError("");
    try {
      const response = await fetch("/api/dyoor-world/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preferences",
          endpoint: subscription.endpoint,
          preferences: next,
        }),
      });
      const data = await readResponse<PushStatusResponse>(response);
      setPreferences(data.preferences || next);
    } catch (caught) {
      setPreferences(previous);
      setError(caught instanceof Error ? caught.message : "Could not save alert preferences.");
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    const subscription = subscriptionRef.current;
    if (!subscription || busy) return;
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/dyoor-world/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "test",
          endpoint: subscription.endpoint,
        }),
      });
      await readResponse<{ error?: string }>(response);
      setMessage("Test signal sent. Check this device’s notification tray.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the test alert.");
    } finally {
      setBusy("");
    }
  }

  async function disableNotifications() {
    const subscription = subscriptionRef.current;
    if (!subscription || busy) return;
    setBusy("disable");
    setError("");
    try {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const response = await fetch("/api/dyoor-world/push", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      await readResponse<{ error?: string }>(response);
      subscriptionRef.current = null;
      setSubscriptionCount((count) => Math.max(0, count - 1));
      setBrowserState("prompt");
      setMessage("Alerts are disabled on this device.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disable notifications.");
    } finally {
      setBusy("");
    }
  }

  const subscribed = browserState === "subscribed";

  return (
    <section className="relative mt-4 overflow-hidden rounded-xl border border-dyoor-cyan/25 bg-[radial-gradient(circle_at_12%_0%,rgba(57,255,226,.13),transparent_36%),radial-gradient(circle_at_100%_0%,rgba(255,79,227,.12),transparent_35%),linear-gradient(145deg,#0a1623,#09091c_62%,#17102d)] p-4 shadow-[0_16px_45px_rgba(0,0,0,.32),0_0_28px_rgba(57,255,226,.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[size:16px_16px]" />
      <div className="relative flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-xl border text-lg ${
          subscribed
            ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200 shadow-[0_0_20px_rgba(110,255,203,.16)]"
            : "border-dyoor-purple/35 bg-dyoor-purple/10 text-dyoor-monad"
        }`}>
          {subscribed ? "◉" : "◌"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan">
            Holder signal alerts
          </p>
          <p className="mt-1 text-xs font-black text-white">
            {browserState === "loading"
              ? "Checking this device"
              : subscribed
                ? "Notifications active"
                : browserState === "unconfigured"
                  ? "Server keys required"
                  : browserState === "unsupported"
                    ? "Not supported here"
                    : browserState === "denied"
                      ? "Permission blocked"
                      : "Notifications off"}
          </p>
        </div>
        {subscribed ? (
          <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[0.45rem] font-black uppercase tracking-[0.11em] text-emerald-200">
            Live
          </span>
        ) : null}
      </div>

      <div className="relative mt-3">
        {browserState === "unconfigured" ? (
          <p className="rounded border border-yellow-200/20 bg-yellow-200/[0.05] p-2.5 text-[0.6rem] font-bold leading-4 text-yellow-100/60">
            The PWA is ready. Add the three protected VAPID variables in Netlify to activate delivery.
          </p>
        ) : browserState === "unsupported" ? (
          <p className="rounded border border-yellow-200/20 bg-yellow-200/[0.05] p-2.5 text-[0.6rem] font-bold leading-4 text-yellow-100/60">
            This embedded browser cannot receive Web Push. Open dYOOR World in Safari or Chrome.
          </p>
        ) : browserState === "denied" ? (
          <p className="rounded border border-red-300/20 bg-red-300/[0.06] p-2.5 text-[0.6rem] font-bold leading-4 text-red-100/65">
            Notifications are blocked in browser settings. Allow dYOOR World, then reload.
          </p>
        ) : !subscribed && browserState !== "loading" ? (
          <>
            <button
              className="btn-primary w-full px-3 text-[0.62rem]"
              disabled={Boolean(busy) || iosInstallRequired}
              onClick={() => void enableNotifications()}
              type="button"
            >
              {busy === "enable" ? "Connecting push service" : "Enable holder alerts"}
            </button>
            {iosInstallRequired ? (
              <p className="mt-2 text-[0.58rem] font-bold leading-4 text-white/38">
                iPhone: open in Safari → Share → Add to Home Screen. Launch the installed dYOOR World app, then enable alerts.
              </p>
            ) : null}
          </>
        ) : null}

        {subscribed ? (
          <>
            <div className="grid gap-1.5">
              {PREFERENCE_OPTIONS.map((option) => (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded border border-white/[0.07] bg-black/20 px-2.5 py-2 transition hover:border-dyoor-cyan/20 hover:bg-dyoor-cyan/[0.04]"
                  key={option.key}
                >
                  <input
                    checked={preferences[option.key]}
                    className="h-3.5 w-3.5 accent-[#39ffe2]"
                    disabled={busy === "preferences"}
                    onChange={(event) => void savePreferences({
                      ...preferences,
                      [option.key]: event.target.checked,
                    })}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.62rem] font-black text-white/70">
                      {option.label}
                    </span>
                    <span className="block text-[0.52rem] font-bold text-white/27">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-3 rounded border border-yellow-200/10 bg-yellow-200/[0.025] px-2.5 py-2">
              <input
                checked={preferences.previews}
                className="h-3.5 w-3.5 accent-[#ffe687]"
                disabled={busy === "preferences"}
                onChange={(event) => void savePreferences({
                  ...preferences,
                  previews: event.target.checked,
                })}
                type="checkbox"
              />
              <span>
                <span className="block text-[0.62rem] font-black text-yellow-100/75">
                  Lock-screen previews
                </span>
                <span className="block text-[0.52rem] font-bold text-white/27">
                  Off by default for holder privacy
                </span>
              </span>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className="btn-secondary px-2 text-[0.56rem]"
                disabled={Boolean(busy)}
                onClick={() => void sendTest()}
                type="button"
              >
                {busy === "test" ? "Sending" : "Send test"}
              </button>
              <button
                className="btn-ghost px-2 text-[0.56rem] text-red-100/60"
                disabled={Boolean(busy)}
                onClick={() => void disableNotifications()}
                type="button"
              >
                {busy === "disable" ? "Disabling" : "Disable device"}
              </button>
            </div>
            <p className="mt-2 text-[0.5rem] font-bold text-white/20">
              {subscriptionCount} holder device{subscriptionCount === 1 ? "" : "s"} registered for this wallet
            </p>
          </>
        ) : null}
        {message ? (
          <p className="mt-2 rounded border border-emerald-300/15 bg-emerald-300/[0.05] px-2.5 py-2 text-[0.57rem] font-bold leading-4 text-emerald-100/70">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded border border-red-300/20 bg-red-300/[0.06] px-2.5 py-2 text-[0.57rem] font-bold leading-4 text-red-100/70">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
