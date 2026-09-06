"use client";

import { formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  STAGED_REVENUE_SPLIT,
  previewRevenueSplit,
} from "@/lib/droid-economy/revenue";
import type {
  EcosystemRevenueApiResponse,
  EcosystemRevenueSnapshot,
  RevenueAssetAmount,
} from "@/lib/droid-economy/types";

function shortAddress(value: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "UNSET";
}

function formatRaw(raw: string, decimals: number) {
  try {
    const value = formatUnits(BigInt(raw), decimals);
    const [whole, fraction = ""] = value.split(".");
    const trimmed = fraction.replace(/0+$/, "").slice(0, 8);
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return "Value unavailable";
  }
}

function amountList(amounts: RevenueAssetAmount[] | null, empty: string) {
  if (amounts === null) return <span className="text-white/35">Value unavailable</span>;
  if (!amounts.length) return <span className="text-white/35">{empty}</span>;
  return (
    <span className="space-y-1">
      {amounts.map((amount) => (
        <span key={amount.asset} className="block font-mono text-white">
          {formatRaw(amount.rawAmount, amount.decimals)} {amount.symbol}
        </span>
      ))}
    </span>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/35">{label}</p>
      <div className="mt-3 text-lg font-black uppercase text-white">{children}</div>
    </div>
  );
}

