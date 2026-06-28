"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, isAddress, parseEther, parseUnits } from "viem";
import { fetchTokenMetadata, useAscension, type AscensionNft } from "@/hooks/useAscension";
import { ascensionStakingAbi, erc721EnumerableAbi } from "@/lib/contracts/abis";
import { ascensionStakingContract, dyoorS1Contract } from "@/lib/contracts/addresses";
import { readContractWithFailover } from "@/lib/rpc";
import { MONAD_EXPLORER_URL } from "@/lib/monad";
import { SWAP_CHAIN_ID_HEX, SWAP_MONAD_RPC } from "@/lib/swap";
import { Alert, Button, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type TransactionReceipt = {
  blockNumber?: string;
  status?: string;
  logs?: Array<{
    address?: string;
    topics?: string[];
    data?: string;
    transactionHash?: string;
  }>;
};

type CardMode = "wallet" | "ascended";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ENERGY_PER_MON = 50n;
const POINTS_CLAIMED_TOPIC = "0xba953728785de35be3827ee7a7a7867a8472947562602939440e6c0bdbf4725e";

function tokenKey(mode: CardMode, tokenId: string) {
  return `${mode}:${tokenId}`;
}

function parseTokenIds(value: string) {
  return Array.from(new Set(value.split(/[,\s]+/).map((item) => item.trim()).filter((item) => /^\d+$/.test(item))));
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseMonInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d{0,18})?$/.test(trimmed)) return null;
  try {
    const raw = parseEther(trimmed);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

function formatEnergyPreview(raw: bigint | null) {
  if (!raw) return "0";
  const formatted = formatUnits(raw * ENERGY_PER_MON, 18);
  return formatted.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function parseEnergyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d{0,18})?$/.test(trimmed)) return null;
  try {
    const raw = parseUnits(trimmed, 18);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

function formatEnergyAmount(raw: bigint) {
  return formatUnits(raw, 18).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatCompactEnergy(value: string) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return value || "0";
  const abs = Math.abs(raw);
  const options = abs >= 1000
    ? { maximumFractionDigits: 1 }
    : abs >= 100
      ? { maximumFractionDigits: 2 }
      : { maximumFractionDigits: 3 };
  return new Intl.NumberFormat("en-US", {
    notation: abs >= 10000 ? "compact" : "standard",
    maximumFractionDigits: options.maximumFractionDigits,
  }).format(raw);
}

function energyTransferMessage(sender: string, recipient: string, amountRaw: string, timestamp: string, nonce: string) {
  return [
    "DYOOR Energy Transfer",
    `From: ${sender}`,
    `To: ${recipient}`,
    `AmountRaw: ${amountRaw}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

function formatWalletError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message || fallback;
  if (/user rejected|user denied|rejected request|denied transaction/i.test(message)) {
    return "Transaction rejected in wallet.";
  }
  if (/insufficient funds/i.test(message)) {
    return "Insufficient MON for gas.";
  }
  if (/execution reverted|call exception|revert/i.test(message)) {
    return `Contract rejected the transaction: ${message}`;
  }
  return message;
}

async function waitReceipt(provider: Eip1193Provider, hash: string) {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null) as TransactionReceipt | null;
    if (receipt?.blockNumber) {
      if (receipt.status && receipt.status !== "0x1") throw new Error(`Transaction reverted: ${hash}`);
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
  }
  throw new Error("Timed out waiting for transaction confirmation.");
}

function harvestAmountFromReceipt(receipt: TransactionReceipt, wallet: string) {
  const normalizedWallet = getAddress(wallet).toLowerCase();
  for (const log of receipt.logs || []) {
    const topics = log.topics || [];
    const logAddress = log.address && isAddress(log.address) ? getAddress(log.address).toLowerCase() : "";
    let topicWallet = "";
    try {
      topicWallet = topics[1] ? getAddress(`0x${String(topics[1]).slice(-40)}`).toLowerCase() : "";
    } catch {
      topicWallet = "";
    }
    if (
      logAddress === ascensionStakingContract.toLowerCase() &&
      String(topics[0] || "").toLowerCase() === POINTS_CLAIMED_TOPIC &&
      topicWallet === normalizedWallet &&
      log.data
    ) {
      try {
        return BigInt(log.data);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}

function ActionNftCard({
  mode,
  nft,
  onPrimary,
  onToggle,
  selected,
  working,
}: {
  mode: CardMode;
  nft: AscensionNft;
  onPrimary: (nft: AscensionNft) => void;
  onToggle: (nft: AscensionNft) => void;
  selected: boolean;
  working: boolean;
}) {
  const actionLabel = mode === "wallet" ? "Stake" : "Unstake";
  const [loadedNft, setLoadedNft] = useState<AscensionNft | null>(null);
  const displayNft = loadedNft?.tokenId === nft.tokenId && loadedNft.source === nft.source ? loadedNft : nft;

  useEffect(() => {
    let active = true;
    if (nft.metadataStatus === "loaded") return;
    fetchTokenMetadata(nft.tokenId, nft.source)
      .then((loaded) => {
        if (active) setLoadedNft(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [nft]);

  return (
    <article className={`group relative overflow-hidden rounded border bg-white/[0.04] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(57,255,226,.10)] ${selected ? "border-dyoor-cyan shadow-[0_0_22px_rgba(57,255,226,.14)]" : "border-dyoor-purple/20 hover:border-dyoor-cyan/45"}`}>
      <button className="block w-full text-left" type="button" onClick={() => onToggle(nft)}>
        <div className="aspect-square bg-black/45">
          {displayNft.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="h-full w-full object-cover" src={displayNft.image} alt={displayNft.name} />
          ) : (
            <div className="grid h-full place-items-center text-sm font-black uppercase text-white/35">DYOOR</div>
          )}
        </div>
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-black">{displayNft.name}</h3>
            <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${selected ? "border-dyoor-cyan text-dyoor-cyan" : "border-white/12 text-white/42"}`}>
              {selected ? "Selected" : "Select"}
            </span>
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/50">#{nft.tokenId}</p>
        </div>
      </button>
      <div className="absolute inset-x-3 bottom-3 translate-y-3 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
        <button
          className="w-full rounded border border-dyoor-cyan bg-black/85 px-3 py-2 text-xs font-black uppercase text-dyoor-cyan backdrop-blur disabled:opacity-50"
          type="button"
          disabled={working}
          onClick={() => onPrimary(nft)}
        >
          {actionLabel} #{nft.tokenId}
        </button>
      </div>
    </article>
  );
}

