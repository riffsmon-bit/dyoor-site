"use client";
import { useCallback, useEffect, useRef } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";
import { parseOperation, parseState, type Operation, type State } from "@/lib/droid-os/ask/schema";
import { challengeMessage } from "@/lib/droid-os/ask/protocol";
export type AskClient = (op: Omit<Operation, "wallet" | "version"> | Record<string, unknown>) => Promise<{ state: State; aiReady: boolean }>;
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
  return useCallback(async (input) => {
    const address = connectedAddress.toLowerCase();
    const operation = parseOperation({ ...input, wallet: address, version: 1 });
    const c = await post({ stage: "challenge", operation });
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(operation))))].map(n => n.toString(16).padStart(2, "0")).join("");
    if (!Number.isSafeInteger(c.block) || !Number.isSafeInteger(c.expires) || c.expires <= Date.now() || c.expires > Date.now() + 120000 || !/^[a-f0-9-]{36}$/.test(c.id)) throw new Error("Invalid ASK challenge.");
    const expected = challengeMessage({ id: c.id, origin: window.location.origin, expires: c.expires, digest: hash, owner: { block: c.block } }, operation);
    if (c.message !== expected || current.current !== address) throw new Error("Wallet or request changed. Please retry.");
    const signature = await signMessage(expected);
    if (current.current !== address) throw new Error("Wallet changed. Nothing was submitted.");
    const result = await post({ stage: "perform", operation, id: c.id, signature });
    if (current.current !== address) throw new Error("Wallet changed. Response discarded.");
    return { state: parseState(result.state), aiReady: result.aiReady === true };
  }, [connectedAddress, signMessage]);
}
