"use client";

import { useEffect, useState } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";
import { parseWalletRoster } from "@/lib/droid-os/roster.mjs";
import { type PreviewDroid } from "@/lib/droid-os/preview";
import { DroidOsPreview } from "./DroidOsPreview";

type RosterResult = { wallet: string; tokenIds: string[]; error: string };

export function DroidOsConnectedPreview() {
  const wallet = useWalletService();
  const address = /^0x[a-fA-F0-9]{40}$/.test(wallet.address) ? wallet.address.toLowerCase() : "";
  const [refreshKey, setRefreshKey] = useState(0);
  const [connectionError, setConnectionError] = useState("");
  const [result, setResult] = useState<RosterResult>({ wallet: "", tokenIds: [], error: "" });

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/s2/owned-tokens?wallet=${encodeURIComponent(address)}`, {
          method: "GET", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load all owned Droids. Retry shortly.");
        const tokenIds = parseWalletRoster(payload, address);
        if (!controller.signal.aborted) setResult({ wallet: address, tokenIds, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ wallet: address, tokenIds: [], error: error instanceof Error ? error.message : "Roster unavailable" });
      }
    })();
    return () => controller.abort();
  }, [address, refreshKey]);

  async function connect() {
    setConnectionError("");
    try { await wallet.connect(); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : "Connection failed"); }
  }

  const loaded = Boolean(address && result.wallet === address);
  const droids: PreviewDroid[] = loaded ? result.tokenIds.map(id => ({
    id, role: "Unassigned", color: "#39ffe2", mon: "Unavailable", energy: "Unavailable",
    achievements: 0, interests: [], liveRoster: true,
  })) : [];

  return <>
    <div className="os-wallet-roster-bar">
      <a href="/droid-os/lab">Contract test bench ↗</a>
      <a href="/droid-os/assist">Owner-approved mainnet test ↗</a>
      <div><strong>{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect to load all your Season 2 Droids"}</strong><span>Read-only holdings and live artwork. No signature, approval or network switch required.</span></div>
      {address ? <><button type="button" onClick={() => { setResult({ wallet: "", tokenIds: [], error: "" }); setRefreshKey(value => value + 1); }}>Refresh holdings</button><button type="button" onClick={() => void wallet.disconnect()}>Disconnect</button></> : <button type="button" disabled={!wallet.ready || wallet.status === "connecting"} onClick={() => void connect()}>{wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}</button>}
      {connectionError || wallet.error ? <p role="alert">{connectionError || wallet.error}</p> : null}
    </div>
    {!address ? <DroidOsPreview key="disconnected-demo" /> : !loaded || result.error || !droids.length ?
      <div className="droid-os os-roster-state" role="status"><h1>{!loaded ? "Loading your Droids…" : result.error ? "Your roster is unavailable." : "No Season 2 Droids found."}</h1><p>{result.error || (!loaded ? "Checking your wallet holdings. No sample Droids are being substituted." : "Check that the connected wallet holds Season 2 on Monad.")}</p></div> :
      <DroidOsPreview key={address} roster={droids} />}
  </>;
}
