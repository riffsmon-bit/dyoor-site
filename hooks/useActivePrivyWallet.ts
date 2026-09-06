"use client";

import { useActiveWallet, useWallets } from "@privy-io/react-auth";

export function useActivePrivyWallet() {
  const { wallets, ready } = useWallets();
  const { wallet: activeWallet, setActiveWallet } = useActiveWallet();
  const activeAddress = typeof activeWallet?.address === "string" ? activeWallet.address.toLowerCase() : "";

  const wallet = activeAddress
    ? wallets.find((item) => item.address?.toLowerCase() === activeAddress)
    : wallets.length === 1
      ? wallets[0]
      : undefined;

  return {
    setActiveWallet,
    wallet,
    wallets,
    ready,
  };
}
