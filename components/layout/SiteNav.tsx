"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import dyoorLogo from "@/assets/dyoor-logo.png";
import { WalletButton } from "@/components/wallet/WalletButton";

const navLinks = [
  { href: "/#swap", label: "Swap" },
  { href: "/ascension", label: "Ascension" },
  { href: "/verify", label: "Verify" },
  { href: "/build-droid", label: "Builder" },
  { href: "/blueprint-checker", label: "Checker" },
  { href: "/whitepaper", label: "Whitepaper" },
];

export function SiteNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-dyoor-purple/25 bg-[#050513]/78 shadow-[0_0_34px_rgba(131,110,249,.16)] backdrop-blur-xl">
      <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 md:px-5">
        <Link className="group flex items-center gap-3" href="/" aria-label="DYOOR home">
          <Image
            src={dyoorLogo}
            alt="DYOOR"
            width={132}
            height={62}
            priority
            className="h-12 w-28 object-contain drop-shadow-[0_0_18px_rgba(57,255,226,.22)] sm:w-32"
          />
        </Link>
        <div className="hidden items-center gap-5 text-xs font-black uppercase tracking-[0.15em] text-white/70 md:flex">
          {navLinks.map((link) => (
            <Link className="transition hover:text-dyoor-cyan hover:drop-shadow-[0_0_10px_rgba(57,255,226,.55)]" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="inline-flex h-11 w-11 items-center justify-center rounded border border-dyoor-purple/35 bg-dyoor-purple/12 text-xl font-black text-white shadow-[0_0_18px_rgba(131,110,249,.18)] md:hidden"
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "×" : "☰"}
          </button>
          <WalletButton />
        </div>
      </nav>
      {menuOpen && (
        <div className="border-t border-dyoor-purple/25 bg-[#060515]/95 px-4 py-3 shadow-[0_22px_44px_rgba(0,0,0,.45)] md:hidden">
          <nav className="mx-auto grid max-w-7xl grid-cols-2 gap-2" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                className="rounded border border-dyoor-purple/24 bg-white/[0.055] px-3 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-white/82 transition hover:border-dyoor-cyan/45 hover:text-dyoor-cyan"
                href={link.href}
                key={link.href}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
