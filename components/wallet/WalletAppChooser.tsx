"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WalletAppChooserProps = {
  onClose: () => void;
  open: boolean;
};

type WalletAppLink = {
  accent: string;
  badge: string;
  href: string;
  name: string;
};

function buildWalletAppLinks(pageUrl: string): WalletAppLink[] {
  if (!pageUrl) return [];

  const parsedUrl = new URL(pageUrl);
  const encodedPageUrl = encodeURIComponent(parsedUrl.toString());
  const metamaskPageUrl = parsedUrl.toString().replace(/^https:\/\//, "");
  const okxDeepLink = `okx://wallet/dapp/url?dappUrl=${encodedPageUrl}`;

  return [
    {
      accent: "border-[#f6851b]/45 bg-[#f6851b]/10 hover:border-[#f6851b] hover:bg-[#f6851b]/20",
      badge: "MM",
      href: `https://metamask.app.link/dapp/${metamaskPageUrl}`,
      name: "MetaMask",
    },
    {
      accent: "border-white/25 bg-white/[0.055] hover:border-white/65 hover:bg-white/10",
      badge: "OKX",
      href: `https://web3.okx.com/download?deeplink=${encodeURIComponent(okxDeepLink)}`,
      name: "OKX Wallet",
    },
    {
      accent: "border-[#ab9ff2]/45 bg-[#ab9ff2]/10 hover:border-[#ab9ff2] hover:bg-[#ab9ff2]/20",
      badge: "PH",
      href: `https://phantom.app/ul/browse/${encodedPageUrl}?ref=${encodeURIComponent(parsedUrl.origin)}`,
      name: "Phantom",
    },
    {
      accent: "border-[#3375bb]/45 bg-[#3375bb]/10 hover:border-[#3375bb] hover:bg-[#3375bb]/20",
      badge: "TW",
      href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodedPageUrl}`,
      name: "Trust Wallet",
    },
  ];
}

export function WalletAppChooser({ onClose, open }: WalletAppChooserProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const pageUrl = open && typeof window !== "undefined" ? window.location.href : "";
  const isMobile = open && typeof navigator !== "undefined"
    ? /android|iphone|ipad|ipod/i.test(navigator.userAgent)
    : false;

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  const walletLinks = useMemo(() => buildWalletAppLinks(pageUrl), [pageUrl]);

  async function copyPageLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-end justify-center bg-[#02030b]/90 p-0 backdrop-blur-xl sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-describedby="wallet-app-description"
        aria-labelledby="wallet-app-title"
        aria-modal="true"
        className="relative max-h-[94dvh] w-full overflow-y-auto rounded-t-[1.5rem] border border-dyoor-cyan/35 bg-[radial-gradient(620px_280px_at_15%_0%,rgba(57,255,226,.15),transparent_58%),radial-gradient(520px_300px_at_100%_12%,rgba(131,110,249,.20),transparent_58%),#070817] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 shadow-[0_0_72px_rgba(57,255,226,.14)] sm:max-w-xl sm:rounded-[1.5rem] sm:p-7"
        role="dialog"
      >
        <button
          aria-label="Close wallet chooser"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/35 text-xl font-black text-white/60 transition hover:border-dyoor-cyan/55 hover:text-dyoor-cyan"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          ×
        </button>

        <p className="eyebrow pr-12">Direct mobile handoff</p>
        <h2 className="mt-3 pr-12 text-3xl font-black uppercase leading-none text-white sm:text-4xl" id="wallet-app-title">
          Choose your wallet
        </h2>
        <p className="mt-4 max-w-lg text-sm font-bold leading-6 text-white/62" id="wallet-app-description">
          {isMobile
            ? "Safari and Chrome cannot expose a mobile wallet directly. Choose any installed wallet to reopen this exact page in its secure in-app browser."
            : "This browser is not exposing a wallet. Open the page in a mobile wallet browser, or enable an EVM browser-wallet extension and try again."}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3" data-wallet-app-choices>
          {walletLinks.map((wallet) => (
            <a
              className={`group flex min-h-24 flex-col items-start justify-between rounded-xl border p-4 text-left transition active:scale-[0.98] ${wallet.accent}`}
              data-wallet-app={wallet.name}
              href={wallet.href}
              key={wallet.name}
            >
              <span className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 bg-black/30 px-2 text-[0.62rem] font-black uppercase tracking-[0.08em] text-white/80">
                {wallet.badge}
              </span>
              <span className="mt-4 flex w-full items-center justify-between gap-2 text-xs font-black uppercase tracking-[0.08em] text-white">
                {wallet.name}
                <span aria-hidden="true" className="text-dyoor-cyan transition group-hover:translate-x-0.5">↗</span>
              </span>
            </a>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-white/42">Any other EVM wallet</p>
          <p className="mt-2 text-xs font-bold leading-5 text-white/55">
            Copy this page and paste it into your wallet&apos;s built-in browser.
          </p>
          <button
            className="btn-secondary mt-3 w-full"
            onClick={() => void copyPageLink()}
            type="button"
          >
            {copyState === "copied"
              ? "Page link copied"
              : copyState === "error"
                ? "Copy unavailable — use address bar"
                : "Copy exact page link"}
          </button>
        </div>

        <div className="mt-5 grid gap-2 text-[0.66rem] font-black uppercase tracking-[0.1em] text-white/45 sm:grid-cols-3">
          <p><span className="text-dyoor-cyan">01</span> Choose wallet</p>
          <p><span className="text-dyoor-cyan">02</span> Page reopens</p>
          <p><span className="text-dyoor-cyan">03</span> Tap connect there</p>
        </div>
        <p className="mt-5 border-t border-white/10 pt-4 text-center text-[0.62rem] font-black uppercase tracking-[0.13em] text-white/32">
          No transaction, token approval, relay account, or paid service is requested.
        </p>
      </section>
    </div>
  );
}
