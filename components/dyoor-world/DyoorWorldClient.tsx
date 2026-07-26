"use client";

/* eslint-disable @next/next/no-img-element */

import {
  decodeFunctionResult,
  encodeFunctionData,
  parseEther,
  toHex,
} from "viem";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DYOOR_WORLD_CHANNELS,
  type DyoorWorldAvatar,
  type DyoorWorldChannelId,
  type DyoorWorldMessageView,
  type DyoorWorldProfile,
  parseWorldMessageLink,
  shortWorldWallet,
  validateWorldLabel,
  worldChannelFromTag,
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
import { DyoorWorldDirectMessages } from "@/components/dyoor-world/DyoorWorldDirectMessages";
import { DyoorWorldNotifications } from "@/components/dyoor-world/DyoorWorldNotifications";
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
  canPostAnnouncements: boolean;
};

type ProfileResponse = {
  ok?: boolean;
  profile?: DyoorWorldProfile | null;
  avatar?: DyoorWorldAvatar | null;
  config?: WorldConfig;
  error?: string;
};

type WorldNameAvailability = {
  label: string;
  displayName: string;
  available: boolean;
  registryMode: "monad" | "preview-reservation";
  currentName: string;
  reason: string;
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
    earnedEnergyToday: number;
    dailyEnergyCap: number;
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
}, {
  type: "function",
  name: "getApproved",
  stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ name: "operator", type: "address" }],
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
const WORLD_WHEEL_PRIZES = [10, 25, 50, 100, 250, 500, 1_000] as const;

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

function worldReplyExcerpt(message: Pick<DyoorWorldMessageView, "content" | "attachment">) {
  const content = String(message.content || "").trim().replace(/\s+/g, " ");
  if (content) return content.slice(0, 140);
  const attachment = normalizeDyoorWorldAttachment(message.attachment);
  if (attachment?.kind === "sticker") return "Shared a World sticker";
  if (attachment?.kind === "gif") return "Shared a GIF";
  if (attachment?.kind === "image") return "Shared an image";
  return "Message";
}

