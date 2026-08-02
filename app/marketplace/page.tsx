import type { Metadata } from "next";
import { TraitMarketplaceClient } from "@/components/s2/TraitMarketplaceClient";

export const metadata: Metadata = {
  title: "D.Y.O.O.R Trait Marketplace | DYOOR",
  description: "Buy approved Season 2 traits with Energy or MON and equip them on an owned D.Y.O.O.R.",
};

export default function TraitMarketplacePage() {
  return <TraitMarketplaceClient />;
}
