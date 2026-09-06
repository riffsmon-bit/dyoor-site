"use client";

import { formatUnits } from "ethers";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  claimRewardToDroid,
  selectFutureRewardStrategy,
} from "@/lib/droid-economy/client";
import type {
  DroidEconomyApiResponse,
  DroidEconomySnapshot,
  DroidRewardAllocationView,
} from "@/lib/droid-economy/types";
import { useWalletService } from "@/providers/WalletServiceProvider";

function shortHash(value: string) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

function displayAmount(raw: string, decimals: number) {
  try {
    const formatted = formatUnits(BigInt(raw), decimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmed = fraction.replace(/0+$/, "").slice(0, 8);
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return "Value unavailable";
  }
}

function friendlyError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const message = String(record?.shortMessage || record?.reason || record?.message || error || "");
  if (/reject|denied|cancel|closed/i.test(message)) return "The wallet request was cancelled. Nothing changed.";
  return message.slice(0, 260) || "The economic Droid request failed.";
}

function statusLabel(status: DroidRewardAllocationView["claimStatus"]) {
  return ({
    MODULE_DISABLED: "MODULE OFFLINE",
    EPOCH_PREPARED: "NOT ON-CHAIN",
    NOT_STARTED: "SCHEDULED",
    CLAIMABLE: "CLAIMABLE",
    CLAIMED: "CLAIMED",
    EXPIRED: "EXPIRED",
    VALUE_UNAVAILABLE: "READ UNAVAILABLE",
  } satisfies Record<DroidRewardAllocationView["claimStatus"], string>)[status];
}

