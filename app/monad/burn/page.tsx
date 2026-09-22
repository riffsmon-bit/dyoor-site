import type { Metadata } from "next";
import { MonadBurnClient } from "@/components/monad/MonadBurnClient";

export const metadata: Metadata = {
  title: "Burn D.Y.O.O.Rs | DYOOR",
  description: "Permanently burn eligible Monad D.Y.O.O.Rs and preserve your verified burn count for the Hoodyoor launch snapshot.",
};

export default function MonadBurnPage() {
  return <MonadBurnClient />;
}
