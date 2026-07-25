"use client";

/* eslint-disable @next/next/no-img-element */

import {
  encodeFunctionData,
  parseEther,
  toHex,
} from "viem";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DYOOR_WORLD_CHANNELS,
  type DyoorWorldAvatar,
  type DyoorWorldChannelId,
  type DyoorWorldMessageView,
  type DyoorWorldProfile,
  normalizeWorldLabel,
  shortWorldWallet,
} from "@/lib/dyoor-world";
import {
  normalizeDyoorWorldAttachment,
  type DyoorWorldMessageAttachment,
} from "@/lib/dyoor-world-media";
import { DyoorWorldGlyph } from "@/components/dyoor-world/DyoorWorldDiscovery";
import {
  DyoorWorldMediaComposer,
  DyoorWorldStickerCard,
} from "@/components/dyoor-world/DyoorWorldMediaComposer";
import { useWalletService } from "@/providers/WalletServiceProvider";

type WorldConfig = {
  chainId: number;
  s2ContractAddress: string;
  registryAddress: string;
  registryMode: "monad" | "preview-reservation";
  claimsOpen: boolean;
  tradeEscrowAddress: string;
  rewardsEnabled: boolean;
  salesBotEnabled: boolean;
};

type ProfileResponse = {
  ok?: boolean;
  profile?: DyoorWorldProfile | null;
  avatar?: DyoorWorldAvatar | null;
  config?: WorldConfig;
  error?: string;
};

type RewardStatus = {
  enabled: boolean;
  claimReady: boolean;
  pendingEnergy: number;
  pendingRewardCount: number;
  daily: {
    amountEnergy: number;
    createdAt: string;
  } | null;
  utcDate: string;
  chat: {
    rewardEnergy: number;
    rewardedToday: number;
    dailyCap: number;
    nextRewardAt: string | null;
  };
  tips: {
    rewardEnergy: number;
    minimumMon: string;
    rewardedToday: number;
    dailyCap: number;
  };
  trades: {
    rewardEnergy: number;
    rewardedToday: number;
    dailyCap: number;
  };
};

type TipTarget = {
  wallet: string;
  author: string;
} | null;

type WorldTrade = {
  tradeId: string;
  maker: string;
  taker: string;
  openOffer: boolean;
  offeredTokenId: string;
  requestedTokenId: string;
  monOfferedWei: string;
  monOffered: string;
  monRequestedWei: string;
  monRequested: string;
  expiresAt: number;
  expired: boolean;
  status: number;
  statusLabel: string;
};

const WORLD_NAMES_ABI = [{
  type: "function",
  name: "claim",
  stateMutability: "nonpayable",
  inputs: [{ name: "label", type: "string" }],
  outputs: [{ name: "tokenId", type: "uint256" }],
}] as const;

const S2_APPROVAL_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "tokenId", type: "uint256" },
  ],
  outputs: [],
}] as const;

const WORLD_TRADE_ABI = [
  {
    type: "function",
    name: "createTrade",
    stateMutability: "payable",
    inputs: [
      { name: "taker", type: "address" },
      { name: "offeredTokenId", type: "uint256" },
      { name: "requestedTokenId", type: "uint256" },
      { name: "monRequested", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [{ name: "tradeId", type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptTrade",
    stateMutability: "payable",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelTrade",
    stateMutability: "nonpayable",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "expireTrade",
    stateMutability: "nonpayable",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: [],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAddress(value?: string) {
  const wallet = String(value || "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

function tokenId(value: string, label: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) < 1n) {
    throw new Error(`${label} must be a valid S2 Droid token ID.`);
  }
  return BigInt(normalized);
}

function validTokenIdText(value: string) {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) && BigInt(normalized) > 0n
    ? normalized
    : "";
}

function monAmount(value: string, label: string) {
  const normalized = value.trim() || "0";
  try {
    const parsed = parseEther(normalized);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a valid MON amount.`);
  }
}

function mediaUrl(uri?: string) {
  const value = String(uri || "").trim();
  if (!value) return "";
  if (value.startsWith("ipfs://")) {
    return `https://jade-efficient-beaver-697.mypinata.cloud/ipfs/${value.slice(7)}`;
  }
  return value;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "dYOOR World request failed.");
  return data as T;
}

function messageTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : "";
}

function shortenedHash(value?: unknown) {
  const hash = String(value || "");
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-5)}` : hash;
}

function WorldChannelList({
  activeChannel,
  descriptions = false,
  onSelect,
}: {
  activeChannel: DyoorWorldChannelId;
  descriptions?: boolean;
  onSelect: (channelId: DyoorWorldChannelId) => void;
}) {
  return (
    <div className="grid gap-2">
      {DYOOR_WORLD_CHANNELS.map((channel) => {
        const active = channel.id === activeChannel;
        return (
          <button
            className={`min-w-0 rounded border px-3 py-3 text-left transition ${
              active
                ? "border-dyoor-cyan/55 bg-dyoor-cyan/10 text-dyoor-cyan"
                : "border-white/[0.07] bg-white/[0.025] text-white/62 hover:border-dyoor-purple/45 hover:text-white"
            }`}
            key={channel.id}
            onClick={() => onSelect(channel.id)}
            type="button"
          >
            <span className="block truncate text-xs font-black"># {channel.label}</span>
            {descriptions ? (
              <span className="mt-1 block text-[0.64rem] font-bold leading-4 text-white/35">
                {channel.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function WorldDroidPreview({
  label,
  tokenId: tokenIdValue,
}: {
  label: string;
  tokenId: string;
}) {
  const normalized = validTokenIdText(tokenIdValue);
  return (
    <div className="overflow-hidden rounded border border-white/10 bg-black/30">
      <div className="aspect-square bg-black/35">
        {normalized ? (
          <img
            alt={`D.Y.O.O.R #${normalized}`}
            className="h-full w-full object-cover"
            loading="lazy"
            src={`/api/dyoor-world/pfp-image/${encodeURIComponent(normalized)}`}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <DyoorWorldGlyph className="h-8 w-8 text-white/15" />
          </div>
        )}
      </div>
      <div className="border-t border-white/10 p-2">
        <p className="text-[0.52rem] font-black uppercase tracking-[0.12em] text-white/35">{label}</p>
        <p className="mt-1 truncate text-xs font-black text-white">
          {normalized ? `D.Y.O.O.R #${normalized}` : "Choose a Droid"}
        </p>
      </div>
    </div>
  );
}

