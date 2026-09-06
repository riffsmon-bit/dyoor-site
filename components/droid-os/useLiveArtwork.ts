"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PREVIEW_DROIDS } from "@/lib/droid-os/preview";

export type LiveArtwork = { tokenId: string; version: string; imageUrl: string; source: string; checkedAt: string };
type ArtworkState = { status: "loading" | "ready" | "error"; data?: LiveArtwork };

export function useLiveArtwork() {
  const [artwork, setArtwork] = useState<Record<string, ArtworkState>>({});
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setArtwork(Object.fromEntries(PREVIEW_DROIDS.map(({ id }) => [id, { status: "loading" }])));
    for (const { id } of PREVIEW_DROIDS) {
      void (async () => {
        try {
          const response = await fetch(`/api/droid-os/artwork/${id}`, {
            method: "GET", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          });
          if (!response.ok) throw new Error("Metadata unavailable");
          const data = await response.json() as LiveArtwork;
          if (data.tokenId !== id || !data.imageUrl || !data.version) throw new Error("Metadata mismatch");
          if (!controller.signal.aborted) setArtwork(previous => ({ ...previous, [id]: { status: "ready", data } }));
        } catch {
          if (!controller.signal.aborted) setArtwork(previous => ({ ...previous, [id]: { status: "error" } }));
        }
      })();
    }
  }, []);
  useEffect(() => { refresh(); return () => request.current?.abort(); }, [refresh]);
  return { artwork, refresh };
}
