"use client";
import { useCallback, useEffect, useRef } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";
import { requestAsk, type AskClient } from "@/lib/droid-os/ask/client";
export type { AskClient } from "@/lib/droid-os/ask/client";
async function post(body: unknown) {
  const response = await fetch("/api/droid-os/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "ASK request failed.");
  return data;
}
export function useDroidAskClient(): AskClient {
  const wallet = useWalletService();
  const { address: connectedAddress, signMessage } = wallet;
  const current = useRef(wallet.address.toLowerCase());
  useEffect(() => { current.current = wallet.address.toLowerCase(); return () => { current.current = ""; }; }, [wallet.address]);
  return useCallback((input, onProgress) => requestAsk(input, {
    address: connectedAddress.toLowerCase(), origin: window.location.origin,
    currentAddress: () => current.current, post, signMessage, onProgress,
  }), [connectedAddress, signMessage]);
}
