import type { Metadata } from "next";
import { MultiChainDroidDashboard } from "@/components/droids/MultiChainDroidDashboard";

export const metadata: Metadata = {
  title: "My Droids | D.Y.O.O.R",
  description: "Your D.Y.O.O.R collection, accounts, and inventory on Monad.",
};

export default function DroidsPage() {
  return <MultiChainDroidDashboard />;
}
