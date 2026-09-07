"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DyoorWorldDiscovery } from "@/components/dyoor-world/DyoorWorldDiscovery";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useWalletService } from "@/providers/WalletServiceProvider";

const navLinks = [
  { href: "/droids", label: "Droids" },
  { href: "/ascension", label: "Ascension" },
  { href: "/reroll", label: "Reroll" },
  { href: "/marketplace", label: "Market" },
  { href: "/whitepaper", label: "Whitepaper" },
];

const adminLink = { href: "/admin-command-center", label: "Admin" };

function normalizeAddress(address?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? String(address).toLowerCase() : "";
}

export function SiteNav() {
  const pathname = usePathname();
  const isWorldApp = pathname.startsWith("/dyoor-world");
  const isStandaloneCampaign = pathname.startsWith("/robinhood") || pathname.startsWith("/droid-os");
  const walletService = useWalletService();
  const walletAddress = normalizeAddress(walletService.address);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authorizedAdminWallet, setAuthorizedAdminWallet] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen || isWorldApp || isStandaloneCampaign) return;
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
  }, [isStandaloneCampaign, isWorldApp, menuOpen]);

  useEffect(() => {
    let active = true;
    if (isWorldApp || isStandaloneCampaign || !walletAddress) return () => {
      active = false;
    };

    async function checkAdminAccess() {
      try {
        const response = await fetch(`/api/admin/snapshots?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (active) setAuthorizedAdminWallet(data.authorized ? walletAddress : "");
      } catch {
        if (active) setAuthorizedAdminWallet("");
      }
    }

    void checkAdminAccess();
    return () => {
      active = false;
    };
  }, [isStandaloneCampaign, isWorldApp, walletAddress]);

  const isActive = (href: string) => {
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const showAdminLink = Boolean(walletAddress && authorizedAdminWallet === walletAddress) || pathname.startsWith("/admin");
  const links = showAdminLink ? [...navLinks, adminLink] : navLinks;

  if (isWorldApp || isStandaloneCampaign) return null;

  return (
    <header className="site-header sticky top-0 z-[90] border-b border-white/[0.07]">
      <nav className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-3 px-4 py-3 md:h-20 md:px-5 md:py-0">
        <Link className="group flex items-center gap-3" href="/" aria-label="DYOOR home">
          <span className="site-wordmark">DYØØR<span className="text-dyoor-cyan">.</span></span>
        </Link>
        <div className="hidden items-center gap-1 text-sm font-semibold text-white/[0.64] md:flex">
          {links.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`site-nav-link ${active ? "site-nav-link-active" : ""}`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DyoorWorldDiscovery />
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
        <div className="fixed inset-x-0 bottom-0 top-20 z-[80] border-t border-dyoor-cyan/30 bg-[#050513] md:hidden" role="dialog" aria-modal="true">
          <div
            ref={menuRef}
            id="mobile-site-menu"
            className="h-full overflow-y-auto bg-[#050513] px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 shadow-[0_26px_60px_rgba(0,0,0,.58)]"
          >
            <nav className="mx-auto grid w-full max-w-md gap-3" aria-label="Mobile navigation">
              {links.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[4.25rem] items-center justify-between rounded border px-4 py-4 text-base font-black uppercase leading-tight tracking-normal transition ${
                      active
                        ? "border-dyoor-cyan bg-dyoor-cyan text-black shadow-[0_0_22px_rgba(57,255,226,.2)]"
                        : "border-dyoor-purple/45 bg-[#0c1026] text-white hover:border-dyoor-cyan/65 hover:text-dyoor-cyan"
                    }`}
                    href={link.href}
                    key={link.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="truncate">{link.label}</span>
                    <span className={active ? "text-black/45" : "text-dyoor-cyan"} aria-hidden="true">/</span>
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
