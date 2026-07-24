"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWalletService } from "@/providers/WalletServiceProvider";

function normalizeAddress(value?: string) {
  const wallet = String(value || "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export function DyoorWorldGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M7 7.2 12 4l5 3.2v6.2L12 17l-5-3.6V7.2Z" stroke="currentColor" strokeWidth="1.45" />
      <path d="m7 7.2 5 3.2 5-3.2M12 10.4V17" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="12" cy="4" fill="currentColor" r="1.55" />
      <circle cx="7" cy="7.2" fill="currentColor" r="1.55" />
      <circle cx="17" cy="7.2" fill="currentColor" r="1.55" />
      <circle cx="7" cy="13.4" fill="currentColor" r="1.55" />
      <circle cx="17" cy="13.4" fill="currentColor" r="1.55" />
      <circle cx="12" cy="17" fill="currentColor" r="1.55" />
      <path d="M9.2 20h5.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

export function DyoorWorldDiscovery() {
  const wallet = useWalletService();
  const address = normalizeAddress(wallet.address);
  const [eligibleWallet, setEligibleWallet] = useState("");

  useEffect(() => {
    let active = true;
    if (!address) return () => {
      active = false;
    };

    async function discover() {
      try {
        const response = await fetch(
          `/api/dyoor-world/discovery?wallet=${encodeURIComponent(address)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (active && response.ok && data?.eligible === true) setEligibleWallet(address);
      } catch {
        if (active) setEligibleWallet("");
      }
    }

    void discover();
    return () => {
      active = false;
    };
  }, [address]);

  if (!address || eligibleWallet !== address) return null;

  return (
    <Link
      aria-label="Enter dYOOR World"
      className="group relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dyoor-cyan/45 bg-dyoor-cyan/[0.07] text-dyoor-cyan shadow-[0_0_20px_rgba(57,255,226,.14)] transition hover:scale-105 hover:border-dyoor-cyan hover:bg-dyoor-cyan hover:text-black hover:shadow-[0_0_28px_rgba(57,255,226,.32)]"
      href="/dyoor-world"
      title="Unlisted holder signal"
    >
      <span className="absolute inset-1 animate-pulse rounded-full border border-dyoor-purple/30" />
      <DyoorWorldGlyph className="relative h-6 w-6" />
    </Link>
  );
}