function NftGrid({
  empty,
  items,
  mode,
  onPrimary,
  onToggle,
  selectedIds,
  title,
  working,
}: {
  empty: string;
  items: AscensionNft[];
  mode: CardMode;
  onPrimary: (nft: AscensionNft) => void;
  onToggle: (nft: AscensionNft) => void;
  selectedIds: Set<string>;
  title: string;
  working: boolean;
}) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-black uppercase">{title}</h2>
        <span className="text-sm font-black uppercase text-dyoor-cyan">{items.length}</span>
      </div>
      {items.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {items.map((nft) => (
            <ActionNftCard
              key={`${nft.source}-${nft.tokenId}`}
              mode={mode}
              nft={nft}
              onPrimary={onPrimary}
              onToggle={onToggle}
              selected={selectedIds.has(tokenKey(mode, nft.tokenId))}
              working={working}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No Droid Signal" copy={empty} />
      )}
    </section>
  );
}

type HealthItemState = "ok" | "busy" | "warn" | "bad";

function compactHealthDetail(detail: string) {
  if (/eth_getLogs|block range|valid request object|RPC Request failed|range should work/i.test(detail)) {
    return "Recovery scan needs a smaller RPC window. Counts are loaded; refresh to retry.";
  }
  return detail.length > 110 ? `${detail.slice(0, 107)}...` : detail;
}

function AscensionHealthDashboard({
  items,
  summary,
}: {
  items: Array<{ label: string; status: HealthItemState; detail: string }>;
  summary: string;
}) {
  const toneClass: Record<HealthItemState, string> = {
    ok: "border-emerald-300/20 bg-emerald-300/[0.055] text-emerald-100",
    busy: "border-dyoor-cyan/28 bg-dyoor-cyan/[0.07] text-dyoor-cyan",
    warn: "border-yellow-300/30 bg-yellow-300/[0.08] text-yellow-100",
    bad: "border-red-400/35 bg-red-400/[0.08] text-red-100",
  };

  return (
    <section className="mb-6 rounded border border-dyoor-purple/24 bg-[radial-gradient(520px_220px_at_12%_0%,rgba(57,255,226,.10),transparent_64%),linear-gradient(135deg,rgba(8,8,22,.84),rgba(21,12,48,.68))] p-3 shadow-[0_0_26px_rgba(131,110,249,.10)] md:p-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[0.68rem] font-black uppercase tracking-[0.22em] text-dyoor-cyan">Ascension Health</p>
          <h2 className="text-lg font-black uppercase text-white md:text-xl">Synchronization Check</h2>
        </div>
        <p className="text-xs font-bold leading-5 text-white/58 md:text-right">{summary}</p>
      </div>
      <div className="mt-3 grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => {
          const showDetail = item.status !== "ok";
          return (
          <div className={`self-start rounded border px-3 py-2 ${toneClass[item.status]}`} key={item.label}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.14em]">{item.label}</p>
              <span className="text-base font-black leading-none">{item.status === "ok" ? "✓" : item.status === "busy" ? "…" : "!"}</span>
            </div>
            {showDetail && <p className="mt-1.5 text-xs font-bold leading-4 opacity-80">{compactHealthDetail(item.detail)}</p>}
          </div>
          );
        })}
      </div>
    </section>
  );
}

function RecoveryPanel({
  status,
  onRecover,
  onManualRecover,
  manualRecovery,
  setManualRecovery,
  working,
}: {
  status: ReturnType<typeof useAscension>["recovery"];
  onRecover: () => void;
  onManualRecover: () => void;
  manualRecovery: string;
  setManualRecovery: (value: string) => void;
  working: boolean;
}) {
  const available = status.status === "available" && status.recoverableTokenIds.length > 0;
  const limited = status.status === "limited";
  const title = available ? "Recovery Available" : limited ? "Recovery Check Limited" : "No Recovery Required";
  if (!available) return null;
  return (
    <section className="mt-10 rounded border border-white/12 bg-white/[0.04] p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-dyoor-cyan">Recovery Tool</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/64">
            {available
              ? "Recoverable deposits were detected from this wallet's Ascension transfer history."
              : status.message || "No recovery required."}
          </p>
        </div>
        <span className={`rounded border px-3 py-2 text-xs font-black uppercase ${available || limited ? "border-yellow-300/45 text-yellow-100" : "border-emerald-300/40 text-emerald-100"}`}>
          {available ? `${status.recoverableTokenIds.length} recoverable` : limited ? "Manual Check" : "Synchronized"}
        </span>
      </div>

      {available && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="rounded border border-yellow-300/25 bg-yellow-300/[0.06] p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-yellow-100/75">Detected Token IDs</p>
            <p className="mt-2 break-words text-lg font-black text-yellow-100">{status.recoverableTokenIds.join(", ")}</p>
            <div className="mt-3 grid gap-2 text-sm font-semibold text-white/70 md:grid-cols-2">
              <span>Estimated transactions: {status.estimatedTransactions}</span>
              <span>Source: {status.source}</span>
              <span>Scan timing: {status.timingMs}ms</span>
              <span>{status.candidates[0]?.reason || "Recovery registration is missing."}</span>
            </div>
          </div>
          <Button variant="primary" disabled={working} onClick={onRecover}>
            {working ? "Recovery Pending..." : "Recover My NFTs"}
          </Button>
        </div>
      )}

      {!available && status.status !== "clear" && (
        <Alert className="mt-5" tone={status.status === "error" ? "danger" : "warning"}>
          {status.message}
        </Alert>
      )}

      <div className="mt-5 rounded border border-white/10 bg-black/25 p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Manual Fallback</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-white/58">
          Use manual token IDs only if automatic detection is unavailable or support has provided specific token IDs.
        </p>
        <div className="mt-4 flex flex-col gap-3 md:flex-row">
          <input
            className="min-w-0 flex-1 rounded border border-white/14 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-dyoor-cyan"
            placeholder="Token ID, e.g. 547 or 547, 548"
            inputMode="numeric"
            value={manualRecovery}
            onChange={(event) => setManualRecovery(event.target.value)}
          />
          <button
            className="rounded border border-dyoor-cyan px-4 py-3 text-sm font-black uppercase text-dyoor-cyan disabled:opacity-50"
            type="button"
            disabled={working}
            onClick={onManualRecover}
          >
            Recover Manually
          </button>
        </div>
      </div>
    </section>
  );
}

