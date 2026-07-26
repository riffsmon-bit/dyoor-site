"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
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

  return (
    <QueryClientProvider client={queryClient}>
      <WalletServiceProvider>{children}</WalletServiceProvider>
    </QueryClientProvider>
  );
}