function WorldMessageContent({
  content,
  onChannelSelect,
}: {
  content: string;
  onChannelSelect: (channelId: DyoorWorldChannelId) => void;
}) {
  return (
    <>
      {content.split(/(https:\/\/[^\s<]+|#[a-z0-9-]+)/gi).map((part, index) => {
        const link = parseWorldMessageLink(part);
        if (link) {
          return (
            <span key={`world-message-link-${index}`}>
              <a
                className="break-all font-bold text-dyoor-cyan underline decoration-dyoor-cyan/30 underline-offset-2 transition hover:text-white"
                href={link.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {link.label}
              </a>
              {link.trailing}
            </span>
          );
        }
        const taggedChannel = worldChannelFromTag(part);
        if (!taggedChannel) return part;
        const channel = DYOOR_WORLD_CHANNELS.find((item) => item.id === taggedChannel);
        return (
          <button
            className="inline rounded-sm bg-dyoor-purple/15 px-1 font-black text-dyoor-cyan underline decoration-dyoor-cyan/25 underline-offset-2 transition hover:bg-dyoor-cyan/15 hover:text-white"
            key={`${part}-${index}`}
            onClick={() => onChannelSelect(taggedChannel)}
            title={`Open #${channel?.label || taggedChannel}`}
            type="button"
          >
            #{channel?.label || taggedChannel}
          </button>
        );
      })}
    </>
  );
}

function activeWorldChannelMention(draft: string, cursorValue: number) {
  const cursor = Math.max(0, Math.min(cursorValue, draft.length));
  const match = draft.slice(0, cursor).match(/(?:^|\s)#([a-z0-9-]*)$/i);
  if (!match) return null;
  const query = String(match[1] || "").toLowerCase();
  return {
    start: cursor - query.length - 1,
    end: cursor,
    query,
  };
}

function readableWorldNameClaimError(error: unknown) {
  const value = error as {
    message?: string;
    shortMessage?: string;
    details?: string;
    cause?: { message?: string; shortMessage?: string };
  };
  const raw = [
    value?.shortMessage,
    value?.message,
    value?.details,
    value?.cause?.shortMessage,
    value?.cause?.message,
  ].filter(Boolean).join(" · ");
  if (/user rejected|user denied|request rejected/i.test(raw)) {
    return "The wallet request was cancelled. No name was claimed.";
  }
  if (/WalletAlreadyNamed/i.test(raw)) {
    return "This wallet already has a .dYOOR name. Each holder wallet can claim one.";
  }
  if (/NameAlreadyClaimed/i.test(raw)) {
    return "That .dYOOR name was just claimed. Choose another name.";
  }
  if (/LabelReservedForProtocol/i.test(raw)) {
    return "That name is reserved by D.Y.O.O.R. Choose another name.";
  }
  if (/HolderRequired/i.test(raw)) {
    return "This wallet must currently hold an S2 Droid to claim a .dYOOR name.";
  }
  if (/ClaimsClosed/i.test(raw)) {
    return "dYOOR World name claims are currently closed.";
  }
  if (/InvalidLabel/i.test(raw)) {
    return "Use 3–24 lowercase letters, numbers, or interior hyphens.";
  }
  if (/execution reverted|reverted|Monad transaction failed/i.test(raw)) {
    return "The registry rejected this claim. Recheck the name availability and wallet, then try again.";
  }
  return raw || "Could not claim this World name.";
}

function readableWorldTradeError(error: unknown) {
  const value = error as {
    code?: number | string;
    data?: unknown;
    details?: string;
    message?: string;
    shortMessage?: string;
    cause?: {
      code?: number | string;
      data?: unknown;
      message?: string;
      shortMessage?: string;
    };
  };
  const raw = [
    value?.shortMessage,
    value?.message,
    value?.details,
    typeof value?.data === "string" ? value.data : "",
    value?.cause?.shortMessage,
    value?.cause?.message,
    typeof value?.cause?.data === "string" ? value.cause.data : "",
    value?.code,
    value?.cause?.code,
  ].filter(Boolean).join(" · ");
  if (/user rejected|user denied|request rejected|4001/i.test(raw)) {
    return "The wallet request was cancelled. No trade assets moved.";
  }
  if (/insufficient funds|exceeds balance/i.test(raw)) {
    return "This wallet does not have enough MON for the trade and network fee.";
  }
  if (/TradeNotActive/i.test(raw)) {
    return "This trade is no longer active. Reload the offer for its latest status.";
  }
  if (/TradeExpiredAlready|TradeNotExpired/i.test(raw)) {
    return "This trade’s expiry state changed. Reload the offer before continuing.";
  }
  if (/Unauthorized|TransferCallerNotOwnerNorApproved|not owner nor approved/i.test(raw)) {
    return "The selected Droid is no longer owned or approved by this wallet. Refresh your Droids and try again.";
  }
  if (/IncorrectPayment/i.test(raw)) {
    return "The required MON amount changed. Reload the offer before accepting.";
  }
  if (/0x1de5204e|whitelist|transfer validator/i.test(raw)) {
    return "Season 2 transfer security has not authorized this escrow route. No assets moved.";
  }
  if (/execution reverted|third-party contract|transaction failed|Monad transaction failed/i.test(raw)) {
    return "The trade failed its on-chain safety check before submission. Refresh the offer and try again.";
  }
  return raw || "Could not complete the World trade.";
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
    <div className="min-w-0 overflow-hidden rounded border border-white/10 bg-black/30">
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
    <div className="flex max-w-full snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-2">
      {tokenIds.map((id) => (
        <button
          aria-pressed={id === value}
          className={`w-20 shrink-0 snap-start overflow-hidden rounded border text-left transition sm:w-24 ${
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

function DyoorEnergyWheel({
  prize,
  spinning,
}: {
  prize?: number;
  spinning: boolean;
}) {
  return (
    <div
      aria-label={
        spinning
          ? "Daily Energy wheel spinning"
          : prize
            ? `Daily Energy wheel awarded ${prize} Energy`
            : "Daily Energy wheel ready"
      }
      className="relative h-36 w-36 shrink-0"
      role="img"
    >
      <div className="world-energy-wheel-aura pointer-events-none absolute -inset-4 rounded-full bg-[radial-gradient(circle,rgba(57,255,226,.24),rgba(131,110,249,.12)_42%,transparent_70%)] blur-xl" />
      <div className="absolute left-1/2 top-0 z-30 -translate-x-1/2 drop-shadow-[0_0_8px_rgba(255,255,255,.8)]">
        <div className="h-0 w-0 border-l-[9px] border-r-[9px] border-t-[15px] border-l-transparent border-r-transparent border-t-white" />
      </div>
      <div
        className={`world-energy-wheel-disc absolute inset-3 rounded-full ${
          spinning ? "world-energy-wheel-spinning" : ""
        }`}
      />
      <div className="absolute inset-[2.45rem] z-20 grid place-items-center rounded-full border border-white/20 bg-[radial-gradient(circle_at_35%_28%,#302c5a,#0a0b1e_58%,#05050d)] text-center shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_0_22px_rgba(57,255,226,.22)]">
        <div>
          <span className="block text-[0.48rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan/70">
            {spinning ? "Routing" : prize ? "Landed" : "Ready"}
          </span>
          <span className="mt-0.5 block text-lg font-black leading-none text-white">
            {spinning ? "•••" : prize ? `+${prize}` : "SPIN"}
          </span>
          <span className="mt-1 block text-[0.42rem] font-black uppercase tracking-[0.15em] text-white/30">
            Energy
          </span>
        </div>
      </div>
    </div>
  );
}

export function DyoorWorldClient({ sessionWallet }: { sessionWallet: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [nameAvailability, setNameAvailability] = useState<WorldNameAvailability | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftCursor, setDraftCursor] = useState(0);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(0);
  const [tagMenuDismissed, setTagMenuDismissed] = useState(false);
  const [composerAttachment, setComposerAttachment] = useState<DyoorWorldMessageAttachment | null>(null);
  const [replyingTo, setReplyingTo] = useState<DyoorWorldMessageView | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [rewardAction, setRewardAction] = useState("");
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [tipTarget, setTipTarget] = useState<TipTarget>(null);
  const [directMessageTarget, setDirectMessageTarget] = useState<TipTarget>(null);
  const [directMessagesOpen, setDirectMessagesOpen] = useState(false);
  const [directMessageUnread, setDirectMessageUnread] = useState(0);
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
  const [mobileIdentityOpen, setMobileIdentityOpen] = useState(false);
  const [messageListAtBottom, setMessageListAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const tipAmountRef = useRef<HTMLInputElement>(null);
  const messageListAtBottomRef = useRef(true);
  const messageTrackerRef = useRef({
    channelId: "world-lobby" as DyoorWorldChannelId,
    lastMessageId: "",
  });
  const messageHighlightTimerRef = useRef<number | null>(null);
  const selectedChannel = useMemo(
    () => DYOOR_WORLD_CHANNELS.find((channel) => channel.id === channelId)
      || DYOOR_WORLD_CHANNELS[0],
    [channelId],
  );
  const selectedChannelCanPost = !selectedChannel.readOnly
    || (
      selectedChannel.id === "announcements"
      && Boolean(config?.canPostAnnouncements)
    );
  const channelMention = useMemo(
    () => tagMenuDismissed ? null : activeWorldChannelMention(draft, draftCursor),
    [draft, draftCursor, tagMenuDismissed],
  );

  useEffect(() => {
    const linkedChannel = worldChannelFromTag(searchParams.get("channel"));
    const directWallet = normalizeAddress(searchParams.get("dm") || "");
    const timer = window.setTimeout(() => {
      if (linkedChannel) setChannelId(linkedChannel);
      if (directWallet && directWallet !== normalizedSessionWallet) {
        setDirectMessageTarget({
          wallet: directWallet,
          author: shortWorldWallet(directWallet),
        });
        setDirectMessagesOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [normalizedSessionWallet, searchParams]);
  const channelTagSuggestions = useMemo(() => {
    if (!channelMention) return [];
    return DYOOR_WORLD_CHANNELS.filter((channel) =>
      channel.label.startsWith(channelMention.query));
  }, [channelMention]);

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

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = "smooth") => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior,
    });
    messageListAtBottomRef.current = true;
    setMessageListAtBottom(true);
    setNewMessageCount(0);
  }, []);

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
    const validation = validateWorldLabel(label);
    if (!config || profile || !validation.ok) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCheckingName(true);
      try {
        const response = await fetch(
          `/api/dyoor-world/names/availability?label=${encodeURIComponent(validation.label)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await readResponse<{ availability?: WorldNameAvailability }>(response);
        if (!controller.signal.aborted) {
          setNameAvailability(data.availability || null);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setNameAvailability({
            label: validation.label,
            displayName: `${validation.label}.dYOOR`,
            available: false,
            registryMode: config.registryMode,
            currentName: "",
            reason: caught instanceof Error
              ? caught.message
              : "Could not verify this name yet.",
          });
        }
      } finally {
        if (!controller.signal.aborted) setCheckingName(false);
      }
    }, 320);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [config, label, profile]);

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
    const newestMessageId = messages.at(-1)?.id || "";
    const tracker = messageTrackerRef.current;
    if (tracker.channelId !== channelId) {
      messageTrackerRef.current = { channelId, lastMessageId: newestMessageId };
      const frame = window.requestAnimationFrame(() => scrollToLatestMessage("auto"));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!newestMessageId || newestMessageId === tracker.lastMessageId) return;

    const previousIndex = messages.findIndex(
      (message) => message.id === tracker.lastMessageId,
    );
    const addedMessages = tracker.lastMessageId && previousIndex >= 0
      ? messages.length - previousIndex - 1
      : 1;
    tracker.lastMessageId = newestMessageId;

    if (messageListAtBottomRef.current) {
      const frame = window.requestAnimationFrame(() => scrollToLatestMessage());
      return () => window.cancelAnimationFrame(frame);
    }
    setNewMessageCount((current) => current + Math.max(1, addedMessages));
  }, [channelId, messages, scrollToLatestMessage]);

  useEffect(() => {
    return () => {
      if (messageHighlightTimerRef.current != null) {
        window.clearTimeout(messageHighlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!replyingTo) return;
    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [replyingTo]);

  useEffect(() => {
    if (!mobileThreadsOpen && !mobileIdentityOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileThreadsOpen(false);
      setMobileIdentityOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileIdentityOpen, mobileThreadsOpen]);

  useEffect(() => {
    if (!tipTarget) return;
    const frame = window.requestAnimationFrame(() => {
      tipAmountRef.current?.focus();
      tipAmountRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tipTarget]);

  function selectWorldChannel(nextChannel: DyoorWorldChannelId) {
    if (nextChannel !== channelId) {
      setChannelId(nextChannel);
      setReplyingTo(null);
      setTagMenuDismissed(false);
      setTagSuggestionIndex(0);
      setNewMessageCount(0);
      setMessageListAtBottom(true);
      messageListAtBottomRef.current = true;
    }
    setMobileThreadsOpen(false);
    setMobileIdentityOpen(false);
  }

  function handleMessageListScroll() {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const distanceFromBottom = messageList.scrollHeight
      - messageList.scrollTop
      - messageList.clientHeight;
    const atBottom = distanceFromBottom <= 96;
    messageListAtBottomRef.current = atBottom;
    setMessageListAtBottom(atBottom);
    if (atBottom) setNewMessageCount(0);
  }

  function jumpToWorldMessage(messageId: string) {
    const target = document.getElementById(`world-message-${messageId}`);
    if (!target) {
      setNotice("The original message is outside the currently loaded history.");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (messageHighlightTimerRef.current != null) {
      window.clearTimeout(messageHighlightTimerRef.current);
    }
    messageHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId("");
      messageHighlightTimerRef.current = null;
    }, 1_800);
  }

  function beginWorldReply(message: DyoorWorldMessageView) {
    setReplyingTo(message);
    setTagMenuDismissed(true);
  }

  function insertWorldChannelTag(nextChannel: DyoorWorldChannelId) {
    if (!channelMention) return;
    const channel = DYOOR_WORLD_CHANNELS.find((item) => item.id === nextChannel);
    if (!channel) return;
    const replacement = `#${channel.label} `;
    const nextDraft = (
      draft.slice(0, channelMention.start)
      + replacement
      + draft.slice(channelMention.end)
    ).slice(0, 800);
    const nextCursor = Math.min(
      channelMention.start + replacement.length,
      nextDraft.length,
    );
    setDraft(nextDraft);
    setDraftCursor(nextCursor);
    setTagMenuDismissed(false);
    setTagSuggestionIndex(0);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (channelTagSuggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setTagSuggestionIndex((current) =>
          (current + direction + channelTagSuggestions.length)
          % channelTagSuggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = channelTagSuggestions[
          Math.min(tagSuggestionIndex, channelTagSuggestions.length - 1)
        ];
        if (selected) insertWorldChannelTag(selected.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setTagMenuDismissed(true);
        return;
      }
    }

    const desktopEnter = event.key === "Enter"
      && !event.shiftKey
      && window.matchMedia("(min-width: 768px)").matches;
    if (!desktopEnter) return;
    event.preventDefault();
    if (event.repeat || sending) return;
    event.currentTarget.form?.requestSubmit();
  }

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

  async function preflightWorldTrade(request: Record<string, string>) {
    const activeProvider = await wallet.getProvider();
    try {
      await activeProvider.request({
        method: "eth_call",
        params: [request, "latest"],
      });
    } catch (caught) {
      throw new Error(readableWorldTradeError(caught));
    }
  }

  async function claimName(event: FormEvent) {
    event.preventDefault();
    const validation = validateWorldLabel(label);
    if (!validation.ok || !config) {
      setError(validation.ok ? "The World name registry is still loading." : validation.error);
      return;
    }
    const normalizedLabel = validation.label;
    setClaiming(true);
    setError("");
    setNotice("");
    try {
      const latest = await loadProfile();
      const liveConfig = latest.config || config;
      if (latest.profile) {
        setProfile(latest.profile);
        throw new Error(
          `${latest.profile.displayName} is already assigned to this wallet. Each holder wallet can claim one .dYOOR name.`,
        );
      }
      if (liveConfig.registryMode === "monad" && liveConfig.registryAddress) {
        if (!liveConfig.claimsOpen) {
          throw new Error("dYOOR World name claims are currently closed.");
        }
        const from = await ensureActiveWallet();
        const availabilityResponse = await fetch(
          `/api/dyoor-world/names/availability?label=${encodeURIComponent(normalizedLabel)}`,
          { cache: "no-store" },
        );
        const availabilityData = await readResponse<{
          availability?: WorldNameAvailability;
        }>(availabilityResponse);
        const availability = availabilityData.availability;
        setNameAvailability(availability || null);
        if (!availability?.available) {
          throw new Error(
            availability?.reason || "That .dYOOR name is not currently available.",
          );
        }
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
        await waitForTransaction(txHash);
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
      setNameAvailability(null);
    } catch (caught) {
      setError(readableWorldNameClaimError(caught));
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
          replyToMessageId: replyingTo?.id,
        }),
      });
      const data = await readResponse<{ message?: DyoorWorldMessageView }>(response);
      if (data.message) {
        messageListAtBottomRef.current = true;
        setMessageListAtBottom(true);
        setNewMessageCount(0);
        setMessages((current) => [...current, data.message!]);
        if (data.message.energyReward) {
          setNotice(`Signal accepted · +${data.message.energyReward} Energy pending.`);
          await loadRewards();
        }
      }
      setDraft("");
      setDraftCursor(0);
      setComposerAttachment(null);
      setReplyingTo(null);
      setTagMenuDismissed(false);
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
        await new Promise((resolve) => window.setTimeout(resolve, 1_600));
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
      selectWorldChannel("tip-ledger");
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
    const activeProvider = await wallet.getProvider();
    const approvedResult = await activeProvider.request({
      method: "eth_call",
      params: [{
        from,
        to: config!.s2ContractAddress,
        data: encodeFunctionData({
          abi: S2_APPROVAL_ABI,
          functionName: "getApproved",
          args: [id],
        }),
      }, "latest"],
    }) as `0x${string}`;
    const approved = decodeFunctionResult({
      abi: S2_APPROVAL_ABI,
      functionName: "getApproved",
      data: approvedResult,
    });
    if (normalizeAddress(approved) === normalizeAddress(escrow)) return;

    const request = {
      from,
      to: config!.s2ContractAddress,
      data: encodeFunctionData({
        abi: S2_APPROVAL_ABI,
        functionName: "approve",
        args: [escrow as `0x${string}`, id],
      }),
    };
    await preflightWorldTrade(request);
    const approvalHash = await wallet.sendTransaction(request);
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
      const request = {
        from,
        to: config.tradeEscrowAddress,
        data: encodeFunctionData({
          abi: WORLD_TRADE_ABI,
          functionName: "createTrade",
          args: [taker as `0x${string}`, offered, requested, monRequested, expiresAt],
        }),
        ...(monOffered > 0n ? { value: toHex(monOffered) } : {}),
      };
      await preflightWorldTrade(request);
      const txHash = await wallet.sendTransaction(request);
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
      setError(readableWorldTradeError(caught));
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
      const request = {
        from,
        to: config.tradeEscrowAddress,
        data: encodeFunctionData({
          abi: WORLD_TRADE_ABI,
          functionName: "acceptTrade",
          args: [id],
        }),
        ...(requestedMon > 0n ? { value: toHex(requestedMon) } : {}),
      };
      await preflightWorldTrade(request);
      const txHash = await wallet.sendTransaction(request);
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
      setError(readableWorldTradeError(caught));
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
      const request = {
        from,
        to: config.tradeEscrowAddress,
        data: encodeFunctionData({
          abi: WORLD_TRADE_ABI,
          functionName: action,
          args: [id],
        }),
      };
      await preflightWorldTrade(request);
      const txHash = await wallet.sendTransaction(request);
      await verifyTrade(txHash);
      setNotice(`Trade #${id} ${action === "cancelTrade" ? "cancelled" : "expired"} · ${shortenedHash(txHash)}`);
      setLoadedTrade(await fetchTradeOffer(id.toString()).catch(() => null));
    } catch (caught) {
      setError(readableWorldTradeError(caught));
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
  const chatEnergyEarnedToday = rewards?.chat.earnedEnergyToday || 0;
  const chatEnergyDailyCap = rewards?.chat.dailyEnergyCap || 200;
  const chatEnergyProgress = Math.min(
    100,
    Math.max(0, (chatEnergyEarnedToday / chatEnergyDailyCap) * 100),
  );
  const nameValidation = validateWorldLabel(label);
  const currentNameAvailability = nameAvailability?.label === nameValidation.label
    ? nameAvailability
    : null;

  return (
    <main className="mx-auto min-h-[100dvh] min-w-0 max-w-[1680px] overflow-x-clip px-0 py-0 sm:px-5 sm:py-6">
      <DyoorWorldDirectMessages
        initialTarget={directMessageTarget}
        onClose={() => setDirectMessagesOpen(false)}
        onUnreadChange={setDirectMessageUnread}
        open={directMessagesOpen}
        sessionWallet={normalizedSessionWallet}
      />
      {mobileIdentityOpen ? (
        <button
          aria-label="Close World identity and Energy"
          className="world-drawer-backdrop fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileIdentityOpen(false)}
          type="button"
        />
      ) : null}
      {mobileThreadsOpen ? (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <button
            aria-label="Close World threads"
            className="world-drawer-backdrop absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileThreadsOpen(false)}
            type="button"
          />
          <aside
            aria-label="dYOOR World threads"
            className="world-drawer-left absolute inset-y-0 left-0 w-[min(86vw,22rem)] overflow-y-auto border-r border-dyoor-purple/35 bg-[#080918] p-4 shadow-[24px_0_70px_rgba(0,0,0,.55)]"
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
                onSelect={selectWorldChannel}
              />
            </div>
          </aside>
        </div>
      ) : null}
      <section className="min-w-0 overflow-hidden rounded-none border-x-0 border-b border-t-0 border-dyoor-purple/30 bg-[#070818]/90 shadow-[0_24px_80px_rgba(0,0,0,.38)] sm:rounded sm:border lg:backdrop-blur-xl">
        <header className="sticky top-0 z-[90] flex min-h-16 items-center gap-2 border-b border-dyoor-purple/25 bg-[#080918]/95 px-3 py-3 shadow-[0_12px_32px_rgba(0,0,0,.25)] backdrop-blur-xl sm:gap-3 sm:px-5">
          <button
            aria-controls="world-mobile-threads"
            aria-expanded={mobileThreadsOpen}
            aria-label={`Open World threads. Current thread: ${selectedChannel.label}`}
            className="world-mobile-panel-trigger shrink-0 lg:hidden"
            onClick={() => {
              setMobileIdentityOpen(false);
              setMobileThreadsOpen(true);
            }}
            type="button"
          >
            <span aria-hidden="true" className="grid gap-1">
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current" />
            </span>
            <span className="hidden min-[360px]:inline">Threads</span>
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dyoor-cyan/40 bg-dyoor-cyan/10 text-dyoor-cyan">
              <DyoorWorldGlyph className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="hidden text-[0.62rem] font-black uppercase tracking-[0.2em] text-dyoor-cyan sm:block">Private Monad node</p>
              <h1 className="sr-only font-black uppercase text-white sm:not-sr-only sm:block sm:truncate sm:text-lg">dYOOR World</h1>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              aria-label={`Open direct messages${directMessageUnread > 0 ? `, ${directMessageUnread} unread` : ""}`}
              className="world-mobile-panel-trigger relative shrink-0 border-dyoor-cyan/35 text-dyoor-cyan"
              onClick={() => {
                setMobileThreadsOpen(false);
                setMobileIdentityOpen(false);
                setDirectMessageTarget(null);
                setDirectMessagesOpen(true);
              }}
              type="button"
            >
              <span aria-hidden="true">✉</span>
              <span className="hidden sm:inline">DMs</span>
              {directMessageUnread > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-fuchsia-400 px-1 py-0.5 text-[0.45rem] font-black leading-none text-black">
                  {Math.min(99, directMessageUnread)}
                </span>
              ) : null}
            </button>
            <button
              aria-controls="world-mobile-identity"
              aria-expanded={mobileIdentityOpen}
              aria-label="Open World identity and Energy"
              className="world-mobile-panel-trigger border-dyoor-monad/35 text-dyoor-monad lg:hidden"
              onClick={() => {
                setMobileThreadsOpen(false);
                setMobileIdentityOpen(true);
              }}
              type="button"
            >
              <span aria-hidden="true">⚡</span>
              <span className="hidden min-[360px]:inline">Identity</span>
            </button>
            <Link
              aria-label="Eject from dYOOR World to the main D.Y.O.O.R site"
              className="world-mobile-panel-trigger border-red-300/30 text-red-100 lg:hidden"
              href="/"
            >
              <span aria-hidden="true">↗</span>
              <span className="hidden min-[360px]:inline">Eject</span>
            </Link>
            <span className="hidden rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-emerald-200 sm:inline-flex">
              S2 gate active
            </span>
            <Link className="btn-ghost hidden min-h-9 px-3 py-2 text-[0.66rem] lg:inline-flex" href="/">
              Eject
            </Link>
            <button className="btn-ghost hidden min-h-9 px-3 py-2 text-[0.66rem] lg:inline-flex" onClick={() => void exitWorld()} type="button">
              Sign out
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

        <div className="grid min-h-0 min-w-0 lg:min-h-[760px] lg:grid-cols-[250px_minmax(0,1fr)_330px]">
          <aside className="hidden border-r border-dyoor-purple/20 bg-black/20 p-3 lg:block">
            <p className="px-2 py-2 text-[0.62rem] font-black uppercase tracking-[0.2em] text-white/35">World streams</p>
            <WorldChannelList
              activeChannel={channelId}
              descriptions
              onSelect={selectWorldChannel}
            />
            <div className="mt-4 rounded border border-dyoor-purple/20 bg-dyoor-purple/[0.07] p-4">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.17em] text-dyoor-monad">Adapted from M3SH</p>
              <p className="mt-2 text-xs font-bold leading-5 text-white/42">
                The node-and-stream model, rebuilt with verified holder access, S2 identity, and immutable system relays.
              </p>
            </div>
          </aside>

          <section
            className={`flex min-w-0 max-w-full flex-col overflow-hidden lg:h-auto lg:min-h-[620px] ${
              channelId === "trade-desk"
                ? "h-auto min-h-0"
                : "h-[calc(100dvh-4rem)] min-h-[30rem] sm:h-[calc(100dvh-7rem)]"
            }`}
          >
            <div className="world-channel-context hidden border-b border-dyoor-purple/20 px-4 py-4 sm:block sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-white"># {selectedChannel.label}</p>
                  <p className="mt-1 break-words text-xs font-bold text-white/38">{selectedChannel.description}</p>
                </div>
                {selectedChannel.readOnly ? (
                  <span className="shrink-0 rounded-full border border-dyoor-monad/30 bg-dyoor-monad/10 px-2.5 py-1 text-[0.56rem] font-black uppercase tracking-[0.12em] text-dyoor-monad">
                    {selectedChannel.id === "announcements"
                      ? selectedChannelCanPost
                        ? "Owner post channel"
                        : "Owner-only feed"
                      : "Verified feed"}
                  </span>
                ) : null}
              </div>
            </div>

            {channelId === "trade-desk" ? (
              <div className="min-w-0 max-w-full overflow-hidden border-b border-dyoor-purple/20 bg-gradient-to-r from-dyoor-purple/[0.08] to-dyoor-cyan/[0.05] p-3 sm:p-4">
                {config?.tradeEscrowAddress ? (
                  <div className="grid min-w-0 max-w-full gap-3 xl:grid-cols-2">
                    <form className="min-w-0 overflow-hidden rounded border border-dyoor-cyan/20 bg-black/25 p-3 sm:p-4" onSubmit={createTrade}>
                      <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-dyoor-cyan">New atomic swap</p>
                      <h3 className="mt-1 text-lg font-black text-white">Choose the Droid you send</h3>
                      <p className="mt-1 break-words text-[0.62rem] font-bold leading-4 text-white/38">
                        Your selected Droid enters the ownerless escrow until the trade completes or you cancel.
                      </p>
                      <div className="mt-3 min-w-0 max-w-full">
                        <OwnedDroidPicker
                          disabled={Boolean(tradeBusy)}
                          onSelect={setTradeOfferedToken}
                          tokenIds={ownedTokenIds}
                          value={tradeOfferedToken}
                        />
                      </div>

                      <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] sm:gap-2">
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
                          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
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
                    <div className="min-w-0 overflow-hidden rounded border border-dyoor-purple/25 bg-black/25 p-3 sm:p-4">
                      <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-dyoor-monad">Open or manage an offer</p>
                      <h3 className="mt-1 text-lg font-black text-white">Load a trade ID</h3>
                      <div className="mt-3 grid min-w-0 gap-2 min-[380px]:grid-cols-[minmax(0,1fr)_auto]">
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
                          <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] sm:gap-2">
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

            <div
              className={`relative min-h-0 flex-1 ${
                channelId === "trade-desk" ? "min-h-[28rem]" : ""
              }`}
            >
              <div
                className="world-message-stream h-full min-h-0 space-y-3 overflow-y-auto px-3 py-4 sm:px-5"
                onScroll={handleMessageListScroll}
                ref={messageListRef}
              >
              {loadingMessages ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => <div className="skeleton-line h-16" key={index} />)}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex min-h-80 items-center justify-center text-center">
                  <div>
                    <DyoorWorldGlyph className="mx-auto h-10 w-10 text-dyoor-purple" />
                    <p className="mt-4 text-sm font-black uppercase text-white/65">
                      {selectedChannel.id === "announcements"
                        ? "No announcements yet"
                        : selectedChannel.readOnly
                          ? "Waiting for verified activity"
                          : "No transmissions yet"}
                    </p>
                    <p className="mt-2 text-xs font-bold text-white/35">
                      {selectedChannel.id === "announcements"
                        ? "The D.Y.O.O.R owner wallet will post the next official dispatch."
                        : selectedChannel.readOnly
                          ? "The World relay will post the next confirmed event automatically."
                          : "Be the first holder to signal in this stream."}
                    </p>
                  </div>
                </div>
              ) : messages.map((message, messageIndex) => {
                const imageUrl = String(message.data?.imageUrl || "");
                const isSystem = (message.kind || "user") !== "user";
                const isOwn = !isSystem
                  && normalizeAddress(message.wallet) === normalizedSessionWallet;
                const attachment = normalizeDyoorWorldAttachment(message.attachment);
                return (
                  <article
                    className={`world-message-bubble group relative rounded-2xl border px-3 py-3 transition ${
                      isSystem
                        ? "world-message-system w-full border-dyoor-purple/25 bg-gradient-to-r from-dyoor-purple/[0.13] via-dyoor-purple/[0.06] to-transparent"
                        : isOwn
                          ? "world-message-own ml-auto w-fit max-w-[92%] border-dyoor-cyan/25 bg-gradient-to-br from-dyoor-cyan/[0.16] via-[#102c37]/90 to-dyoor-purple/[0.12] sm:max-w-[84%]"
                          : "world-message-peer mr-auto w-fit max-w-[92%] border-dyoor-purple/25 bg-gradient-to-br from-[#17162b]/95 via-[#101225]/95 to-dyoor-purple/[0.11] sm:max-w-[84%]"
                    } ${
                      highlightedMessageId === message.id
                        ? "ring-2 ring-dyoor-cyan/80 shadow-[0_0_38px_rgba(57,255,226,.25)]"
                        : ""
                    }`}
                    id={`world-message-${message.id}`}
                    key={message.id}
                    style={{ animationDelay: `${Math.min(messageIndex, 6) * 35}ms` }}
                  >
                    <div className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
                      <div className="world-message-avatar flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30">
                        {message.avatar?.imageUrl ? (
                          <img alt={`S2 #${message.avatar.tokenId}`} className="h-full w-full object-cover" src={mediaUrl(message.avatar.imageUrl)} />
                        ) : imageUrl ? (
                          <img alt="" className="h-full w-full object-cover" src={mediaUrl(imageUrl)} />
                        ) : (
                          <DyoorWorldGlyph className={`h-5 w-5 ${isSystem ? "text-dyoor-monad" : "text-white/30"}`} />
                        )}
                      </div>
                      <div className={`min-w-0 flex-1 ${isOwn ? "text-right" : ""}`}>
                        <div className={`flex flex-wrap items-baseline gap-2 ${isOwn ? "justify-end" : ""}`}>
                          {isSystem || isOwn ? (
                            <span className={`text-xs font-black ${isSystem ? "text-dyoor-monad" : "text-dyoor-cyan"}`}>
                              {message.author}
                            </span>
                          ) : (
                            <button
                              aria-label={`Tip ${message.author} in MON`}
                              className="text-xs font-black text-dyoor-cyan underline decoration-transparent underline-offset-4 transition hover:text-emerald-200 hover:decoration-emerald-200/70"
                              onClick={() => setTipTarget({
                                wallet: message.wallet,
                                author: message.author,
                              })}
                              title={`Tip ${message.author} in MON`}
                              type="button"
                            >
                              {message.author}
                            </button>
                          )}
                          <span className="text-[0.62rem] font-bold text-white/25">{messageTime(message.createdAt)}</span>
                          {isSystem ? <span className="text-[0.53rem] font-black uppercase tracking-[0.12em] text-white/28">verified {message.kind}</span> : null}
                          {!isSystem && selectedChannelCanPost ? (
                            <>
                              {!isOwn ? (
                                <button
                                  aria-label={`Direct message ${message.author}`}
                                  className="rounded border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[0.53rem] font-black uppercase tracking-[0.08em] text-white/35 opacity-75 transition hover:border-dyoor-monad/35 hover:bg-dyoor-monad/10 hover:text-dyoor-monad sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                                  onClick={() => {
                                    setDirectMessageTarget({
                                      wallet: message.wallet,
                                      author: message.author,
                                    });
                                    setDirectMessagesOpen(true);
                                  }}
                                  title={`Direct message ${message.author}`}
                                  type="button"
                                >
                                  ✉ DM
                                </button>
                              ) : null}
                              <button
                                aria-label={`Reply to ${message.author}`}
                                className="rounded border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[0.53rem] font-black uppercase tracking-[0.08em] text-white/35 opacity-75 transition hover:border-dyoor-cyan/35 hover:bg-dyoor-cyan/10 hover:text-dyoor-cyan sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                                onClick={() => beginWorldReply(message)}
                                title={`Reply to ${message.author}`}
                                type="button"
                              >
                                ↩ Reply
                              </button>
                            </>
                          ) : null}
                        </div>
                        {message.replyTo ? (
                          <button
                            className={`mt-2 block max-w-full rounded-lg border-l-2 border-dyoor-purple/55 bg-black/25 px-3 py-2 text-left transition hover:border-dyoor-cyan hover:bg-dyoor-cyan/[0.07] ${
                              isOwn ? "ml-auto" : ""
                            }`}
                            onClick={() => jumpToWorldMessage(message.replyTo!.messageId)}
                            title="Jump to original message"
                            type="button"
                          >
                            <span className="block truncate text-[0.58rem] font-black uppercase tracking-[0.08em] text-dyoor-monad">
                              ↪ {message.replyTo.author}
                            </span>
                            <span className="mt-0.5 block max-w-[24rem] truncate text-[0.68rem] font-bold text-white/42">
                              {message.replyTo.content
                                || `Shared a ${message.replyTo.attachmentKind || "message"}`}
                            </span>
                          </button>
                        ) : null}
                        {message.content ? (
                          <p className="world-message-copy mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-white/78">
                            <WorldMessageContent
                              content={message.content}
                              onChannelSelect={selectWorldChannel}
                            />
                          </p>
                        ) : null}
                        {attachment?.kind === "image" || attachment?.kind === "gif" ? (
                          <a
                            className={`relative mt-3 block w-fit max-w-full overflow-hidden rounded-xl border border-dyoor-purple/25 bg-black/35 shadow-[0_0_30px_rgba(128,92,255,.12)] transition hover:border-dyoor-cyan/45 ${isOwn ? "ml-auto" : ""}`}
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
                          <div className={`mt-3 ${isOwn ? "flex justify-end" : ""}`}>
                            <DyoorWorldStickerCard stickerId={attachment.stickerId} />
                          </div>
                        ) : null}
                        <div className={`mt-2 flex flex-wrap gap-2 ${isOwn ? "justify-end" : ""}`}>
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
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
                <div ref={messageEndRef} />
              </div>
              {!messageListAtBottom ? (
                <button
                  aria-label="Jump to the latest World message"
                  className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-dyoor-cyan/45 bg-[#091624]/95 px-4 py-2 text-[0.62rem] font-black uppercase tracking-[0.1em] text-dyoor-cyan shadow-[0_10px_35px_rgba(0,0,0,.55),0_0_24px_rgba(57,255,226,.14)] backdrop-blur transition hover:border-dyoor-cyan hover:bg-dyoor-cyan/15 hover:text-white"
                  onClick={() => scrollToLatestMessage()}
                  type="button"
                >
                  {newMessageCount > 0
                    ? `${newMessageCount} new message${newMessageCount === 1 ? "" : "s"} ↓`
                    : "Jump to latest ↓"}
                </button>
              ) : null}
            </div>

            {tipTarget ? (
              <div className="border-t border-emerald-300/20 bg-emerald-300/[0.05] p-3 sm:px-4">
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendTip();
                  }}
                >
                  <p className="mr-auto text-xs font-black text-emerald-200">
                    Direct tip to {tipTarget.author}
                  </p>
                  <input
                    aria-label={`MON tip amount for ${tipTarget.author}`}
                    className="field-control w-28 text-xs"
                    min="0"
                    onChange={(event) => setTipAmount(event.target.value)}
                    ref={tipAmountRef}
                    step="0.01"
                    type="number"
                    value={tipAmount}
                  />
                  <span className="text-xs font-black text-white/50">MON</span>
                  <button className="btn-primary px-3 text-xs" disabled={tipping} type="submit">{tipping ? "Confirming" : "Send direct"}</button>
                  <button className="btn-ghost px-3 text-xs" onClick={() => setTipTarget(null)} type="button">Cancel</button>
                </form>
                <p className="mt-2 text-[0.6rem] font-bold text-white/30">
                  Wallet-to-wallet on Monad. Tips of {rewards?.tips.minimumMon || "0.1"} MON or more can earn +{rewards?.tips.rewardEnergy || 10} Energy, capped daily. dYOOR World never takes custody.
                </p>
              </div>
            ) : null}

            {selectedChannelCanPost ? (
              <form className="border-t border-dyoor-purple/20 bg-black/20 p-3 sm:p-4" onSubmit={sendMessage}>
                {selectedChannel.id === "announcements" ? (
                  <div className="mb-2 rounded-lg border border-dyoor-monad/30 bg-gradient-to-r from-dyoor-monad/[0.13] to-dyoor-cyan/[0.06] px-3 py-2">
                    <p className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-dyoor-monad">
                      Owner dispatch
                    </p>
                    <p className="mt-1 text-xs font-bold leading-5 text-white/45">
                      Publish an official update or paste an HTTPS post link. Announcements do not earn chat Energy.
                    </p>
                  </div>
                ) : null}
                {replyingTo ? (
                  <div className="mb-2 flex min-w-0 items-center gap-3 rounded-lg border border-dyoor-purple/30 bg-gradient-to-r from-dyoor-purple/[0.12] to-dyoor-cyan/[0.05] px-3 py-2">
                    <span aria-hidden="true" className="text-lg text-dyoor-cyan">↩</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.58rem] font-black uppercase tracking-[0.1em] text-dyoor-monad">
                        Replying to {replyingTo.author}
                      </p>
                      <p className="mt-0.5 truncate text-xs font-bold text-white/42">
                        {worldReplyExcerpt(replyingTo)}
                      </p>
                    </div>
                    <button
                      aria-label="Cancel message reply"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 text-sm font-black text-white/40 transition hover:border-white/25 hover:text-white"
                      onClick={() => setReplyingTo(null)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                {channelTagSuggestions.length > 0 ? (
                  <div
                    aria-label="World thread suggestions"
                    className="mb-2 overflow-hidden rounded-lg border border-dyoor-cyan/25 bg-[#0a0b1d]/98 p-1 shadow-[0_16px_50px_rgba(0,0,0,.5),0_0_30px_rgba(57,255,226,.08)]"
                    id="world-channel-tag-suggestions"
                    role="listbox"
                  >
                    <p className="px-2 py-1 text-[0.5rem] font-black uppercase tracking-[0.14em] text-white/28">
                      Tag a World thread
                    </p>
                    {channelTagSuggestions.map((channel, index) => (
                      <button
                        aria-selected={index === tagSuggestionIndex}
                        className={`flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition ${
                          index === tagSuggestionIndex
                            ? "bg-dyoor-cyan/10 text-dyoor-cyan"
                            : "text-white/60 hover:bg-white/[0.04] hover:text-white"
                        }`}
                        id={`world-channel-tag-${channel.id}`}
                        key={channel.id}
                        onClick={() => insertWorldChannelTag(channel.id)}
                        onMouseDown={(event) => event.preventDefault()}
                        role="option"
                        type="button"
                      >
                        <span className="text-sm font-black">#{channel.label}</span>
                        <span className="truncate text-[0.6rem] font-bold text-white/28">
                          {channel.description}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-end gap-2 rounded border border-dyoor-purple/25 bg-black/35 p-2 focus-within:border-dyoor-cyan/55">
                  <textarea
                    aria-controls={channelTagSuggestions.length > 0
                      ? "world-channel-tag-suggestions"
                      : undefined}
                    aria-label={`Message ${selectedChannel.label}`}
                    className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm font-bold text-white outline-none placeholder:text-white/25"
                    maxLength={800}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setDraftCursor(event.currentTarget.selectionStart || 0);
                      setTagMenuDismissed(false);
                      setTagSuggestionIndex(0);
                    }}
                    onKeyDown={handleComposerKeyDown}
                    onKeyUp={(event) =>
                      setDraftCursor(event.currentTarget.selectionStart || 0)}
                    onSelect={(event) =>
                      setDraftCursor(event.currentTarget.selectionStart || 0)}
                    placeholder={selectedChannel.id === "announcements"
                      ? `Publish to #announcements as ${identity}`
                      : `Message #${selectedChannel.label} as ${identity}`}
                    ref={composerRef}
                    rows={2}
                    value={draft}
                  />
                  <button
                    className="btn-primary min-h-10 shrink-0 px-4 py-2 text-xs"
                    disabled={sending || (!draft.trim() && !composerAttachment)}
                    type="submit"
                  >
                    {sending
                      ? selectedChannel.id === "announcements"
                        ? "Publishing"
                        : "Sending"
                      : selectedChannel.id === "announcements"
                        ? "Publish"
                        : "Send"}
                  </button>
                </div>
                <DyoorWorldMediaComposer
                  attachment={composerAttachment}
                  disabled={sending}
                  onChange={setComposerAttachment}
                />
                <p className="mt-2 px-1 text-[0.62rem] font-bold text-white/25">
                  {selectedChannel.id === "announcements" ? (
                    <>
                      {draft.length}/800 · HTTPS links become clickable · <span className="hidden md:inline">Enter publishes · Shift+Enter newline</span>
                    </>
                  ) : (
                    <>
                      {draft.length}/800 · type # to tag a thread · tap ↩ to reply · <span className="hidden md:inline">Enter sends · Shift+Enter newline · </span>meaningful text can earn {rewards?.chat.rewardEnergy || 5} Energy · media and stickers alone do not earn
                    </>
                  )}
                </p>
              </form>
            ) : null}
          </section>

          <aside
            aria-label="World identity and Daily Energy"
            className={`fixed inset-y-0 right-0 z-[110] w-[min(92vw,24rem)] overflow-y-auto border-l border-dyoor-purple/35 bg-[#080918] p-4 shadow-[-24px_0_70px_rgba(0,0,0,.58)] transition-[transform,visibility] duration-300 ease-out ${
              mobileIdentityOpen
                ? "visible translate-x-0"
                : "invisible translate-x-full pointer-events-none"
            } lg:visible lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:overflow-visible lg:border-l lg:border-t-0 lg:border-dyoor-purple/20 lg:bg-black/20 lg:pointer-events-auto lg:shadow-none`}
            id="world-mobile-identity"
          >
            <div className="sticky -top-4 z-20 -mx-4 -mt-4 mb-4 flex items-center gap-2 border-b border-white/10 bg-[#080918]/95 px-4 py-4 backdrop-blur-xl lg:hidden">
              <div className="mr-auto">
                <p className="text-[0.55rem] font-black uppercase tracking-[0.18em] text-dyoor-monad">Holder console</p>
                <p className="mt-1 text-sm font-black uppercase text-white">Identity + Energy</p>
              </div>
              <button
                className="btn-ghost min-h-9 px-3 text-[0.6rem]"
                onClick={() => void exitWorld()}
                type="button"
              >
                Sign out
              </button>
              <button
                aria-label="Close identity and Energy"
                className="flex h-9 w-9 items-center justify-center rounded border border-white/10 text-lg font-black text-white/55"
                onClick={() => setMobileIdentityOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
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

            {config && !profile ? (
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
                    onChange={(event) => {
                      setLabel(event.target.value);
                      setNameAvailability(null);
                      setCheckingName(false);
                    }}
                    pattern="[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?"
                    placeholder="riffs"
                    value={label}
                  />
                  <span className="flex items-center border-l border-white/10 px-3 text-xs font-black text-dyoor-cyan">.dYOOR</span>
                </div>
                {label ? (
                  <p
                    aria-live="polite"
                    className={`mt-2 text-[0.6rem] font-bold leading-4 ${
                      currentNameAvailability?.available
                        ? "text-emerald-200"
                        : "text-yellow-100/65"
                    }`}
                  >
                    {checkingName
                      ? `Checking ${nameValidation.label || "name"}.dYOOR on Monad…`
                      : !nameValidation.ok
                        ? nameValidation.error
                        : currentNameAvailability?.reason
                          || "Waiting for the registry availability check…"}
                  </p>
                ) : (
                  <p className="mt-2 text-[0.58rem] font-bold text-white/28">
                    Availability and wallet eligibility are verified before MetaMask opens.
                  </p>
                )}
                <button
                  className="btn-secondary mt-3 w-full text-xs"
                  disabled={
                    claiming
                    || checkingName
                    || !nameValidation.ok
                    || currentNameAvailability?.available !== true
                    || (config.registryMode === "monad" && !config.claimsOpen)
                  }
                  type="submit"
                >
                  {claiming
                    ? "Claiming"
                    : checkingName
                      ? "Checking name"
                      : config.registryMode === "monad"
                        ? config.claimsOpen ? "Claim on Monad" : "Claims closed"
                        : "Reserve preview name"}
                </button>
              </form>
            ) : null}

            <DyoorWorldNotifications />

            <div className="relative mt-4 overflow-hidden rounded-xl border border-dyoor-monad/35 bg-[radial-gradient(circle_at_15%_15%,rgba(57,255,226,.12),transparent_34%),radial-gradient(circle_at_90%_5%,rgba(255,79,227,.16),transparent_38%),linear-gradient(145deg,#171035,#08091c_58%,#062526)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_20px_55px_rgba(0,0,0,.35),0_0_36px_rgba(131,110,249,.12)]">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-dyoor-monad">Daily Energy wheel</p>
                  <p className="mt-1 text-xs font-black text-white">One verified spin every UTC day</p>
                </div>
                <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[0.46rem] font-black uppercase tracking-[0.12em] text-emerald-200">
                  10–1,000
                </span>
              </div>
              <div className="relative mt-4 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-4">
                <DyoorEnergyWheel
                  prize={rewards?.daily?.amountEnergy}
                  spinning={wheelSpinning}
                />
                <div className="min-w-0">
                  <p className="text-3xl font-black leading-none text-white">{rewards?.pendingEnergy || 0}</p>
                  <p className="mt-1 text-[0.52rem] font-black uppercase tracking-[0.15em] text-white/40">Pending Energy</p>
                  <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
                    <p className="text-[0.52rem] font-black uppercase tracking-[0.12em] text-yellow-100/85">
                      1% jackpot
                    </p>
                    <p className="mt-1 text-[0.58rem] font-bold leading-4 text-white/42">
                      Rare 1,000 Energy signal. Every spin awards at least 10.
                    </p>
                  </div>
                </div>
              </div>
              <div className="relative mt-3 flex flex-wrap gap-1">
                {WORLD_WHEEL_PRIZES.map((amount) => (
                  <span
                    className={`rounded border px-1.5 py-1 text-[0.46rem] font-black ${
                      amount === 1_000
                        ? "border-yellow-200/35 bg-yellow-200/10 text-yellow-100"
                        : "border-white/10 bg-black/20 text-white/38"
                    }`}
                    key={amount}
                  >
                    {amount.toLocaleString()}
                  </span>
                ))}
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
              <div className="relative mt-3 rounded border border-dyoor-cyan/15 bg-dyoor-cyan/[0.04] p-2.5">
                <div className="flex items-center justify-between gap-3 text-[0.52rem] font-black uppercase tracking-[0.11em]">
                  <span className="text-dyoor-cyan">Message rewards</span>
                  <span className="text-white/55">
                    {chatEnergyEarnedToday}/{chatEnergyDailyCap} Energy
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-dyoor-cyan via-dyoor-monad to-fuchsia-400 shadow-[0_0_12px_rgba(57,255,226,.45)] transition-[width] duration-500"
                    style={{ width: `${chatEnergyProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-[0.54rem] font-bold text-white/32">
                  +{rewards?.chat.rewardEnergy || 5} per qualifying message · 200 Energy daily cap · 10m cooldown
                </p>
              </div>
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