function OwnedDroidPicker({
  disabled,
  onSelect,
  tokenIds,
  value,
}: {
  disabled?: boolean;
  onSelect: (tokenId: string) => void;
  tokenIds: string[];
  value: string;
}) {
  if (tokenIds.length === 0) {
    return (
      <div className="rounded border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs font-bold text-white/35">
        No S2 Droids were found in this holder wallet.
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {tokenIds.map((id) => (
        <button
          aria-pressed={id === value}
          className={`w-24 shrink-0 overflow-hidden rounded border text-left transition ${
            id === value
              ? "border-dyoor-cyan bg-dyoor-cyan/10 ring-2 ring-dyoor-cyan/25"
              : "border-white/10 bg-black/25 hover:border-dyoor-purple/55"
          }`}
          disabled={disabled}
          key={id}
          onClick={() => onSelect(id)}
          type="button"
        >
          <span className="block aspect-square bg-black/35">
            <img
              alt={`D.Y.O.O.R #${id}`}
              className="h-full w-full object-cover"
              loading="lazy"
              src={`/api/dyoor-world/pfp-image/${encodeURIComponent(id)}`}
            />
          </span>
          <span className="block truncate border-t border-white/10 px-2 py-2 text-[0.58rem] font-black text-white">
            #{id}
          </span>
        </button>
      ))}
    </div>
  );
}

export function DyoorWorldClient({ sessionWallet }: { sessionWallet: string }) {
  const router = useRouter();
  const wallet = useWalletService();
  const connectedWallet = normalizeAddress(wallet.address);
  const normalizedSessionWallet = normalizeAddress(sessionWallet);
  const [channelId, setChannelId] = useState<DyoorWorldChannelId>("world-lobby");
  const [profile, setProfile] = useState<DyoorWorldProfile | null>(null);
  const [avatar, setAvatar] = useState<DyoorWorldAvatar | null>(null);
  const [config, setConfig] = useState<WorldConfig | null>(null);
  const [messages, setMessages] = useState<DyoorWorldMessageView[]>([]);
  const [rewards, setRewards] = useState<RewardStatus | null>(null);
  const [ownedTokenIds, setOwnedTokenIds] = useState<string[]>([]);
  const [avatarTokenId, setAvatarTokenId] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState("");
  const [composerAttachment, setComposerAttachment] = useState<DyoorWorldMessageAttachment | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [rewardAction, setRewardAction] = useState("");
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [tipTarget, setTipTarget] = useState<TipTarget>(null);
  const [tipAmount, setTipAmount] = useState("1");
  const [tipping, setTipping] = useState(false);
  const [tradeBusy, setTradeBusy] = useState("");
  const [tradeCounterparty, setTradeCounterparty] = useState("");
  const [tradeOfferedToken, setTradeOfferedToken] = useState("");
  const [tradeRequestedToken, setTradeRequestedToken] = useState("");
  const [tradeMonOffered, setTradeMonOffered] = useState("0");
  const [tradeMonRequested, setTradeMonRequested] = useState("0");
  const [tradeExpiryHours, setTradeExpiryHours] = useState("24");
  const [tradeId, setTradeId] = useState("");
  const [loadedTrade, setLoadedTrade] = useState<WorldTrade | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const selectedChannel = useMemo(
    () => DYOOR_WORLD_CHANNELS.find((channel) => channel.id === channelId)
      || DYOOR_WORLD_CHANNELS[0],
    [channelId],
  );

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/dyoor-world/profile", { cache: "no-store" });
    const data = await readResponse<ProfileResponse>(response);
    setProfile(data.profile || null);
    setAvatar(data.avatar || null);
    setAvatarTokenId(data.avatar?.tokenId || "");
    setAvatarPreview(mediaUrl(data.avatar?.imageUrl));
    setConfig(data.config || null);
    return data;
  }, []);

  const loadRewards = useCallback(async () => {
    const response = await fetch("/api/dyoor-world/rewards", { cache: "no-store" });
    const data = await readResponse<{ status?: RewardStatus }>(response);
    setRewards(data.status || null);
    return data.status || null;
  }, []);

  const loadOwnedTokens = useCallback(async () => {
    const response = await fetch(
      `/api/s2/owned-tokens?wallet=${encodeURIComponent(normalizedSessionWallet)}`,
      { cache: "no-store" },
    );
    const data = await readResponse<{ tokenIds?: string[] }>(response);
    const ids = Array.isArray(data.tokenIds) ? data.tokenIds.map(String) : [];
    setOwnedTokenIds(ids);
    if (ids[0]) setAvatarTokenId((current) => current || ids[0]);
    return ids;
  }, [normalizedSessionWallet]);

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const response = await fetch(
        `/api/dyoor-world/messages?channel=${encodeURIComponent(channelId)}`,
        { cache: "no-store" },
      );
      const data = await readResponse<{ messages?: DyoorWorldMessageView[] }>(response);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load World messages.");
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [channelId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadProfile(), loadRewards(), loadOwnedTokens()]).catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not load the World identity.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOwnedTokens, loadProfile, loadRewards]);

  useEffect(() => {
    if (!avatarTokenId) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/metadata/${encodeURIComponent(avatarTokenId)}`,
          { cache: "no-store" },
        );
        const metadata = await readResponse<{ image?: string }>(response);
        if (active) setAvatarPreview(mediaUrl(metadata.image));
      } catch {
        if (active && avatar?.tokenId !== avatarTokenId) setAvatarPreview("");
      }
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [avatar?.tokenId, avatarTokenId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadMessages(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages(true);
    }, 4_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadMessages]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  useEffect(() => {
    if (!mobileThreadsOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMobileThreadsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileThreadsOpen]);

  async function ensureActiveWallet() {
    if (!connectedWallet) throw new Error("Connect the authenticated holder wallet first.");
    if (connectedWallet !== normalizedSessionWallet) {
      throw new Error("The connected wallet must match this holder session.");
    }
    if (wallet.status === "wrong-network") await wallet.switchChain();
    return connectedWallet;
  }

  async function waitForTransaction(txHash: string) {
    const activeProvider = await wallet.getProvider();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const receipt = await activeProvider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }) as { status?: string } | null;
      if (receipt) {
        if (String(receipt.status || "").toLowerCase() !== "0x1") {
          throw new Error("The Monad transaction failed.");
        }
        return receipt;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    throw new Error("The Monad transaction is still pending. Check the wallet activity.");
  }

  async function claimName(event: FormEvent) {
    event.preventDefault();
    const normalizedLabel = normalizeWorldLabel(label);
    if (!normalizedLabel || !config) return;
    setClaiming(true);
    setError("");
    setNotice("");
    try {
      const latest = await loadProfile();
      const liveConfig = latest.config || config;
      if (liveConfig.registryMode === "monad" && liveConfig.registryAddress) {
        if (!liveConfig.claimsOpen) {
          throw new Error("dYOOR World name claims are currently closed.");
        }
        const from = await ensureActiveWallet();
        const data = encodeFunctionData({
          abi: WORLD_NAMES_ABI,
          functionName: "claim",
          args: [normalizedLabel],
        });
        const txHash = await wallet.sendTransaction({
          from,
          to: liveConfig.registryAddress,
          data,
        });
        setNotice(`Monad claim submitted: ${shortenedHash(txHash)}`);
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
          const result = await loadProfile();
          if (result.profile?.registryStatus === "monad-active") break;
        }
      } else {
        const response = await fetch("/api/dyoor-world/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reserve-name", label: normalizedLabel }),
        });
        const data = await readResponse<ProfileResponse>(response);
        setProfile(data.profile || null);
        setConfig(data.config || null);
        setNotice(`${data.profile?.displayName || "World name"} reserved for this preview.`);
      }
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not claim this World name.");
    } finally {
      setClaiming(false);
    }
  }

  async function saveAvatar() {
    if (!avatarTokenId) return;
    setSavingAvatar(true);
    setError("");
    try {
      const response = await fetch("/api/dyoor-world/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-pfp", tokenId: avatarTokenId }),
      });
      const data = await readResponse<ProfileResponse>(response);
      setAvatar(data.avatar || null);
      setAvatarPreview(mediaUrl(data.avatar?.imageUrl));
      setNotice(`S2 Droid #${data.avatar?.tokenId} is now your World PFP.`);
      await loadMessages(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the World PFP.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content && !composerAttachment) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/dyoor-world/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId,
          content,
          attachment: composerAttachment,
        }),
      });
      const data = await readResponse<{ message?: DyoorWorldMessageView }>(response);
      if (data.message) {
        setMessages((current) => [...current, data.message!]);
        if (data.message.energyReward) {
          setNotice(`Signal accepted · +${data.message.energyReward} Energy pending.`);
          await loadRewards();
        }
      }
      setDraft("");
      setComposerAttachment(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the World message.");
    } finally {
      setSending(false);
    }
  }

  async function runRewardAction(action: "check-in" | "claim") {
    setRewardAction(action);
    setError("");
    if (action === "check-in") setWheelSpinning(true);
    try {
      const response = await fetch("/api/dyoor-world/rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await readResponse<{
        reward?: { amountEnergy?: number };
        status?: RewardStatus;
        claim?: { amountEnergy?: number; txHash?: string };
      }>(response);
      if (action === "check-in") {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        setNotice(`Daily signal landed on ${data.reward?.amountEnergy || 0} Energy.`);
      } else {
        setNotice(
          `Claimed ${data.claim?.amountEnergy || 0} Energy to the Energy Bank${data.claim?.txHash ? ` · ${shortenedHash(data.claim.txHash)}` : ""}.`,
        );
      }
      setRewards(data.status || await loadRewards());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "World Energy request failed.");
    } finally {
      setRewardAction("");
      setWheelSpinning(false);
    }
  }

  async function sendTip() {
    if (!tipTarget) return;
    setTipping(true);
    setError("");
    try {
      const from = await ensureActiveWallet();
      const value = monAmount(tipAmount, "Tip");
      if (value <= 0n) throw new Error("Choose a MON tip greater than zero.");
      const txHash = await wallet.sendTransaction({
        from,
        to: tipTarget.wallet,
        value: toHex(value),
      });
      await waitForTransaction(txHash);
      const response = await fetch("/api/dyoor-world/tips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipient: tipTarget.wallet, txHash }),
      });
      const data = await readResponse<{
        reward?: { amountEnergy?: number };
      }>(response);
      if (data.reward?.amountEnergy) await loadRewards();
      setNotice(
        `Tipped ${tipTarget.author} ${tipAmount} MON · ${shortenedHash(txHash)}${
          data.reward?.amountEnergy ? ` · +${data.reward.amountEnergy} Energy pending` : ""
        }`,
      );
      setTipTarget(null);
      setChannelId("tip-ledger");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the MON tip.");
    } finally {
      setTipping(false);
    }
  }

  async function verifyTrade(txHash: string) {
    await waitForTransaction(txHash);
    const response = await fetch("/api/dyoor-world/trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
    const data = await readResponse<{
      rewards?: Array<{ wallet?: string; amountEnergy?: number }>;
      messages?: DyoorWorldMessageView[];
    }>(response);
    if (data.rewards?.length) await loadRewards();
    await loadMessages(true);
    return data;
  }

  async function fetchTradeOffer(idValue: string) {
    const id = tokenId(idValue, "Trade ID").toString();
    const response = await fetch(
      `/api/dyoor-world/trades?id=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    const data = await readResponse<{ trade?: WorldTrade }>(response);
    if (!data.trade) throw new Error(`World trade #${id} was not found.`);
    return data.trade;
  }

  async function loadTradeOffer() {
    setTradeBusy("load");
    setError("");
    try {
      const trade = await fetchTradeOffer(tradeId);
      setLoadedTrade(trade);
      setTradeId(trade.tradeId);
      return trade;
    } catch (caught) {
      setLoadedTrade(null);
      setError(caught instanceof Error ? caught.message : "Could not load this World trade.");
      return null;
    } finally {
      setTradeBusy("");
    }
  }

  async function approveDroid(from: string, escrow: string, id: bigint) {
    const approvalHash = await wallet.sendTransaction({
      from,
      to: config!.s2ContractAddress,
      data: encodeFunctionData({
        abi: S2_APPROVAL_ABI,
        functionName: "approve",
        args: [escrow as `0x${string}`, id],
      }),
    });
    await waitForTransaction(approvalHash);
  }

  async function createTrade(event: FormEvent) {
    event.preventDefault();
    if (!config?.tradeEscrowAddress) return;
    setTradeBusy("create");
    setError("");
    try {
      const from = await ensureActiveWallet();
      const offered = tokenId(tradeOfferedToken, "Offered Droid");
      const requested = tokenId(tradeRequestedToken, "Requested Droid");
      const taker = tradeCounterparty.trim()
        ? normalizeAddress(tradeCounterparty)
        : ZERO_ADDRESS;
      if (!taker) throw new Error("Counterparty must be a valid wallet or left blank.");
      const monOffered = monAmount(tradeMonOffered, "MON offered");
      const monRequested = monAmount(tradeMonRequested, "MON requested");
      const hours = Number(tradeExpiryHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
        throw new Error("Trade expiry must be between 1 and 720 hours.");
      }
      await approveDroid(from, config.tradeEscrowAddress, offered);
      const expiresAt = BigInt(Math.floor(Date.now() / 1_000) + Math.floor(hours * 3_600));
      const txHash = await wallet.sendTransaction({
        from,
        to: config.tradeEscrowAddress,
        data: encodeFunctionData({
          abi: WORLD_TRADE_ABI,
          functionName: "createTrade",
          args: [taker as `0x${string}`, offered, requested, monRequested, expiresAt],
        }),
        ...(monOffered > 0n ? { value: toHex(monOffered) } : {}),
      });
      const verified = await verifyTrade(txHash);
      const createdTradeId = String(
        verified.messages?.find((message) => message.data?.action === "created")
          ?.data?.tradeId
        || "",
      );
      if (createdTradeId) {
        setTradeId(createdTradeId);
        setLoadedTrade(await fetchTradeOffer(createdTradeId).catch(() => null));
      }
      setNotice(
        `Trade${createdTradeId ? ` #${createdTradeId}` : ""} created in atomic escrow · ${shortenedHash(txHash)}`,
      );
      setTradeOfferedToken("");
      setTradeRequestedToken("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the World trade.");
    } finally {
      setTradeBusy("");
    }
  }

  async function acceptTrade() {
    if (!config?.tradeEscrowAddress) return;
    setTradeBusy("accept");
    setError("");
    try {
      const from = await ensureActiveWallet();
      const id = tokenId(tradeId, "Trade ID");
      const trade = await fetchTradeOffer(id.toString());
      if (trade.status !== 1) {
        throw new Error(`Trade #${id} is ${trade.statusLabel}, not active.`);
      }
      if (!trade.openOffer && normalizeAddress(trade.taker) !== normalizedSessionWallet) {
        throw new Error("This private offer belongs to another holder wallet.");
      }
      if (normalizeAddress(trade.maker) === normalizedSessionWallet) {
        throw new Error("The maker cannot accept their own trade.");
      }
      if (!ownedTokenIds.includes(trade.requestedTokenId)) {
        throw new Error(`This wallet must own D.Y.O.O.R #${trade.requestedTokenId} to accept.`);
      }
      const requestedToken = tokenId(trade.requestedTokenId, "Requested Droid");
      const requestedMon = BigInt(trade.monRequestedWei || "0");
      await approveDroid(from, config.tradeEscrowAddress, requestedToken);
      const txHash = await wallet.sendTransaction({
        from,
        to: config.tradeEscrowAddress,
        data: encodeFunctionData({
          abi: WORLD_TRADE_ABI,
          functionName: "acceptTrade",
          args: [id],
        }),
        ...(requestedMon > 0n ? { value: toHex(requestedMon) } : {}),
      });
      const result = await verifyTrade(txHash);
      const ownReward = result.rewards?.find(
        (reward) => normalizeAddress(reward.wallet) === normalizedSessionWallet,
      );
      setNotice(
        `Trade #${id} completed atomically · ${shortenedHash(txHash)}${
          ownReward?.amountEnergy ? ` · +${ownReward.amountEnergy} Energy pending` : ""
        }`,
      );
      setLoadedTrade(await fetchTradeOffer(id.toString()).catch(() => null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not accept the World trade.");
    } finally {
      setTradeBusy("");
    }
  }

  async function closeTrade(action: "cancelTrade" | "expireTrade") {
    if (!config?.tradeEscrowAddress) return;
    setTradeBusy(action);
    setError("");
    try {
      const from = await ensureActiveWallet();
      const id = tokenId(tradeId, "Trade ID");
      const txHash = await wallet.sendTransaction({
        from,
        to: config.tradeEscrowAddress,
        data: encodeFunctionData({
          abi: WORLD_TRADE_ABI,
          functionName: action,
          args: [id],
        }),
      });
      await verifyTrade(txHash);
      setNotice(`Trade #${id} ${action === "cancelTrade" ? "cancelled" : "expired"} · ${shortenedHash(txHash)}`);
      setLoadedTrade(await fetchTradeOffer(id.toString()).catch(() => null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not close the World trade.");
    } finally {
      setTradeBusy("");
    }
  }

  async function exitWorld() {
    await fetch("/api/dyoor-world/session", { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  }

  const identity = profile?.displayName || shortWorldWallet(normalizedSessionWallet);
  const walletMismatch = Boolean(connectedWallet && connectedWallet !== normalizedSessionWallet);
  const loadedTradeActive = loadedTrade?.status === 1;
  const loadedTradeIsMaker = normalizeAddress(loadedTrade?.maker) === normalizedSessionWallet;
  const loadedTradeTargetsSession = Boolean(
    loadedTrade?.openOffer
      || normalizeAddress(loadedTrade?.taker) === normalizedSessionWallet,
  );
  const loadedTradeRequestedOwned = Boolean(
    loadedTrade?.requestedTokenId
      && ownedTokenIds.includes(loadedTrade.requestedTokenId),
  );
  const canAcceptLoadedTrade = Boolean(
    loadedTradeActive
      && !loadedTradeIsMaker
      && loadedTradeTargetsSession
      && loadedTradeRequestedOwned
  );

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-[1680px] px-3 py-4 sm:px-5 sm:py-6">
      {mobileThreadsOpen ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            aria-label="Close World threads"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileThreadsOpen(false)}
            type="button"
          />
          <aside
            aria-label="dYOOR World threads"
            className="absolute inset-y-0 left-0 w-[min(86vw,22rem)] overflow-y-auto border-r border-dyoor-purple/35 bg-[#080918] p-4 shadow-[24px_0_70px_rgba(0,0,0,.55)]"
            id="world-mobile-threads"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan">dYOOR World</p>
                <p className="mt-1 text-lg font-black uppercase text-white">Threads</p>
              </div>
              <button
                aria-label="Close threads"
                className="flex h-9 w-9 items-center justify-center rounded border border-white/10 text-lg font-black text-white/55"
                onClick={() => setMobileThreadsOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="mt-4">
              <WorldChannelList
                activeChannel={channelId}
                descriptions
                onSelect={(nextChannel) => {
                  setChannelId(nextChannel);
                  setMobileThreadsOpen(false);
                }}
              />
            </div>
          </aside>
        </div>
      ) : null}
      <section className="overflow-hidden rounded border border-dyoor-purple/30 bg-[#070818]/90 shadow-[0_24px_80px_rgba(0,0,0,.38)] backdrop-blur-xl">
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-dyoor-purple/25 bg-black/25 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dyoor-cyan/40 bg-dyoor-cyan/10 text-dyoor-cyan">
              <DyoorWorldGlyph className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-dyoor-cyan">Private Monad node</p>
              <h1 className="truncate text-lg font-black uppercase text-white">dYOOR World</h1>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              aria-controls="world-mobile-threads"
              aria-expanded={mobileThreadsOpen}
              className="btn-ghost min-h-9 px-3 py-2 text-[0.66rem] lg:hidden"
              onClick={() => setMobileThreadsOpen(true)}
              type="button"
            >
              Threads
            </button>
            <span className="hidden rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-emerald-200 sm:inline-flex">
              S2 gate active
            </span>
            <button className="btn-ghost min-h-9 px-3 py-2 text-[0.66rem]" onClick={() => void exitWorld()} type="button">
              Exit
            </button>
          </div>
        </header>

        {walletMismatch ? (
          <div className="border-b border-yellow-300/30 bg-yellow-300/10 px-4 py-3 text-sm font-bold text-yellow-100">
            Connected wallet does not match this holder session. Exit and authenticate the connected wallet before using on-chain features.
          </div>
        ) : null}
        {error ? (
          <div className="border-b border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-bold text-red-100">{error}</div>
        ) : null}
        {notice ? (
          <div className="border-b border-dyoor-cyan/25 bg-dyoor-cyan/[0.07] px-4 py-3 text-sm font-bold text-dyoor-cyan">{notice}</div>
        ) : null}

        <div className="grid min-h-[760px] lg:grid-cols-[250px_minmax(0,1fr)_330px]">
          <aside className="hidden border-r border-dyoor-purple/20 bg-black/20 p-3 lg:block">
            <p className="px-2 py-2 text-[0.62rem] font-black uppercase tracking-[0.2em] text-white/35">World streams</p>
            <WorldChannelList
              activeChannel={channelId}
              descriptions
              onSelect={setChannelId}
            />
            <div className="mt-4 rounded border border-dyoor-purple/20 bg-dyoor-purple/[0.07] p-4">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.17em] text-dyoor-monad">Adapted from M3SH</p>
              <p className="mt-2 text-xs font-bold leading-5 text-white/42">
                The node-and-stream model, rebuilt with verified holder access, S2 identity, and immutable system relays.
              </p>
            </div>
          </aside>

          <section className="flex min-h-[620px] min-w-0 flex-col">
            <div className="border-b border-dyoor-purple/20 px-4 py-4 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white"># {selectedChannel.label}</p>
                  <p className="mt-1 text-xs font-bold text-white/38">{selectedChannel.description}</p>
                </div>
                {selectedChannel.readOnly ? (
                  <span className="rounded-full border border-dyoor-monad/30 bg-dyoor-monad/10 px-2.5 py-1 text-[0.56rem] font-black uppercase tracking-[0.12em] text-dyoor-monad">
                    Verified feed
                  </span>
                ) : null}
              </div>
            </div>

            {channelId === "trade-desk" ? (
              <div className="border-b border-dyoor-purple/20 bg-gradient-to-r from-dyoor-purple/[0.08] to-dyoor-cyan/[0.05] p-4">
                {config?.tradeEscrowAddress ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <form className="rounded border border-dyoor-cyan/20 bg-black/25 p-4" onSubmit={createTrade}>
                      <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-dyoor-cyan">New atomic swap</p>
                      <h3 className="mt-1 text-lg font-black text-white">Choose the Droid you send</h3>
                      <p className="mt-1 text-[0.62rem] font-bold leading-4 text-white/38">
                        Your selected Droid enters the ownerless escrow until the trade completes or you cancel.
                      </p>
                      <div className="mt-3">
                        <OwnedDroidPicker
                          disabled={Boolean(tradeBusy)}
                          onSelect={setTradeOfferedToken}
                          tokenIds={ownedTokenIds}
                          value={tradeOfferedToken}
                        />
                      </div>

                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-2">
                        <WorldDroidPreview label="You send" tokenId={tradeOfferedToken} />
                        <div className="text-center text-xl font-black text-dyoor-cyan">↔</div>
                        <WorldDroidPreview label="You receive" tokenId={tradeRequestedToken} />
                      </div>

                      <label className="mt-3 block">
                        <span className="text-[0.56rem] font-black uppercase tracking-[0.12em] text-white/40">
                          Droid you want
                        </span>
                        <input
                          className="field-control mt-2 w-full text-sm"
                          inputMode="numeric"
                          onChange={(event) => setTradeRequestedToken(event.target.value)}
                          placeholder="Enter requested Droid #"
                          value={tradeRequestedToken}
                        />
                      </label>

                      <details className="mt-3 rounded border border-white/10 bg-black/20">
                        <summary className="cursor-pointer px-3 py-3 text-[0.6rem] font-black uppercase tracking-[0.12em] text-white/48">
                          Optional MON, private wallet, and expiry
                        </summary>
                        <div className="grid gap-2 border-t border-white/10 p-3">
                          <input
                            className="field-control w-full text-xs"
                            onChange={(event) => setTradeCounterparty(event.target.value)}
                            placeholder="Specific taker wallet (blank = open offer)"
                            value={tradeCounterparty}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <span className="text-[0.52rem] font-black uppercase text-white/32">MON you add</span>
                              <input className="field-control mt-1 w-full text-xs" min="0" onChange={(event) => setTradeMonOffered(event.target.value)} step="0.01" type="number" value={tradeMonOffered} />
                            </label>
                            <label>
                              <span className="text-[0.52rem] font-black uppercase text-white/32">MON you request</span>
                              <input className="field-control mt-1 w-full text-xs" min="0" onChange={(event) => setTradeMonRequested(event.target.value)} step="0.01" type="number" value={tradeMonRequested} />
                            </label>
                          </div>
                          <label>
                            <span className="text-[0.52rem] font-black uppercase text-white/32">Offer expires</span>
                            <select className="field-control mt-1 w-full text-xs" onChange={(event) => setTradeExpiryHours(event.target.value)} value={tradeExpiryHours}>
                              <option value="1">1 hour</option>
                              <option value="6">6 hours</option>
                              <option value="24">24 hours</option>
                              <option value="72">3 days</option>
                              <option value="168">7 days</option>
                              <option value="720">30 days</option>
                            </select>
                          </label>
                        </div>
                      </details>

                      <button
                        className="btn-primary mt-3 w-full px-3 text-[0.68rem]"
                        disabled={Boolean(tradeBusy) || !validTokenIdText(tradeOfferedToken) || !validTokenIdText(tradeRequestedToken)}
                        type="submit"
                      >
                        {tradeBusy === "create" ? "Approving + opening trade" : "Open atomic trade"}
                      </button>
                    </form>
                    <div className="rounded border border-dyoor-purple/25 bg-black/25 p-4">
                      <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-dyoor-monad">Open or manage an offer</p>
                      <h3 className="mt-1 text-lg font-black text-white">Load a trade ID</h3>
                      <div className="mt-3 flex gap-2">
                        <input
                          className="field-control min-w-0 flex-1 text-sm"
                          inputMode="numeric"
                          onChange={(event) => {
                            setTradeId(event.target.value);
                            setLoadedTrade(null);
                          }}
                          placeholder="Trade #"
                          value={tradeId}
                        />
                        <button
                          className="btn-secondary shrink-0 px-3 text-[0.62rem]"
                          disabled={Boolean(tradeBusy) || !validTokenIdText(tradeId)}
                          onClick={() => void loadTradeOffer()}
                          type="button"
                        >
                          {tradeBusy === "load" ? "Loading" : "Load offer"}
                        </button>
                      </div>

                      {loadedTrade ? (
                        <div className="mt-4">
                          <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.035] px-3 py-2">
                            <p className="text-xs font-black text-white">Trade #{loadedTrade.tradeId}</p>
                            <span className={`rounded border px-2 py-1 text-[0.52rem] font-black uppercase tracking-[0.1em] ${
                              loadedTradeActive
                                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                                : "border-white/15 text-white/45"
                            }`}>
                              {loadedTrade.statusLabel}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-2">
                            <WorldDroidPreview label="Maker offers" tokenId={loadedTrade.offeredTokenId} />
                            <div className="text-center text-xl font-black text-dyoor-monad">↔</div>
                            <WorldDroidPreview label="Taker sends" tokenId={loadedTrade.requestedTokenId} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                            <div className="rounded border border-white/10 bg-black/25 p-2">
                              <p className="text-[0.5rem] font-black uppercase text-white/32">Maker adds</p>
                              <p className="mt-1 text-xs font-black text-emerald-200">{loadedTrade.monOffered} MON</p>
                            </div>
                            <div className="rounded border border-white/10 bg-black/25 p-2">
                              <p className="text-[0.5rem] font-black uppercase text-white/32">Taker adds</p>
                              <p className="mt-1 text-xs font-black text-yellow-100">{loadedTrade.monRequested} MON</p>
                            </div>
                          </div>
                          <p className="mt-3 break-all text-[0.58rem] font-bold leading-4 text-white/32">
                            {loadedTrade.openOffer ? "Open to any holder" : `Reserved for ${shortWorldWallet(loadedTrade.taker)}`}
                            {" · "}maker {shortWorldWallet(loadedTrade.maker)}
                            {" · "}expires {new Date(loadedTrade.expiresAt * 1_000).toLocaleString()}
                          </p>
                          {loadedTradeActive && !loadedTradeRequestedOwned && !loadedTradeIsMaker ? (
                            <p className="mt-2 rounded border border-yellow-300/20 bg-yellow-300/[0.06] p-2 text-[0.6rem] font-bold text-yellow-100/65">
                              This wallet does not own requested Droid #{loadedTrade.requestedTokenId}.
                            </p>
                          ) : null}
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {!loadedTradeIsMaker ? (
                              <button
                                className="btn-primary px-3 text-[0.62rem]"
                                disabled={Boolean(tradeBusy) || !canAcceptLoadedTrade}
                                onClick={() => void acceptTrade()}
                                type="button"
                              >
                                {tradeBusy === "accept" ? "Approving + swapping" : "Accept atomic swap"}
                              </button>
                            ) : (
                              <button
                                className="btn-secondary px-3 text-[0.62rem]"
                                disabled={Boolean(tradeBusy) || !loadedTradeActive}
                                onClick={() => void closeTrade("cancelTrade")}
                                type="button"
                              >
                                {tradeBusy === "cancelTrade" ? "Cancelling" : "Cancel + recover"}
                              </button>
                            )}
                            <button
                              className="btn-ghost px-3 text-[0.62rem]"
                              disabled={Boolean(tradeBusy) || !loadedTradeActive || !loadedTrade.expired}
                              onClick={() => void closeTrade("expireTrade")}
                              type="button"
                            >
                              {tradeBusy === "expireTrade"
                                ? "Recovering"
                                : loadedTrade.expired
                                  ? "Recover expired trade"
                                  : "Not expired yet"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded border border-dashed border-white/10 bg-black/15 p-6 text-center">
                          <DyoorWorldGlyph className="mx-auto h-7 w-7 text-dyoor-purple/55" />
                          <p className="mt-3 text-xs font-black text-white/45">Enter a trade ID to preview both Droids and exact MON terms.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded border border-yellow-300/20 bg-yellow-300/[0.06] p-4">
                    <p className="text-sm font-black text-yellow-100">Trade desk staged safely</p>
                    <p className="mt-1 text-xs font-bold leading-5 text-yellow-100/55">
                      The fee-free escrow must be deployed and added to the preview environment before trade controls unlock. The relay bot never holds assets or a custody key.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-5">
              {loadingMessages ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => <div className="skeleton-line h-16" key={index} />)}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex min-h-80 items-center justify-center text-center">
                  <div>
                    <DyoorWorldGlyph className="mx-auto h-10 w-10 text-dyoor-purple" />
                    <p className="mt-4 text-sm font-black uppercase text-white/65">
                      {selectedChannel.readOnly ? "Waiting for verified activity" : "No transmissions yet"}
                    </p>
                    <p className="mt-2 text-xs font-bold text-white/35">
                      {selectedChannel.readOnly
                        ? "The World relay will post the next confirmed event automatically."
                        : "Be the first holder to signal in this stream."}
                    </p>
                  </div>
                </div>
              ) : messages.map((message) => {
                const imageUrl = String(message.data?.imageUrl || "");
                const isSystem = (message.kind || "user") !== "user";
                const attachment = normalizeDyoorWorldAttachment(message.attachment);
                return (
                  <article
                    className={`group rounded border px-3 py-3 transition ${
                      isSystem
                        ? "border-dyoor-purple/15 bg-gradient-to-r from-dyoor-purple/[0.07] to-transparent"
                        : "border-transparent hover:border-white/[0.04] hover:bg-white/[0.025]"
                    }`}
                    key={message.id}
                  >
                    <div className="flex gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-black/30">
                        {message.avatar?.imageUrl ? (
                          <img alt={`S2 #${message.avatar.tokenId}`} className="h-full w-full object-cover" src={mediaUrl(message.avatar.imageUrl)} />
                        ) : imageUrl ? (
                          <img alt="" className="h-full w-full object-cover" src={mediaUrl(imageUrl)} />
                        ) : (
                          <DyoorWorldGlyph className={`h-5 w-5 ${isSystem ? "text-dyoor-monad" : "text-white/30"}`} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className={`text-xs font-black ${isSystem ? "text-dyoor-monad" : "text-dyoor-cyan"}`}>{message.author}</span>
                          <span className="text-[0.62rem] font-bold text-white/25">{messageTime(message.createdAt)}</span>
                          {isSystem ? <span className="text-[0.53rem] font-black uppercase tracking-[0.12em] text-white/28">verified {message.kind}</span> : null}
                        </div>
                        {message.content ? (
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-white/72">{message.content}</p>
                        ) : null}
                        {attachment?.kind === "image" || attachment?.kind === "gif" ? (
                          <a
                            className="relative mt-3 block w-fit max-w-full overflow-hidden rounded-lg border border-dyoor-purple/25 bg-black/35 shadow-[0_0_30px_rgba(128,92,255,.12)] transition hover:border-dyoor-cyan/45"
                            href={attachment.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <img
                              alt={attachment.alt || `${message.author} shared ${attachment.kind}`}
                              className="max-h-96 max-w-full object-contain"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              src={attachment.url}
                            />
                            <span className="absolute right-2 top-2 rounded border border-white/15 bg-black/70 px-2 py-1 text-[0.5rem] font-black uppercase tracking-[0.14em] text-white/65 backdrop-blur">
                              {attachment.kind}
                            </span>
                          </a>
                        ) : attachment?.kind === "sticker" ? (
                          <div className="mt-3">
                            <DyoorWorldStickerCard stickerId={attachment.stickerId} />
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.data?.openSeaUrl ? (
                            <a className="text-[0.6rem] font-black uppercase tracking-[0.1em] text-dyoor-cyan hover:text-white" href={String(message.data.openSeaUrl)} rel="noreferrer" target="_blank">
                              View on OpenSea ↗
                            </a>
                          ) : null}
                          {message.data?.txHash ? (
                            <a className="text-[0.6rem] font-black uppercase tracking-[0.1em] text-white/35 hover:text-white" href={`https://monadscan.com/tx/${String(message.data.txHash)}`} rel="noreferrer" target="_blank">
                              {shortenedHash(message.data.txHash)} ↗
                            </a>
                          ) : null}
                          {!isSystem && message.wallet !== normalizedSessionWallet ? (
                            <button
                              className="text-[0.6rem] font-black uppercase tracking-[0.1em] text-emerald-300/70 hover:text-emerald-200"
                              onClick={() => setTipTarget({ wallet: message.wallet, author: message.author })}
                              type="button"
                            >
                              Tip MON
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              <div ref={messageEndRef} />
            </div>

            {tipTarget ? (
              <div className="border-t border-emerald-300/20 bg-emerald-300/[0.05] p-3 sm:px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mr-auto text-xs font-black text-emerald-200">
                    Direct tip to {tipTarget.author}
                  </p>
                  <input className="field-control w-28 text-xs" min="0" onChange={(event) => setTipAmount(event.target.value)} step="0.01" type="number" value={tipAmount} />
                  <span className="text-xs font-black text-white/50">MON</span>
                  <button className="btn-primary px-3 text-xs" disabled={tipping} onClick={() => void sendTip()} type="button">{tipping ? "Confirming" : "Send direct"}</button>
                  <button className="btn-ghost px-3 text-xs" onClick={() => setTipTarget(null)} type="button">Cancel</button>
                </div>
                <p className="mt-2 text-[0.6rem] font-bold text-white/30">
                  Wallet-to-wallet on Monad. Tips of {rewards?.tips.minimumMon || "0.1"} MON or more can earn +{rewards?.tips.rewardEnergy || 10} Energy, capped daily. dYOOR World never takes custody.
                </p>
              </div>
            ) : null}

            {!selectedChannel.readOnly ? (
              <form className="border-t border-dyoor-purple/20 bg-black/20 p-3 sm:p-4" onSubmit={sendMessage}>
                <div className="flex items-end gap-2 rounded border border-dyoor-purple/25 bg-black/35 p-2 focus-within:border-dyoor-cyan/55">
                  <textarea
                    aria-label={`Message ${selectedChannel.label}`}
                    className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm font-bold text-white outline-none placeholder:text-white/25"
                    maxLength={800}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={`Message #${selectedChannel.label} as ${identity}`}
                    rows={2}
                    value={draft}
                  />
                  <button
                    className="btn-primary min-h-10 shrink-0 px-4 py-2 text-xs"
                    disabled={sending || (!draft.trim() && !composerAttachment)}
                    type="submit"
                  >
                    {sending ? "Sending" : "Send"}
                  </button>
                </div>
                <DyoorWorldMediaComposer
                  attachment={composerAttachment}
                  disabled={sending}
                  onChange={setComposerAttachment}
                />
                <p className="mt-2 px-1 text-[0.62rem] font-bold text-white/25">
                  {draft.length}/800 · meaningful text can earn {rewards?.chat.rewardEnergy || 5} Energy · media and stickers alone do not earn · holder session verified
                </p>
              </form>
            ) : null}
          </section>

          <aside className="border-t border-dyoor-purple/20 bg-black/20 p-4 lg:border-l lg:border-t-0">
            <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-white/35">World identity</p>
            <div className="mt-3 overflow-hidden rounded border border-dyoor-cyan/25 bg-gradient-to-br from-dyoor-cyan/[0.09] via-transparent to-dyoor-purple/[0.12]">
              <div className="flex items-center gap-3 p-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-dyoor-cyan/35 bg-black/35 shadow-[0_0_24px_rgba(76,255,229,.12)]">
                  {avatarPreview ? (
                    <img alt="Selected World PFP" className="h-full w-full object-cover" src={avatarPreview} />
                  ) : (
                    <DyoorWorldGlyph className="m-5 h-6 w-6 text-dyoor-cyan/50" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="break-words text-lg font-black text-dyoor-cyan">{identity}</p>
                  <p className="mt-1 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-white/35">{shortWorldWallet(normalizedSessionWallet)}</p>
                  {avatarTokenId ? <p className="mt-1 text-[0.58rem] font-black text-dyoor-monad">S2 DROID #{avatarTokenId}</p> : null}
                </div>
              </div>
              <div className="border-t border-white/[0.06] p-3">
                <label className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-white/35" htmlFor="world-pfp">Choose owned S2 PFP</label>
                <div className="mt-2 flex gap-2">
                  <select
                    className="field-control min-w-0 flex-1 text-xs"
                    id="world-pfp"
                    onChange={(event) => {
                      const nextTokenId = event.target.value;
                      setAvatarTokenId(nextTokenId);
                      if (!nextTokenId) setAvatarPreview("");
                    }}
                    value={avatarTokenId}
                  >
                    <option value="">Select Droid</option>
                    {ownedTokenIds.map((id) => <option key={id} value={id}>D.Y.O.O.R #{id}</option>)}
                  </select>
                  <button className="btn-secondary px-3 text-[0.62rem]" disabled={savingAvatar || !avatarTokenId} onClick={() => void saveAvatar()} type="button">
                    {savingAvatar ? "Saving" : "Set PFP"}
                  </button>
                </div>
              </div>
            </div>

            {!profile ? (
              <form className="mt-4 rounded border border-dyoor-purple/25 bg-dyoor-purple/[0.06] p-4" onSubmit={claimName}>
                <p className="text-sm font-black text-white">Create your .dYOOR name</p>
                <p className="mt-2 text-xs font-bold leading-5 text-white/42">
                  {config?.registryMode === "monad"
                    ? config.claimsOpen
                      ? "Claim a soulbound holder identity directly on Monad."
                      : "On-chain name claims are currently closed by the registry owner."
                    : "Reserve the name in this preview. On-chain activation follows registry deployment."}
                </p>
                <div className="mt-3 flex rounded border border-white/10 bg-black/35 focus-within:border-dyoor-cyan/55">
                  <input
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-black text-white outline-none placeholder:text-white/20"
                    maxLength={24}
                    minLength={3}
                    onChange={(event) => setLabel(event.target.value)}
                    pattern="[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?"
                    placeholder="riffs"
                    value={label}
                  />
                  <span className="flex items-center border-l border-white/10 px-3 text-xs font-black text-dyoor-cyan">.dYOOR</span>
                </div>
                <button
                  className="btn-secondary mt-3 w-full text-xs"
                  disabled={claiming || normalizeWorldLabel(label).length < 3 || (config?.registryMode === "monad" && !config.claimsOpen)}
                  type="submit"
                >
                  {claiming ? "Claiming" : config?.registryMode === "monad" ? config.claimsOpen ? "Claim on Monad" : "Claims closed" : "Reserve preview name"}
                </button>
              </form>
            ) : null}

            <div className="relative mt-4 overflow-hidden rounded border border-dyoor-monad/30 bg-gradient-to-br from-[#251146] via-[#10102b] to-[#082f34] p-4">
              <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-dyoor-cyan/10 blur-2xl" />
              <p className="relative text-[0.62rem] font-black uppercase tracking-[0.18em] text-dyoor-monad">Daily Energy signal</p>
              <div className="relative mt-3 flex items-center gap-4">
                <div className={`relative h-24 w-24 shrink-0 rounded-full border-4 border-white/15 bg-[conic-gradient(#6bf8e8_0_60%,#8b5cf6_60%_85%,#facc15_85%_95%,#fb7185_95%_99%,#fff_99%)] shadow-[0_0_30px_rgba(139,92,246,.25)] ${wheelSpinning ? "animate-spin" : ""}`}>
                  <div className="absolute inset-3 flex items-center justify-center rounded-full bg-[#0b0b1c] text-center">
                    <span className="text-base font-black text-white">{rewards?.daily ? `+${rewards.daily.amountEnergy}` : "SPIN"}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-black text-white">{rewards?.pendingEnergy || 0}</p>
                  <p className="text-[0.58rem] font-black uppercase tracking-[0.13em] text-white/40">Pending Energy</p>
                  <p className="mt-2 text-[0.62rem] font-bold leading-4 text-white/40">Free once per UTC day. Rare 1% signal: 1,000 Energy.</p>
                </div>
              </div>
              {rewards?.enabled ? (
                <div className="relative mt-3 grid grid-cols-2 gap-2">
                  <button className="btn-secondary px-2 text-[0.62rem]" disabled={Boolean(rewardAction) || Boolean(rewards.daily)} onClick={() => void runRewardAction("check-in")} type="button">
                    {rewards.daily ? "Checked in" : rewardAction === "check-in" ? "Receiving" : "Daily check-in"}
                  </button>
                  <button className="btn-primary px-2 text-[0.62rem]" disabled={Boolean(rewardAction) || rewards.pendingEnergy <= 0 || !rewards.claimReady} onClick={() => void runRewardAction("claim")} type="button">
                    {rewardAction === "claim" ? "Claiming" : "Claim to Bank"}
                  </button>
                </div>
              ) : (
                <p className="relative mt-3 rounded border border-yellow-300/20 bg-yellow-300/[0.06] p-2 text-[0.6rem] font-bold leading-4 text-yellow-100/60">
                  Reward accounting is staged but off until the preview reward secret and operator flag are enabled.
                </p>
              )}
              <p className="relative mt-2 text-[0.56rem] font-bold text-white/25">
                Chat: +{rewards?.chat.rewardEnergy || 5} · {rewards?.chat.rewardedToday || 0}/{rewards?.chat.dailyCap || 5} rewarded today · 10m cooldown
              </p>
              <p className="relative mt-1 text-[0.56rem] font-bold text-white/25">
                Tips: +{rewards?.tips.rewardEnergy || 10} at {rewards?.tips.minimumMon || "0.1"}+ MON · {rewards?.tips.rewardedToday || 0}/{rewards?.tips.dailyCap || 3} today
              </p>
              <p className="relative mt-1 text-[0.56rem] font-bold text-white/25">
                Completed trades: +{rewards?.trades.rewardEnergy || 100} each · {rewards?.trades.rewardedToday || 0}/{rewards?.trades.dailyCap || 1} today
              </p>
            </div>

            <div className="mt-4 rounded border border-white/[0.07] bg-white/[0.025] p-4">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-dyoor-monad">Safety model</p>
              <p className="mt-2 text-xs font-bold leading-5 text-white/40">
                Tips travel wallet-to-wallet. Trades settle atomically in a fee-free S2 escrow. Energy is earned only from meaningful messages, qualifying verified tips, and completed swaps. Sales, burn, and trade bots only verify and relay public events—no bot custody key exists.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
