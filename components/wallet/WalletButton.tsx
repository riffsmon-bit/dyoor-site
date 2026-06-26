"use client";

import { useWalletService } from "@/providers/WalletServiceProvider";

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet";
}

export function WalletButton() {
  const wallet = useWalletService();
  const loading = wallet.status === "loading";
  const connecting = wallet.status === "connecting";
  const errored = wallet.status === "error";
  const connected = wallet.connected;
  const wrongNetwork = wallet.status === "wrong-network";

  async function onClick() {
    if (wrongNetwork) {
      await wallet.switchChain().catch(() => {});
      return;
    }
    if (connected) {
      await wallet.disconnect();
      return;
    }
    await wallet.connect().catch(() => {});
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

  return (
    <button
      id="globalWalletBtn"
      className={`rounded border px-4 py-3 text-xs font-black uppercase transition ${
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
      title={wallet.error || (wrongNetwork ? "Switch wallet to Monad" : connected ? `Disconnect ${wallet.providerName || "wallet"}` : "Connect wallet")}
    >
      {label}
    </button>
  );
}
