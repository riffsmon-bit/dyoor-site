"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Memberships = {
  season1: boolean;
  ascended: boolean;
  season2: boolean;
  hoodyoor: boolean;
};

type VerifyStatus = {
  dyoorified: boolean;
  wallets: Array<{
    address: string;
    checkedAt: number | null;
    memberships: Partial<Memberships>;
    rpcUncertain: string[];
  }>;
  memberships: Memberships;
  lastCheckedAt: number | null;
};

type StatusPayload = {
  authenticated: boolean;
  discordUser?: { id: string; username: string; globalName: string };
  status?: VerifyStatus;
};

const membershipLabels: Array<[keyof Memberships, string]> = [
  ["season1", "Season 1"],
  ["ascended", "Ascended"],
  ["season2", "Season 2"],
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Verification request failed.");
  return data;
}

export function DiscordVerifyClient() {
  const searchParams = useSearchParams();
  const wallet = useWalletService();
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(searchParams.get("discord_error") || "");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/.netlify/functions/discord-status", {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        setPayload({ authenticated: false });
        return;
      }
      setPayload(await responseJson(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Discord status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  async function verifyWallet() {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      if (!wallet.address) await wallet.connect();
      const address = String(await wallet.getAddress()).toLowerCase();
      const nonceResponse = await fetch("/.netlify/functions/discord-verify-nonce", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const nonceData = await responseJson(nonceResponse);
      const challenge = nonceData.challenge;
      const signature = await wallet.signMessage(String(challenge.message || ""));
      const submitResponse = await fetch("/.netlify/functions/discord-verify-submit", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          nonce: challenge.nonce,
          signature,
        }),
      });
      const result = await responseJson(submitResponse);
      setNotice(result.warning || "Wallet verified and Discord roles synchronized.");
      await loadStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet verification failed.");
    } finally {
      setWorking(false);
    }
  }

  async function refreshRoles() {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/.netlify/functions/discord-refresh", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      await responseJson(response);
      setNotice("Current ownership checked and Discord roles synchronized.");
      await loadStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Role sync failed.");
    } finally {
      setWorking(false);
    }
  }

  const loginUrl = `/.netlify/functions/discord-login-start?returnTo=${encodeURIComponent("/discord/verify?source=discord")}`;

  return (
    <main className="page-shell min-h-screen py-8 sm:py-14">
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-dyoor-cyan/25 bg-[#080918]/95 shadow-[0_24px_100px_rgba(0,0,0,.55)]">
        <div className="border-b border-white/10 bg-gradient-to-r from-dyoor-purple/20 via-transparent to-dyoor-cyan/10 px-5 py-7 sm:px-9">
          <p className="eyebrow">Discord gateway // secure identity sync</p>
          <h1 className="heading-gradient mt-3 text-3xl sm:text-5xl">DYØØR Verification</h1>
          <p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-white/58">
            Verify your Discord account, sign a short-lived wallet-authentication message, and sync every identity you currently qualify for. No transaction or approval is requested.
          </p>
        </div>

        <div className="space-y-6 p-5 sm:p-9">
          <div className="grid gap-3 sm:grid-cols-4">
            {membershipLabels.map(([key, label]) => (
              <div key={key} className={`rounded-xl border px-4 py-3 ${payload?.status?.memberships?.[key] ? "border-dyoor-cyan/40 bg-dyoor-cyan/10" : "border-white/10 bg-white/[0.025]"}`}>
                <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-white/38">{label}</p>
                <p className={`mt-1 text-xs font-black uppercase ${payload?.status?.memberships?.[key] ? "text-dyoor-cyan" : "text-white/45"}`}>
                  {payload?.status?.memberships?.[key] ? "Verified" : "Not detected"}
                </p>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="rounded-xl border border-white/10 bg-black/25 p-5 text-sm font-bold text-white/55">Checking your Discord session…</div>
          ) : !payload?.authenticated ? (
            <div className="rounded-xl border border-dyoor-purple/35 bg-dyoor-purple/10 p-5 sm:p-6">
              <p className="text-sm font-black uppercase tracking-[0.12em] text-white">Step 1 — Verify Discord</p>
              <p className="mt-2 text-sm leading-6 text-white/55">Sign in with Discord so the server—not a browser query parameter—binds this session to your Discord user ID and the official DYØØR guild.</p>
              <a className="btn-primary mt-5 w-full justify-center sm:w-auto" href={loginUrl}>Verify with Discord</a>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-dyoor-cyan/25 bg-dyoor-cyan/[0.06] p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
                <div>
                  <p className="text-[0.58rem] font-black uppercase tracking-[0.15em] text-dyoor-cyan">Discord identity verified</p>
                  <p className="mt-1 font-black text-white">{payload.discordUser?.globalName || payload.discordUser?.username}</p>
                  <p className="mt-1 text-xs font-bold text-white/40">DYØØRified public access remains even if holder status changes.</p>
                </div>
                <button className="btn-ghost mt-4 w-full justify-center sm:mt-0 sm:w-auto" disabled={working} onClick={() => void refreshRoles()} type="button">Refresh roles</button>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 p-5 sm:p-6">
                <p className="text-sm font-black uppercase tracking-[0.12em] text-white">Step 2 — Link a holder wallet</p>
                <p className="mt-2 text-sm leading-6 text-white/55">Multiple wallets are supported. Their S1, Ascended, and S2 qualifications are combined without overwriting one another.</p>
                {payload.status?.wallets?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {payload.status.wallets.map((item) => (
                      <span key={item.address} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 font-mono text-[0.68rem] text-white/65">{shortAddress(item.address)}</span>
                    ))}
                  </div>
                ) : null}
                <button className="btn-primary mt-5 w-full justify-center sm:w-auto" disabled={working || wallet.status === "connecting"} onClick={() => void verifyWallet()} type="button">
                  {working ? "Checking current ownership…" : wallet.address ? "Sign and sync this wallet" : "Connect wallet"}
                </button>
              </div>
            </>
          )}

          {notice ? <p className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm font-bold text-emerald-100">{notice}</p> : null}
          {error ? <p className="rounded-lg border border-red-400/35 bg-red-400/10 px-4 py-3 text-sm font-bold text-red-100">{error}</p> : null}

          <div className="rounded-xl border border-red-300/20 bg-red-300/[0.05] p-5 text-sm leading-6 text-white/58">
            <p className="font-black uppercase tracking-[0.12em] text-red-100">Wallet safety</p>
            <p className="mt-2">DYØØR staff will never ask for your seed phrase, private key, wallet export, asset approval, transfer, payment, or remote access. Verify that the signing prompt names <strong className="text-white">dyoor.fun</strong> and explains its purpose.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link className="btn-primary flex-1 justify-center" href="/dyoor-world?source=discord">Enter dYØØR Wørld</Link>
            <Link className="btn-ghost flex-1 justify-center" href="/">Return to DYØØR</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
