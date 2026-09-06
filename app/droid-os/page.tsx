import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DroidOsConnectedPreview } from "@/components/droid-os/DroidOsConnectedPreview";
import "./droid-os.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Droid OS · Local UI Review", robots: { index: false, follow: false } };

export default function DroidOsPage() {
  if (process.env.DROID_OS_UI_PREVIEW !== "true") notFound();
  return <DroidOsConnectedPreview />;
}
