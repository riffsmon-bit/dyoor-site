"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useState } from "react";
import { DyoorWorldGlyph } from "@/components/dyoor-world/DyoorWorldDiscovery";
import {
  DYOOR_WORLD_STICKERS,
  dyoorWorldSticker,
  normalizeDyoorWorldAttachment,
  type DyoorWorldMessageAttachment,
  type DyoorWorldStickerId,
} from "@/lib/dyoor-world-media";

type MediaResponse = {
  ok?: boolean;
  error?: string;
  attachment?: DyoorWorldMessageAttachment;
};

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Media request failed.");
  return data as T;
}

export function DyoorWorldStickerCard({
  stickerId,
  compact = false,
}: {
  stickerId: DyoorWorldStickerId;
  compact?: boolean;
}) {
  const sticker = dyoorWorldSticker(stickerId);
  if (!sticker) return null;
  const tone = stickerId === "burn-verified"
    ? "border-orange-300/35 from-orange-400/20 via-rose-500/10 to-black text-orange-100"
    : stickerId === "charged-up"
      ? "border-emerald-300/35 from-emerald-300/20 via-dyoor-cyan/10 to-black text-emerald-100"
      : stickerId === "diamond-droid"
        ? "border-sky-300/35 from-sky-300/20 via-dyoor-purple/15 to-black text-sky-100"
        : "border-dyoor-purple/40 from-dyoor-purple/25 via-dyoor-cyan/10 to-black text-white";
  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-gradient-to-br shadow-[0_0_32px_rgba(128,92,255,.15)] ${tone} ${
        compact ? "min-h-20 p-3" : "min-h-36 w-full max-w-sm p-5"
      }`}
    >
      <div className="absolute -right-7 -top-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/65 to-transparent" />
      <div className="relative flex h-full items-center gap-3">
        <div className={`flex shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/25 shadow-[0_0_25px_rgba(76,255,229,.18)] ${compact ? "h-10 w-10" : "h-16 w-16"}`}>
          <DyoorWorldGlyph className={compact ? "h-5 w-5" : "h-8 w-8"} />
        </div>
        <div className="min-w-0">
          <p className={`${compact ? "text-[0.5rem]" : "text-[0.6rem]"} font-black uppercase tracking-[0.22em] text-current opacity-55`}>
            {sticker.signal}
          </p>
          <p className={`${compact ? "mt-1 text-sm" : "mt-2 text-2xl"} break-words font-black uppercase leading-none tracking-[-0.02em]`}>
            {sticker.label}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DyoorWorldMediaComposer({
  attachment,
  disabled = false,
  onChange,
}: {
  attachment: DyoorWorldMessageAttachment | null;
  disabled?: boolean;
  onChange: (attachment: DyoorWorldMessageAttachment | null) => void;
}) {
  const [mode, setMode] = useState<"" | "upload" | "stickers">("");
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState("");

  function openMode(next: "upload" | "stickers") {
    const opening = mode !== next;
    setMode(opening ? next : "");
    setMediaError("");
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMediaError("");
    try {
      const body = new FormData();
      body.set("image", file);
      const response = await fetch("/api/dyoor-world/media/upload", {
        method: "POST",
        body,
      });
      const data = await readResponse<MediaResponse>(response);
      const normalized = normalizeDyoorWorldAttachment(data.attachment);
      if (!normalized || normalized.kind !== "image") {
        throw new Error("The uploaded image response was invalid.");
      }
      onChange(normalized);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not upload this image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-pressed={mode === "upload"}
          className={`rounded border px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.12em] transition ${
            mode === "upload"
              ? "border-emerald-300/45 bg-emerald-300/10 text-emerald-200"
              : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white"
          }`}
          disabled={disabled}
          onClick={() => openMode("upload")}
          type="button"
        >
          Upload image
        </button>
        <button
          aria-pressed={mode === "stickers"}
          className={`rounded border px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.12em] transition ${
            mode === "stickers"
              ? "border-dyoor-purple/60 bg-dyoor-purple/15 text-white"
              : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white"
          }`}
          disabled={disabled}
          onClick={() => openMode("stickers")}
          type="button"
        >
          World stickers
        </button>
        {attachment ? (
          <button
            className="ml-auto text-[0.55rem] font-black uppercase tracking-[0.1em] text-white/30 hover:text-rose-200"
            disabled={disabled}
            onClick={() => onChange(null)}
            type="button"
          >
            Clear attachment
          </button>
        ) : null}
      </div>

      {mode === "upload" ? (
        <div className="mt-2 rounded border border-emerald-300/20 bg-emerald-300/[0.04] p-3">
          <label className="flex cursor-pointer items-center justify-center rounded border border-dashed border-emerald-300/30 bg-black/25 px-4 py-6 text-center transition hover:border-emerald-200/60">
            <input
              accept="image/avif,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled || uploading}
              onChange={uploadImage}
              type="file"
            />
            <span>
              <span className="block text-xs font-black uppercase tracking-[0.12em] text-emerald-200">
                {uploading ? "Optimizing image" : "Choose an image"}
              </span>
              <span className="mt-2 block text-[0.6rem] font-bold text-white/35">
                PNG, JPG, WEBP, or AVIF · 5 MB max · converted to private optimized WEBP
              </span>
            </span>
          </label>
          {mediaError ? (
            <p className="mt-2 text-[0.62rem] font-bold text-rose-200/85">{mediaError}</p>
          ) : null}
        </div>
      ) : null}

      {mode === "stickers" ? (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded border border-dyoor-purple/25 bg-dyoor-purple/[0.04] p-3 sm:grid-cols-3 xl:grid-cols-5">
          {DYOOR_WORLD_STICKERS.map((sticker) => (
            <button
              aria-pressed={attachment?.kind === "sticker" && attachment.stickerId === sticker.id}
              className={`rounded-lg text-left transition ${
                attachment?.kind === "sticker" && attachment.stickerId === sticker.id
                  ? "ring-2 ring-dyoor-cyan/70 ring-offset-2 ring-offset-black"
                  : "opacity-65 hover:opacity-100"
              }`}
              key={sticker.id}
              onClick={() => {
                onChange(
                  attachment?.kind === "sticker" && attachment.stickerId === sticker.id
                    ? null
                    : { kind: "sticker", stickerId: sticker.id },
                );
              }}
              type="button"
            >
              <DyoorWorldStickerCard compact stickerId={sticker.id} />
            </button>
          ))}
        </div>
      ) : null}

      {attachment?.kind === "image" || attachment?.kind === "gif" ? (
        <div className="mt-2 flex items-center gap-3 rounded border border-white/10 bg-black/30 p-2">
          <img
            alt={attachment.alt || "Selected attachment"}
            className="h-14 w-14 rounded object-cover"
            referrerPolicy="no-referrer"
            src={attachment.url}
          />
          <div className="min-w-0">
            <p className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-dyoor-cyan">
              {attachment.kind === "gif" ? "GIF selected" : "Image ready"}
            </p>
            <p className="mt-1 truncate text-xs font-bold text-white/45">
              {attachment.alt || "Ready to send"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
