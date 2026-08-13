"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { droidEconomyFeatureFlags } from "@/lib/droid-economy/feature-flags";
import type {
  DroidAccountApiResponse,
  DroidSquadItem,
} from "@/lib/droid-accounts/types";
import { useWalletService } from "@/providers/WalletServiceProvider";

const MONAD_COLLECTION = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const ROBINHOOD_COLLECTION = "0x8277F8126722B11D7b44C5C453bcF62A78AAFa25";

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

export function MultiChainDroidDashboard() {
  const wallet = useWalletService();
  const flags = droidEconomyFeatureFlags();
  const [robinhoodDroids, setRobinhoodDroids] = useState<DroidSquadItem[]>([]);
  const [monadDroids, setMonadDroids] = useState<DroidSquadItem[]>([]);
  const [loadedWallet, setLoadedWallet] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    if (!wallet.address) {
      const timer = window.setTimeout(() => {
        setRobinhoodDroids([]);
        setMonadDroids([]);
        setLoadedWallet(wallet.address);
      }, 0);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }
    async function readChain(chainId: number, label: string) {
      const response = await fetch(
        `/api/droid-accounts?chainId=${chainId}&owner=${encodeURIComponent(wallet.address || "")}`,
        { cache: "no-store", signal: controller.signal },
      );
      const data = await response.json().catch(() => null) as DroidAccountApiResponse | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `${label} Droid reads are unavailable.`);
      }
      return data.squad || [];
    }
    void Promise.allSettled([
      flags.robinhoodDroidsEnabled
        ? readChain(4_663, "Robinhood")
        : Promise.resolve([]),
      flags.monadDroidsEnabled
        ? readChain(143, "Monad")
        : Promise.resolve([]),
    ]).then(([robinhood, monad]) => {
      if (controller.signal.aborted) return;
      setRobinhoodDroids(robinhood.status === "fulfilled" ? robinhood.value : []);
      setMonadDroids(monad.status === "fulfilled" ? monad.value : []);
      const failures = [robinhood, monad]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : "Droid reads are unavailable.");
      setError(failures.join(" "));
      setLoadedWallet(wallet.address);
    });
    return () => controller.abort();
  }, [flags.monadDroidsEnabled, flags.robinhoodDroidsEnabled, wallet.address]);

  const loading = loadedWallet !== wallet.address;

  return (
    <main className="min-h-screen bg-[#060714] px-4 pb-24 pt-10 text-white sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-end gap-7 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-dyoor-cyan">Chain-qualified command network</p>
            <h1 className="mt-4 text-5xl font-black uppercase leading-[0.86] tracking-[-0.07em] sm:text-7xl">My<br /><span className="text-dyoor-cyan">Droids</span></h1>
            <p className="mt-6 max-w-2xl text-base font-semibold leading-7 text-white/50">Separate native collections, one common interface. Every Droid keeps its own custody, identity, portfolio, and chain provenance.</p>
          </div>
          <div className="rounded-[1.5rem] border border-dyoor-purple/30 bg-[#0c1026] p-5">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.17em] text-white/35">Logical squad portfolio</p>
            <p className="mt-3 text-2xl font-black uppercase text-white/55">Value unavailable</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/30">No unverified cross-chain prices are summed. Underlying balances stay chain-local and independently verifiable.</p>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4"><span className="text-xs font-black uppercase text-white/35">Connected commander</span><span className="font-mono text-xs text-dyoor-cyan">{shortAddress(wallet.address || "")}</span></div>
          </div>
        </div>

        {!wallet.address ? (
          <div className="mt-10 rounded-[1.5rem] border border-dashed border-dyoor-cyan/25 bg-dyoor-cyan/[0.03] p-10 text-center">
            <p className="text-lg font-black uppercase">Connect a commander wallet</p>
            <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-white/40">Ownership will be read independently from each native collection. Token ID alone is never used as a cross-chain identity.</p>
            <button type="button" onClick={() => void wallet.connect()} className="mt-6 rounded-xl bg-dyoor-cyan px-6 py-3 text-xs font-black uppercase tracking-[0.13em] text-black">Connect wallet</button>
          </div>
        ) : null}
        {error ? <p className="mt-6 rounded-xl border border-red-300/20 bg-red-300/[0.05] p-4 text-sm font-bold text-red-100">{error}</p> : null}

        <section className="mt-10 rounded-[1.75rem] border border-[#c7ff00]/20 bg-[#091007] p-5 sm:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]">Robinhood Chain · 4663</p><h2 className="mt-2 text-3xl font-black uppercase tracking-[-0.05em]">HoodYØØR</h2></div>
            <p className="font-mono text-[0.58rem] text-white/25">{ROBINHOOD_COLLECTION}</p>
          </div>
          {!flags.robinhoodDroidsEnabled ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#c7ff00]/25 bg-black/20 p-7">
              <p className="text-sm font-black uppercase text-white/55">Collection deployed · mint and activation staged</p>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-white/35">The verified HoodYØØR collection and immutable Droid Account V1 infrastructure are deployed on Robinhood Chain, but supply is still zero and first-party activation remains disabled. No nonexistent NFT is shown and no economic reward module is live.</p>
              <Link href="/robinhood" className="mt-4 inline-flex text-xs font-black uppercase tracking-[0.12em] text-[#c7ff00]">Open HoodYØØR launch status →</Link>
              <p className="mt-3 text-xs font-black uppercase tracking-[0.11em] text-[#c7ff00]/60">Pre-mint · rewards off · agents off · bridge off</p>
            </div>
          ) : loading ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div> : robinhoodDroids.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {robinhoodDroids.map((droid) => (
                <Link key={droid.tokenId} href={`/robinhood/droids/${droid.tokenId}`} className="group overflow-hidden rounded-2xl border border-white/10 bg-black/25 transition hover:border-[#c7ff00]/35">
                  <div className="relative aspect-square"><Image src={droid.imageUrl} alt={`HoodYØØR #${droid.tokenId}`} fill unoptimized sizes="(min-width:1024px) 30vw, 100vw" className="object-cover [image-rendering:pixelated] transition group-hover:scale-[1.02]" /></div>
                  <div className="p-4"><div className="flex items-center justify-between gap-3"><p className="text-xl font-black uppercase">Droid #{droid.tokenId}</p><span className={`text-[0.55rem] font-black uppercase ${droid.active ? "text-[#c7ff00]" : "text-white/30"}`}>{droid.active ? "Online" : "Offline"}</span></div><p className="mt-2 truncate font-mono text-[0.58rem] text-white/25">{droid.accountAddress}</p></div>
                </Link>
              ))}
            </div>
          ) : <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-7 text-center"><p className="text-sm font-black uppercase text-white/45">{wallet.address ? "No native HoodYØØRs found" : "Wallet signal required"}</p><Link href="/robinhood/droids" className="mt-4 inline-flex text-xs font-black uppercase tracking-[0.12em] text-[#c7ff00]">Open Robinhood Droid OS →</Link></div>}
        </section>

        <section className="mt-6 rounded-[1.75rem] border border-dyoor-purple/30 bg-[#0c1026] p-5 sm:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan">Monad · 143</p><h2 className="mt-2 text-3xl font-black uppercase tracking-[-0.05em]">D.Y.O.O.R</h2></div>
            <p className="font-mono text-[0.58rem] text-white/25">{MONAD_COLLECTION}</p>
          </div>
          {!flags.monadDroidsEnabled ? (
            <div className="mt-6 rounded-2xl border border-dashed border-dyoor-purple/30 bg-black/20 p-7">
              <p className="text-sm font-black uppercase text-white/55">Native collection integrated · activation staged</p>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-white/35">The existing Monad D.Y.O.O.R collection, artwork, direct owner control, Energy ledger, Trait Lab, and Build systems are reused. Activation stays disabled until the chain-local ERC-6551 registry and account contracts pass deployment preflight and verification.</p>
              <Link href="/monad/droids" className="mt-4 inline-flex text-xs font-black uppercase tracking-[0.12em] text-dyoor-cyan">Open Monad Droid OS →</Link>
              <p className="mt-3 text-xs font-black uppercase tracking-[0.11em] text-dyoor-cyan/60">Bridge disabled · no mirrored NFT implied</p>
            </div>
          ) : loading ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
          ) : monadDroids.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {monadDroids.map((droid) => (
                <Link key={droid.tokenId} href={`/monad/droids/${droid.tokenId}`} className="group overflow-hidden rounded-2xl border border-white/10 bg-black/25 transition hover:border-dyoor-cyan/35">
                  <div className="relative aspect-square"><Image src={droid.imageUrl} alt={`D.Y.O.O.R #${droid.tokenId}`} fill unoptimized sizes="(min-width:1024px) 30vw, 100vw" className="object-cover [image-rendering:pixelated] transition group-hover:scale-[1.02]" /></div>
                  <div className="p-4"><div className="flex items-center justify-between gap-3"><p className="text-xl font-black uppercase">Droid #{droid.tokenId}</p><span className={`text-[0.55rem] font-black uppercase ${droid.active ? "text-dyoor-cyan" : "text-white/30"}`}>{droid.active ? "Online" : "Offline"}</span></div><p className="mt-2 truncate font-mono text-[0.58rem] text-white/25">{droid.accountAddress}</p></div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-7 text-center"><p className="text-sm font-black uppercase text-white/45">{wallet.address ? "No native D.Y.O.O.Rs found" : "Wallet signal required"}</p><Link href="/monad/droids" className="mt-4 inline-flex text-xs font-black uppercase tracking-[0.12em] text-dyoor-cyan">Open Monad Droid OS →</Link></div>
          )}
        </section>
      </div>
    </main>
  );
}