function ManualStakePanel({
  manualStake,
  onManualStake,
  setManualStake,
  working,
}: {
  manualStake: string;
  onManualStake: () => void;
  setManualStake: (value: string) => void;
  working: boolean;
}) {
  return (
    <section className="rounded border border-white/12 bg-white/[0.04] p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-dyoor-cyan">Manual Stake</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">Stake By Token ID</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/64">
            Use this when the wallet count loaded but a specific NFT card has not rendered.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input
          className="min-w-0 flex-1 rounded border border-white/14 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-dyoor-cyan"
          placeholder="Token ID, e.g. 595"
          inputMode="numeric"
          value={manualStake}
          onChange={(event) => setManualStake(event.target.value)}
        />
        <button
          className="rounded border border-dyoor-cyan px-4 py-3 text-sm font-black uppercase text-dyoor-cyan disabled:opacity-50"
          type="button"
          disabled={working}
          onClick={onManualStake}
        >
          Stake Manually
        </button>
      </div>
    </section>
  );
}

export default function AscensionPage() {
  const walletService = useWalletService();
  const authenticated = walletService.connected;
  const connectWallet = walletService.connect;
  const ascension = useAscension();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [manualRecovery, setManualRecovery] = useState("");
  const [manualStake, setManualStake] = useState("");
  const [actionStatus, setActionStatus] = useState("Select NFTs to stake or unstake. Hover a card for quick actions.");
  const [treasuryWallet, setTreasuryWallet] = useState("");
  const [rechargeMon, setRechargeMon] = useState("");
  const [rechargeStatus, setRechargeStatus] = useState("Enter a MON amount to preview Energy.");
  const [rechargeTxHash, setRechargeTxHash] = useState("");
  const [rechargeCreditTxHash, setRechargeCreditTxHash] = useState("");
  const [rechargeRecoveryTx, setRechargeRecoveryTx] = useState("");
  const [rechargeCreditReady, setRechargeCreditReady] = useState(true);
  const [recharging, setRecharging] = useState(false);
  const [lendRecipient, setLendRecipient] = useState("");
  const [lendEnergy, setLendEnergy] = useState("");
  const [lendStatus, setLendStatus] = useState("Enter a recipient and Energy amount.");
  const [lendTxHash, setLendTxHash] = useState("");
  const [lending, setLending] = useState(false);
  const [blueprintHealth, setBlueprintHealth] = useState<{ loading: boolean; saved: boolean; eligible: boolean; message: string }>({
    loading: false,
    saved: false,
    eligible: false,
    message: "Blueprint not checked.",
  });
  const [working, setWorking] = useState(false);

  const rechargeMonRaw = useMemo(() => parseMonInput(rechargeMon), [rechargeMon]);
  const rechargeEnergyPreview = useMemo(() => formatEnergyPreview(rechargeMonRaw), [rechargeMonRaw]);
  const lendEnergyRaw = useMemo(() => parseEnergyInput(lendEnergy), [lendEnergy]);
  let bankedEnergyRaw = 0n;
  try {
    bankedEnergyRaw = parseUnits(String(ascension.bankedEnergy || "0"), 18);
  } catch {
    bankedEnergyRaw = 0n;
  }
  const lendRemainingRaw = lendEnergyRaw && bankedEnergyRaw > lendEnergyRaw ? bankedEnergyRaw - lendEnergyRaw : 0n;
  const countValue = useCallback((value: string | number) => ascension.hasLoaded ? value : "Loading", [ascension.hasLoaded]);

  const selectedWalletIds = useMemo(() => {
    return ascension.walletNfts.filter((nft) => selected.has(tokenKey("wallet", nft.tokenId))).map((nft) => nft.tokenId);
  }, [ascension.walletNfts, selected]);

  const selectedAscendedIds = useMemo(() => {
    return ascension.ascendedNfts.filter((nft) => selected.has(tokenKey("ascended", nft.tokenId))).map((nft) => nft.tokenId);
  }, [ascension.ascendedNfts, selected]);

  const getProvider = useCallback(async () => {
    return await walletService.getProvider() as Eip1193Provider;
  }, [walletService]);

  useEffect(() => {
    let active = true;
    fetch("/api/energy-recharge", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setTreasuryWallet(typeof data?.treasuryWallet === "string" ? data.treasuryWallet : "");
        setRechargeCreditReady(data?.creditReady !== false);
        if (!data?.treasuryWallet) setRechargeStatus("Recharge is unavailable: treasury wallet is not configured.");
        else if (data?.creditReady === false) setRechargeStatus(`Recharge is unavailable: ${data?.creditUnavailableReason || "Energy credit operator is not configured."}`);
      })
      .catch(() => {
        if (!active) return;
        setRechargeCreditReady(false);
        setRechargeStatus("Recharge is unavailable: treasury config could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadBlueprintHealth() {
      if (!ascension.walletAddress) {
        setBlueprintHealth({ loading: false, saved: false, eligible: false, message: "Connect wallet to check blueprint." });
        return;
      }
      setBlueprintHealth((current) => ({ ...current, loading: true }));
      try {
        const response = await fetch(`/api/ascension-blueprints?wallet=${encodeURIComponent(ascension.walletAddress)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!active) return;
        setBlueprintHealth({
          loading: false,
          saved: Boolean(data?.registration),
          eligible: Boolean(data?.registration?.ascensionBlueprint),
          message: data?.registration ? "Blueprint saved." : "No saved blueprint found.",
        });
      } catch {
        if (active) setBlueprintHealth({ loading: false, saved: false, eligible: false, message: "Blueprint check unavailable." });
      }
    }
    void loadBlueprintHealth();
    return () => {
      active = false;
    };
  }, [ascension.walletAddress]);

  const healthItems = useMemo(() => {
    const synced = ascension.hasLoaded && !ascension.loading && !ascension.error;
    const recoveryAvailable = ascension.recovery.status === "available" && ascension.recovery.recoverableTokenIds.length > 0;
    const items = [
      {
        label: "Wallet Connected",
        status: authenticated ? "ok" as const : "warn" as const,
        detail: authenticated ? `${walletService.providerName || "Wallet"} connected.` : "Connect wallet to begin.",
      },
      {
        label: "Correct Network",
        status: !authenticated ? "warn" as const : walletService.status === "wrong-network" ? "bad" as const : "ok" as const,
        detail: walletService.status === "wrong-network" ? "Switch to Monad." : "Monad network ready.",
      },
      {
        label: "Staking Data Synced",
        status: ascension.loading ? "busy" as const : synced ? "ok" as const : "warn" as const,
        detail: synced ? "Staking counts loaded." : ascension.loading ? "Scanning wallet..." : "Staking data not loaded.",
      },
      {
        label: "Wallet NFTs Loaded",
        status: ascension.loading ? "busy" as const : ascension.hasLoaded ? "ok" as const : "warn" as const,
        detail: ascension.hasLoaded ? `${ascension.walletUnstakedCount} unstaked detected.` : "Waiting for wallet NFT count.",
      },
      {
        label: "Ascended NFTs Loaded",
        status: ascension.loading ? "busy" as const : ascension.hasLoaded ? "ok" as const : "warn" as const,
        detail: ascension.hasLoaded ? `${ascension.ascendedCount} ascended detected.` : "Waiting for staking count.",
      },
      {
        label: "Energy Synced",
        status: ascension.energyLoading ? "busy" as const : "ok" as const,
        detail: ascension.energyLoading ? "Refreshing Energy values..." : "Pending, banked, harvested, and lifetime values loaded.",
      },
      {
        label: "Blueprint Saved",
        status: blueprintHealth.loading ? "busy" as const : blueprintHealth.saved ? "ok" as const : "warn" as const,
        detail: blueprintHealth.message,
      },
      {
        label: "Blueprint Eligible",
        status: blueprintHealth.loading ? "busy" as const : blueprintHealth.eligible ? "ok" as const : "warn" as const,
        detail: blueprintHealth.eligible ? "Ascension Blueprint eligible." : "No eligibility record loaded.",
      },
    ];
    if (recoveryAvailable) {
      items.push({
        label: "Recovery Required",
        status: "warn" as const,
        detail: `${ascension.recovery.recoverableTokenIds.length} NFT(s) need recovery.`,
      });
    }
    return items;
  }, [ascension, authenticated, blueprintHealth, walletService.providerName, walletService.status]);

  const healthSummary = useMemo(() => {
    if (!authenticated) return "Connect wallet to run the complete health check.";
    if (healthItems.every((item) => item.status === "ok")) return "Your Ascension is fully synchronized.";
    return "Some checks need attention. Only affected sections are highlighted.";
  }, [authenticated, healthItems]);

  const ensureReady = useCallback(async () => {
    if (!authenticated || !ascension.walletAddress) {
      await connectWallet().catch(() => {});
      throw new Error("Connect wallet first.");
    }
    if (!isAddress(ascension.walletAddress)) throw new Error("Connected wallet is invalid.");
    const provider = await getProvider();
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
    if (String(chainId).toLowerCase() !== SWAP_CHAIN_ID_HEX) {
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SWAP_CHAIN_ID_HEX }] });
      } catch {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SWAP_CHAIN_ID_HEX,
            chainName: "Monad",
            rpcUrls: [SWAP_MONAD_RPC],
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            blockExplorerUrls: ["https://monadscan.com"],
          }],
        });
      }
    }
    return provider;
  }, [ascension.walletAddress, authenticated, connectWallet, getProvider]);

  async function sendContract(provider: Eip1193Provider, to: `0x${string}`, data: `0x${string}`) {
    const from = getAddress(ascension.walletAddress);
    const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []) as string[];
    const activeAccount = accounts?.[0] && isAddress(accounts[0]) ? getAddress(accounts[0]) : "";
    if (activeAccount && activeAccount !== from) {
      throw new Error(`Wallet account changed to ${activeAccount.slice(0, 6)}...${activeAccount.slice(-4)}. Reconnect and try again.`);
    }
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data, value: "0x0" }],
    }) as string;
    const receipt = await waitReceipt(provider, hash);
    return { hash, receipt };
  }

  async function sendNative(provider: Eip1193Provider, to: `0x${string}`, value: bigint) {
    const from = getAddress(ascension.walletAddress);
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to, value: `0x${value.toString(16)}` }],
    }) as string;
    await waitReceipt(provider, hash);
    return hash;
  }

  async function ensureApproval(provider: Eip1193Provider) {
    const approved = await readContractWithFailover({
      address: dyoorS1Contract,
      abi: erc721EnumerableAbi,
      functionName: "isApprovedForAll",
      args: [getAddress(ascension.walletAddress), ascensionStakingContract],
      label: "S1 isApprovedForAll",
    }) as boolean;
    if (approved) return;
    setActionStatus("Approval required. Confirm setApprovalForAll in your wallet.");
    const data = encodeFunctionData({
      abi: erc721EnumerableAbi,
      functionName: "setApprovalForAll",
      args: [ascensionStakingContract, true],
    });
    await sendContract(provider, dyoorS1Contract, data);
    const approvedAfter = await readContractWithFailover({
      address: dyoorS1Contract,
      abi: erc721EnumerableAbi,
      functionName: "isApprovedForAll",
      args: [getAddress(ascension.walletAddress), ascensionStakingContract],
      label: "S1 isApprovedForAll after approval",
    }) as boolean;
    if (!approvedAfter) throw new Error("Approval did not complete. Try again after the approval transaction confirms.");
  }

  async function stakeTokenIds(tokenIds: string[]) {
    if (working) return;
    if (!tokenIds.length) {
      setActionStatus("Enter a token ID first.");
      return;
    }
    setWorking(true);
    try {
      const provider = await ensureReady();
      const ids = tokenIds.map((id) => BigInt(id));
      await ensureApproval(provider);
      for (const id of ids) {
        setActionStatus(`Checking wallet ownership for #${id.toString()}...`);
        const owner = await readContractWithFailover({
          address: dyoorS1Contract,
          abi: erc721EnumerableAbi,
          functionName: "ownerOf",
          args: [id],
          label: `S1 ownerOf before stake #${id.toString()}`,
        }) as string;
        const ownerAddress = getAddress(owner);
        const connectedWallet = getAddress(ascension.walletAddress);
        if (ownerAddress !== connectedWallet) {
          if (ownerAddress === ascensionStakingContract) {
            throw new Error(`Token #${id.toString()} is already inside Ascension. Use manual recovery for this token.`);
          }
          throw new Error(`Token #${id.toString()} is owned by ${shortAddress(ownerAddress)}, not your connected wallet.`);
        }
      }
      setActionStatus(`Depositing ${ids.length} NFT${ids.length === 1 ? "" : "s"} into Ascension...`);
      for (const id of ids) {
        const data = encodeFunctionData({
          abi: erc721EnumerableAbi,
          functionName: "transferFrom",
          args: [getAddress(ascension.walletAddress), ascensionStakingContract, id],
        });
        await sendContract(provider, dyoorS1Contract, data);
      }
      setActionStatus("Registering deposited NFT(s)...");
      const registerData = encodeFunctionData({
        abi: ascensionStakingAbi,
        functionName: "stakeDeposited",
        args: [ids],
      });
      await sendContract(provider, ascensionStakingContract, registerData);
      setActionStatus("Ascension complete. Refreshing NFTs...");
      setSelected(new Set());
      setManualStake("");
      await ascension.refresh();
    } catch (error) {
      setActionStatus(formatWalletError(error, "Ascension failed."));
    } finally {
      setWorking(false);
    }
  }

  async function unstakeTokenIds(tokenIds: string[]) {
    if (!tokenIds.length || working) return;
    setWorking(true);
    try {
      const provider = await ensureReady();
      const ids = tokenIds.map((id) => BigInt(id));
      setActionStatus(`Unstaking ${ids.length} NFT${ids.length === 1 ? "" : "s"}...`);
      const data = encodeFunctionData({
        abi: ascensionStakingAbi,
        functionName: "unstake",
        args: [ids],
      });
      await sendContract(provider, ascensionStakingContract, data);
      setActionStatus("Unstake complete. Refreshing NFTs...");
      setSelected(new Set());
      await ascension.refresh();
    } catch (error) {
      setActionStatus(formatWalletError(error, "Unstake failed."));
    } finally {
      setWorking(false);
    }
  }

  async function harvestEnergy() {
    if (working) return;
    setWorking(true);
    try {
      const provider = await ensureReady();
      setActionStatus("Harvesting pending Energy...");
      const pendingBefore = await readContractWithFailover({
        address: ascensionStakingContract,
        abi: ascensionStakingAbi,
        functionName: "pendingPoints",
        args: [getAddress(ascension.walletAddress)],
        label: "Ascension pendingPoints before harvest",
      }) as bigint;
      const data = encodeFunctionData({
        abi: ascensionStakingAbi,
        functionName: "claimPoints",
        args: [],
      });
      const tx = await sendContract(provider, ascensionStakingContract, data);
      const harvestedRaw = harvestAmountFromReceipt(tx.receipt, ascension.walletAddress) || pendingBefore;
      if (harvestedRaw > 0n) {
        let bankCreditOk = false;
        let bankCreditMessage = "";
        let bankCreditResponse = await fetch("/api/energy-harvest-credit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user: getAddress(ascension.walletAddress),
            amountRaw: harvestedRaw.toString(),
            txHash: tx.hash,
          }),
        });
        if (bankCreditResponse.status === 409) {
          await new Promise((resolve) => window.setTimeout(resolve, 2500));
          bankCreditResponse = await fetch("/api/energy-harvest-credit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              user: getAddress(ascension.walletAddress),
              amountRaw: harvestedRaw.toString(),
              txHash: tx.hash,
            }),
          });
        }
        const bankCredit = await bankCreditResponse.json().catch(() => ({}));
        bankCreditOk = bankCreditResponse.ok && bankCredit?.ok !== false;
        if (!bankCreditOk) bankCreditMessage = bankCredit?.error || "Energy Bank credit failed";

        const harvestRecordBody = JSON.stringify({
          action: "recordHarvest",
          address: getAddress(ascension.walletAddress),
          amountRaw: harvestedRaw.toString(),
          txHash: tx.hash,
        });
        let response = await fetch("/.netlify/functions/ascension-stats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: harvestRecordBody,
        });
        if (response.status === 409) {
          await new Promise((resolve) => window.setTimeout(resolve, 2500));
          response = await fetch("/.netlify/functions/ascension-stats", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: harvestRecordBody,
          });
        }
        const record = await response.json().catch(() => ({}));
        if (!response.ok || record?.ok === false) {
          setActionStatus(`Harvest confirmed${bankCreditOk ? " and bank credited" : ""}, but the legacy display ledger did not update: ${record?.error || "ledger update failed"}`);
        } else if (!bankCreditOk) {
          setActionStatus(`Harvest confirmed and indexed, but Energy Bank was not credited: ${bankCreditMessage}. Use admin reconciliation.`);
        } else if (bankCredit?.alreadyCredited) {
          setActionStatus("Energy harvest was already credited. Refreshing state...");
        } else {
          setActionStatus("Energy harvest credited to Energy Bank. Refreshing state...");
        }
      } else {
        setActionStatus("Energy harvest confirmed. Refreshing state...");
      }
      await ascension.refresh({ scanLogs: true });
    } catch (error) {
      setActionStatus(formatWalletError(error, "Harvest failed."));
    } finally {
      setWorking(false);
    }
  }

  async function recoverTokenIds(tokenIds: string[], source: "auto" | "manual") {
    if (working) return;
    if (!tokenIds.length) {
      setActionStatus("Enter a stuck token ID first.");
      return;
    }
    setWorking(true);
    try {
      const provider = await ensureReady();
      const ids: bigint[] = [];
      for (const tokenId of tokenIds) {
        if (source === "auto" && !ascension.recovery.recoverableTokenIds.includes(tokenId)) {
          throw new Error(`Token #${tokenId} is no longer marked recoverable. Refresh and try again.`);
        }
        setActionStatus(`Checking recovery token #${tokenId}...`);
        const owner = await readContractWithFailover({
          address: dyoorS1Contract,
          abi: erc721EnumerableAbi,
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
          label: `S1 ownerOf recovery #${tokenId}`,
        }) as string;
        const ownerAddress = getAddress(owner);
        const info = await readContractWithFailover({
          address: ascensionStakingContract,
          abi: ascensionStakingAbi,
          functionName: "stakeInfo",
          args: [BigInt(tokenId)],
          label: `Ascension stakeInfo #${tokenId}`,
        }) as readonly [string, number | bigint];
        const registeredWallet = info?.[0] && getAddress(info[0]) !== getAddress(ZERO_ADDRESS) ? getAddress(info[0]) : "";
        if (registeredWallet) {
          throw new Error(`Token #${tokenId} is already registered to ${shortAddress(registeredWallet)}. Refresh Ascension if it is not visible yet.`);
        }
        if (ownerAddress !== ascensionStakingContract) {
          if (ownerAddress === getAddress(ascension.walletAddress)) {
            throw new Error(`Token #${tokenId} is still in your connected wallet. Use Stake By Token ID, not recovery.`);
          }
          throw new Error(`Token #${tokenId} is owned by ${shortAddress(ownerAddress)}. Recovery only applies after an NFT is inside Ascension.`);
        }
        ids.push(BigInt(tokenId));
      }
      setActionStatus(`Recovering ${ids.length} pending deposit${ids.length === 1 ? "" : "s"}...`);
      const data = encodeFunctionData({
        abi: ascensionStakingAbi,
        functionName: "stakeDeposited",
        args: [ids],
      });
      await sendContract(provider, ascensionStakingContract, data);
      setManualRecovery("");
      setActionStatus("Ascension recovery complete. Refreshing NFTs...");
      await ascension.refresh();
    } catch (error) {
      setActionStatus(formatWalletError(error, "Recovery failed."));
    } finally {
      setWorking(false);
    }
  }

  async function recoverManualDeposits() {
    await recoverTokenIds(parseTokenIds(manualRecovery), "manual");
  }

  async function stakeManualDeposits() {
    await stakeTokenIds(parseTokenIds(manualStake));
  }

  async function recoverDetectedDeposits() {
    await recoverTokenIds(ascension.recovery.recoverableTokenIds, "auto");
  }

  async function creditRechargePayment(paymentTxHash: string, monAmountRaw?: bigint) {
      const response = await fetch("/api/energy-recharge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user: getAddress(ascension.walletAddress),
          txHash: paymentTxHash,
          ...(monAmountRaw ? { monAmountRaw: monAmountRaw.toString() } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(typeof data?.error === "string" ? data.error : "Recharge failed. Please try again.");
      }

      setRechargeCreditTxHash(String(data.creditTxHash || ""));
      return data;
  }

  async function rechargeEnergy() {
    if (recharging) return;
    if (!treasuryWallet || !isAddress(treasuryWallet)) {
      setRechargeStatus("Recharge failed. Treasury wallet is not configured.");
      return;
    }
    if (!rechargeCreditReady) {
      setRechargeStatus("Recharge is unavailable: Energy credit operator is not configured.");
      return;
    }
    if (!rechargeMonRaw) {
      setRechargeStatus("Enter a valid MON amount.");
      return;
    }

    setRecharging(true);
    setRechargeStatus("Sending MON to treasury. Confirm the wallet transaction.");
    setRechargeTxHash("");
    setRechargeCreditTxHash("");
    try {
      const provider = await ensureReady();
      const paymentTxHash = await sendNative(provider, getAddress(treasuryWallet), rechargeMonRaw);
      setRechargeTxHash(paymentTxHash);
      setRechargeStatus("Payment confirmed. Verifying recharge and crediting Energy...");
      await creditRechargePayment(paymentTxHash, rechargeMonRaw);
      setRechargeStatus("Energy recharged successfully.");
      setRechargeMon("");
      await ascension.refresh();
    } catch (error) {
      setRechargeStatus(formatWalletError(error, "Recharge failed. Please try again."));
    } finally {
      setRecharging(false);
    }
  }

  async function recoverRechargePayment() {
    const txHash = rechargeRecoveryTx.trim();
    if (recharging) return;
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      setRechargeStatus("Enter a valid recharge transaction hash.");
      return;
    }
    if (!rechargeCreditReady) {
      setRechargeStatus("Recharge recovery is unavailable: Energy credit operator is not configured.");
      return;
    }

    setRecharging(true);
    setRechargeTxHash(txHash);
    setRechargeCreditTxHash("");
    setRechargeStatus("Verifying recharge transaction and crediting Energy...");
    try {
      await ensureReady();
      await creditRechargePayment(txHash);
      setRechargeStatus("Energy recharged successfully.");
      setRechargeRecoveryTx("");
      await ascension.refresh();
    } catch (error) {
      setRechargeStatus(formatWalletError(error, "Recharge failed. Please try again."));
    } finally {
      setRecharging(false);
    }
  }

  async function lendEnergyToFren() {
    if (lending) return;
    if (!authenticated || !ascension.walletAddress) {
      await connectWallet().catch(() => {});
      setLendStatus("Connect wallet first.");
      return;
    }
    if (!isAddress(lendRecipient)) {
      setLendStatus("Enter a valid recipient wallet.");
      return;
    }
    const recipient = getAddress(lendRecipient);
    if (recipient === getAddress(ZERO_ADDRESS)) {
      setLendStatus("Recipient cannot be the zero address.");
      return;
    }
    if (recipient === getAddress(ascension.walletAddress)) {
      setLendStatus("Recipient must be a different wallet.");
      return;
    }
    if (!lendEnergyRaw) {
      setLendStatus("Enter a positive Energy amount.");
      return;
    }
    if (lendEnergyRaw > bankedEnergyRaw) {
      setLendStatus("Energy amount exceeds your transferable Energy Bank balance.");
      return;
    }

    setLending(true);
    setLendTxHash("");
    setLendStatus("Sign the Energy transfer authorization.");
    try {
      await ensureReady();
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const message = energyTransferMessage(
        getAddress(ascension.walletAddress),
        recipient,
        lendEnergyRaw.toString(),
        timestamp,
        nonce,
      );
      const signature = await walletService.signMessage(message);
      setLendStatus("Submitting Energy transfer for server verification...");
      const response = await fetch("/api/energy-transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sender: getAddress(ascension.walletAddress),
          recipient,
          amountRaw: lendEnergyRaw.toString(),
          timestamp,
          nonce,
          signature,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(typeof data?.error === "string" ? data.error : "Energy transfer failed.");
      }
      setLendTxHash(String(data.creditTxHash || data.spendTxHash || ""));
      setLendStatus(data.alreadyTransferred ? "Energy transfer was already completed." : "Energy transfer complete.");
      setLendRecipient("");
      setLendEnergy("");
      await ascension.refresh();
    } catch (error) {
      setLendStatus(formatWalletError(error, "Energy transfer failed."));
    } finally {
      setLending(false);
    }
  }

  function toggleSelection(mode: CardMode, nft: AscensionNft) {
    const key = tokenKey(mode, nft.tokenId);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <PageShell>
      <div className="glass-panel-strong energy-grid mb-8 p-6">
        <SectionHeader
          eyebrow="Ascension Protocol"
          title="Ascension Command Center"
          copy="Stake Season 1 DYOOR into the Ascension chamber, generate Energy, unstake when needed, and recover deposits that need final registration."
          actions={
            <Button variant="primary" onClick={authenticated ? () => void ascension.refresh() : connectWallet} disabled={working || ascension.refreshing}>
              {authenticated ? ascension.refreshing ? "Refreshing..." : "Refresh Signal" : "Connect Wallet"}
            </Button>
          }
        />
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Unstaked" value={countValue(ascension.walletUnstakedCount)} />
        <StatCard label="Ascended" value={countValue(ascension.ascendedCount)} />
        <StatCard label="Total Controlled" value={countValue(ascension.totalControlled)} />
        <StatCard label="Pending Energy" value={formatCompactEnergy(ascension.pendingEnergy)} />
        <StatCard label="Harvested Energy" value={formatCompactEnergy(ascension.harvestedEnergy)} />
        <StatCard label="Lifetime Energy" value={formatCompactEnergy(ascension.lifetimeEnergy)} />
        <StatCard label="Energy Bank" value={formatCompactEnergy(ascension.bankedEnergy)} />
      </div>

      <AscensionHealthDashboard items={healthItems} summary={healthSummary} />

      <section className="mb-8 grid gap-5 lg:grid-cols-2">
        <div className="rounded border border-dyoor-purple/30 bg-gradient-to-br from-dyoor-cyan/[0.10] via-dyoor-purple/[0.10] to-fuchsia-500/[0.08] p-5 shadow-[0_0_42px_rgba(131,110,249,.12)] md:p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-dyoor-cyan">Energy Bank</p>
          <h2 className="mt-2 text-3xl font-black uppercase text-white">Recharge Energy</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/66">
            Power up your Ascension bank with MON.
          </p>
          <p className="mt-4 inline-flex rounded border border-dyoor-cyan/35 bg-black/30 px-3 py-2 text-sm font-black uppercase text-dyoor-cyan">
            1 MON = 50 Energy
          </p>
          <div className="rounded border border-dyoor-purple/24 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-white/45" htmlFor="recharge-mon">
              MON Amount
            </label>
            <input
              id="recharge-mon"
              className="field-control mt-2 text-lg font-black"
              inputMode="decimal"
              placeholder="10"
              value={rechargeMon}
              onChange={(event) => setRechargeMon(event.target.value)}
              disabled={recharging}
            />
            <div className="mt-3 rounded border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white/68">
              Preview: {rechargeMon || "0"} MON = <span className="text-dyoor-cyan">{rechargeEnergyPreview} Energy</span>
            </div>
            <Button
              className="mt-3 w-full"
              variant="primary"
              disabled={!authenticated || !rechargeMonRaw || !treasuryWallet || !rechargeCreditReady || recharging}
              onClick={() => void rechargeEnergy()}
            >
              {recharging ? "Recharging..." : "Recharge Energy"}
            </Button>
            <div className="mt-3 rounded border border-white/10 bg-black/30 p-3 text-sm font-bold leading-6 text-white/68">
              {rechargeStatus}
              {rechargeTxHash && (
                <p className="mt-2">
                  Payment:{" "}
                  <a className="text-dyoor-cyan underline" href={`${MONAD_EXPLORER_URL}/tx/${rechargeTxHash}`} target="_blank" rel="noreferrer">
                    {rechargeTxHash.slice(0, 10)}...{rechargeTxHash.slice(-6)}
                  </a>
                </p>
              )}
              {rechargeCreditTxHash && (
                <p>
                  Credit:{" "}
                  <a className="text-dyoor-cyan underline" href={`${MONAD_EXPLORER_URL}/tx/${rechargeCreditTxHash}`} target="_blank" rel="noreferrer">
                    {rechargeCreditTxHash.slice(0, 10)}...{rechargeCreditTxHash.slice(-6)}
                  </a>
                </p>
              )}
            </div>
            <div className="mt-3 rounded border border-white/10 bg-black/25 p-3">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-white/45" htmlFor="recharge-recovery">
                Recover Recharge
              </label>
              <div className="mt-2 flex flex-col gap-2 md:flex-row">
                <input
                  id="recharge-recovery"
                  className="min-w-0 flex-1 rounded border border-white/15 bg-black/45 px-3 py-2 text-xs font-bold text-white outline-none focus:border-dyoor-cyan"
                  placeholder="Paste payment tx hash"
                  value={rechargeRecoveryTx}
                  onChange={(event) => setRechargeRecoveryTx(event.target.value)}
                  disabled={recharging}
                />
                <Button
                  className="px-3 py-2 text-xs"
                  variant="ghost"
                  disabled={recharging || !rechargeCreditReady || !rechargeRecoveryTx.trim()}
                  onClick={() => void recoverRechargePayment()}
                >
                  Credit Tx
                </Button>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/48">
                Use this only if MON was sent but Energy did not appear.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded border border-dyoor-purple/30 bg-[radial-gradient(560px_260px_at_80%_0%,rgba(57,255,226,.14),transparent_60%),linear-gradient(135deg,rgba(8,8,24,.88),rgba(24,13,54,.72))] p-5 shadow-[0_0_42px_rgba(57,255,226,.10)] md:p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-dyoor-cyan">Energy Utility</p>
          <h2 className="mt-2 text-3xl font-black uppercase text-white">Lend to a Fren</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/66">
            Transfer spendable Energy from your Energy Bank to another wallet after server verification.
          </p>
          <div className="mt-5 rounded border border-dyoor-purple/24 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-white/45" htmlFor="lend-recipient">
              Recipient Wallet
            </label>
            <input
              id="lend-recipient"
              className="field-control mt-2 text-sm font-black"
              placeholder="0x..."
              value={lendRecipient}
              onChange={(event) => setLendRecipient(event.target.value)}
              disabled={lending}
            />
            <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-white/45" htmlFor="lend-energy">
              Energy Amount
            </label>
            <input
              id="lend-energy"
              className="field-control mt-2 text-lg font-black"
              inputMode="decimal"
              placeholder="250"
              value={lendEnergy}
              onChange={(event) => setLendEnergy(event.target.value)}
              disabled={lending}
            />
            <div className="mt-3 grid gap-2 text-sm font-bold text-white/68 md:grid-cols-2">
              <div className="rounded border border-white/10 bg-white/[0.035] p-3">
                Current: <span className="text-dyoor-cyan">{formatCompactEnergy(ascension.bankedEnergy)} Energy</span>
              </div>
              <div className="rounded border border-white/10 bg-white/[0.035] p-3">
                Remaining: <span className="text-dyoor-cyan">{formatCompactEnergy(lendEnergyRaw ? formatEnergyAmount(lendRemainingRaw) : ascension.bankedEnergy)}</span>
              </div>
              <div className="rounded border border-white/10 bg-white/[0.035] p-3 md:col-span-2">
                Recipient: <span className="break-all text-dyoor-cyan">{isAddress(lendRecipient) ? getAddress(lendRecipient) : "Not set"}</span>
              </div>
            </div>
            <Button
              className="mt-3 w-full"
              variant="primary"
              disabled={!authenticated || !lendEnergyRaw || !isAddress(lendRecipient) || lending}
              onClick={() => void lendEnergyToFren()}
            >
              {lending ? "Sending Energy..." : "Lend Energy"}
            </Button>
            <div className="mt-3 rounded border border-white/10 bg-black/30 p-3 text-sm font-bold leading-6 text-white/68">
              {lendStatus}
              {lendTxHash && (
                <p className="mt-2">
                  Tx:{" "}
                  <a className="text-dyoor-cyan underline" href={`${MONAD_EXPLORER_URL}/tx/${lendTxHash}`} target="_blank" rel="noreferrer">
                    {lendTxHash.slice(0, 10)}...{lendTxHash.slice(-6)}
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded border border-dyoor-purple/28 bg-[linear-gradient(135deg,rgba(57,255,226,.08),rgba(131,110,249,.10))] p-5 shadow-[0_0_34px_rgba(131,110,249,.10)]">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <h2 className="text-2xl font-black uppercase text-white">Staking Flow</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/68">
              Select wallet NFTs, approve once, deposit them into the Ascension contract, then register the deposit.
              Ascended NFTs can be selected and unstaked from the same page.
            </p>
          </div>
          <div className="grid gap-2 text-center text-xs font-black uppercase text-white/70 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:items-center">
            {["Select", "Approve", "Deposit", "Register"].map((step, index) => (
              <div key={step} className="contents">
                <div className="rounded border border-white/12 bg-black/25 p-3">{step}</div>
                {index < 3 && <div className="text-dyoor-cyan">↓</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="glass-panel sticky bottom-3 z-20 mb-8 p-4 md:static md:p-5">
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-3">
          <Button variant="primary" disabled={!selectedWalletIds.length || working} onClick={() => void stakeTokenIds(selectedWalletIds)}>
            Stake Selected ({selectedWalletIds.length})
          </Button>
          <Button variant="secondary" disabled={!ascension.walletNfts.length || working} onClick={() => void stakeTokenIds(ascension.walletNfts.map((nft) => nft.tokenId))}>
            Stake All ({ascension.walletNfts.length})
          </Button>
          <Button variant="ghost" disabled={!selectedAscendedIds.length || working} onClick={() => void unstakeTokenIds(selectedAscendedIds)}>
            Unstake Selected ({selectedAscendedIds.length})
          </Button>
          <Button variant="ghost" disabled={working || Number(ascension.pendingEnergy) <= 0} onClick={() => void harvestEnergy()}>
            Harvest Energy
          </Button>
          <Button variant="ghost" disabled={!selected.size || working} onClick={() => setSelected(new Set())}>
            Clear Selection
          </Button>
        </div>
        <Alert className="mt-4" tone={working ? "busy" : /complete|success/i.test(actionStatus) ? "success" : "idle"}>
          {working ? "Working. Confirm each wallet prompt and wait for confirmation." : actionStatus}
        </Alert>
      </section>

      {ascension.loading && (
        <div className="mb-6">
          <Alert tone="busy">Loading Ascension state...</Alert>
          <LoadingSkeleton className="mt-4" lines={4} />
        </div>
      )}

      {ascension.error && (
        <Alert className="mb-6" tone="danger">
          {ascension.error instanceof Error ? ascension.error.message : "Failed to load Ascension state."}
        </Alert>
      )}

      {ascension.warnings.length > 0 && (
        <Alert className="mb-6" tone="warning">
          {ascension.warnings[0]}
        </Alert>
      )}

      {process.env.NODE_ENV !== "production" && ascension.sources && (
        <section className="terminal-panel mb-8 p-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="eyebrow">Dev Verification</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Ascension Token ID Debug</h2>
              <p className="mt-2 text-sm font-semibold text-white/55">
                Source: {ascension.sources.nftFetchSource || "pending"} / Pages: {ascension.sources.nftFetchPageCount || 0}
              </p>
            </div>
            <div className="grid gap-2 text-sm font-black text-white/70 md:grid-cols-3">
              <span>Wallet: {ascension.sources.ownerScanWalletIds.length}</span>
              <span>Staked: {ascension.ascendedNfts.map((nft) => nft.tokenId).length}</span>
              <span>Total: {ascension.totalControlled}</span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded border border-dyoor-purple/25 bg-black/35 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">Wallet Token IDs</p>
              <p className="mt-2 break-words text-sm font-bold text-dyoor-cyan">{ascension.sources.ownerScanWalletIds.join(", ") || "None found"}</p>
            </div>
            <div className="rounded border border-dyoor-purple/25 bg-black/35 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">Staked Token IDs</p>
              <p className="mt-2 break-words text-sm font-bold text-dyoor-cyan">
                {ascension.ascendedNfts.map((nft) => nft.tokenId).join(", ") || "None found"}
              </p>
            </div>
          </div>
        </section>
      )}

      {!authenticated ? (
        <EmptyState title="Wallet Signal Required" copy="Connect with the global Privy wallet button to load unstaked and ascended DYOOR." />
      ) : (
        <div className="space-y-10">
          <NftGrid
            title="Wallet NFTs"
            mode="wallet"
            items={ascension.walletNfts}
            empty={ascension.walletUnstakedCount ? `${ascension.walletUnstakedCount} unstaked DYOOR detected. Token cards are still resolving; use manual token IDs if you need to stake immediately.` : "No unstaked DYOOR found after discovery completes."}
            selectedIds={selected}
            working={working}
            onToggle={(nft) => toggleSelection("wallet", nft)}
            onPrimary={(nft) => void stakeTokenIds([nft.tokenId])}
          />
          <ManualStakePanel
            manualStake={manualStake}
            setManualStake={setManualStake}
            working={working}
            onManualStake={() => void stakeManualDeposits()}
          />
          <NftGrid
            title="Ascended NFTs"
            mode="ascended"
            items={ascension.ascendedNfts}
            empty={ascension.ascendedCount ? `${ascension.ascendedCount} ascended DYOOR detected. Token IDs are still loading.` : "No ascended DYOOR found."}
            selectedIds={selected}
            working={working}
            onToggle={(nft) => toggleSelection("ascended", nft)}
            onPrimary={(nft) => void unstakeTokenIds([nft.tokenId])}
          />
        </div>
      )}

      <RecoveryPanel
        status={ascension.recovery}
        working={working}
        manualRecovery={manualRecovery}
        setManualRecovery={setManualRecovery}
        onRecover={() => void recoverDetectedDeposits()}
        onManualRecover={() => void recoverManualDeposits()}
      />
    </PageShell>
  );
}
