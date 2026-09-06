import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssistCanaryClient } from "./AssistCanaryClient";
import "../droid-os.css";
import "./assist.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Droid #11 · ASSIST Canary", robots: { index: false, follow: false } };

export default function AssistPage() {
  // next.config.mjs freezes this flag after checking the build deployment context.
  // Netlify build variables are not necessarily present in the runtime function env.
  if (process.env.DROID_OS_UI_PREVIEW !== "true") notFound();
  return <AssistCanaryClient />;
}
