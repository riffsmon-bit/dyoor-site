"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const socials = [
  { label: "X / Twitter", href: "https://x.com/dyoor_" },
  { label: "Discord Onboarding", href: "https://discord.com/invite/nE5ZzejBfw" },
  { label: "Telegram Onboarding", href: "https://t.me/dyoorintake" },
  { label: "M3SH", href: "https://m3sh.netlify.app/app?node=dyoor&stream=dyoor-general" },
  { label: "OpenSea", href: "https://opensea.io/collection/d-y-o-o-r" },
];

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/dyoor-world") || pathname.startsWith("/robinhood")) return null;

  return (
    <footer className="border-t border-white/[0.07] bg-[#07070b]/90">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex items-center gap-3">
          <div>
            <Link href="/" className="text-sm font-semibold tracking-[0.12em] text-white">
              DYØØR.
            </Link>
            <p className="mt-1 text-xs font-semibold text-white/[0.48]">
              Discord and Telegram welcome new users. S2 holders gather inside dYOOR World.
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="DYOOR external links">
          {socials.map((social) => (
            <a
              key={social.label}
              className="rounded-full border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-medium text-white/[0.64] transition hover:border-dyoor-cyan/[0.35] hover:text-white"
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {social.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
