"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveArtwork = { tokenId: string; version: string; imageUrl: string; source: string; checkedAt: string };
type ArtworkState = { status: "loading" | "ready" | "error"; data?: LiveArtwork };

export function useLiveArtwork(tokenIds: readonly string[]) {
  const idsKey = tokenIds.join(",");
  const [artwork, setArtwork] = useState<Record<string, ArtworkState>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    request.current?.abort();
    setArtwork({});
    setRefreshKey(previous => previous + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const remaining = idsKey.split(",").filter(Boolean);
    async function worker() {
      while (remaining.length && !controller.signal.aborted) {
        const id = remaining.shift()!;
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
      }
    }
    for (let index = 0; index < Math.min(4, remaining.length); index++) void worker();
    return () => controller.abort();
  }, [refreshKey, idsKey]);
  return { artwork, refresh };
}
