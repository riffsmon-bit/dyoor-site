import type { Metadata } from "next";
import { DroidSquadClient } from "@/components/robinhood/droids/DroidSquadClient";

export const metadata: Metadata = {
  title: "HoodYØØR Droid Accounts",
  description: "Open the deterministic smart accounts, inventory, Energy, and security controls for your HoodYØØR squad.",
};

export default function DroidSquadPage() {
  return <DroidSquadClient />;
}
