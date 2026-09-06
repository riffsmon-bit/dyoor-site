/* eslint-disable @next/next/no-img-element */
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { PREVIEW_DROIDS, droidDisplayName, type PreviewDroid } from "@/lib/droid-os/preview";
import { OsIcon } from "./OsIcon";

export function DroidCharacter({ droid, select }: { droid: PreviewDroid; select: (id: string) => void }) {
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (index + offset + PREVIEW_DROIDS.length) % PREVIEW_DROIDS.length;
    select(PREVIEW_DROIDS[next].id);
    event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
  }
  return <section className="os-character" aria-label="Selected Droid" style={{ "--droid-color": droid.color } as CSSProperties}>
    <div className="os-stage-top"><span className="os-eyebrow">SEASON 02 <span>/</span> UNIT {droid.id.padStart(3, "0")}</span><span className="os-stage-label"><i /> CHARACTER PREVIEW</span></div>
    <div className="os-art-stage">
      <span className="os-stage-coordinate os-coordinate-left" aria-hidden="true">143 / DYOOR</span>
      <div className="os-art-frame" key={droid.id}>
        {missing[droid.id]
          ? <div className="os-art-missing"><OsIcon name="grid" /><p>Artwork unavailable</p></div>
          : <img className="os-hero-image" src={`/droid-os/droid-${droid.id}.png`} alt={`Season 2 Droid #${droid.id} — original artwork preview`} onError={() => setMissing((previous) => ({ ...previous, [droid.id]: true }))} />}
        <span className="os-frame-corner os-frame-tl" /><span className="os-frame-corner os-frame-br" />
        <span className="os-art-stamp">DYØØR<span>GEN. 02</span></span>
      </div>
      <span className="os-stage-coordinate os-coordinate-right" aria-hidden="true">DIRECTIVE / EXPLORE</span>
    </div>
    <div className="os-character-title"><div><span className="os-eyebrow">{droid.role} CLASS · SAMPLE PERSONA</span><h2>D.Y.O.O.R<span>#{droid.id}</span></h2></div><span className="os-mode-pill"><OsIcon name="shield" /> ASK MODE</span></div>
    <p className="os-character-line">A little curiosity. A clear directive. Entirely yours.</p>
    <div className="os-character-traits">{droid.interests.map((interest) => <span key={interest}>{interest}</span>)}</div>
    <div className="os-roster-heading"><span className="os-eyebrow">SELECT YOUR DROID</span><span>04 <span>/ SAMPLE ROSTER</span></span></div>
    <div className="os-roster" aria-label="Sample Droid roster">
      {PREVIEW_DROIDS.map((item, index) => <button key={item.id} type="button" aria-pressed={item.id === droid.id} aria-label={`Select ${droidDisplayName(item)}`} className={`os-roster-slot ${item.id === droid.id ? "os-slot-selected" : ""}`} onClick={() => select(item.id)} onKeyDown={(event) => move(event, index)}><img src={`/droid-os/droid-${item.id}.png`} alt="" loading="lazy" /><span>#{item.id}<i /></span></button>)}
    </div>
    <p className="os-roster-note">Original artwork samples · not your connected holdings</p>
  </section>;
}
