import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/providers/AppProviders";
import { SiteFooter } from "@/components/footer/SiteFooter";
import { SiteNav } from "@/components/layout/SiteNav";

export const metadata: Metadata = {
  title: "DYOOR",
  description: "DYOOR Monad NFT community and Ascension Protocol",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <SiteNav />
          {children}
          <SiteFooter />
        </AppProviders>
      </body>
    </html>
  );
}