export function EcosystemRevenueDashboard({
  chainId = 143,
  compact = false,
}: {
  chainId?: number;
  compact?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<EcosystemRevenueSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [simulationAmount, setSimulationAmount] = useState("10");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/ecosystem-revenue?chainId=${chainId}`, {
      cache: "no-store",
      signal,
    });
    const body = await response.json().catch(() => null) as EcosystemRevenueApiResponse | null;
    if (!response.ok || !body?.ok || !body.snapshot) {
      throw new Error(body?.error || "Ecosystem revenue telemetry is unavailable.");
    }
    setSnapshot(body.snapshot);
  }, [chainId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      load(controller.signal)
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Revenue read failed."))
        .finally(() => setLoading(false));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const preview = useMemo(() => {
    try {
      const gross = parseUnits(simulationAmount || "0", 18);
      if (gross < 0n) return null;
      return previewRevenueSplit(gross, snapshot?.policy || STAGED_REVENUE_SPLIT);
    } catch {
      return null;
    }
  }, [simulationAmount, snapshot]);

  if (loading) {
    return <div className="h-[32rem] animate-pulse rounded-[1.75rem] border border-white/[0.07] bg-white/[0.03]" />;
  }

  if (!snapshot) {
    return (
      <section className="rounded-[1.75rem] border border-red-300/20 bg-red-300/[0.05] p-6">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-red-100">Revenue telemetry unavailable</p>
        <p className="mt-2 text-sm font-semibold text-white/45">{error || "No revenue balance was fabricated."}</p>
      </section>
    );
  }

  const secondary = snapshot.sources.find(
    (source) => source.sourceKind === "SECONDARY_MARKET_REVENUE",
  );
  const policy = snapshot.policy;

  return (
    <div className="space-y-6" data-testid="ecosystem-revenue-dashboard">
      <section id="revenue-summary" className="scroll-mt-8 overflow-hidden rounded-[1.75rem] border border-[#c7ff00]/20 bg-[#0c110b] shadow-[0_28px_90px_rgba(0,0,0,.36)]">
        <div className="border-b border-white/[0.07] p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/65">Collection economic telemetry</p>
              <h2 className="mt-2 text-3xl font-black uppercase tracking-[-0.05em] text-white sm:text-4xl">Ecosystem Revenue</h2>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-white/40">
                Secondary-sale revenue actually received by the ecosystem may contribute to funded Droid Reward pools. Sale value is never counted as creator revenue by itself.
              </p>
            </div>
            <span className="w-fit rounded-full border border-amber-300/25 bg-amber-300/[0.07] px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.13em] text-amber-100">
              Proposed / staged
            </span>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
          <Metric label="Total verified revenue received">
            {amountList(snapshot.totalVerifiedRevenueReceived, "No verified receipts indexed")}
          </Metric>
          <Metric label="Secondary-market revenue received">
            {amountList(snapshot.secondaryMarketRevenueReceived, "No verified receipts indexed")}
          </Metric>
          <Metric label="Other revenue received">
            {amountList(snapshot.otherRevenueReceived, "No verified receipts indexed")}
          </Metric>
          <Metric label="Receipt coverage">
            <span className="text-amber-100">Partial</span>
            <span className="mt-1 block text-[0.58rem] tracking-normal text-white/30">{snapshot.verifiedReceiptCount} proof-backed receipt(s)</span>
          </Metric>
        </div>

        <div className="grid gap-3 border-t border-white/[0.07] p-5 sm:grid-cols-3 sm:p-7">
          {[
            ["Project Treasury", policy.projectTreasuryBps, "Operational runway and reserves"],
            ["Droid Reward Allocation", policy.droidRewardsBps, "Future funded reward pool"],
            ["Other Approved", policy.otherApprovedBps, "Transparent approved uses only"],
          ].map(([label, bps, description]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-black/25 p-5">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-white/40">{label}</p>
              <p className="mt-2 text-4xl font-black tracking-[-0.06em] text-[#c7ff00]">{Number(bps) / 100}%</p>
              <p className="mt-2 text-xs font-semibold leading-5 text-white/30">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className={`grid gap-6 ${compact ? "" : "lg:grid-cols-[1.05fr_0.95fr]"}`}>
        <section id="secondary-sale-preview" className="scroll-mt-8 rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Secondary-sale revenue preview</p>
          <h3 className="mt-2 text-2xl font-black uppercase text-white">Actual receipt → staged allocation</h3>
          <p className="mt-3 text-xs font-semibold leading-5 text-white/35">
            Simulation only. This does not move funds, fund an epoch, or enable claims.
          </p>
          <label className="mt-5 block">
            <span className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-white/40">Verified creator revenue received · MON</span>
            <input
              value={simulationAmount}
              onChange={(event) => setSimulationAmount(event.target.value)}
              inputMode="decimal"
              aria-label="Simulated verified creator revenue"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-xl font-black text-white outline-none focus:border-[#c7ff00]/45"
            />
          </label>
          {preview ? (
            <div className="mt-4 space-y-2">
              {[
                ["Project Treasury", preview.projectTreasuryAmount],
                ["Droid Reward Pool", preview.droidRewardsAmount],
                ["Other Approved", preview.otherApprovedAmount],
              ].map(([label, amount]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3">
                  <span className="text-xs font-black uppercase tracking-[0.1em] text-white/40">{label}</span>
                  <span className="font-mono text-sm font-black text-white">{formatRaw(String(amount), 18)} MON</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-red-300/20 bg-red-300/[0.05] p-3 text-xs font-bold text-red-100">Enter a valid non-negative amount.</p>
          )}
          <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs font-semibold leading-5 text-amber-50/55">
            Marketplace creator revenue is not guaranteed. Only a verified receipt at an approved destination can enter ecosystem accounting.
          </p>
        </section>

        <section id="droid-reward-pool" className="scroll-mt-8 rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Droid Rewards pool</p>
          <h3 className="mt-2 text-2xl font-black uppercase text-white">Coming soon / staged</h3>
          <div className="mt-5 space-y-3">
            {[
              ["Current funded reward pool", amountList(snapshot.rewardPool.currentFundedPool, "Value unavailable")],
              ["Pending accounted revenue", amountList(snapshot.rewardPool.pendingAccountedRevenue, "Value unavailable")],
              ["Distributed rewards", amountList(snapshot.rewardPool.distributedRewards, "Value unavailable")],
              ["Next epoch", <span key="epoch">{snapshot.rewardPool.nextEpoch || "Not scheduled"}</span>],
              ["Claims status", <span key="claims" className="text-red-100">{snapshot.rewardPool.claimsStatus}</span>],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-start justify-between gap-4 border-b border-white/[0.07] pb-3 text-sm">
                <span className="font-bold text-white/35">{label}</span>
                <span className="text-right font-black uppercase text-white">{value}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs font-semibold leading-5 text-white/30">Rewards are funded and eligibility-based. No reward balance is inferred from Energy or marketplace sale volume.</p>
        </section>
      </div>

      {!compact ? (
        <section id="revenue-sources" className="scroll-mt-8 rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Admin revenue sources</p>
              <h3 className="mt-2 text-2xl font-black uppercase text-white">Receipt registry</h3>
            </div>
            <p className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-white/25">Unknown sources default inactive</p>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="text-[0.54rem] font-black uppercase tracking-[0.12em] text-white/30">
                <tr><th className="pb-3">Source name</th><th className="pb-3">Chain</th><th className="pb-3">Receiver</th><th className="pb-3">Asset</th><th className="pb-3">Verified?</th><th className="pb-3">Active?</th><th className="pb-3">Total received</th><th className="pb-3">Reward eligible?</th></tr>
              </thead>
              <tbody>
                {snapshot.sources.map((source) => (
                  <tr key={source.sourceKind} className="border-t border-white/[0.07]">
                    <td className="py-4 pr-4"><p className="font-black text-white">{source.name}</p><p className="mt-1 max-w-xs text-[0.58rem] leading-4 text-white/25">{source.notes}</p></td>
                    <td className="pr-4 font-black text-white/45">{source.chainId}</td>
                    <td className="pr-4 font-mono text-white/45" title={source.receiver}>{shortAddress(source.receiver)}</td>
                    <td className="pr-4 font-black text-white/45">{source.assetSymbol || "UNSET"}</td>
                    <td className="pr-4 font-black text-white/45">{source.verified ? "YES" : "NO"}</td>
                    <td className="pr-4 font-black text-red-100">{source.active ? "YES" : "NO"}</td>
                    <td className="pr-4 font-bold">{amountList(source.totalReceived, "No indexed receipts")}</td>
                    <td className="font-black text-red-100">{source.rewardEligible ? "YES" : "NO"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {secondary?.receiver ? (
            <p className="mt-4 font-mono text-[0.62rem] text-white/30">Verified configured creator receiver: {secondary.receiver}</p>
          ) : null}
        </section>
      ) : null}

      {snapshot.warnings.length ? (
        <aside className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/35">Accounting limits</p>
          <ul className="mt-3 space-y-2 text-xs font-semibold leading-5 text-white/35">
            {snapshot.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
