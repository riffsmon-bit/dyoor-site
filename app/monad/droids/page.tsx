import type { Metadata } from "next";
import { DroidSquadClient } from "@/components/robinhood/droids/DroidSquadClient";
import { MONAD_MAINNET_CHAIN_ID } from "@/lib/monad";

export const metadata: Metadata = {
  title: "D.Y.O.O.R Droid Accounts | Monad",
  description: "Open the deterministic Droid Wallet, portfolio, Energy, and security controls for your Monad D.Y.O.O.R squad.",
};

export default function MonadDroidSquadPage() {
  return (
    <DroidSquadClient
      chainId={MONAD_MAINNET_CHAIN_ID}
      basePath="/monad/droids"
      traitLabPath="/reroll"
    />
  );
}
