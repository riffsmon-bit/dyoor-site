import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { droidOsPreviewEnabled } from "@/lib/droid-os/preview-config.mjs";
import { AssistCanaryClient } from "./AssistCanaryClient";
import "../droid-os.css";
import "./assist.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Droid #11 · ASSIST Canary", robots: { index: false, follow: false } };

export default function AssistPage() {
  if (!droidOsPreviewEnabled(process.env)) notFound();
  return <AssistCanaryClient />;
}
