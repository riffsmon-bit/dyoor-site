"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DroidAccountApiResponse,
  DroidProtocolConfig,
  DroidSquadItem,
} from "@/lib/droid-accounts/types";
import { useWalletService } from "@/providers/WalletServiceProvider";

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function DroidSquadClient({
  chainId = 4_663,
  basePath = "/robinhood/droids",
  traitLabPath = "/robinhood/trait-lab",
}: {
  chainId?: number;
  basePath?: string;
  traitLabPath?: string;
}) {
  const wallet = useWalletService();
  const router = useRouter();
  const [config, setConfig] = useState<DroidProtocolConfig | null>(null);
  const [squad, setSquad] = useState<DroidSquadItem[]>([]);
  const [loadedWallet, setLoadedWallet] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tokenLookup, setTokenLookup] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = wallet.address ? `?owner=${encodeURIComponent(wallet.address)}` : "";
    const separator = query ? "&" : "?";
    fetch(`/api/droid-accounts${query}${separator}chainId=${chainId}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => null) as DroidAccountApiResponse | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Droid Squad data is unavailable.");
      setConfig(data.config);
      setSquad(data.squad || []);
      setError("");
    }).catch((caught) => {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Droid Squad data is unavailable.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoadedWallet(wallet.address);
    });
    return () => controller.abort();
  }, [chainId, wallet.address]);

  const loading = loadedWallet !== wallet.address;

  function openToken(event: FormEvent) {
    event.preventDefault();
    const tokenId = Number(tokenLookup);
    const maxSupply = config?.maxSupply || 3_333;
    if (!Number.isSafeInteger(tokenId) || tokenId < 1 || tokenId > maxSupply) {
      setError(`Enter a ${config?.collectionName || "Droid"} token ID from 1 to ${maxSupply.toLocaleString()}.`);
      return;
    }
    router.push(`${basePath}/${tokenId}`);
  }

  return (
    <main className={`relative min-h-screen overflow-hidden text-white selection:bg-[#c7ff00]/35 ${chainId === 143 ? "dyoor-site-droid-theme bg-[#03030a]" : "bg-[#070a06]"}`}>
      <div className="droid-os-grid pointer-events-none fixed inset-0 opacity-25 [background-image:linear-gradient(rgba(199,255,0,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(199,255,0,.055)_1px,transparent_1px)] [background-size:40px_40px]" />
      <header className="sticky top-0 z-40 border-b border-[#c7ff00]/15 bg-[#070a06]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-[#c7ff00]">
              <Image src={chainId === 143 ? "/assets/dyoor-logo.png" : "/assets/robinhood/hoodyoor-robinhood-feather-logo.png"} alt="" fill sizes="36px" className="object-cover" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black uppercase tracking-[-0.02em]">{config?.collectionName || "Droid"} Droid OS</span>
              <span className="block text-[0.5rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/55">Squad command</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href={traitLabPath} className="hidden rounded-full border border-white/10 px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.1em] text-white/45 sm:block">Trait Lab</Link>
            {chainId === 143 ? (
              <Link href="/droids" className="rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.07] px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.1em] text-[#c7ff00]">All Droids</Link>
            ) : wallet.address ? (
              <button type="button" onClick={() => void wallet.disconnect()} className="rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.07] px-3 py-2 font-mono text-xs font-bold text-[#c7ff00]" title="Disconnect wallet">{shortAddress(wallet.address)}</button>
            ) : (
              <button type="button" onClick={() => void wallet.connect()} className="rounded-full bg-[#c7ff00] px-4 py-2 text-[0.62rem] font-black uppercase tracking-[0.1em] text-black">Connect</button>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <div className="grid items-end gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.06] px-3 py-2 text-[0.6rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c7ff00] shadow-[0_0_10px_#c7ff00]" />
              NFT-bound command network
            </p>
            <h1 className="mt-5 max-w-3xl text-5xl font-black uppercase leading-[0.86] tracking-[-0.07em] sm:text-7xl lg:text-8xl">
              My<br /><span className="text-[#c7ff00]">Droids</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base font-semibold leading-7 text-white/50 sm:text-lg">
              Droids don&apos;t sit in wallets. Droids have wallets. Open each {config?.collectionName || "NFT"}&apos;s deterministic account, inventory, Energy, and security controls.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-white/35">Squad portfolio</p>
            <p className="mt-3 text-2xl font-black uppercase text-white/55">Value unavailable</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/30">Custody stays separate per Droid. No unverified prices are totaled.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-2xl font-black">{wallet.address ? squad.length : "—"}</p><p className="mt-1 text-[0.52rem] font-black uppercase tracking-[0.12em] text-white/35">Droids linked</p></div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-2xl font-black text-[#c7ff00]">{wallet.address ? squad.filter((droid) => droid.active).length : "—"}</p><p className="mt-1 text-[0.52rem] font-black uppercase tracking-[0.12em] text-white/35">Online</p></div>
            </div>
          </div>
        </div>

        <form onSubmit={openToken} className="mt-10 flex max-w-xl gap-2 rounded-2xl border border-white/10 bg-[#0c110b] p-2">
          <input value={tokenLookup} onChange={(event) => setTokenLookup(event.target.value)} inputMode="numeric" placeholder="Open Droid by token ID" aria-label={`${config?.collectionName || "Droid"} token ID`} className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/25" />
          <button className="rounded-xl bg-[#c7ff00] px-5 py-3 text-[0.62rem] font-black uppercase tracking-[0.12em] text-black">Open</button>
        </form>

        {!config?.configured && config ? (
          <div className="mt-6 rounded-2xl border border-sky-300/25 bg-sky-300/[0.07] p-4">
            <p className="text-xs font-black uppercase tracking-[0.15em] text-sky-200">Protocol deployment pending</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/50">{config.setupIssue} Collection ownership remains readable; activation controls stay disabled until verified addresses are configured.</p>
          </div>
        ) : null}
        {config?.configured && !config.activationEnabled ? (
          <div className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-4">
            <p className="text-xs font-black uppercase tracking-[0.15em] text-amber-200">Infrastructure live · new activation staged</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/50">Existing deployed Droid Wallets remain publicly readable. The holder activation gate is still off, so no other token receives Stage 1 activation. Rewards, strategies, agents, and bridges remain off.</p>
          </div>
        ) : null}
        {error ? <div className="mt-6 rounded-2xl border border-red-300/25 bg-red-300/[0.06] p-4 text-sm font-bold text-red-100">{error}</div> : null}

        <section className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/60">Connected identity</p><h2 className="mt-2 text-2xl font-black uppercase tracking-[-0.04em] sm:text-3xl">Your Droids</h2></div>
            {config ? <span className="hidden text-[0.58rem] font-black uppercase tracking-[0.13em] text-white/25 sm:block">{config.chainName} · {config.chainId}</span> : null}
          </div>

          {loading ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-80 animate-pulse rounded-[1.5rem] border border-white/[0.07] bg-white/[0.03]" />)}
            </div>
          ) : !wallet.address ? (
            <div className="mt-6 rounded-[1.5rem] border border-dashed border-[#c7ff00]/20 bg-[#c7ff00]/[0.025] px-5 py-14 text-center">
              <p className="text-lg font-black uppercase">Connect your commander wallet</p>
              <p className="mx-auto mt-3 max-w-lg text-sm font-semibold leading-6 text-white/40">The collection is read directly on-chain. No client-supplied ownership claim is trusted.</p>
              <button type="button" onClick={() => void wallet.connect()} className="mt-6 rounded-xl bg-[#c7ff00] px-6 py-3 text-xs font-black uppercase tracking-[0.13em] text-black">Connect wallet</button>
            </div>
          ) : squad.length ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {squad.map((droid) => <DroidCard key={droid.tokenId} droid={droid} config={config} basePath={basePath} />)}
            </div>
          ) : (
            <div className="mt-6 rounded-[1.5rem] border border-dashed border-white/10 px-5 py-14 text-center">
              <p className="text-lg font-black uppercase text-white/60">No eligible {config?.collectionName || "Droids"} found</p>
              <p className="mx-auto mt-3 max-w-lg text-sm font-semibold leading-6 text-white/35">This connected address does not currently own a token in the configured {config?.collectionName || "Droid"} collection.</p>
            </div>
          )}
        </section>

        <aside className="mt-10 rounded-[1.5rem] border border-amber-300/30 bg-amber-300/[0.07] p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-amber-200">Transfer model</p>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-amber-50/65">Selling or transferring a parent Droid transfers control of everything held by that Droid Account. Assets are not automatically returned, and third-party marketplaces may not display or value them.</p>
        </aside>
      </div>
    </main>
  );
}

function DroidCard({
  droid,
  config,
  basePath,
}: {
  droid: DroidSquadItem;
  config: DroidProtocolConfig | null;
  basePath: string;
}) {
  const energy = (() => {
    try {
      const raw = BigInt(droid.energyBalance);
      const decimals = config?.energyDecimals || 0;
      if (!decimals) return raw.toLocaleString("en-US");
      const scale = 10n ** BigInt(decimals);
      const fraction = (raw % scale).toString().padStart(decimals, "0")
        .replace(/0+$/, "").slice(0, 4);
      return fraction ? `${raw / scale}.${fraction}` : (raw / scale).toString();
    } catch {
      return droid.energyBalance;
    }
  })();
  return (
    <Link href={`${basePath}/${droid.tokenId}`} className="group overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0c110b] transition hover:-translate-y-1 hover:border-[#c7ff00]/35 hover:shadow-[0_25px_75px_rgba(0,0,0,.45),0_0_35px_rgba(199,255,0,.06)]">
      <div className="relative aspect-square overflow-hidden bg-[#11180d]">
        <Image src={droid.imageUrl} alt={`${config?.collectionName || "Droid"} #${droid.tokenId}`} fill unoptimized sizes="(min-width: 1024px) 30vw, (min-width: 640px) 48vw, 100vw" className="object-cover [image-rendering:pixelated] transition duration-500 group-hover:scale-[1.03]" />
        <span className={`absolute right-3 top-3 rounded-full border px-3 py-2 text-[0.55rem] font-black uppercase tracking-[0.12em] backdrop-blur-md ${droid.active ? "border-[#c7ff00]/35 bg-black/55 text-[#c7ff00]" : "border-white/15 bg-black/55 text-white/45"}`}>{droid.active ? "Wallet active" : "Not activated"}</span>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[0.55rem] font-black uppercase tracking-[0.17em] text-[#c7ff00]/55">{droid.directive}</p><h3 className="mt-1 text-2xl font-black uppercase tracking-[-0.045em]">{config?.collectionName || "Droid"} #{droid.tokenId}</h3></div><span className="text-xl text-[#c7ff00] transition group-hover:translate-x-1" aria-hidden="true">→</span></div>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-4">
          <div><p className="text-[0.5rem] font-black uppercase tracking-[0.12em] text-white/30">{config?.nativeCurrencySymbol || "Native"}</p><p className="mt-1 font-mono text-xs font-bold text-white/70">{droid.nativeFormatted}</p></div>
          <div><p className="text-[0.5rem] font-black uppercase tracking-[0.12em] text-white/30">Energy</p><p className="mt-1 font-mono text-xs font-bold text-white/70">{energy}</p></div>
        </div>
        <p className="mt-4 truncate font-mono text-[0.58rem] text-white/25">{droid.accountAddress || config?.setupIssue || "Account not configured"}</p>
      </div>
    </Link>
  );
}
