import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscordVerifyClient } from "@/components/discord/DiscordVerifyClient";

export const metadata: Metadata = {
  title: "Verify Discord | DYØØR",
  description: "Securely link wallets and synchronize DYØØR Discord identity roles.",
  alternates: { canonical: "https://dyoor.fun/discord/verify" },
  robots: { index: false, follow: false },
};

export default function DiscordVerifyPage() {
  return (
    <Suspense
      fallback={(
        <main className="page-shell min-h-screen py-8 sm:py-14">
          <section className="mx-auto w-full max-w-3xl rounded-2xl border border-dyoor-cyan/25 bg-[#080918]/95 p-8 text-sm font-bold text-white/55">
            Loading the secure Discord gateway…
          </section>
        </main>
      )}
    >
      <DiscordVerifyClient />
    </Suspense>
  );
}
