import type { Metadata } from "next";
import { RobinhoodGtdClient } from "@/components/robinhood/RobinhoodGtdClient";

export const metadata: Metadata = {
  title: "HoodYØØR | Onchain Droids With Their Own Wallets",
  description: "Explore HoodYØØR art, traits, Energy, rerolls, verified contracts, and NFT-bound Droid Accounts on Robinhood Chain.",
};

export default function RobinhoodGtdPage() {
  return <RobinhoodGtdClient />;
}
