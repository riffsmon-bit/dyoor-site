import type { Metadata } from "next";
import { HoodYoorTraitLabClient } from "@/components/robinhood/HoodYoorTraitLabClient";

export const metadata: Metadata = {
  title: "HoodYØØR Trait Lab",
  description: "Preview compatibility-checked HoodYØØR rerolls and accept them gaslessly with Energy.",
};

export default function HoodYoorTraitLabPage() {
  return <HoodYoorTraitLabClient />;
}
