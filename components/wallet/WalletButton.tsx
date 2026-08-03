"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet";
}

export function WalletButton() {
  const wallet = useWalletService();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const loading = wallet.status === "loading";
  const connecting = wallet.status === "connecting";
  const errored = wallet.status === "error";
  const connected = wallet.connected;
  const wrongNetwork = wallet.status === "wrong-network";

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function onClick() {
    if (wrongNetwork) {
      setSwitchError("");
      try {
        await wallet.switchChain();
      } catch (caught) {
        setSwitchError(caught instanceof Error ? caught.message : "Wallet could not switch to Monad mainnet.");
      }
      return;
    }
    if (connected) {
      setSwitchError("");
      setMenuOpen((open) => !open);
      return;
    }
    setMenuOpen(false);
    await wallet.connect().catch(() => {});
  }

  async function disconnect() {
    setMenuOpen(false);
    await wallet.disconnect().catch(() => {});
  }

  const label = loading
    ? "Loading"
    : connecting
      ? "Connecting..."
      : connected
        ? wrongNetwork
          ? "Switch to Monad"
          : shortAddress(wallet.address)
        : errored
          ? "Retry Wallet"
          : "Connect Wallet";

  const showMenu = menuOpen && connected && !wrongNetwork;

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        aria-expanded={connected && !wrongNetwork ? menuOpen : undefined}
        aria-haspopup={connected && !wrongNetwork ? "menu" : undefined}
        className={`max-w-[9.5rem] shrink-0 rounded border px-3 py-3 text-xs font-black uppercase transition sm:max-w-[12rem] sm:px-4 md:max-w-none ${
          connected && !wrongNetwork
            ? "border-dyoor-cyan bg-dyoor-cyan/10 text-dyoor-cyan shadow-[0_0_22px_rgba(57,255,226,.16)] hover:bg-dyoor-cyan hover:text-black"
            : wrongNetwork
              ? "border-yellow-300/50 bg-yellow-300/10 text-yellow-100 hover:bg-yellow-300 hover:text-black"
              : errored
                ? "border-red-400/50 bg-red-400/10 text-red-100 hover:bg-red-400 hover:text-black"
                : "border-dyoor-cyan bg-dyoor-cyan/10 text-dyoor-cyan shadow-[0_0_22px_rgba(57,255,226,.16)] hover:bg-dyoor-cyan hover:text-black"
        } disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-transparent disabled:text-white/50 disabled:shadow-none`}
        type="button"
        disabled={loading || connecting}
        onClick={() => void onClick()}
        title={wrongNetwork
          ? switchError || wallet.error || "Switch wallet to Monad mainnet (chain 143)"
          : wallet.error || (connected ? "Open wallet options" : "Connect wallet")}
      >
        <span className="block truncate">{label}</span>
      </button>
      {wrongNetwork && switchError ? (
        <div className="absolute right-0 top-[calc(100%+0.55rem)] z-[130] w-72 rounded border border-red-300/40 bg-[#160a14] p-3 text-left text-xs font-bold normal-case text-red-100 shadow-[0_18px_42px_rgba(0,0,0,.55)]" role="alert">
          {switchError}
        </div>
      ) : null}
      {showMenu ? (
        <div
          className="absolute right-0 top-[calc(100%+0.55rem)] z-[120] w-56 rounded border border-dyoor-cyan/35 bg-[#060817] p-2 text-left shadow-[0_18px_42px_rgba(0,0,0,.55)]"
          role="menu"
        >
          <div className="border-b border-white/10 px-3 py-2">
            <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-white/42">{wallet.providerName || wallet.source || "Wallet"}</p>
            <p className="mt-1 break-all text-xs font-black uppercase text-dyoor-cyan">{shortAddress(wallet.address)}</p>
          </div>
          <button
            className="mt-2 w-full rounded border border-red-300/35 bg-red-400/10 px-3 py-3 text-left text-xs font-black uppercase text-red-100 transition hover:bg-red-300 hover:text-black"
            role="menuitem"
            type="button"
            onClick={() => void disconnect()}
          >
            Disconnect Wallet
          </button>
        </div>
      ) : null}
    </div>
  );
}
