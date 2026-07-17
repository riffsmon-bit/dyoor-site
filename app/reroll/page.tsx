import type { Metadata } from "next";
import { TraitLabClient } from "@/components/s2/TraitLabClient";

export const metadata: Metadata = {
  title: "D.Y.O.O.R Trait Lab | DYOOR",
  description: "Reroll, unlock, and upgrade D.Y.O.O.R Season 2 metadata traits with Energy.",
};

export default function RerollPage() {
  return <TraitLabClient />;
}
