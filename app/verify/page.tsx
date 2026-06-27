"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import homeBanner from "@/assets/home_banner.png";
import { Alert, Button, Card, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { useWalletService } from "@/providers/WalletServiceProvider";

const VERIFY_API = {
  status: "/.netlify/functions/discord-status",
  loginStart: "/.netlify/functions/discord-login-start",
  nonce: "/.netlify/functions/discord-verify-nonce",
  submit: "/.netlify/functions/discord-verify-submit",
};

type DiscordUser = {
  username?: string;
  discriminator?: string;
  global_name?: string;
  globalName?: string;
  discordUserId?: string;
};

type VerifySnapshot = {
  walletBalance?: string;
  stakedBalance?: string;
  totalBalance?: string;
  isHolder?: boolean;
  isAscended?: boolean;
  isTwentyPlus?: boolean;
  isFiftyPlus?: boolean;
  updatedAt?: number;
};

type VerifyStatus = {
  discordUser?: DiscordUser | null;
  snapshot?: VerifySnapshot | null;
  wallet?: string;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not connected";
}

function discordName(user?: DiscordUser | null) {
  if (!user) return "Not connected";
  if (user.username) return `${user.username}${user.discriminator ? `#${user.discriminator}` : ""}`;
  return user.global_name || user.globalName || "Connected";
}

function roleList(snapshot?: VerifySnapshot | null) {
  if (!snapshot) return "Not synced";
  const roles = [];
  if (snapshot.isHolder) roles.push("Holder");
  if (snapshot.isAscended) roles.push("Ascended");
  if (snapshot.isTwentyPlus) roles.push("20+");
  if (snapshot.isFiftyPlus) roles.push("50+");
  return roles.length ? roles.join(" / ") : "No active roles";
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export default function VerifyPage() {
  const walletService = useWalletService();
  const authenticated = walletService.connected;
  const walletAddress = walletService.address;
  const [discordUser, setDiscordUser] = useState<DiscordUser | null>(null);
  const [snapshot, setSnapshot] = useState<VerifySnapshot | null>(null);
  const [linkedWallet, setLinkedWallet] = useState<string>("");
  const [status, setStatus] = useState("Connect Discord and your wallet to begin role verification.");
  const [tone, setTone] = useState<"idle" | "good" | "warn" | "bad" | "busy">("idle");
  const [loading, setLoading] = useState(false);

  const activeWallet = walletAddress || linkedWallet;
  const canVerify = Boolean(discordUser && walletAddress);
  const statusClass = useMemo(() => {
    if (tone === "good") return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100";
    if (tone === "warn") return "border-yellow-300/35 bg-yellow-300/10 text-yellow-100";
    if (tone === "bad") return "border-red-400/40 bg-red-400/10 text-red-100";
    if (tone === "busy") return "border-dyoor-cyan/40 bg-dyoor-cyan/10 text-dyoor-cyan";
    return "border-white/12 bg-white/[0.03] text-white/60";
  }, [tone]);

  const loadStatus = useCallback(async () => {
    try {
      const data = await fetchJson<VerifyStatus>(VERIFY_API.status, { credentials: "include" });
      setDiscordUser(data.discordUser || null);
      setSnapshot(data.snapshot || null);
      setLinkedWallet(data.wallet || "");
      if (data.snapshot) {
        setStatus("Roles synced. Hourly auto-update is active.");
        setTone("good");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Verifier backend not reachable yet.");
      setTone("warn");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  function startDiscordLogin() {
    const returnTo = encodeURIComponent(window.location.href);
    window.location.href = `${VERIFY_API.loginStart}?returnTo=${returnTo}`;
  }

  async function getProvider() {
    return await walletService.getProvider() as Eip1193Provider;
  }

  async function verifyRoles(mode: "verify" | "refresh") {
    if (loading) return;
    if (!discordUser) {
      setStatus("Connect Discord first so the site knows which account should receive roles.");
      setTone("warn");
      return;
    }
    if (!walletAddress) {
      setStatus("Connect your wallet first.");
      setTone("warn");
      await walletService.connect().catch(() => {});
      return;
    }

    setLoading(true);
    setStatus(mode === "refresh" ? "Refreshing your roles..." : "Preparing secure verification message...");
    setTone("busy");

    try {
      const nonce = await fetchJson<{ message: string }>(VERIFY_API.nonce, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ wallet: walletAddress, mode }),
      });

      if (!nonce.message) throw new Error("Verifier did not return a signable message.");

      setStatus(mode === "refresh" ? "Sign to refresh your role state..." : "Sign the wallet message to verify...");
      const provider = await getProvider();
      const signature = await provider.request({
        method: "personal_sign",
        params: [nonce.message, walletAddress],
      });

      const result = await fetchJson<{ snapshot?: VerifySnapshot; discordUser?: DiscordUser; message?: string }>(
        VERIFY_API.submit,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ wallet: walletAddress, message: nonce.message, signature, mode }),
        },
      );

      setSnapshot(result.snapshot || null);
      setDiscordUser(result.discordUser || discordUser);
      setStatus(result.message || "Roles synced successfully.");
      setTone("good");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Verification failed. Try again.");
      setTone("bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell size="narrow">
      <Card strong className="energy-grid relative mb-8 overflow-hidden p-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-42"
          style={{ backgroundImage: `url(${homeBanner.src})` }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,3,10,.96),rgba(6,5,21,.78)_54%,rgba(17,10,45,.48)),radial-gradient(780px_420px_at_82%_16%,rgba(131,110,249,.28),transparent_58%)]" />
        <div className="relative z-10 p-6 md:p-8 lg:p-10">
          <SectionHeader
            eyebrow="Discord + Wallet Sync"
            title="Verify Your DYOOR Roles"
            copy="Link Discord, connect the wallet that holds your DYOORs, and sync holder and Ascension roles against the existing verification backend."
            className="mb-0 max-w-3xl"
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant={discordUser ? "secondary" : "primary"} onClick={startDiscordLogin}>
              {discordUser ? "Discord Connected" : "Connect Discord"}
            </Button>
            {!authenticated && (
              <Button variant="secondary" onClick={() => void walletService.connect()}>
                Connect Wallet
              </Button>
            )}
            <span className="btn-ghost text-white/45">
              Legacy fallback pending
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="terminal-panel p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Discord</p>
            <p className="mt-3 text-2xl font-black">{discordName(discordUser)}</p>
            <p className="mt-2 text-sm text-white/55">
              {discordUser ? "Discord is linked for role sync." : "Connect the Discord account that should receive roles."}
            </p>
          </div>
          <div className="terminal-panel p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Wallet</p>
            <p className="mt-3 text-2xl font-black">{shortAddress(activeWallet)}</p>
            <p className="mt-2 text-sm text-white/55">
              {walletAddress ? `Wallet connected through ${walletService.providerName || "wallet"}.` : "Connect the wallet that holds or ascended your S1."}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <StatCard label="Wallet S1" value={snapshot?.walletBalance ?? "-"} />
          <StatCard label="Staked S1" value={snapshot?.stakedBalance ?? "-"} />
          <StatCard label="Total Counted" value={snapshot?.totalBalance ?? "-"} />
          <StatCard label="Active Roles" value={<span className="text-lg">{roleList(snapshot)}</span>} />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant="primary"
            onClick={() => verifyRoles("verify")}
            disabled={!canVerify || loading}
          >
            {loading ? "Syncing Signal..." : "Verify Roles"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => verifyRoles("refresh")}
            disabled={!canVerify || loading}
          >
            Refresh Roles
          </Button>
        </div>

        <Alert className={`mt-5 ${statusClass}`} tone="idle">{status}</Alert>
      </Card>
    </PageShell>
  );
}
