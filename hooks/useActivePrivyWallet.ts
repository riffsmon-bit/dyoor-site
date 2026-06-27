"use client";

import { useActiveWallet, useWallets } from "@privy-io/react-auth";

export function useActivePrivyWallet() {
  const { wallets, ready } = useWallets();
  const { wallet: activeWallet } = useActiveWallet();
  const activeAddress = typeof activeWallet?.address === "string" ? activeWallet.address.toLowerCase() : "";

  const wallet = activeAddress
    ? wallets.find((item) => item.address?.toLowerCase() === activeAddress) || wallets[0]
    : wallets[0];

  return {
    wallet,
    wallets,
    ready,
  };
}
