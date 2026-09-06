import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { DyoorWorldClient } from "@/components/dyoor-world/DyoorWorldClient";
import { DyoorWorldGate } from "@/components/dyoor-world/DyoorWorldGate";
import { DYOOR_WORLD_SESSION_COOKIE } from "@/lib/dyoor-world";
import { authenticateDyoorWorldToken } from "@/lib/dyoor-world-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "dYØØR Wørld",
  description: "The token-gated home of the D.Y.Ø.Ø.R ecosystem.",
  alternates: { canonical: "https://dyoor.fun/dyoor-world" },
  openGraph: {
    title: "dYØØR Wørld",
    description: "The token-gated home of the D.Y.Ø.Ø.R ecosystem.",
    url: "https://dyoor.fun/dyoor-world",
    siteName: "D.Y.Ø.Ø.R",
    type: "website",
    images: [{ url: "/dyoor-world-icon-512.png", width: 512, height: 512, alt: "dYØØR Wørld" }],
  },
  applicationName: "dYOOR World",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "dYOOR World",
  },
  icons: {
    icon: [
      {
        url: "/dyoor-world-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/dyoor-world-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/dyoor-world-apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#080918",
};

export default async function DyoorWorldPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(DYOOR_WORLD_SESSION_COOKIE)?.value || "";
  const authenticated = await authenticateDyoorWorldToken(token).catch(() => null);

  return (
    <div className="dyoor-world-app">
      {authenticated
        ? <DyoorWorldClient sessionWallet={authenticated.wallet} />
        : <DyoorWorldGate />}
    </div>
  );
}
