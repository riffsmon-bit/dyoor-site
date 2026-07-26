"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import dyoorLogo from "@/assets/dyoor-logo.png";
import { monadMainnet } from "@/lib/monad";
import { WalletServiceProvider } from "@/providers/WalletServiceProvider";

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
  const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      const message = args.map((arg) => String(arg)).join(" ");
      const keyWarning = message.includes('Each child in a list should have a unique "key" prop');
      const providerStackWarning = message.includes("AppProviders") || message.includes("from xe") || message.includes("from `xe`");
      if (keyWarning && providerStackWarning) {
        return;
      }
      originalError(...args);
    };

    return () => {
      console.error = originalError;
    };
  }, []);

  if (!appId) {
    return (
      <QueryClientProvider client={queryClient}>
        <WalletServiceProvider privyEnabled={false}>{children}</WalletServiceProvider>
      </QueryClientProvider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#39ffe2",
          logo: dyoorLogo.src,
          showWalletLoginFirst: true,
          walletChainType: "ethereum-only",
          walletList: [
            "metamask",
            "coinbase_wallet",
            "rainbow",
            "okx_wallet",
            "phantom",
            "backpack",
            "detected_ethereum_wallets",
            "wallet_connect",
            "wallet_connect_qr",
          ],
        },
        loginMethods: ["wallet", "email"],
        walletConnectCloudProjectId: walletConnectProjectId || undefined,
        externalWallets: {
          walletConnect: {
            enabled: true,
          },
          disableAllExternalWallets: false,
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: monadMainnet,
        supportedChains: [monadMainnet],
      } as any}
    >
      <QueryClientProvider client={queryClient}>
        <WalletServiceProvider privyEnabled>{children}</WalletServiceProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
