"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DroidAssetTransferWarning } from "@/components/robinhood/droids/DroidAssetTransferWarning";
import { DroidEconomyPanel } from "@/components/robinhood/droids/DroidEconomyPanel";
import { DroidTradingPanel } from "@/components/robinhood/droids/DroidTradingPanel";
import {
  activateDroidAccount,
  fundDroidWithEth,
  fundDroidWithToken,
  withdrawDroidEth,
  withdrawDroidNft,
  withdrawDroidToken,
} from "@/lib/droid-accounts/client";
import type {
  DroidAccountApiResponse,
  DroidAccountSnapshot,
  DroidConfiguredToken,
  DroidNftInventoryItem,
  DroidProtocolConfig,
} from "@/lib/droid-accounts/types";
import {
  isSupportedDroidChainId,
  providerDroidChainId,
  switchProviderToDroidChain,
} from "@/lib/droid-accounts/network";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Operation =
  | "idle"
  | "connecting"
  | "switching"
  | "activating"
  | "funding"
  | "withdrawing";

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

function sameAddress(left: string, right: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function friendlyError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const message = String(record?.shortMessage || record?.reason || record?.message || error || "");
  if (/reject|denied|cancel|closed/i.test(message)) {
    return "The wallet request was cancelled. Nothing was changed or spent.";
  }
  if (/insufficient funds/i.test(message)) return "The wallet does not have enough native currency for this action and gas.";
  return message.replace(/\s*\(action=.*$/s, "").slice(0, 280)
    || "The Droid Account request failed. Try again.";
}

function positiveRaw(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function energyLabel(value: string, decimals: number) {
  try {
    const raw = BigInt(value);
    if (!decimals) return raw.toLocaleString("en-US");
    const scale = 10n ** BigInt(decimals);
    const whole = raw / scale;
    const fraction = (raw % scale).toString().padStart(decimals, "0")
      .replace(/0+$/, "").slice(0, 4);
    return fraction
      ? `${whole.toLocaleString("en-US")}.${fraction}`
      : whole.toLocaleString("en-US");
  } catch {
    return value;
  }
}

function externalAddressUrl(config: DroidProtocolConfig, address: string) {
  return config.explorerUrl && address ? `${config.explorerUrl}/address/${address}` : "";
}

function externalTxUrl(config: DroidProtocolConfig, hash: string) {
  return config.explorerUrl && hash ? `${config.explorerUrl}/tx/${hash}` : "";
}

function externalNftUrl(config: DroidProtocolConfig, tokenId: number) {
  return config.explorerUrl && config.collectionAddress
    ? `${config.explorerUrl}/nft/${config.collectionAddress}/${tokenId}`
    : "";
}

function externalInventoryNftUrl(
  config: DroidProtocolConfig,
  collectionAddress: string,
  tokenId: string,
) {
  return config.explorerUrl && collectionAddress
    ? `${config.explorerUrl}/nft/${collectionAddress}/${tokenId}`
    : "";
}

function NftInventoryArtwork({ nft }: { nft: DroidNftInventoryItem }) {
  const fallback = nft.collectionName.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()
    || "NFT";
  const backgroundImage = nft.imageUrls
    .map((url) => `url("${url.replaceAll('"', "%22")}")`)
    .join(", ");
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#11150e]">
      <span className="absolute inset-0 grid place-items-center text-xs font-black uppercase tracking-[0.12em] text-[#c7ff00]/45">
        {fallback}
      </span>
      {backgroundImage ? (
        <span
          aria-label={`${nft.collectionName} #${nft.tokenId} artwork`}
          role="img"
          className="absolute inset-0 bg-cover bg-center [image-rendering:auto]"
          style={{ backgroundImage }}
        />
      ) : null}
    </div>
  );
}

function activityTime(timestamp: number | null) {
  if (!timestamp) return "Timestamp syncing";
  return new Date(timestamp * 1_000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.15em] ${
      active
        ? "border-[#c7ff00]/35 bg-[#c7ff00]/10 text-[#c7ff00]"
        : "border-white/15 bg-white/[0.04] text-white/45"
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#c7ff00] shadow-[0_0_10px_#c7ff00]" : "bg-white/30"}`} />
      {label}
    </span>
  );
}

function Panel({
  id,
  eyebrow,
  title,
  children,
  className = "",
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 rounded-[1.5rem] border border-white/10 bg-[#0c110b]/95 p-5 shadow-[0_22px_70px_rgba(0,0,0,.28)] sm:p-6 ${className}`}>
      <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/65">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-black uppercase tracking-[-0.035em] text-white sm:text-2xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function DataRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2 border-b border-white/[0.07] py-3 last:border-0 sm:flex-row sm:justify-between sm:gap-4">
      <span className="shrink-0 text-[0.62rem] font-black uppercase tracking-[0.14em] text-white/35">{label}</span>
      <span className={`block w-full min-w-0 max-w-full whitespace-normal break-all text-left text-sm font-bold text-white/80 [overflow-wrap:anywhere] sm:w-auto sm:text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export function DroidAccountClient({
  tokenId,
  chainId = 4_663,
  basePath = "/robinhood/droids",
}: {
  tokenId: number;
  chainId?: number;
  basePath?: string;
}) {
  const wallet = useWalletService();
  const [payload, setPayload] = useState<DroidAccountApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [operation, setOperation] = useState<Operation>("idle");
  const [actionError, setActionError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [walletChainId, setWalletChainId] = useState(0);
  const [fundAsset, setFundAsset] = useState("native");
  const [fundAmount, setFundAmount] = useState("");
  const [sendAsset, setSendAsset] = useState("native");
  const [sendAmount, setSendAmount] = useState("");
  const [sendRecipient, setSendRecipient] = useState("");
  const [nftRecipients, setNftRecipients] = useState<Record<string, string>>({});
  const [copiedAddress, setCopiedAddress] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const owner = wallet.address ? `&owner=${encodeURIComponent(wallet.address)}` : "";
    const response = await fetch(
      `/api/droid-accounts?chainId=${chainId}&tokenId=${tokenId}${owner}`,
      { cache: "no-store", signal },
    );
    const data = await response.json().catch(() => null) as DroidAccountApiResponse | null;
    if (!response.ok || !data?.ok || !data.droid) {
      throw new Error(data?.error || "Droid Account data is unavailable.");
    }
    setPayload(data);
    setReadError("");
    return data;
  }, [chainId, tokenId, wallet.address]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      load(controller.signal)
        .catch((caught) => {
          if (!controller.signal.aborted) setReadError(friendlyError(caught));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    let provider: Awaited<ReturnType<typeof wallet.getProvider>> | null = null;
    const update = (value: unknown) => {
      try {
        const parsed = Number(BigInt(String(value || 0)));
        if (active) setWalletChainId(parsed);
      } catch {
        if (active) setWalletChainId(0);
      }
    };
    if (!wallet.address) {
      return;
    }
    wallet.getProvider().then(async (nextProvider) => {
      provider = nextProvider;
      provider.on?.("chainChanged", update);
      update(await nextProvider.request({ method: "eth_chainId" }));
    }).catch(() => {
      if (active) setWalletChainId(0);
    });
    return () => {
      active = false;
      provider?.removeListener?.("chainChanged", update);
    };
  }, [wallet, wallet.address]);

  const droid = payload?.droid || null;
  const config = payload?.config || null;
  const isOwner = Boolean(droid && wallet.address && sameAddress(droid.owner, wallet.address));
  const correctNetwork = Boolean(config && walletChainId === config.chainId);
  const busy = operation !== "idle";
  const selectedFundToken = useMemo(
    () => config?.tokens.find((token) => sameAddress(token.address, fundAsset)) || null,
    [config, fundAsset],
  );
  const selectedSendToken = useMemo(
    () => config?.tokens.find((token) => sameAddress(token.address, sendAsset)) || null,
    [config, sendAsset],
  );

  async function copyDroidAddress() {
    if (!droid?.accountAddress || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(droid.accountAddress);
      setCopiedAddress(true);
      window.setTimeout(() => setCopiedAddress(false), 1_800);
    } catch {
      setCopiedAddress(false);
    }
  }

  async function connect() {
    setActionError("");
    setOperation("connecting");
    try {
      await wallet.connect();
    } catch (caught) {
      setActionError(friendlyError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function switchNetwork() {
    if (!config || !isSupportedDroidChainId(config.chainId)) return;
    setActionError("");
    setOperation("switching");
    try {
      const provider = await wallet.getProvider();
      await switchProviderToDroidChain(provider, config.chainId);
      setWalletChainId(await providerDroidChainId(provider));
    } catch (caught) {
      setActionError(friendlyError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function activate() {
    if (!config || !droid) return;
    if (!wallet.address) return await connect();
    if (!correctNetwork) return await switchNetwork();
    setActionError("");
    setTransactionHash("");
    setOperation("activating");
    try {
      const provider = await wallet.getProvider();
      const result = await activateDroidAccount({
        provider,
        config,
        tokenId,
        expectedAccount: droid.accountAddress,
      });
      setTransactionHash(result.transactionHash);
      await load();
    } catch (caught) {
      setActionError(friendlyError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function fund(event: FormEvent) {
    event.preventDefault();
    if (!config || !droid) return;
    setActionError("");
    setTransactionHash("");
    setOperation("funding");
    try {
      const provider = await wallet.getProvider();
      const hash = selectedFundToken
        ? await fundDroidWithToken({
            provider,
            config,
            accountAddress: droid.accountAddress,
            tokenAddress: selectedFundToken.address,
            decimals: selectedFundToken.decimals,
            amount: fundAmount,
          })
        : await fundDroidWithEth({
            provider,
            config,
            accountAddress: droid.accountAddress,
            amount: fundAmount,
          });
      setTransactionHash(hash);
      setFundAmount("");
      await load();
    } catch (caught) {
      setActionError(friendlyError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (!config || !droid) return;
    setActionError("");
    setTransactionHash("");
    setOperation("withdrawing");
    try {
      const provider = await wallet.getProvider();
      const hash = selectedSendToken
        ? await withdrawDroidToken({
            provider,
            config,
            accountAddress: droid.accountAddress,
            tokenId,
            tokenAddress: selectedSendToken.address,
            decimals: selectedSendToken.decimals,
            recipient: sendRecipient,
            amount: sendAmount,
          })
        : await withdrawDroidEth({
            provider,
            config,
            accountAddress: droid.accountAddress,
            tokenId,
            recipient: sendRecipient,
            amount: sendAmount,
          });
      setTransactionHash(hash);
      setSendAmount("");
      await load();
    } catch (caught) {
      setActionError(friendlyError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function withdrawNft(collection: string, nftTokenId: string) {
    if (!config || !droid) return;
    const key = `${collection}:${nftTokenId}`;
    setActionError("");
    setTransactionHash("");
    setOperation("withdrawing");
    try {
      const provider = await wallet.getProvider();
      const hash = await withdrawDroidNft({
        provider,
        config,
        accountAddress: droid.accountAddress,
        tokenId,
        nftCollection: collection,
        nftTokenId,
        recipient: nftRecipients[key] || "",
      });
      setTransactionHash(hash);
      setNftRecipients((current) => ({ ...current, [key]: "" }));
      await load();
    } catch (caught) {
      setActionError(friendlyError(caught));
    } finally {
      setOperation("idle");
    }
  }

  if (loading && !droid) {
    return <DroidLoading tokenId={tokenId} siteTheme={chainId === 143} />;
  }

  if (readError || !droid || !config) {
    return (
      <main className={`grid min-h-screen place-items-center px-5 text-white ${chainId === 143 ? "dyoor-site-droid-theme bg-[#03030a]" : "bg-[#070a06]"}`}>
        <div className="w-full max-w-lg rounded-[1.5rem] border border-red-300/25 bg-red-300/[0.06] p-7 text-center">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-200">Droid link offline</p>
          <h1 className="mt-3 text-3xl font-black uppercase">Droid #{tokenId}</h1>
          <p className="mt-4 text-sm font-semibold leading-6 text-white/55">{readError || "Droid Account data is unavailable."}</p>
          <Link href={basePath} className="mt-6 inline-flex rounded-xl bg-[#c7ff00] px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-black">Return to squad</Link>
        </div>
      </main>
    );
  }

  const txUrl = externalTxUrl(config, transactionHash);
  const accountUrl = externalAddressUrl(config, droid.accountAddress);
  const nftUrl = externalNftUrl(config, tokenId);
  const activation = droid.activity.find((item) => item.kind === "activated");
  const activationUrl = activation ? externalTxUrl(config, activation.transactionHash) : "";
  const stageOneEnabled = config.activationEnabled
    && config.activationMode === "allowlist"
    && config.activationTokenIds.includes(tokenId);
  const accountStatus = droid.active
    ? stageOneEnabled
      ? "Active — Stage 1"
      : config.activationMode === "general"
        ? "Wallet active"
        : "Canary active · Stage 1 staged"
    : "Wallet not activated";

  return (
    <main className={`relative min-h-screen w-full max-w-full overflow-hidden text-white selection:bg-[#c7ff00]/35 ${config.chainId === 143 ? "dyoor-site-droid-theme bg-[#03030a]" : "bg-[#070a06]"}`}>
      <div className="droid-os-grid pointer-events-none fixed inset-0 opacity-25 [background-image:linear-gradient(rgba(199,255,0,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(199,255,0,.055)_1px,transparent_1px)] [background-size:40px_40px]" />
      <header className="sticky top-0 z-40 border-b border-[#c7ff00]/15 bg-[#070a06]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={basePath} className="flex min-w-0 items-center gap-3">
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-[#c7ff00]">
              <Image src={config.chainId === 143 ? "/assets/dyoor-logo.png" : "/assets/robinhood/hoodyoor-robinhood-feather-logo.png"} alt="" fill sizes="36px" className="object-cover" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black uppercase tracking-[-0.02em]">{config.collectionName} Droid OS</span>
              <span className="block text-[0.5rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/55">Command interface / v1</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-white/10 px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.12em] text-white/45 sm:block">{config.chainName}</span>
            {config.chainId === 143 ? (
              <Link href="/droids" className="rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.07] px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.1em] text-[#c7ff00]">My Droids</Link>
            ) : wallet.address ? (
              <button type="button" onClick={() => void wallet.disconnect()} className="rounded-full border border-[#c7ff00]/25 bg-[#c7ff00]/[0.07] px-3 py-2 font-mono text-xs font-bold text-[#c7ff00]" title="Disconnect wallet">
                {shortAddress(wallet.address)}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void connect()} className="rounded-full bg-[#c7ff00] px-4 py-2 text-[0.62rem] font-black uppercase tracking-[0.1em] text-black disabled:opacity-50">Connect</button>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full min-w-0 max-w-7xl px-4 pb-24 pt-7 sm:px-6 sm:pt-10">
        <nav className="mb-6 flex gap-2 overflow-x-auto pb-2 text-[0.58rem] font-black uppercase tracking-[0.13em] text-white/45">
          {["Core", "Portfolio", "Trading", "Inventory", "Equipment", "Energy", "Rewards", "Strategy", "Achievements", "Directive", "Activity", "Security"].map((item) => (
            <a key={item} href={`#${item.toLowerCase()}`} className="whitespace-nowrap rounded-full border border-white/10 bg-black/25 px-3 py-2 transition hover:border-[#c7ff00]/30 hover:text-[#c7ff00]">{item}</a>
          ))}
        </nav>

        {wallet.address && walletChainId > 0 && !correctNetwork ? (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-sky-300/25 bg-sky-300/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-200">Wrong network</p>
              <p className="mt-1 text-sm font-semibold text-white/50">Droid commands require {config.chainName} (chain {config.chainId}).</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void switchNetwork()} className="rounded-xl bg-sky-200 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-950 disabled:opacity-40">{operation === "switching" ? "Switching…" : "Switch network"}</button>
          </div>
        ) : null}

        <div className={`mb-6 rounded-2xl border p-4 ${isOwner ? "border-[#c7ff00]/30 bg-[#c7ff00]/[0.07]" : "border-white/10 bg-white/[0.035]"}`} role="status">
          {isOwner ? (
            <>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#c7ff00]">You control this Droid</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/55">The connected wallet matches the current NFT owner read from {config.chainName}. Contract authorization still checks live ownership for every command.</p>
            </>
          ) : (
            <>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">Public Droid view</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/40">Anyone can inspect this Droid and its public on-chain wallet. Only the current NFT owner receives owner controls.</p>
            </>
          )}
        </div>

        <section id="core" className="w-full max-w-full scroll-mt-24 overflow-hidden rounded-[1.75rem] border border-[#c7ff00]/20 bg-[#0c110b] shadow-[0_35px_120px_rgba(0,0,0,.55),0_0_60px_rgba(199,255,0,.05)]">
          <div className="grid lg:grid-cols-[0.78fr_1.22fr]">
            <div className="relative min-h-[22rem] overflow-hidden bg-[#11180d] sm:min-h-[30rem] lg:min-h-[38rem]">
              <Image src={droid.imageUrl} alt={`${config.collectionName} Droid #${tokenId}`} fill unoptimized sizes="(min-width: 1024px) 38vw, 100vw" className="object-cover object-center [image-rendering:pixelated]" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent p-5 pt-24 sm:p-7">
                <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]">Controlling identity</p>
                <p className="mt-2 text-4xl font-black uppercase tracking-[-0.06em] sm:text-6xl">#{tokenId}</p>
              </div>
            </div>
            <div className="flex flex-col p-5 sm:p-8 lg:p-10">
              <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:justify-between">
                <div>
                  <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-[#c7ff00]">Droid core</p>
                  <h1 className="mt-3 text-4xl font-black uppercase leading-none tracking-[-0.065em] sm:text-6xl">{config.collectionName} #{tokenId}</h1>
                </div>
                <StatusPill active={droid.active} label={accountStatus} />
              </div>

              <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
                <DataRow label="Network" value={`${config.chainName} · ${config.chainId}`} />
                <DataRow label="Owner" value={droid.owner} mono />
                <DataRow label="Droid Wallet" value={(
                  <span className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                    <span className="font-mono [overflow-wrap:anywhere]">{droid.accountAddress || "Not configured"}</span>
                    {droid.accountAddress ? (
                      <button type="button" onClick={() => void copyDroidAddress()} className="rounded-lg border border-white/10 px-3 py-2 text-[0.56rem] font-black uppercase tracking-[0.11em] text-white/50 transition hover:border-[#c7ff00]/35 hover:text-[#c7ff00]">
                        {copiedAddress ? "Copied" : "Copy address"}
                      </button>
                    ) : null}
                  </span>
                )} />
                <DataRow label="Release status" value={accountStatus} />
                <DataRow label="Directive" value={droid.directive} />
                <DataRow label="Agent" value={<span className="text-white/45">{droid.agent}</span>} />
              </div>

              {!config.configured ? (
                <div className="mt-5 rounded-2xl border border-sky-300/25 bg-sky-300/[0.07] p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-sky-200">Protocol deployment pending</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/55">{config.setupIssue} No activation or asset transaction is enabled until the verified addresses are configured.</p>
                </div>
              ) : !droid.active ? (
                <div className="mt-5 rounded-2xl border border-[#c7ff00]/25 bg-[#c7ff00]/[0.06] p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#c7ff00]">Droid Account offline</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/55">
                    Activation deploys code at the deterministic address above. This smart account belongs to the NFT itself. If NFT ownership changes, control changes with it.
                  </p>
                  <button type="button" onClick={() => void activate()} disabled={busy || !droid.activationAllowed || (Boolean(wallet.address) && !isOwner)} className="mt-5 w-full rounded-xl bg-[#c7ff00] px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">
                    {!droid.activationAllowed
                      ? config.activationMode === "allowlist"
                        ? "Activation staged — current cohort only"
                        : "Activation staged — not enabled"
                      : !wallet.address
                      ? "Connect to activate"
                      : !isOwner
                        ? "Current owner only"
                        : !correctNetwork
                          ? `Switch to chain ${config.chainId}`
                          : operation === "activating"
                            ? "Activating Droid…"
                            : "Activate Droid"}
                  </button>
                </div>
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <a href="#portfolio" className="rounded-xl bg-[#c7ff00] px-5 py-4 text-center text-xs font-black uppercase tracking-[0.13em] text-black">Fund Droid</a>
                  {accountUrl ? <a href={accountUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/15 px-5 py-4 text-center text-xs font-black uppercase tracking-[0.13em] text-white/70">{config.chainId === 143 ? "View on Monadscan ↗" : "View on explorer ↗"}</a> : null}
                  {nftUrl ? <a href={nftUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/15 px-5 py-4 text-center text-xs font-black uppercase tracking-[0.13em] text-white/70">View NFT on explorer ↗</a> : null}
                  {activationUrl ? <a href={activationUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/15 px-5 py-4 text-center text-xs font-black uppercase tracking-[0.13em] text-white/70">View activation transaction ↗</a> : null}
                </div>
              )}
              {droid.active ? (
                <div className="mt-auto pt-6 text-xs font-semibold leading-5 text-white/40">
                  <p>Your Droid has its own on-chain wallet.</p>
                  <p className="mt-1">Control of this Droid Wallet follows ownership of the {config.collectionName} NFT.</p>
                  <p className="mt-1 text-white/25">No separate Droid private key exists.</p>
                </div>
              ) : <p className="mt-auto pt-6 text-xs font-semibold leading-5 text-white/30">No Droid private key exists. Current NFT ownership is the authority source.</p>}
            </div>
          </div>
        </section>

        <section aria-label="Droid ownership relationship" className="mt-6 rounded-[1.5rem] border border-[#c7ff00]/25 bg-[#0c110b]/95 p-5 sm:p-6">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/65">How this Droid works</p>
          <div className="mt-4 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div className="rounded-xl border border-dyoor-purple/25 bg-black/25 p-4 text-center">
              <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/35">Identity</p>
              <p className="mt-2 font-black text-white">{config.collectionName} #{tokenId}</p>
            </div>
            <div className="grid place-items-center py-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]"><span className="sm:hidden">↓ controls ↓</span><span className="hidden sm:inline">controls →</span></div>
            <div className="rounded-xl border border-[#c7ff00]/25 bg-[#c7ff00]/[0.05] p-4 text-center">
              <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/35">On-chain body</p>
              <p className="mt-2 font-black text-[#c7ff00]">Droid Wallet</p>
            </div>
            <div className="grid place-items-center py-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]"><span className="sm:hidden">↓ holds ↓</span><span className="hidden sm:inline">holds →</span></div>
            <div className="rounded-xl border border-dyoor-purple/25 bg-black/25 p-4 text-center">
              <p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/35">Inventory</p>
              <p className="mt-2 font-black text-white">Assets</p>
            </div>
          </div>
          <p className="mt-4 text-sm font-semibold leading-6 text-white/45">Ownership of the Droid determines control of its Droid Wallet. If the NFT transfers, control follows the NFT&apos;s current owner; the Droid Wallet address and its assets stay with the Droid.</p>
        </section>

        {(actionError || transactionHash) ? (
          <div className={`mt-5 rounded-2xl border p-4 ${actionError ? "border-red-300/30 bg-red-300/[0.07]" : "border-[#c7ff00]/30 bg-[#c7ff00]/[0.07]"}`} role="status" aria-live="polite">
            <p className={`text-sm font-bold ${actionError ? "text-red-100" : "text-[#c7ff00]"}`}>
              {actionError || "Droid Account transaction confirmed."}
              {transactionHash && txUrl ? <a href={txUrl} target="_blank" rel="noreferrer" className="ml-2 underline">View transaction ↗</a> : null}
            </p>
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel id="portfolio" eyebrow="Asset telemetry" title="Portfolio" className="lg:col-span-2">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.17em] text-white/35">Portfolio value</p>
              <p className="mt-2 text-2xl font-black uppercase text-white/55">Value unavailable</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-white/30">No verified price source is configured. Underlying balances remain visible below.</p>
            </div>
            <div className="mt-4">
              <DataRow label={config.nativeCurrencySymbol} value={`${droid.nativeFormatted} ${config.nativeCurrencySymbol}`} mono />
              {droid.tokens.map((token) => (
                <DataRow key={token.address} label={token.symbol} value={token.formattedBalance === "Unavailable" ? "Unavailable" : `${token.formattedBalance} ${token.symbol}`} mono />
              ))}
            </div>

            {isOwner && droid.active ? (
              <form onSubmit={(event) => void fund(event)} className="mt-5 rounded-2xl border border-[#c7ff00]/20 bg-[#c7ff00]/[0.04] p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#c7ff00]">Fund Droid</p>
                <p className="mt-2 break-all font-mono text-[0.66rem] leading-5 text-white/45">Destination: {droid.accountAddress}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/45">Funds deposited here are owned by Droid #{tokenId}&apos;s smart account.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                  <select value={fundAsset} onChange={(event) => setFundAsset(event.target.value)} className="rounded-xl border border-white/10 bg-black px-3 py-3 text-sm font-bold text-white outline-none focus:border-[#c7ff00]/50">
                    <option value="native">{config.nativeCurrencySymbol}</option>
                    {config.tokens.map((token) => <option key={token.address} value={token.address}>{token.symbol}</option>)}
                  </select>
                  <input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} inputMode="decimal" placeholder="Amount" aria-label="Funding amount" className="rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-[#c7ff00]/50" />
                </div>
                <button disabled={busy || !fundAmount} className="mt-3 w-full rounded-xl bg-[#c7ff00] px-4 py-3 text-xs font-black uppercase tracking-[0.13em] text-black disabled:opacity-40">{operation === "funding" ? "Confirming…" : `Deposit ${selectedFundToken?.symbol || config.nativeCurrencySymbol}`}</button>
              </form>
            ) : null}
          </Panel>

          {config.chainId === 143 ? (
            <div className="lg:col-span-2">
              <DroidTradingPanel
                tokenId={tokenId}
                owner={droid.owner}
                droidAccount={droid.accountAddress}
                nativeBalance={droid.nativeBalance}
                active={droid.active}
              />
            </div>
          ) : null}

          <Panel id="inventory" eyebrow="Custody map" title="Inventory">
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Tokens", String(
                  Number(positiveRaw(droid.nativeBalance))
                  + droid.tokens.filter((token) => positiveRaw(token.rawBalance)).length,
                )],
                ["NFTs", String(droid.nfts.length)],
                ["Equipment", String(droid.nfts.filter((nft) => nft.equipment).length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-black/25 p-3 text-center">
                  <p className="text-xl font-black text-white">{value}</p>
                  <p className="mt-1 text-[0.52rem] font-black uppercase tracking-[0.12em] text-white/35">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              {droid.nfts.length ? droid.nfts.map((nft) => {
                const key = `${nft.collectionAddress}:${nft.tokenId}`;
                const nftExplorerUrl = externalInventoryNftUrl(
                  config,
                  nft.collectionAddress,
                  nft.tokenId,
                );
                return (
                  <div key={key} className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <NftInventoryArtwork nft={nft} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-black text-white">{nft.collectionName} #{nft.tokenId}</p>
                          <span className="rounded-full border border-white/10 px-2 py-1 text-[0.55rem] font-black uppercase text-white/40">ERC-721</span>
                        </div>
                        <p className="mt-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]/55">{nft.equipment ? "Equipment compatible" : "NFT inventory"}</p>
                        <p className="mt-2 break-all font-mono text-[0.58rem] text-white/25">{nft.collectionAddress}</p>
                        {nftExplorerUrl ? (
                          <a href={nftExplorerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[0.58rem] font-black uppercase tracking-[0.11em] text-[#c7ff00]/70 hover:text-[#c7ff00]">
                            {config.chainId === 143 ? "View NFT on Monadscan ↗" : "View NFT on explorer ↗"}
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {isOwner && droid.active ? (
                      <div className="mt-3 flex gap-2">
                        <input value={nftRecipients[key] || ""} onChange={(event) => setNftRecipients((current) => ({ ...current, [key]: event.target.value }))} placeholder="Recipient 0x…" aria-label={`Recipient for ${nft.collectionName} ${nft.tokenId}`} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#c7ff00]/50" />
                        <button type="button" disabled={busy || !nftRecipients[key]} onClick={() => void withdrawNft(nft.collectionAddress, nft.tokenId)} className="rounded-lg border border-[#c7ff00]/30 px-3 text-[0.58rem] font-black uppercase text-[#c7ff00] disabled:opacity-40">Send</button>
                      </div>
                    ) : null}
                  </div>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
                  <p className="text-sm font-black uppercase text-white/45">Inventory bay empty</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/30">Only explicitly configured collections are discovered. Unknown NFTs are never presented as trusted equipment.</p>
                </div>
              )}
            </div>
          </Panel>

          <Panel id="equipment" eyebrow="Capability hardware" title="Equipment">
            {droid.nfts.some((nft) => nft.equipment) ? (
              <div className="space-y-3">
                {droid.nfts.filter((nft) => nft.equipment).map((nft) => (
                  <div key={`${nft.collectionAddress}:${nft.tokenId}`} className="rounded-xl border border-[#c7ff00]/20 bg-[#c7ff00]/[0.04] p-4">
                    <p className="font-black text-white">{nft.collectionName} #{nft.tokenId}</p>
                    <p className="mt-1 text-[0.58rem] font-black uppercase tracking-[0.13em] text-[#c7ff00]/55">Detected · slot resolution pending</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm font-black uppercase text-white/45">No equipment installed</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/30">Only allowlisted equipment owned by this account can be recognized. V1 does not rewrite {config.collectionName} traits or metadata.</p>
              </div>
            )}
          </Panel>

          <Panel id="energy" eyebrow="Operating resource" title="Energy">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#c7ff00]/20 bg-[#c7ff00]/[0.05] p-5">
                <p className="text-[0.58rem] font-black uppercase tracking-[0.15em] text-[#c7ff00]/60">Droid Energy</p>
                <p className="mt-2 text-3xl font-black text-[#c7ff00]">{energyLabel(droid.energyBalance, config.energyDecimals)}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/35">Existing Energy ledger balance keyed to this Droid Account.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
                <p className="text-[0.58rem] font-black uppercase tracking-[0.15em] text-white/35">Commander Energy</p>
                <p className="mt-2 text-3xl font-black text-white">{energyLabel(droid.commanderEnergyBalance, config.energyDecimals)}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/35">Current NFT owner&apos;s separate existing balance.</p>
              </div>
            </div>
            <p className="mt-4 text-xs font-semibold leading-5 text-white/30">V1 does not transfer, duplicate, or change Energy economics.</p>
          </Panel>

          <DroidEconomyPanel chainId={config.chainId} tokenId={tokenId} active={droid.active} isOwner={isOwner} />

          <Panel id="directive" eyebrow="Autonomy boundary" title="Directive">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
              <div className="flex items-center justify-between gap-4"><span className="text-xs font-black uppercase tracking-[0.15em] text-white/40">Mode</span><span className="font-black text-[#c7ff00]">MANUAL</span></div>
              <div className="mt-4 flex items-center justify-between gap-4"><span className="text-xs font-black uppercase tracking-[0.15em] text-white/40">Agent authority</span><span className="font-black text-white/45">ZERO</span></div>
              <div className="mt-4 flex items-center justify-between gap-4"><span className="text-xs font-black uppercase tracking-[0.15em] text-white/40">Missions</span><span className="font-black text-white/45">OFFLINE</span></div>
              <div className="mt-4 flex items-center justify-between gap-4"><span className="text-xs font-black uppercase tracking-[0.15em] text-white/40">Droid Score</span><span className="font-black text-white/45">NOT INITIALIZED</span></div>
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-white/40">No session key, backend, AI, or project administrator can execute from this V1 account. Future Directives require a separately audited capability policy.</p>
          </Panel>

          <Panel id="activity" eyebrow="On-chain signal" title="Activity">
            {droid.activityHealth.status !== "synced" ? (
              <div className="mb-4 rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-4" role="status">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-100">Some historical Droid activity is still syncing.</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/35">Live owner, controller, activation, and portfolio values are read directly on-chain and are not inferred from this history.</p>
              </div>
            ) : null}
            <div className="space-y-2">
              {droid.activity.length ? droid.activity.map((item) => (
                <a key={item.id} href={externalTxUrl(config, item.transactionHash)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 transition hover:border-[#c7ff00]/25">
                  <span>
                    <span className="block text-xs font-black uppercase tracking-[0.1em] text-white/70">{item.label}</span>
                    <span className="mt-1 block text-[0.58rem] font-semibold text-white/25">{activityTime(item.timestamp)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.58rem] text-white/25">#{item.blockNumber} ↗</span>
                </a>
              )) : <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-white/30">No indexed Droid activity yet.</p>}
            </div>
            <div className="mt-4 grid gap-2 text-[0.58rem] font-black uppercase tracking-[0.1em] text-white/25 sm:grid-cols-3">
              <span>Indexed through #{droid.activityHealth.indexedThroughBlock || "—"}</span>
              <span>{droid.activityHealth.blocksBehind.toLocaleString()} blocks behind</span>
              <span>Provider: {droid.activityHealth.provider || "Unavailable"}</span>
            </div>
          </Panel>

          <Panel id="security" eyebrow="Commander controls" title="Security" className="lg:col-span-2">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <DataRow label="Ultimate owner" value={droid.owner} mono />
                <DataRow label="Agent" value="OFF" />
                <DataRow label="Active session keys" value="0" />
                <DataRow label="Admin withdrawal" value="NONE" />
                <DataRow label="Owner rescue path" value={droid.active ? "ACTIVE" : "ACTIVATE FIRST"} />
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs font-black uppercase tracking-[0.15em] text-white/55">Owner send / withdraw</p>
                {isOwner && droid.active ? (
                  <form onSubmit={(event) => void withdraw(event)} className="mt-4 space-y-3">
                    <select value={sendAsset} onChange={(event) => setSendAsset(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm font-bold text-white outline-none focus:border-[#c7ff00]/50">
                      <option value="native">{config.nativeCurrencySymbol}</option>
                      {config.tokens.map((token: DroidConfiguredToken) => <option key={token.address} value={token.address}>{token.symbol}</option>)}
                    </select>
                    <input value={sendRecipient} onChange={(event) => setSendRecipient(event.target.value)} placeholder="Recipient 0x…" aria-label="Withdrawal recipient" className="w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-[#c7ff00]/50" />
                    <input value={sendAmount} onChange={(event) => setSendAmount(event.target.value)} inputMode="decimal" placeholder="Amount" aria-label="Withdrawal amount" className="w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-[#c7ff00]/50" />
                    <button disabled={busy || !sendRecipient || !sendAmount} className="w-full rounded-xl border border-[#c7ff00]/35 bg-[#c7ff00]/10 px-4 py-3 text-xs font-black uppercase tracking-[0.13em] text-[#c7ff00] disabled:opacity-40">{operation === "withdrawing" ? "Executing…" : `Send ${selectedSendToken?.symbol || config.nativeCurrencySymbol}`}</button>
                  </form>
                ) : (
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/35">{!droid.active ? "Activate the Droid Account to enable owner recovery." : "Only the current NFT owner can execute asset recovery."}</p>
                )}
              </div>
            </div>
            <div className="mt-6"><DroidAssetTransferWarning droid={droid} config={config} /></div>
          </Panel>
        </div>

        {droid.partialErrors.length ? (
          <aside className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.15em] text-white/35">Partial data notice</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/35">{droid.partialErrors.join(" ")}</p>
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function DroidLoading({ tokenId, siteTheme }: { tokenId: number; siteTheme: boolean }) {
  return (
    <main className={`grid min-h-screen place-items-center px-5 text-white ${siteTheme ? "dyoor-site-droid-theme bg-[#03030a]" : "bg-[#070a06]"}`}>
      <div className="text-center">
        <span className="mx-auto block h-12 w-12 animate-spin rounded-full border-2 border-[#c7ff00]/20 border-t-[#c7ff00]" />
        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-[#c7ff00]">Linking Droid #{tokenId}</p>
        <p className="mt-2 text-sm font-semibold text-white/35">Reading current on-chain state…</p>
      </div>
    </main>
  );
}
