"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DyoorWorldGlyph } from "@/components/dyoor-world/DyoorWorldDiscovery";
import { useWalletService } from "@/providers/WalletServiceProvider";

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
  const [eligibility, setEligibility] = useState<{ wallet: string; eligible: boolean } | null>(null);
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
          setEligibility({ wallet: address, eligible: data?.eligible === true });
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
      await wallet.connect().catch(() => {});
      return;
    }
    if (wallet.status === "wrong-network") {
      await wallet.switchChain().catch(() => {});
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
    ? "Connect holder wallet"
    : wallet.status === "wrong-network"
      ? "Switch to Monad"
      : eligible === false
        ? "S2 Droid required"
        : eligible === null
          ? "Scanning S2 ownership"
          : working
            ? "Awaiting holder signature"
            : "Authenticate and enter";

  return (
    <main className="page-shell flex min-h-[calc(100vh-10rem)] items-center justify-center">
      <section className="glass-panel-strong relative w-full max-w-3xl overflow-hidden p-6 sm:p-10">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-dyoor-cyan/10 blur-3xl" />
        <div className="absolute -bottom-28 -left-16 h-72 w-72 rounded-full bg-dyoor-purple/15 blur-3xl" />
        <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-dyoor-cyan/45 bg-black/35 text-dyoor-cyan shadow-[0_0_52px_rgba(57,255,226,.18)]">
            <span className="absolute inset-2 animate-pulse rounded-full border border-dyoor-purple/45" />
            <DyoorWorldGlyph className="relative h-12 w-12" />
          </div>
          <p className="eyebrow mt-7">Unlisted signal // S2 holders only</p>
          <h1 className="heading-gradient mt-4 text-4xl sm:text-6xl">dYOOR World</h1>
          <p className="mt-5 max-w-lg text-sm font-bold leading-7 text-white/62 sm:text-base">
            A private Monad social node for D.Y.O.O.R holders. Access requires a
            read-only S2 ownership check and a one-time wallet signature.
          </p>
          <div className="mt-7 grid w-full gap-3 rounded border border-white/10 bg-black/30 p-4 text-left text-xs font-bold leading-6 text-white/55 sm:grid-cols-3">
            <div><span className="block text-dyoor-cyan">01</span>Hold an active S2 Droid</div>
            <div><span className="block text-dyoor-cyan">02</span>Sign the holder challenge</div>
            <div><span className="block text-dyoor-cyan">03</span>Enter the private World</div>
          </div>
          <button
            className="btn-primary mt-7 w-full sm:w-auto sm:min-w-72"
            disabled={working || Boolean(address && eligible !== true && wallet.status !== "wrong-network")}
            onClick={() => void enterWorld()}
            type="button"
          >
            {buttonLabel}
          </button>
          {error ? (
            <p className="mt-4 w-full rounded border border-red-400/35 bg-red-400/10 px-4 py-3 text-sm font-bold text-red-100">
              {error}
            </p>
          ) : null}
          <p className="mt-5 text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/32">
            Signing does not spend MON, Energy, or approve a transaction.
          </p>
        </div>
      </section>
    </main>
  );
}
