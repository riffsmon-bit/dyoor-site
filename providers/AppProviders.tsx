"use client";

import { PrivyProvider, type WalletListEntry } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import dyoorLogo from "@/assets/dyoor-logo.png";
import { monadMainnet } from "@/lib/monad";
import { WalletServiceProvider } from "@/providers/WalletServiceProvider";

const PRIVY_WALLET_LIST: WalletListEntry[] = [
  "detected_ethereum_wallets",
  "wallet_connect",
];

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  }));
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

  const app = (
    <QueryClientProvider client={queryClient}>
      <WalletServiceProvider privyEnabled={Boolean(appId)}>{children}</WalletServiceProvider>
    </QueryClientProvider>
  );

  if (!appId) return app;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          accentColor: "#39ffe2",
          logo: dyoorLogo.src,
          theme: "dark",
          walletChainType: "ethereum-only",
          walletList: PRIVY_WALLET_LIST,
        },
        defaultChain: monadMainnet,
        externalWallets: {
          disableAllExternalWallets: false,
        },
        loginMethods: ["wallet"],
        supportedChains: [monadMainnet],
      }}
    >
      {app}
    </PrivyProvider>
  );
}
