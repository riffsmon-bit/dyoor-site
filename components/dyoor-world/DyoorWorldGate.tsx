"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DyoorWorldGlyph } from "@/components/dyoor-world/DyoorWorldDiscovery";
import type { DyoorWorldEntitlements } from "@/lib/dyoor-world";
import { useWalletService } from "@/providers/WalletServiceProvider";
import { WorldIcon } from "./WorldIcon";

function normalizeAddress(value?: string) {
  const wallet = String(value || "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "dYOOR World access failed.");
  return data;
}

export function DyoorWorldGate() {
  const router = useRouter();
  const wallet = useWalletService();
  const address = normalizeAddress(wallet.address);
  const [eligibility, setEligibility] = useState<{
    wallet: string;
    eligible: boolean;
    entitlements: DyoorWorldEntitlements;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const eligible = eligibility?.wallet === address ? eligibility.eligible : null;

  useEffect(() => {
    let active = true;
    if (!address) return () => {
      active = false;
    };

    async function check() {
      try {
        const response = await fetch(
          `/api/dyoor-world/discovery?wallet=${encodeURIComponent(address)}`,
          { cache: "no-store" },
        );
        const data = await responseJson(response);
        if (active) {
          setEligibility({
            wallet: address,
            eligible: data?.eligible === true,
            entitlements: {
              season1: data?.entitlements?.season1 === true,
              ascended: data?.entitlements?.ascended === true,
              season2: data?.entitlements?.season2 === true,
              hoodyoor: data?.entitlements?.hoodyoor === true,
            },
          });
          setError("");
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not check holder access.");
      }
    }

    void check();
    return () => {
      active = false;
    };
  }, [address]);

  async function enterWorld() {
    if (!address) {
      setError("");
      await wallet.connect().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not connect this holder wallet.");
      });
      return;
    }

    setWorking(true);
    setError("");
    try {
      const challengeResponse = await fetch("/api/dyoor-world/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const challengeData = await responseJson(challengeResponse);
      const challenge = challengeData?.challenge;
      const signature = await wallet.signMessage(String(challenge?.message || ""));
      const sessionResponse = await fetch("/api/dyoor-world/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          nonce: challenge?.nonce,
          signature,
        }),
      });
      await responseJson(sessionResponse);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not authenticate this holder wallet.");
    } finally {
      setWorking(false);
    }
  }

  const buttonLabel = !address
    ? wallet.status === "connecting"
      ? "Preparing wallet connection"
      : "Connect holder wallet"
    : eligible === false
      ? "Accepted NFT required"
      : eligible === null
        ? "Scanning holder contracts"
        : working
          ? "Awaiting holder signature"
          : "Authenticate and enter";

  return (
    <div className="world-entry">
      <header className="world-entry-header">
        <DyoorWorldGlyph className="h-8 w-8 text-dyoor-cyan" />
        <div className="mr-auto">
          <p className="world-overline">The holder clubhouse</p>
          <p className="world-brand">dYOOR World<span>.</span></p>
        </div>
        <Link className="btn-ghost min-h-9 px-3 py-2 text-[0.62rem]" href="/">
          Back to DYOOR ↗
        </Link>
      </header>
      <main className="world-entry-main">
        <section className="world-entry-intro">
          <p className="world-overline"><span className="world-status-dot" /> A place for the people behind the Droids</p>
          <h1>Your people.<br />Your corner<br />of the <em>World.</em></h1>
          <p className="world-entry-copy">The conversations, connections, and next ideas that make DYOOR more than a collection. All in one holder-only home.</p>
          <div className="world-entry-features">
            <div><WorldIcon name="chat" /><span><strong>Find your room</strong><small>Shared conversations. Collection-specific spaces.</small></span></div>
            <div><WorldIcon name="collection" /><span><strong>Make it yours</strong><small>Your Droid, your identity, your community.</small></span></div>
            <div><WorldIcon name="energy" /><span><strong>Stay involved</strong><small>Discover the Trait Lab, Energy, and holder trades.</small></span></div>
          </div>
          <p className="world-entry-footnote">Built for DYOOR holders <span>·</span> Connected on Monad</p>
        </section>
        <section className="world-entry-pass" aria-labelledby="world-access-title">
          <div className="world-orbit-art" aria-hidden="true"><i /><i /><i /><div><DyoorWorldGlyph className="h-16 w-16" /></div><span>YOUR WORLD, CONNECTED</span></div>
          <div className="world-entry-pass-content">
            <p className="world-overline">Your membership starts here</p>
            <h2 id="world-access-title">Come on in.</h2>
            <p className="world-entry-pass-copy">Connect a wallet holding Season 1, Ascended, or Season 2. We’ll find the rooms that belong to you.</p>
            {eligibility?.wallet === address && eligibility.eligible ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {eligibility.entitlements.season1 ? <span className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-[0.62rem] font-black text-white/70">Season 1 verified</span> : null}
                {eligibility.entitlements.ascended ? <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[0.62rem] font-black text-amber-200">Ascended verified</span> : null}
                {eligibility.entitlements.season2 ? <span className="rounded-full border border-dyoor-cyan/30 bg-dyoor-cyan/10 px-3 py-1.5 text-[0.62rem] font-black text-dyoor-cyan">Season 2 verified</span> : null}
              </div>
            ) : null}
            <ol className="world-access-steps"><li><span>01</span> Connect</li><li><span>02</span> Verify ownership</li><li><span>03</span> Enter World</li></ol>
            <button
              className="world-enter-button"
              disabled={
                working ||
                wallet.status === "connecting" ||
                Boolean(address && eligible !== true)
              }
              onClick={() => void enterWorld()}
              type="button"
            >
              {buttonLabel}<WorldIcon name="arrow" />
            </button>
            {error ? (
              <p role="alert" className="world-entry-error">
                {error}
              </p>
            ) : null}
            <p className="world-access-note"><WorldIcon name="shield" /><span>One holder signature. No gas, no MON or Energy spent, no transaction approval, and no network switch.</span></p>
          </div>
        </section>
      </main>
      <footer className="world-entry-footer"><span>A private home. A shared World.</span><span>New here? Discord remains our public onboarding path.</span></footer>
    </div>
  );
}