function EconomySection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[1.5rem] border border-white/10 bg-[#0c110b]/95 p-5 shadow-[0_22px_70px_rgba(0,0,0,.28)] sm:p-6">
      <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/65">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-black uppercase tracking-[-0.035em] text-white sm:text-2xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function DroidEconomyPanel({
  chainId,
  tokenId,
  active,
  isOwner,
}: {
  chainId: number;
  tokenId: number;
  active: boolean;
  isOwner: boolean;
}) {
  const wallet = useWalletService();
  const [snapshot, setSnapshot] = useState<DroidEconomySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [selectedStrategy, setSelectedStrategy] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/droid-economy?chainId=${chainId}&tokenId=${tokenId}`, {
      cache: "no-store",
      signal,
    });
    const data = await response.json().catch(() => null) as DroidEconomyApiResponse | null;
    if (!response.ok || !data?.ok || !data.snapshot) {
      throw new Error(data?.error || "Economic Droid data is unavailable.");
    }
    setSnapshot(data.snapshot);
    setSelectedStrategy((current) => current || data.snapshot?.strategy?.strategyId || "");
    return data.snapshot;
  }, [chainId, tokenId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      load(controller.signal)
        .catch((caught) => setError(friendlyError(caught)))
        .finally(() => setLoading(false));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const currentStrategyLabel = useMemo(() => {
    if (!snapshot?.strategy) return "MANUAL / SETTLEMENT ASSET";
    return snapshot.config.strategyOptions.find(
      (option) => option.strategyId === snapshot.strategy?.strategyId.toLowerCase(),
    )?.label || shortHash(snapshot.strategy.strategyId);
  }, [snapshot]);

  async function claim(allocation: DroidRewardAllocationView) {
    if (!snapshot) return;
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Confirm claim to this Droid Account in your wallet.");
    setTransactionHash("");
    try {
      const provider = await wallet.getProvider();
      const hash = await claimRewardToDroid({
        provider,
        config: snapshot.config,
        tokenId,
        allocation,
      });
      setTransactionHash(hash);
      setMessage("Reward claimed to the Droid Account. Refreshing on-chain state.");
      await load();
    } catch (caught) {
      setError(friendlyError(caught));
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function changeStrategy(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !selectedStrategy) return;
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Confirm the future-reward strategy in your wallet.");
    setTransactionHash("");
    try {
      const provider = await wallet.getProvider();
      const hash = await selectFutureRewardStrategy({
        provider,
        config: snapshot.config,
        tokenId,
        strategyId: selectedStrategy,
      });
      setTransactionHash(hash);
      setMessage("Strategy updated for future eligible rewards. Existing assets were not sold.");
      await load();
    } catch (caught) {
      setError(friendlyError(caught));
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="h-72 animate-pulse rounded-[1.5rem] border border-white/[0.07] bg-white/[0.03]" />
        <div className="h-72 animate-pulse rounded-[1.5rem] border border-white/[0.07] bg-white/[0.03]" />
      </>
    );
  }

  if (!snapshot) {
    return (
      <section id="rewards" className="scroll-mt-24 rounded-[1.5rem] border border-red-300/20 bg-red-300/[0.05] p-5 lg:col-span-2">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-red-100">Economic telemetry unavailable</p>
        <p className="mt-2 text-sm font-semibold text-white/45">{error || "No financial state was fabricated."}</p>
      </section>
    );
  }

  const { config } = snapshot;
  const txUrl = transactionHash && config.explorerUrl
    ? `${config.explorerUrl}/tx/${transactionHash}`
    : "";

  return (
    <>
      <EconomySection id="rewards" eyebrow="Funded economic loop" title="Droid Rewards">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Native chain</p>
            <p className="mt-2 text-sm font-black text-white">{snapshot.nativeChain}</p>
            <p className="mt-1 font-mono text-[0.58rem] text-white/30">Chain {snapshot.identity.chainId}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Reward weight</p>
            <p className="mt-2 text-sm font-black text-white">{snapshot.rewardWeight ?? "Not published"}</p>
            <p className="mt-1 text-[0.58rem] font-bold uppercase text-white/25">Separate from Energy</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Pending epochs</p>
            <p className="mt-2 text-sm font-black text-white">{snapshot.pendingRewards.length}</p>
            <p className="mt-1 text-[0.58rem] font-bold uppercase text-white/25">Explicitly funded only</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Current funded reward pool", snapshot.rewardPool.currentFundedPool === null ? "Value unavailable" : "No funded assets"],
            ["Pending accounted revenue", snapshot.rewardPool.pendingAccountedRevenue === null ? "Value unavailable" : "None indexed"],
            ["Distributed rewards", snapshot.rewardPool.distributedRewards === null ? "Value unavailable" : "None indexed"],
            ["Next epoch", snapshot.rewardPool.nextEpoch || "Not scheduled"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-black/25 p-4">
              <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">{label}</p>
              <p className="mt-2 text-sm font-black uppercase text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-red-300/20 bg-red-300/[0.04] p-4">
          <div>
            <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Claims status</p>
            <p className="mt-1 text-sm font-black text-red-100">{snapshot.rewardPool.claimsStatus}</p>
          </div>
          <span className="rounded-full border border-sky-300/20 bg-sky-300/[0.05] px-3 py-2 text-[0.55rem] font-black uppercase tracking-[0.12em] text-sky-100">Coming soon / staged</span>
        </div>

        {!config.flags.droidRewardsEnabled ? (
          <div className="mt-4 rounded-xl border border-sky-300/20 bg-sky-300/[0.06] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-100">Droid Rewards — not active</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/40">Secondary-sale revenue actually received by the ecosystem may contribute to funded Droid Reward pools. Claims appear only after a funded epoch is deployed, verified, and separately enabled.</p>
          </div>
        ) : snapshot.pendingRewards.length ? (
          <div className="mt-4 space-y-3">
            {snapshot.pendingRewards.map((allocation) => (
              <div key={allocation.epochId} className="rounded-xl border border-[#c7ff00]/15 bg-black/25 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-white">{displayAmount(allocation.amount, allocation.assetDecimals)} {allocation.assetSymbol}</p>
                    <p className="mt-1 font-mono text-[0.58rem] text-white/25">Epoch {shortHash(allocation.epochId)}</p>
                  </div>
                  <span className="rounded-full border border-[#c7ff00]/20 px-2 py-1 text-[0.52rem] font-black uppercase tracking-[0.1em] text-[#c7ff00]/75">{statusLabel(allocation.claimStatus)}</span>
                </div>
                <button
                  type="button"
                  disabled={busy || !isOwner || !active || allocation.claimStatus !== "CLAIMABLE"}
                  onClick={() => void claim(allocation)}
                  className="mt-4 w-full rounded-xl bg-[#c7ff00] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-black disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {!active ? "Activate Droid first" : !isOwner ? "Current owner only" : "Claim to Droid"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-white/30">No funded, unclaimed reward epoch is published for this Droid.</p>
        )}

        {snapshot.lifetimeRewards.length ? (
          <div className="mt-5 border-t border-white/[0.07] pt-4">
            <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Lifetime claimed to Droid</p>
            <div className="mt-2 space-y-2">
              {snapshot.lifetimeRewards.map((reward) => (
                <div key={reward.asset} className="flex justify-between gap-3 text-sm font-bold"><span className="text-white/40">{reward.symbol}</span><span>{displayAmount(reward.amount, reward.decimals)}</span></div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Potential eligibility inputs</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.potentialEligibilityInputs.map((input) => (
              <span key={input} className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[0.55rem] font-black uppercase tracking-[0.1em] text-white/40">{input}</span>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold leading-5 text-white/30">These inputs describe a future configurable eligibility model. They do not guarantee an amount or turn Energy into money.</p>
        </div>
        <p className="mt-4 text-xs font-semibold leading-5 text-white/30">Energy is progression utility. It is not tokenized, assigned a dollar value, or converted into these assets.</p>
        {chainId === 143 ? (
          <Link href="/monad/ecosystem-revenue" className="mt-4 inline-flex rounded-xl border border-white/10 px-4 py-3 text-[0.58rem] font-black uppercase tracking-[0.12em] text-white/45 transition hover:border-[#c7ff00]/30 hover:text-[#c7ff00]">View staged ecosystem revenue →</Link>
        ) : null}
      </EconomySection>

      <EconomySection id="strategy" eyebrow="Future reward routing" title="Strategy">
        <div className="rounded-xl border border-white/10 bg-black/25 p-4">
          <p className="text-[0.55rem] font-black uppercase tracking-[0.13em] text-white/35">Current preference</p>
          <p className="mt-2 text-lg font-black uppercase text-white">{currentStrategyLabel}</p>
          {snapshot.strategy ? <p className="mt-1 font-mono text-[0.58rem] text-white/25">Version {snapshot.strategy.strategyVersion} · {shortHash(snapshot.strategy.strategyId)}</p> : null}
        </div>

        {!config.flags.droidStrategiesEnabled ? (
          <div className="mt-4 rounded-xl border border-sky-300/20 bg-sky-300/[0.06] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-100">Strategy registry staged — not enabled</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/40">V1 retains the approved settlement asset. No swap, rebalance, bridge, or autonomous trade is running.</p>
          </div>
        ) : config.strategyOptions.length ? (
          <form onSubmit={changeStrategy} className="mt-4 space-y-3">
            <select value={selectedStrategy} onChange={(event) => setSelectedStrategy(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm font-bold text-white outline-none focus:border-[#c7ff00]/50">
              <option value="">Select an approved strategy</option>
              {config.strategyOptions.map((option) => <option key={option.strategyId} value={option.strategyId}>{option.label}</option>)}
            </select>
            {config.strategyOptions.find((option) => option.strategyId === selectedStrategy)?.description ? <p className="text-xs font-semibold leading-5 text-white/35">{config.strategyOptions.find((option) => option.strategyId === selectedStrategy)?.description}</p> : null}
            <button disabled={busy || !isOwner || !selectedStrategy} className="w-full rounded-xl border border-[#c7ff00]/30 bg-[#c7ff00]/10 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-[#c7ff00] disabled:opacity-35">Change future strategy</button>
          </form>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-white/30">No reviewed strategy metadata is configured.</p>
        )}
        <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-[0.13em] text-amber-100">Future rewards only</p>
          <p className="mt-2 text-xs font-semibold leading-5 text-amber-50/50">Changing this preference never sells, bridges, or reallocates assets already held by the Droid Account.</p>
        </div>

        {(message || error) ? <p className={`mt-4 rounded-xl border p-3 text-xs font-bold ${error ? "border-red-300/20 bg-red-300/[0.06] text-red-100" : "border-[#c7ff00]/20 bg-[#c7ff00]/[0.05] text-[#c7ff00]"}`}>{error || message}{txUrl ? <a href={txUrl} target="_blank" rel="noreferrer" className="ml-2 underline">View transaction ↗</a> : null}</p> : null}
        {snapshot.partialErrors.length ? <p className="mt-4 text-[0.68rem] font-semibold leading-5 text-white/25">{snapshot.partialErrors.join(" ")}</p> : null}
      </EconomySection>

      <EconomySection id="achievements" eyebrow="Progression signal" title="Achievements">
        {snapshot.achievements.length ? (
          <div className="space-y-3">
            {snapshot.achievements.map((achievement) => (
              <div key={achievement.achievementId} className="rounded-xl border border-[#c7ff00]/15 bg-[#c7ff00]/[0.04] p-4">
                <p className="font-mono text-xs font-black text-white">{shortHash(achievement.achievementId)}</p>
                <p className="mt-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]/60">Verified progression record</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-5 text-center">
            <p className="text-sm font-black uppercase text-white/45">No achievements published</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/30">The achievement foundation is staged. No hidden financial modifier is applied.</p>
          </div>
        )}
      </EconomySection>
    </>
  );
}
