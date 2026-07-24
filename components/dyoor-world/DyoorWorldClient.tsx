"use client";

import { encodeFunctionData } from "viem";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DYOOR_WORLD_CHANNELS,
  type DyoorWorldChannelId,
  type DyoorWorldMessageView,
  type DyoorWorldProfile,
  normalizeWorldLabel,
  shortWorldWallet,
} from "@/lib/dyoor-world";
import { DyoorWorldGlyph } from "@/components/dyoor-world/DyoorWorldDiscovery";
import { useWalletService } from "@/providers/WalletServiceProvider";

type WorldConfig = {
  chainId: number;
  s2ContractAddress: string;
  registryAddress: string;
  registryMode: "monad" | "preview-reservation";
};

type ProfileResponse = {
  ok?: boolean;
  profile?: DyoorWorldProfile | null;
  config?: WorldConfig;
  error?: string;
};

const WORLD_NAMES_ABI = [{
  type: "function",
  name: "claim",
  stateMutability: "nonpayable",
  inputs: [{ name: "label", type: "string" }],
  outputs: [{ name: "tokenId", type: "uint256" }],
}] as const;

function normalizeAddress(value?: string) {
  const wallet = String(value || "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
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

export function DyoorWorldClient({ sessionWallet }: { sessionWallet: string }) {
  const router = useRouter();
  const wallet = useWalletService();
  const connectedWallet = normalizeAddress(wallet.address);
  const normalizedSessionWallet = normalizeAddress(sessionWallet);
  const [channelId, setChannelId] = useState<DyoorWorldChannelId>("world-lobby");
  const [profile, setProfile] = useState<DyoorWorldProfile | null>(null);
  const [config, setConfig] = useState<WorldConfig | null>(null);
  const [messages, setMessages] = useState<DyoorWorldMessageView[]>([]);
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const messageEndRef = useRef<HTMLDivElement>(null);
  const selectedChannel = useMemo(
    () => DYOOR_WORLD_CHANNELS.find((channel) => channel.id === channelId) || DYOOR_WORLD_CHANNELS[0],
    [channelId],
  );

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/dyoor-world/profile", { cache: "no-store" });
    const data = await readResponse<ProfileResponse>(response);
    setProfile(data.profile || null);
    setConfig(data.config || null);
    return data;
  }, []);

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
      void loadProfile().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not load the World identity.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

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

  async function claimName(event: FormEvent) {
    event.preventDefault();
    const normalizedLabel = normalizeWorldLabel(label);
    if (!normalizedLabel || !config) return;
    setClaiming(true);
    setError("");
    setNotice("");
    try {
      if (config.registryMode === "monad" && config.registryAddress) {
        if (!connectedWallet) throw new Error("Connect the holder wallet before claiming on Monad.");
        if (connectedWallet !== normalizedSessionWallet) {
          throw new Error("The connected wallet must match the authenticated holder session.");
        }
        if (wallet.status === "wrong-network") {
          await wallet.switchChain();
        }
        const data = encodeFunctionData({
          abi: WORLD_NAMES_ABI,
          functionName: "claim",
          args: [normalizedLabel],
        });
        const txHash = await wallet.sendTransaction({
          from: connectedWallet,
          to: config.registryAddress,
          data,
        });
        setNotice(`Monad claim submitted: ${txHash.slice(0, 10)}…`);
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
          const result = await loadProfile();
          if (result.profile?.registryStatus === "monad-active") break;
        }
      } else {
        const response = await fetch("/api/dyoor-world/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: normalizedLabel }),
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

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/dyoor-world/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, content }),
      });
      const data = await readResponse<{ message?: DyoorWorldMessageView }>(response);
      if (data.message) setMessages((current) => [...current, data.message!]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the World message.");
    } finally {
      setSending(false);
    }
  }

  async function exitWorld() {
    await fetch("/api/dyoor-world/session", { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  }

  const identity = profile?.displayName || shortWorldWallet(normalizedSessionWallet);
  const walletMismatch = Boolean(
    connectedWallet && connectedWallet !== normalizedSessionWallet,
  );

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6">
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
            Connected wallet does not match this holder session. Exit and authenticate the connected wallet before making an on-chain name claim.
          </div>
        ) : null}
        {error ? (
          <div className="border-b border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-bold text-red-100">{error}</div>
        ) : null}
        {notice ? (
          <div className="border-b border-dyoor-cyan/25 bg-dyoor-cyan/[0.07] px-4 py-3 text-sm font-bold text-dyoor-cyan">{notice}</div>
        ) : null}

        <div className="grid min-h-[680px] lg:grid-cols-[250px_minmax(0,1fr)_300px]">
          <aside className="border-b border-dyoor-purple/20 bg-black/20 p-3 lg:border-b-0 lg:border-r">
            <p className="px-2 py-2 text-[0.62rem] font-black uppercase tracking-[0.2em] text-white/35">World streams</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1">
              {DYOOR_WORLD_CHANNELS.map((channel) => {
                const active = channel.id === channelId;
                return (
                  <button
                    className={`min-w-0 rounded border px-3 py-3 text-left transition ${
                      active
                        ? "border-dyoor-cyan/55 bg-dyoor-cyan/10 text-dyoor-cyan"
                        : "border-white/[0.07] bg-white/[0.025] text-white/62 hover:border-dyoor-purple/45 hover:text-white"
                    }`}
                    key={channel.id}
                    onClick={() => setChannelId(channel.id)}
                    type="button"
                  >
                    <span className="block truncate text-xs font-black"># {channel.label}</span>
                    <span className="mt-1 hidden text-[0.64rem] font-bold leading-4 text-white/35 lg:block">{channel.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 hidden rounded border border-dyoor-purple/20 bg-dyoor-purple/[0.07] p-4 lg:block">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.17em] text-dyoor-monad">Adapted from M3SH</p>
              <p className="mt-2 text-xs font-bold leading-5 text-white/42">
                The node-and-stream model, rebuilt with server-verified holder access and immutable message writes.
              </p>
            </div>
          </aside>

          <section className="flex min-h-[560px] min-w-0 flex-col">
            <div className="border-b border-dyoor-purple/20 px-4 py-4 sm:px-5">
              <p className="text-sm font-black text-white"># {selectedChannel.label}</p>
              <p className="mt-1 text-xs font-bold text-white/38">{selectedChannel.description}</p>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-5">
              {loadingMessages ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => <div className="skeleton-line h-16" key={index} />)}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex min-h-80 items-center justify-center text-center">
                  <div>
                    <DyoorWorldGlyph className="mx-auto h-10 w-10 text-dyoor-purple" />
                    <p className="mt-4 text-sm font-black uppercase text-white/65">No transmissions yet</p>
                    <p className="mt-2 text-xs font-bold text-white/35">Be the first holder to signal in this stream.</p>
                  </div>
                </div>
              ) : messages.map((message) => (
                <article className="group rounded px-2 py-3 transition hover:bg-white/[0.025]" key={message.id}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-black text-dyoor-cyan">{message.author}</span>
                    <span className="text-[0.62rem] font-bold text-white/25">{messageTime(message.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-white/72">{message.content}</p>
                </article>
              ))}
              <div ref={messageEndRef} />
            </div>
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
                <button className="btn-primary min-h-10 shrink-0 px-4 py-2 text-xs" disabled={sending || !draft.trim()} type="submit">
                  {sending ? "Sending" : "Send"}
                </button>
              </div>
              <p className="mt-2 px-1 text-[0.62rem] font-bold text-white/25">{draft.length}/800 · holder session verified server-side</p>
            </form>
          </section>

          <aside className="border-t border-dyoor-purple/20 bg-black/20 p-4 lg:border-l lg:border-t-0">
            <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-white/35">World identity</p>
            {profile ? (
              <div className="mt-3 rounded border border-dyoor-cyan/30 bg-dyoor-cyan/[0.07] p-4">
                <p className="break-words text-xl font-black text-dyoor-cyan">{profile.displayName}</p>
                <p className="mt-2 break-all text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white/35">{shortWorldWallet(profile.wallet)}</p>
                <span className="mt-4 inline-flex rounded-full border border-white/10 px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.12em] text-white/52">
                  {profile.registryStatus === "monad-active" ? "Monad on-chain name" : "Preview reservation"}
                </span>
              </div>
            ) : (
              <form className="mt-3 rounded border border-dyoor-purple/25 bg-dyoor-purple/[0.06] p-4" onSubmit={claimName}>
                <p className="text-sm font-black text-white">Create your .dYOOR name</p>
                <p className="mt-2 text-xs font-bold leading-5 text-white/42">
                  {config?.registryMode === "monad"
                    ? "Claim a soulbound holder identity directly on Monad."
                    : "Reserve the name in this preview. On-chain activation follows registry deployment."}
                </p>
                <label className="mt-4 block text-[0.62rem] font-black uppercase tracking-[0.15em] text-white/40" htmlFor="world-label">
                  Name
                </label>
                <div className="mt-2 flex rounded border border-white/10 bg-black/35 focus-within:border-dyoor-cyan/55">
                  <input
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-black text-white outline-none placeholder:text-white/20"
                    id="world-label"
                    maxLength={24}
                    minLength={3}
                    onChange={(event) => setLabel(event.target.value)}
                    pattern="[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?"
                    placeholder="riffs"
                    value={label}
                  />
                  <span className="flex items-center border-l border-white/10 px-3 text-xs font-black text-dyoor-cyan">.dYOOR</span>
                </div>
                <button className="btn-secondary mt-3 w-full text-xs" disabled={claiming || normalizeWorldLabel(label).length < 3} type="submit">
                  {claiming
                    ? "Claiming"
                    : config?.registryMode === "monad"
                      ? "Claim on Monad"
                      : "Reserve preview name"}
                </button>
              </form>
            )}
            <div className="mt-4 rounded border border-white/[0.07] bg-white/[0.025] p-4">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-dyoor-monad">Name system</p>
              <p className="mt-2 text-xs font-bold leading-5 text-white/40">
                `.dYOOR` is a Monad-native World identity. It is not public DNS or Ethereum ENS. The registry exposes forward and reverse resolution for DYOOR integrations.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
