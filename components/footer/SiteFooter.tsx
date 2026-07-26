import Image from "next/image";
import Link from "next/link";
import dyoorLogo from "@/assets/dyoor-logo.png";

const socials = [
  { label: "X / Twitter", href: "https://x.com/dyoor_" },
  { label: "Discord Onboarding", href: "https://discord.com/invite/nE5ZzejBfw" },
  { label: "Telegram Onboarding", href: "https://t.me/dyoorintake" },
  { label: "M3SH", href: "https://m3sh.netlify.app/app?node=dyoor&stream=dyoor-general" },
  { label: "OpenSea", href: "https://opensea.io/collection/d-y-o-o-r" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-dyoor-purple/25 bg-[#050513]/72 shadow-[0_-26px_54px_rgba(131,110,249,.10)]">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex items-center gap-3">
          <Image
            src={dyoorLogo}
            alt=""
            width={132}
            height={62}
            className="h-12 w-28 object-contain drop-shadow-[0_0_18px_rgba(57,255,226,.18)] sm:w-32"
          />
          <div>
            <Link href="/" className="bg-gradient-to-r from-white via-dyoor-cyan to-dyoor-monad bg-clip-text text-sm font-black uppercase tracking-[0.18em] text-transparent">
              DYOOR
            </Link>
            <p className="mt-1 text-xs font-semibold text-white/48">
              Discord and Telegram welcome new users. S2 holders gather inside dYOOR World.
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="DYOOR external links">
          {socials.map((social) => (
            <a
              key={social.label}
              className="rounded border border-dyoor-purple/24 bg-white/[0.035] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/72 transition hover:border-dyoor-cyan/45 hover:bg-dyoor-cyan/10 hover:text-dyoor-cyan"
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
