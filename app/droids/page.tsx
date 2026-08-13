import type { Metadata } from "next";
import { MultiChainDroidDashboard } from "@/components/droids/MultiChainDroidDashboard";

export const metadata: Metadata = {
  title: "My Droids | D.Y.O.O.R + HoodYØØR",
  description: "Open chain-qualified Droids across the native Monad and Robinhood collections.",
};

export default function DroidsPage() {
  return <MultiChainDroidDashboard />;
}
