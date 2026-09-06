"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { INTERESTS, emptyState, type State, type Training } from "@/lib/droid-os/ask/schema";
import type { AskClient } from "@/hooks/useDroidAskClient";
import type { OsView, PreviewDroid } from "@/lib/droid-os/preview";
import { DroidPanels } from "./DroidPanels";
import { OsIcon } from "./OsIcon";

export function DroidAskWorkspace({ droid, view, client }: { droid: PreviewDroid; view: OsView; client: AskClient }) {
  const [saved, setSaved] = useState<State | null>(null);
  const [training, setTraining] = useState<Training>(emptyState().training);
  const [aiReady, setAiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [showTraining, setShowTraining] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "auto" }); }, [saved?.messages.length]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/droid-os/ask", { cache: "no-store", signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(r => { if (!controller.signal.aborted) setAiReady(r.aiReady === true); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  async function run(kind: "load" | "save" | "chat") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("Checking current Droid ownership and preparing a signature request…");
    try {
      const input = { kind, tokenId: droid.id, ...(kind !== "load" ? { revision: saved?.revision ?? 0 } : {}), ...(kind === "save" ? { training: { ...training, missions: training.missions.map(m => m.trim()).filter(Boolean) } } : {}), ...(kind === "chat" ? { message: draft } : {}) };
      const result = await client(input, stage => {
        if (!active.current) return;
        setNotice(stage === "checking-owner" ? "Checking current Droid ownership and preparing a signature request…" : stage === "awaiting-signature" ? "Open your connected wallet for a gas-free, one-request signature." : "Verifying your signature and current ownership. Please wait…");
      });
      if (!active.current) return;
      setSaved(result.state); setTraining(result.state.training); setAiReady(result.aiReady);
      setNotice(kind === "save" ? "Training saved to this Droid’s owner-scoped profile. No wallet permissions changed." : kind === "load" ? "Saved training loaded. ASK only; no financial permissions." : "Reply saved. No financial action occurred.");
      if (kind === "chat") setDraft("");
    } catch (e) { if (active.current) { setError(e instanceof Error ? e.message : "Request failed."); setNotice(""); } }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  const dirty = !!saved && JSON.stringify(training) !== JSON.stringify(saved.training);
  const editor = showTraining || view === "Strategy" || view === "Settings" || view === "Missions";
  function submit(event: FormEvent) { event.preventDefault(); if (saved && aiReady && !dirty) void run("chat"); }
  if (!["Talk", "Strategy", "Settings", "Missions"].includes(view)) return <DroidPanels view={view} droid={droid} />;
  return <div className="os-ask">
    <div className="os-intelligence-bar"><span><span className="os-signal-dot" /> dYØØR INTELLIGENCE</span><span>ASK / {aiReady ? "CONNECTED" : "SETUP REQUIRED"}</span></div>
    <div className="os-ask-controls"><div><strong>D.Y.O.O.R #{droid.id}</strong><span>{saved ? `Saved profile · revision ${saved.revision}` : "Owner verification required"}</span></div><button className="os-button-secondary" type="button" disabled={busy} onClick={() => void run("load")}>{busy ? "Working…" : saved ? "Reload saved" : "Load my training"}</button>{view === "Talk" ? <button className="os-button-secondary" type="button" onClick={() => setShowTraining(v => !v)}>{editor ? "Back to talk" : "Train Droid"}</button> : null}</div>
    <p className="os-ask-caption">Gas-free signature per load, save or message. No trading authority. Private training is scoped to your wallet and this Droid. Never enter keys or secrets.</p>
    {!aiReady ? <p className="os-inline-note">AI provider setup is required before real replies. You can still load and save training. No simulated replies are used here.</p> : <p className="os-ask-caption">Messages and saved training are sent to the configured AI provider. Shared preview limits apply; older context may be omitted. No live market feeds or transaction tools are connected.</p>}
    {error ? <p className="os-ask-error" role="alert">{error}</p> : null}{notice ? <p className="os-ask-notice" role="status">{notice}</p> : null}
    {editor ? <form className="os-training-form" onSubmit={e => { e.preventDefault(); if (saved) void run("save"); }}>
      <h3>Shape your Droid.</h3><p>These are soft preferences and research objectives—not model fine-tuning, a spending policy, or autonomous skills.</p>
      <fieldset disabled={!saved || busy}><legend>Research interests</legend><div className="os-training-interests">{INTERESTS.map(interest => <label key={interest}><input type="checkbox" checked={training.preferences.interests.includes(interest)} onChange={e => setTraining(t => ({ ...t, preferences: { ...t.preferences, interests: e.target.checked ? [...t.preferences.interests, interest] : t.preferences.interests.filter(i => i !== interest) } }))} />{interest}</label>)}</div>
        <label className="os-training-field">Response style<select value={training.preferences.detail} onChange={e => setTraining(t => ({ ...t, preferences: { ...t.preferences, detail: e.target.value as "concise" | "detailed" } }))}><option value="concise">Concise</option><option value="detailed">Detailed</option></select></label>
        <label className="os-training-field">What should your Droid know?<textarea rows={4} maxLength={1000} placeholder="Focus on Monad NFT projects. Explain what you know, what is uncertain, and what needs checking." value={training.preferences.instructions} onChange={e => setTraining(t => ({ ...t, preferences: { ...t.preferences, instructions: e.target.value } }))} /></label>
        <label className="os-training-field">Research objectives · one per line, up to five<textarea rows={4} maxLength={1204} placeholder={"Learn how to evaluate free NFT mints\nBuild a checklist for memecoin contract research"} value={training.missions.join("\n")} onChange={e => setTraining(t => ({ ...t, missions: e.target.value.split("\n").slice(0, 5) }))} /></label>
      </fieldset><p className="os-ask-caption">Objectives are saved drafts. No scanner, background agent, trade, mint or Energy reward is started.</p><button className="os-button-primary" type="submit" disabled={!saved || busy || !dirty}>Save training · sign message</button>
    </form> : <>
      <div className="os-ask-conversation" ref={scroll} role="log" aria-label={`ASK conversation with D.Y.O.O.R #${droid.id}`} aria-live="polite">
        {!saved?.messages.length ? <div className="os-droid-greeting"><div className="os-bot-mark"><OsIcon name="Opportunities" /></div><h3>What should<br />we learn<span>?</span></h3><p>Set my interests with Train Droid, then ask me to explain an idea or help draft a research plan.</p></div> : saved.messages.map((m, i) => <div className={`os-message os-message-${m.role === "user" ? "user" : "droid"}`} key={i}><span className="os-eyebrow">{m.role === "user" ? "YOU" : `D.Y.O.O.R #${droid.id} · AI ANALYSIS`}</span><p>{m.text}</p></div>)}
      </div>
      <form className="os-chat-composer" onSubmit={submit}><label className="os-sr-only" htmlFor="os-ask-input">Talk to D.Y.O.O.R #{droid.id}</label><textarea id="os-ask-input" rows={3} maxLength={1200} value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Talk to D.Y.O.O.R #${droid.id}…`} disabled={!saved || busy || !aiReady} /><div><span><OsIcon name="shield" /> ASK · NO EXECUTION</span><button type="submit" disabled={!saved || !draft.trim() || busy || !aiReady || dirty} aria-label="Sign and send ASK message"><OsIcon name="arrow" /></button></div></form>
      <p className="os-ask-caption">{dirty ? "Save or reload your training changes before sending a message." : "Last six exchanges are saved. General AI discussion only; facts and risks require independent verification."}</p>
    </>}
  </div>;
}
