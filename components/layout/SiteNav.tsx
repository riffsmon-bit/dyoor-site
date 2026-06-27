"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const isActive = (href: string) => {
    if (href === "/#swap") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-dyoor-purple/25 bg-[#050513]/90 shadow-[0_0_34px_rgba(131,110,249,.16)] backdrop-blur-xl">
      <nav className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-3 px-4 py-3 md:h-20 md:px-5 md:py-0">
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
            aria-controls="mobile-site-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-dyoor-purple/45 bg-dyoor-purple/14 text-white shadow-[0_0_18px_rgba(131,110,249,.18)] transition hover:border-dyoor-cyan/55 hover:text-dyoor-cyan md:hidden"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="relative h-4 w-5" aria-hidden="true">
              <span className={`absolute left-0 top-0 h-0.5 w-5 rounded bg-current transition ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
              <span className={`absolute left-0 top-[7px] h-0.5 w-5 rounded bg-current transition ${menuOpen ? "opacity-0" : ""}`} />
              <span className={`absolute bottom-0 left-0 h-0.5 w-5 rounded bg-current transition ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
            </span>
          </button>
          <WalletButton />
        </div>
      </nav>
      {menuOpen && (
        <div className="fixed inset-x-0 bottom-0 top-20 z-40 md:hidden">
          <button
            aria-label="Close navigation menu"
            className="absolute inset-0 h-full w-full cursor-default bg-black/64 backdrop-blur-sm"
            type="button"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuRef}
            id="mobile-site-menu"
            className="absolute inset-x-0 top-0 max-h-[calc(100dvh-5rem)] overflow-y-auto border-b border-dyoor-purple/30 bg-[#070619]/96 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 shadow-[0_26px_60px_rgba(0,0,0,.58)]"
          >
            <nav className="mx-auto grid w-full max-w-md gap-2" aria-label="Mobile navigation">
              {navLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    className={`flex min-h-12 items-center justify-between rounded border px-4 py-3 text-sm font-black uppercase tracking-[0.13em] transition ${
                      active
                        ? "border-dyoor-cyan/70 bg-dyoor-cyan/14 text-dyoor-cyan shadow-[0_0_22px_rgba(57,255,226,.14)]"
                        : "border-dyoor-purple/28 bg-white/[0.055] text-white/82 hover:border-dyoor-cyan/45 hover:text-dyoor-cyan"
                    }`}
                    href={link.href}
                    key={link.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span>{link.label}</span>
                    <span className="text-white/28" aria-hidden="true">/</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
