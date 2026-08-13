"use client";

import { ZeroAddress, keccak256, toUtf8Bytes } from "ethers";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WalletButton } from "@/components/wallet/WalletButton";
import { createAdminAuthorization } from "@/lib/adminMessage";
import type {
  DroidEconomyConfig,
  RewardEpochManifest,
  RewardEpochManifestSummary,
  RewardManifestAllocationInput,
} from "@/lib/droid-economy/types";
import { useWalletService } from "@/providers/WalletServiceProvider";

type AdminStatus = {
  ok?: boolean;
  authorized?: boolean;
  ownerConfigured?: boolean;
  config?: DroidEconomyConfig;
  manifests?: RewardEpochManifestSummary[];
  manifest?: RewardEpochManifest;
  broadcastEnabled?: boolean;
  error?: string;
};

function normalizeWallet(value?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "") ? String(value).toLowerCase() : "";
}

function localDateValue(offsetHours: number) {
  const value = new Date(Date.now() + offsetHours * 60 * 60 * 1_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function unixSeconds(value: string) {
  return Math.floor(new Date(value).getTime() / 1_000);
}

function short(value: string) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

function moduleCards(status: AdminStatus | null) {
  const addresses = status?.config?.addresses;
  return [
    ["REVENUE", addresses?.revenueVault],
    ["REWARDS", addresses?.rewardsDistributor],
    ["STRATEGIES", addresses?.strategyRegistry],
    ["ASSETS", addresses?.assetRegistry],
    ["TREASURY", addresses?.revenueVault],
    ["DROID ACTIVITY", addresses?.droidRegistry],
    ["SECURITY", addresses?.achievementRegistry],
  ] as const;
}

export default function DroidEconomyAdminPage() {
  const wallet = useWalletService();
  const walletAddress = normalizeWallet(wallet.address);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [notice, setNotice] = useState("Connect the configured owner wallet to prepare a reward epoch.");
  const [working, setWorking] = useState(false);
  const [manifest, setManifest] = useState<RewardEpochManifest | null>(null);
  const [epochId, setEpochId] = useState(() => keccak256(toUtf8Bytes(`HoodYoor reward epoch ${new Date().toISOString()}`)));
  const [asset, setAsset] = useState(ZeroAddress);
  const [assetSymbol, setAssetSymbol] = useState("ETH");
  const [assetDecimals, setAssetDecimals] = useState("18");
  const [startsAt, setStartsAt] = useState(() => localDateValue(1));
  const [endsAt, setEndsAt] = useState(() => localDateValue(24 * 30));
  const [metadataUri, setMetadataUri] = useState("");
  const [allocationJson, setAllocationJson] = useState("[]");
  const [onchainEpochId, setOnchainEpochId] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  const authorized = Boolean(status?.authorized && walletAddress);
  const parsedCount = useMemo(() => {
    try {
      const parsed = JSON.parse(allocationJson) as unknown;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }, [allocationJson]);

  async function loadStatus() {
    if (!walletAddress) {
      setStatus(null);
      return;
    }
    const response = await fetch(`/api/admin/droid-economy?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as AdminStatus;
    setStatus(data);
    setNotice(data.authorized
      ? "Owner wallet recognized. Every change still requires a fresh signed payload."
      : "Connected wallet is not the configured admin owner.");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  async function signedPost(payload: Record<string, unknown>) {
    if (!walletAddress) throw new Error("Connect the configured owner wallet.");
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const authorization = createAdminAuthorization({
      wallet: walletAddress,
      timestamp,
      nonce,
      action: "droid-economy",
      route: "/api/admin/droid-economy",
      payload,
      chainId: status?.config?.chainId || 4663,
    });
    const signature = await wallet.signMessage(authorization.message);
    const { message: _message, ...fields } = authorization;
    const response = await fetch("/api/admin/droid-economy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: walletAddress, timestamp, nonce, signature, ...fields, ...payload }),
    });
    const data = await response.json().catch(() => ({})) as AdminStatus;
    if (!response.ok || !data.ok) throw new Error(data.error || "Economic admin request failed.");
    return data;
  }

  async function prepareEpoch() {
    if (!authorized) return;
    setWorking(true);
    setNotice("Validating every chain-qualified account and building the Merkle manifest.");
    try {
      const allocations = JSON.parse(allocationJson) as RewardManifestAllocationInput[];
      const payload = {
        mode: "prepare-epoch",
        epochId,
        targetChainId: status?.config?.chainId,
        asset,
        assetSymbol,
        assetDecimals: Number(assetDecimals),
        startsAt: unixSeconds(startsAt),
        endsAt: unixSeconds(endsAt),
        metadataUri,
        allocations,
      };
      const data = await signedPost(payload);
      setManifest(data.manifest || null);
      setOnchainEpochId(data.manifest?.epochId || epochId);
      setNotice("Manifest prepared and saved. No transaction was broadcast. Review it before deployment preflight.");
      await loadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Reward manifest preparation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function markOnchain() {
    if (!authorized) return;
    setWorking(true);
    setNotice("Verifying the receipt and RewardEpochCreated event against the immutable manifest.");
    try {
      const data = await signedPost({
        mode: "mark-epoch-onchain",
        epochId: onchainEpochId,
        transactionHash,
      });
      setManifest(data.manifest || null);
      setNotice("On-chain epoch event matches the prepared root, asset, total, and manifest hash.");
      await loadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Epoch verification failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070a06] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-[0.6rem] font-black uppercase tracking-[0.17em] text-[#c7ff00]/60">← Admin command center</Link>
            <p className="mt-5 text-[0.62rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]">Economic Droid control plane</p>
            <h1 className="mt-3 text-4xl font-black uppercase tracking-[-0.06em] sm:text-6xl">Revenue / Rewards</h1>
            <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-white/45">Prepare transparent reward epochs, inspect module wiring, and verify receipts. This workstation contains no deployment or broadcast button.</p>
          </div>
          <WalletButton />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {moduleCards(status).map(([label, address]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-[#0c110b] p-4">
              <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/35">{label}</p>
              <p className={`mt-3 text-xs font-black uppercase ${address ? "text-[#c7ff00]" : "text-white/30"}`}>{address ? "Configured" : "Not deployed"}</p>
              <p className="mt-2 truncate font-mono text-[0.55rem] text-white/20">{address || "—"}</p>
            </div>
          ))}
        </div>

        <div className={`mt-6 rounded-2xl border p-4 ${authorized ? "border-[#c7ff00]/25 bg-[#c7ff00]/[0.05]" : "border-amber-300/20 bg-amber-300/[0.05]"}`}>
          <p className="text-sm font-bold text-white/60">{notice}</p>
          <p className="mt-2 text-[0.62rem] font-black uppercase tracking-[0.12em] text-white/25">Broadcast enabled: NEVER · Bridge: OFF · Agent: OFF</p>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Reward engine</p>
            <h2 className="mt-2 text-2xl font-black uppercase">Prepare funded epoch</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="text-xs font-black uppercase text-white/40">Epoch ID (bytes32)</span><input value={epochId} onChange={(event) => setEpochId(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-xs outline-none focus:border-[#c7ff00]/40" /></label>
              <label><span className="text-xs font-black uppercase text-white/40">Asset contract</span><input value={asset} onChange={(event) => setAsset(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-xs outline-none focus:border-[#c7ff00]/40" /></label>
              <div className="grid grid-cols-[1fr_5rem] gap-2"><label><span className="text-xs font-black uppercase text-white/40">Symbol</span><input value={assetSymbol} onChange={(event) => setAssetSymbol(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm font-bold outline-none" /></label><label><span className="text-xs font-black uppercase text-white/40">Decimals</span><input value={assetDecimals} onChange={(event) => setAssetDecimals(event.target.value)} inputMode="numeric" className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm font-bold outline-none" /></label></div>
              <label><span className="text-xs font-black uppercase text-white/40">Starts</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm outline-none" /></label>
              <label><span className="text-xs font-black uppercase text-white/40">Ends</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm outline-none" /></label>
              <label className="sm:col-span-2"><span className="text-xs font-black uppercase text-white/40">Public metadata URI</span><input value={metadataUri} onChange={(event) => setMetadataUri(event.target.value)} placeholder="ipfs://…" className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm outline-none" /></label>
              <label className="sm:col-span-2"><span className="text-xs font-black uppercase text-white/40">Allocations JSON · {parsedCount} rows</span><textarea value={allocationJson} onChange={(event) => setAllocationJson(event.target.value)} rows={13} spellCheck={false} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-xs leading-5 outline-none focus:border-[#c7ff00]/40" /></label>
            </div>
            <button type="button" onClick={() => void prepareEpoch()} disabled={!authorized || working || parsedCount === 0} className="mt-5 w-full rounded-xl bg-[#c7ff00] px-5 py-4 text-xs font-black uppercase tracking-[0.13em] text-black disabled:opacity-35">{working ? "Validating…" : "Prepare manifest — no broadcast"}</button>
          </section>

          <div className="space-y-6">
            <section className="rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Manifest review</p>
              <h2 className="mt-2 text-2xl font-black uppercase">Immutable commitment</h2>
              {manifest ? (
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-white/35">Root</span><span className="font-mono">{short(manifest.merkleRoot)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-white/35">Manifest</span><span className="font-mono">{short(manifest.manifestHash)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-white/35">Allocations</span><span>{manifest.allocationCount}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-white/35">Atomic total</span><span className="font-mono">{manifest.totalAllocated}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-white/35">Status</span><span className="font-black uppercase text-[#c7ff00]">{manifest.deploymentStatus}</span></div>
                  <pre className="max-h-80 overflow-auto rounded-xl border border-white/10 bg-black p-3 text-[0.58rem] leading-4 text-white/35">{JSON.stringify(manifest, null, 2)}</pre>
                </div>
              ) : <p className="mt-5 text-sm font-semibold leading-6 text-white/30">A prepared root, content hash, exact total, and per-Droid proofs will appear here. Preparation does not create a financial promise or transaction.</p>}
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Post-deployment verification</p>
              <h2 className="mt-2 text-2xl font-black uppercase">Match receipt</h2>
              <input value={onchainEpochId} onChange={(event) => setOnchainEpochId(event.target.value)} placeholder="Epoch ID" className="mt-5 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-xs outline-none" />
              <input value={transactionHash} onChange={(event) => setTransactionHash(event.target.value)} placeholder="Creation transaction 0x…" className="mt-3 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-xs outline-none" />
              <button type="button" onClick={() => void markOnchain()} disabled={!authorized || working || !onchainEpochId || !transactionHash} className="mt-3 w-full rounded-xl border border-[#c7ff00]/30 bg-[#c7ff00]/10 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-[#c7ff00] disabled:opacity-35">Verify event — no broadcast</button>
            </section>
          </div>
        </div>

        <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-5 sm:p-6">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-[#c7ff00]/60">Prepared history</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-[0.55rem] font-black uppercase tracking-[0.12em] text-white/30"><tr><th className="pb-3">Epoch</th><th className="pb-3">Asset</th><th className="pb-3">Allocations</th><th className="pb-3">Atomic total</th><th className="pb-3">Status</th><th className="pb-3">Prepared</th></tr></thead>
              <tbody>{(status?.manifests || []).map((item) => <tr key={item.epochId} className="border-t border-white/[0.07]"><td className="py-3 font-mono">{short(item.epochId)}</td><td>{item.assetSymbol}</td><td>{item.allocationCount}</td><td className="font-mono">{item.totalAllocated}</td><td className="font-black uppercase text-[#c7ff00]/70">{item.deploymentStatus}</td><td>{new Date(item.preparedAt).toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
