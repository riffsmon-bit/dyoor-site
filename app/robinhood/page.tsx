import type { Metadata } from "next";
import { RobinhoodGtdClient } from "@/components/robinhood/RobinhoodGtdClient";

export const metadata: Metadata = {
  title: "HoodYØØR GTD Wallet Confirmation",
  description: "Confirm your wallet for the HoodYØØR GTD list on Robinhood Chain.",
};

export default function RobinhoodGtdPage() {
  return <RobinhoodGtdClient />;
}
