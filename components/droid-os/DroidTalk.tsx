import { useEffect, useRef, useState, type FormEvent } from "react";
import { droidDisplayName, previewReply, type PreviewDroid } from "@/lib/droid-os/preview";
import { OsIcon } from "./OsIcon";

type Message = { id: number; role: "user" | "droid"; text: string };
const prompts = ["What’s happening on Monad?", "Walk me through my portfolio", "Explain my operating rules"];

export function DroidTalk({ droid }: { droid: PreviewDroid }) {
  const displayName = droidDisplayName(droid);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const container = scroll.current;
    if (container && (messages.length || thinking)) container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
  }, [messages, thinking]);

  function send(value: string) {
    const text = value.trim().slice(0, 800);
    if (!text || thinking) return;
    setMessages((previous) => [...previous, { id: previous.length, role: "user", text }]);
    setDraft("");
    setThinking(true);
    timer.current = setTimeout(() => {
      setMessages((previous) => [...previous, { id: previous.length, role: "droid", text: previewReply(text, droid) }]);
      setThinking(false);
    }, 650);
  }
  function submit(event: FormEvent) { event.preventDefault(); send(draft); }

  return <div className="os-talk">
    <div className="os-intelligence-bar"><span><span className="os-signal-dot" /> dYØØR INTELLIGENCE</span><span>AUTO <span className="os-muted">/ PREVIEW</span></span></div>
    <div className="os-talk-scroll" ref={scroll}>
      <div className="os-droid-greeting"><div className="os-bot-mark"><OsIcon name="Opportunities" /></div><span className="os-eyebrow">{displayName}</span><h3>What’s our<br />next move<span>?</span></h3><p>Your research partner. Your eyes on Monad.<br />You set the direction. I help make sense of it.</p></div>
      <div className="os-brief-preview"><div><span className="os-eyebrow">YOUR FIRST DIRECTIVE</span><span className="os-tiny-tag">READ ONLY</span></div><p>Let’s find your signal.</p><span>Explore an idea, look into a project, or get a clearer picture of your portfolio.</span><button type="button" onClick={() => send(prompts[0])} disabled={thinking}>Start with a briefing <OsIcon name="arrow" /></button></div>
      <div className="os-chat-log" role="log" aria-label={`Conversation preview with ${displayName}`} aria-live="polite">
        {messages.map((message) => <div className={`os-message os-message-${message.role}`} key={message.id}><span className="os-eyebrow">{message.role === "user" ? "YOU" : `${displayName} · SCRIPTED PREVIEW`}</span><p>{message.text}</p></div>)}
        {thinking ? <p className="os-thinking" role="status"><span /> Preparing a preview response…</p> : null}
      </div>
      <div ref={end} />
    </div>
    <div className="os-talk-bottom"><div className="os-prompt-list">{prompts.slice(1).map((prompt) => <button key={prompt} disabled={thinking} type="button" onClick={() => send(prompt)}>{prompt}<span>↗</span></button>)}</div>
      <form className="os-chat-composer" onSubmit={submit}><label className="os-sr-only" htmlFor="os-chat-input">Talk to {displayName}</label><textarea id="os-chat-input" placeholder={`Talk to ${displayName}…`} rows={2} maxLength={800} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { event.preventDefault(); send(draft); } }} /><div><span><OsIcon name="shield" /> ASK · NO EXECUTION</span><button type="submit" aria-label="Send preview message" disabled={!draft.trim() || thinking}><OsIcon name="arrow" /></button></div></form>
      <p className="os-talk-disclaimer">Scripted demo. Messages stay in this view; no AI provider is called.</p>
    </div>
  </div>;
}
