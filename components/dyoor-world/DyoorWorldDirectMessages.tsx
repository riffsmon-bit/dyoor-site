"use client";

/* eslint-disable @next/next/no-img-element */

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { DyoorWorldGlyph } from "@/components/dyoor-world/DyoorWorldDiscovery";
import {
  DyoorWorldMediaComposer,
  DyoorWorldStickerCard,
} from "@/components/dyoor-world/DyoorWorldMediaComposer";
import type {
  DyoorWorldDirectConversationView,
  DyoorWorldDirectMessageView,
} from "@/lib/dyoor-world-direct";
import {
  normalizeDyoorWorldAttachment,
  type DyoorWorldMessageAttachment,
} from "@/lib/dyoor-world-media";
import { shortWorldWallet } from "@/lib/dyoor-world";

type DirectTarget = {
  wallet: string;
  author: string;
} | null;

type InboxResponse = {
  conversations?: DyoorWorldDirectConversationView[];
  unreadCount?: number;
  error?: string;
};

type ConversationResponse = {
  messages?: DyoorWorldDirectMessageView[];
  other?: {
    wallet: string;
    author: string;
    avatar?: DyoorWorldDirectConversationView["avatar"];
  };
  error?: string;
};

async function readResponse<T extends { error?: string }>(response: Response) {
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function directMessageTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function directMessagePreview(message: DyoorWorldDirectMessageView) {
  if (message.content) return message.content;
  const attachment = normalizeDyoorWorldAttachment(message.attachment);
  if (attachment?.kind === "sticker") return "World sticker";
  if (attachment?.kind === "gif") return "GIF";
  return "Image";
}

export function DyoorWorldDirectMessages({
  initialTarget,
  onClose,
  onUnreadChange,
  open,
  sessionWallet,
}: {
  initialTarget: DirectTarget;
  onClose(): void;
  onUnreadChange(count: number): void;
  open: boolean;
  sessionWallet: string;
}) {
  const [conversations, setConversations] = useState<DyoorWorldDirectConversationView[]>([]);
  const [activeWallet, setActiveWallet] = useState("");
  const [activeAuthor, setActiveAuthor] = useState("");
  const [activeAvatar, setActiveAvatar] = useState<DyoorWorldDirectConversationView["avatar"]>(null);
  const [messages, setMessages] = useState<DyoorWorldDirectMessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<DyoorWorldMessageAttachment | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const loadInbox = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/dyoor-world/direct-messages", {
        cache: "no-store",
      });
      const data = await readResponse<InboxResponse>(response);
      const next = Array.isArray(data.conversations) ? data.conversations : [];
      setConversations(next);
      onUnreadChange(Math.max(0, Number(data.unreadCount || 0)));
      if (!silent) setError("");
      return next;
    } catch (caught) {
      if (!silent) {
        setError(caught instanceof Error ? caught.message : "Could not load direct messages.");
      }
      return [];
    }
  }, [onUnreadChange]);

  const loadConversation = useCallback(async (
    otherWallet: string,
    silent = false,
  ) => {
    if (!otherWallet) return;
    if (!silent) setLoadingConversation(true);
    try {
      const response = await fetch(
        `/api/dyoor-world/direct-messages?with=${encodeURIComponent(otherWallet)}`,
        { cache: "no-store" },
      );
      const data = await readResponse<ConversationResponse>(response);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setActiveAuthor(data.other?.author || shortWorldWallet(otherWallet));
      setActiveAvatar(data.other?.avatar || null);
      setError("");
      void loadInbox(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this conversation.");
    } finally {
      if (!silent) setLoadingConversation(false);
    }
  }, [loadInbox]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadInbox(true), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadInbox(true);
    }, 12_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadInbox]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setActiveWallet(initialTarget?.wallet || "");
      setActiveAuthor(initialTarget?.author || "");
      if (!initialTarget?.wallet) {
        setActiveAvatar(null);
        setMessages([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialTarget, open]);

  useEffect(() => {
    if (!open || !activeWallet) return;
    const initial = window.setTimeout(
      () => void loadConversation(activeWallet),
      0,
    );
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadConversation(activeWallet, true);
      }
    }, 4_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [activeWallet, loadConversation, open]);

  const latestMessageId = messages.at(-1)?.id || "";

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageId, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  function selectConversation(conversation: DyoorWorldDirectConversationView) {
    setActiveWallet(conversation.wallet);
    setActiveAuthor(conversation.author);
    setActiveAvatar(conversation.avatar);
    setMessages([]);
    setError("");
  }

  async function sendDirectMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!activeWallet || sending || (!draft.trim() && !attachment)) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/dyoor-world/direct-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: activeWallet,
          content: draft,
          attachment,
        }),
      });
      const data = await readResponse<{
        message?: DyoorWorldDirectMessageView;
        error?: string;
      }>(response);
      if (data.message) {
        setMessages((current) => [
          ...current.filter((message) => message.id !== data.message?.id),
          data.message!,
        ]);
      }
      setDraft("");
      setAttachment(null);
      void loadInbox(true);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the direct message.");
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter"
        || event.shiftKey
        || event.nativeEvent.isComposing
        || !window.matchMedia("(min-width: 768px)").matches
    ) {
      return;
    }
    event.preventDefault();
    void sendDirectMessage();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160] bg-[#04040d]/92 p-0 backdrop-blur-xl sm:p-5">
      <section
        aria-label="dYOOR World direct messages"
        aria-modal="true"
        className="mx-auto flex h-[100dvh] max-w-6xl flex-col overflow-hidden border-dyoor-purple/35 bg-[#080918] shadow-[0_30px_100px_rgba(0,0,0,.7)] sm:h-[calc(100dvh-2.5rem)] sm:rounded-xl sm:border"
        role="dialog"
      >
        <header className="flex min-h-16 items-center gap-3 border-b border-dyoor-purple/25 bg-black/25 px-4 py-3 sm:px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-dyoor-cyan/35 bg-dyoor-cyan/10 text-lg text-dyoor-cyan">
            ✉
          </div>
          <div className="min-w-0">
            <p className="text-[0.55rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan">
              Holder-to-holder relay
            </p>
            <h2 className="truncate text-base font-black uppercase text-white">
              Direct messages
            </h2>
          </div>
          <span className="ml-auto hidden rounded-full border border-yellow-200/20 bg-yellow-200/[0.06] px-3 py-1.5 text-[0.52rem] font-black uppercase tracking-[0.1em] text-yellow-100/65 sm:inline-flex">
            Participant-private · not end-to-end encrypted
          </span>
          <button
            aria-label="Close direct messages"
            className="flex h-10 w-10 items-center justify-center rounded border border-white/10 text-xl font-black text-white/55 transition hover:border-white/30 hover:text-white"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            className={`${activeWallet ? "hidden sm:block" : "block"} min-h-0 overflow-y-auto border-r border-dyoor-purple/20 bg-black/20 p-3`}
          >
            <div className="mb-3 rounded border border-yellow-200/15 bg-yellow-200/[0.04] p-3 sm:hidden">
              <p className="text-[0.58rem] font-bold leading-4 text-yellow-100/55">
                Messages are visible only to both holder accounts, but are not end-to-end encrypted.
              </p>
            </div>
            <p className="px-2 py-2 text-[0.58rem] font-black uppercase tracking-[0.17em] text-white/35">
              Conversations
            </p>
            {conversations.length === 0 ? (
              <div className="rounded border border-dashed border-white/10 p-5 text-center">
                <DyoorWorldGlyph className="mx-auto h-8 w-8 text-dyoor-purple/55" />
                <p className="mt-3 text-xs font-black text-white/45">No direct signals yet</p>
                <p className="mt-2 text-[0.62rem] font-bold leading-4 text-white/28">
                  Tap DM beside a holder’s message to start one.
                </p>
              </div>
            ) : conversations.map((conversation) => (
              <button
                className={`mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                  activeWallet === conversation.wallet
                    ? "border-dyoor-cyan/40 bg-dyoor-cyan/10"
                    : "border-white/[0.07] bg-white/[0.025] hover:border-dyoor-purple/35 hover:bg-dyoor-purple/[0.07]"
                }`}
                key={conversation.conversationId}
                onClick={() => selectConversation(conversation)}
                type="button"
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/35">
                  {conversation.avatar?.imageUrl ? (
                    <img
                      alt=""
                      className="h-full w-full object-cover"
                      src={conversation.avatar.imageUrl}
                    />
                  ) : (
                    <DyoorWorldGlyph className="m-3 h-5 w-5 text-white/25" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-black text-dyoor-cyan">
                      {conversation.author}
                    </p>
                    {conversation.unreadCount > 0 ? (
                      <span className="rounded-full bg-fuchsia-400 px-1.5 py-0.5 text-[0.48rem] font-black text-black">
                        {Math.min(99, conversation.unreadCount)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[0.62rem] font-bold text-white/32">
                    {conversation.lastSender === sessionWallet.toLowerCase() ? "You: " : ""}
                    {conversation.lastMessage}
                  </p>
                </div>
              </button>
            ))}
          </aside>

          <div className={`${activeWallet ? "flex" : "hidden sm:flex"} min-h-0 flex-col`}>
            {activeWallet ? (
              <>
                <div className="flex items-center gap-3 border-b border-dyoor-purple/20 bg-black/15 px-4 py-3">
                  <button
                    aria-label="Back to direct message inbox"
                    className="flex h-9 w-9 items-center justify-center rounded border border-white/10 text-white/55 sm:hidden"
                    onClick={() => setActiveWallet("")}
                    type="button"
                  >
                    ←
                  </button>
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-dyoor-cyan/20 bg-black/35">
                    {activeAvatar?.imageUrl ? (
                      <img alt="" className="h-full w-full object-cover" src={activeAvatar.imageUrl} />
                    ) : (
                      <DyoorWorldGlyph className="m-3 h-4 w-4 text-white/25" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-dyoor-cyan">{activeAuthor}</p>
                    <p className="truncate text-[0.55rem] font-bold uppercase tracking-[0.08em] text-white/28">
                      {shortWorldWallet(activeWallet)}
                    </p>
                  </div>
                </div>

                <div className="world-message-stream min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5">
                  {loadingConversation ? (
                    [0, 1, 2].map((index) => (
                      <div className="skeleton-line h-16" key={index} />
                    ))
                  ) : messages.length === 0 ? (
                    <div className="grid min-h-full place-items-center text-center">
                      <div>
                        <p className="text-3xl">✦</p>
                        <p className="mt-3 text-sm font-black uppercase text-white/55">
                          Start a private signal
                        </p>
                        <p className="mt-2 text-xs font-bold text-white/28">
                          Only these two authenticated holder accounts can load this thread.
                        </p>
                      </div>
                    </div>
                  ) : messages.map((message) => {
                    const own = message.from === sessionWallet.toLowerCase();
                    const messageAttachment = normalizeDyoorWorldAttachment(message.attachment);
                    return (
                      <article
                        className={`w-fit max-w-[88%] rounded-2xl border px-3 py-3 ${
                          own
                            ? "ml-auto border-dyoor-cyan/25 bg-gradient-to-br from-dyoor-cyan/[0.16] to-dyoor-purple/[0.12]"
                            : "mr-auto border-dyoor-purple/25 bg-gradient-to-br from-[#17162b] to-dyoor-purple/[0.11]"
                        }`}
                        key={message.id}
                      >
                        <div className={`flex items-center gap-2 ${own ? "justify-end" : ""}`}>
                          <span className={`text-[0.62rem] font-black ${own ? "text-dyoor-cyan" : "text-dyoor-monad"}`}>
                            {own ? "You" : message.author}
                          </span>
                          <span className="text-[0.55rem] font-bold text-white/22">
                            {directMessageTime(message.createdAt)}
                          </span>
                        </div>
                        {message.content ? (
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-white/78">
                            {message.content}
                          </p>
                        ) : null}
                        {messageAttachment?.kind === "image" || messageAttachment?.kind === "gif" ? (
                          <a
                            className="mt-3 block overflow-hidden rounded-xl border border-white/10 bg-black/30"
                            href={messageAttachment.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <img
                              alt={messageAttachment.alt || directMessagePreview(message)}
                              className="max-h-80 max-w-full object-contain"
                              src={messageAttachment.url}
                            />
                          </a>
                        ) : messageAttachment?.kind === "sticker" ? (
                          <div className={`mt-3 ${own ? "flex justify-end" : ""}`}>
                            <DyoorWorldStickerCard stickerId={messageAttachment.stickerId} />
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  <div ref={endRef} />
                </div>

                <form
                  className="border-t border-dyoor-purple/20 bg-black/20 p-3 sm:p-4"
                  onSubmit={sendDirectMessage}
                >
                  {error ? (
                    <p className="mb-2 rounded border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex items-end gap-2 rounded-xl border border-dyoor-purple/25 bg-black/35 p-2 focus-within:border-dyoor-cyan/50">
                    <textarea
                      aria-label={`Direct message ${activeAuthor}`}
                      className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm font-bold text-white outline-none placeholder:text-white/25"
                      maxLength={800}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      placeholder={`Message ${activeAuthor}`}
                      ref={composerRef}
                      rows={2}
                      value={draft}
                    />
                    <button
                      className="btn-primary min-h-10 shrink-0 px-4 py-2 text-xs"
                      disabled={sending || (!draft.trim() && !attachment)}
                      type="submit"
                    >
                      {sending ? "Sending" : "Send"}
                    </button>
                  </div>
                  <DyoorWorldMediaComposer
                    attachment={attachment}
                    disabled={sending}
                    onChange={setAttachment}
                  />
                  <p className="mt-2 px-1 text-[0.55rem] font-bold text-white/24">
                    {draft.length}/800 · Enter sends on desktop · private to participants, not end-to-end encrypted
                  </p>
                </form>
              </>
            ) : (
              <div className="grid min-h-full flex-1 place-items-center text-center">
                <div>
                  <p className="text-4xl text-dyoor-purple">✉</p>
                  <p className="mt-4 text-sm font-black uppercase text-white/55">
                    Select a holder conversation
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
