"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";

type BurnSummary = { totalBurns?: number; walletBurnCount?: number; error?: string };

export function MonadBurnClient() {
  const wallet = useWalletService();
  const [summary, setSummary] = useState<BurnSummary>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = wallet.address ? `?wallet=${encodeURIComponent(wallet.address)}` : "";
    fetch(`/api/s2/trait-lab/burned-droids${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as BurnSummary;
        if (!response.ok) throw new Error(data.error || "Burn registry unavailable.");
        setSummary(data);
      })
      .catch((error) => { if (!controller.signal.aborted) setSummary({ error: error instanceof Error ? error.message : "Burn registry unavailable." }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [wallet.address]);

  return (
    <main className="min-h-screen bg-[#060714] px-4 pb-24 pt-12 text-white sm:px-6 sm:pt-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-dyoor-cyan">Monad · Burn registry</p>
        <h1 className="mt-4 text-5xl font-black uppercase leading-[0.88] tracking-[-0.07em] sm:text-7xl">Burn for<br /><span className="text-dyoor-cyan">Hoodyoor</span></h1>
        <p className="mt-6 max-w-2xl text-base font-semibold leading-7 text-white/55">Permanently burn an eligible Monad D.Y.O.O.R. Every confirmed burn is recorded with the wallet, token ID, transaction hash, and timestamp for a future Hoodyoor launch snapshot.</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-dyoor-purple/30 bg-[#0c1026] p-6"><p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">Your recorded burns</p><p className="mt-3 text-4xl font-black text-dyoor-cyan">{loading ? "—" : summary.walletBurnCount ?? (wallet.address ? 0 : "Connect")}</p><p className="mt-2 text-sm font-semibold text-white/40">Only confirmed on-chain burns count.</p></div>
          <div className="rounded-2xl border border-dyoor-purple/30 bg-[#0c1026] p-6"><p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">Registry total</p><p className="mt-3 text-4xl font-black text-white">{loading ? "—" : summary.totalBurns ?? 0}</p><p className="mt-2 text-sm font-semibold text-white/40">All verified burns recorded by DYOOR.</p></div>
        </div>

        {summary.error ? <p className="mt-5 rounded-xl border border-red-300/20 bg-red-300/[0.05] p-4 text-sm font-bold text-red-100">{summary.error}</p> : null}
        <div className="mt-8 rounded-2xl border border-red-400/30 bg-red-500/[0.07] p-6">
          <h2 className="text-xl font-black uppercase">This action cannot be undone</h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-white/60">The official Trait Lab checks ownership and Droid Wallet safety before broadcasting the burn. Activated or funded Droid Wallets are blocked so assets are not stranded.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {!wallet.address ? <button type="button" onClick={() => void wallet.connect()} className="rounded-xl bg-dyoor-cyan px-5 py-3 text-xs font-black uppercase tracking-[0.13em] text-black">Connect wallet</button> : null}
            <Link href="/reroll#burn-droid" className="rounded-xl border border-dyoor-cyan/40 px-5 py-3 text-xs font-black uppercase tracking-[0.13em] text-dyoor-cyan">Open secure burn flow</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
