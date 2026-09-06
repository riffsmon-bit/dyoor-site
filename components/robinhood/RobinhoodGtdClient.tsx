"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  normalizeRobinhoodGtdWallet,
  ROBINHOOD_GTD_CHAIN_ID,
  robinhoodGtdConfirmationMessage,
} from "@/lib/robinhood-gtd";
import { useWalletService } from "@/providers/WalletServiceProvider";

type Submission = {
  wallet: string;
  campaign: string;
  createdAt: string;
  destinationChain: {
    name: string;
    chainId: number;
  };
};

type RegistrationStatus = {
  ok?: boolean;
  registrationOpen?: boolean;
  acceptedCount?: number;
  submitted?: boolean;
  submission?: Submission | null;
  error?: string;
};

type FlowState = "idle" | "checking" | "connecting" | "signing" | "submitting" | "success" | "error";

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

function friendlyWalletError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/rejected|denied|cancel|closed/i.test(message)) return "The signature request was cancelled. Your wallet was not submitted.";
  return message || "We could not confirm this wallet. Please try again.";
}

function displayDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function RobinhoodGtdClient() {
  const wallet = useWalletService();
  const walletAddress = normalizeRobinhoodGtdWallet(wallet.address);
  return <RobinhoodGtdSession key={walletAddress || "disconnected"} wallet={wallet} walletAddress={walletAddress} />;
}

function RobinhoodGtdSession({ wallet, walletAddress }: {
  wallet: ReturnType<typeof useWalletService>;
  walletAddress: string;
}) {
  const [flow, setFlow] = useState<FlowState>("checking");
  const [confirmed, setConfirmed] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [acceptedCount, setAcceptedCount] = useState<number | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    const query = walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : "";
    fetch(`/api/robinhood-gtd${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as RegistrationStatus;
        if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load registration status.");
        return data;
      })
      .then((data) => {
        setRegistrationOpen(data.registrationOpen !== false);
        setAcceptedCount(typeof data.acceptedCount === "number" ? data.acceptedCount : null);
        setSubmission(data.submission || null);
        setFlow(data.submitted ? "success" : "idle");
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(friendlyWalletError(caught));
        setFlow("error");
      });

    return () => controller.abort();
  }, [walletAddress]);

  const buttonLabel = useMemo(() => {
    if (!walletAddress) return flow === "connecting" ? "Opening wallet…" : "Connect wallet";
    if (flow === "checking") return "Checking wallet…";
    if (flow === "signing") return "Check your wallet…";
    if (flow === "submitting") return "Confirming spot…";
    if (flow === "success") return "Wallet confirmed";
    if (!registrationOpen) return "Registration closed";
    return "Verify & submit wallet";
  }, [flow, registrationOpen, walletAddress]);

  async function connectWallet() {
    setError("");
    setFlow("connecting");
    try {
      await wallet.connect();
      setFlow("idle");
    } catch (caught) {
      setError(friendlyWalletError(caught));
      setFlow("error");
    }
  }

  async function submitWallet() {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!confirmed || !registrationOpen || flow === "signing" || flow === "submitting") return;

    setError("");
    setFlow("signing");

    try {
      const issuedAt = new Date().toISOString();
      const nonce = globalThis.crypto.randomUUID();
      const message = robinhoodGtdConfirmationMessage({
        wallet: walletAddress,
        issuedAt,
        nonce,
      });
      const signature = await wallet.signMessage(message);

      setFlow("submitting");
      const response = await fetch("/api/robinhood-gtd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, issuedAt, nonce, message, signature }),
      });
      const data = await response.json().catch(() => ({})) as RegistrationStatus;
      if (!response.ok || data.ok === false || !data.submission) {
        throw new Error(data.error || "Could not save this wallet.");
      }

      setAcceptedCount(typeof data.acceptedCount === "number" ? data.acceptedCount : acceptedCount);
      setSubmission(data.submission);
      setFlow("success");
    } catch (caught) {
      setError(friendlyWalletError(caught));
      setFlow("error");
    }
  }

  const busy = flow === "checking" || flow === "connecting" || flow === "signing" || flow === "submitting";
  const submitted = flow === "success" && Boolean(submission);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070a06] text-white selection:bg-[#c7ff00]/40 selection:text-white">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(199,255,0,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(199,255,0,.07)_1px,transparent_1px)] [background-size:48px_48px]" />

      <header className="relative z-30 border-b border-[#c7ff00]/15 bg-[#070a06]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="DYOOR home">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#c7ff00] shadow-[0_0_28px_rgba(199,255,0,.18)]">
              <Image src="/assets/robinhood/hoodyoor-robinhood-feather-logo.png" alt="" fill sizes="44px" className="object-cover" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-black uppercase tracking-[-0.03em]">HoodYØØR</span>
              <span className="block truncate text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/70">A DYOOR collection</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.14em] text-white/55 sm:block">
              Robinhood Chain
            </span>
            {walletAddress ? (
              <span className="rounded-full border border-[#c7ff00]/30 bg-[#c7ff00]/10 px-3 py-2 font-mono text-xs font-bold text-[#c7ff00]">
                {shortAddress(walletAddress)}
              </span>
            ) : (
              <button
                className="rounded-full border border-[#c7ff00]/35 bg-[#c7ff00]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.08em] text-[#c7ff00] transition hover:bg-[#c7ff00] hover:text-black disabled:opacity-50"
                type="button"
                disabled={flow === "connecting"}
                onClick={() => void connectWallet()}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="relative min-h-[43rem] overflow-hidden border-b border-[#c7ff00]/20 sm:min-h-[36rem]">
        <picture className="absolute inset-0 block h-full w-full">
          <source media="(max-width: 639px)" srcSet="/assets/robinhood/hoodyoor-gtd-hero-mobile.png" />
          {/* The campaign handoff supplies distinct art-direction crops, so a native picture is intentional here. */}
          <img
            src="/assets/robinhood/hoodyoor-gtd-hero-desktop.png"
            alt="HoodYØØR collection artwork"
            width={1942}
            height={809}
            fetchPriority="high"
            className="h-full w-full object-cover object-center sm:object-right-center"
          />
        </picture>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,5,.88)_0%,rgba(5,10,5,.60)_45%,rgba(5,10,5,.10)_72%,rgba(5,10,5,.24)_100%)] sm:bg-[linear-gradient(90deg,rgba(5,10,5,.98)_0%,rgba(5,10,5,.88)_35%,rgba(5,10,5,.30)_61%,rgba(5,10,5,.04)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#070a06] via-[#070a06]/70 to-transparent" />
        <div className="relative z-10 mx-auto flex min-h-[43rem] max-w-7xl items-start px-5 py-12 sm:min-h-[36rem] sm:items-center sm:py-16">
          <div className="w-full max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#c7ff00]/30 bg-black/45 px-3 py-2 text-[0.65rem] font-black uppercase tracking-[0.18em] text-[#c7ff00] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c7ff00] shadow-[0_0_12px_#c7ff00]" />
              GTD wallet confirmation
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-black uppercase leading-[0.88] tracking-[-0.07em] text-white drop-shadow-[0_8px_30px_rgba(0,0,0,.65)] min-[360px]:text-5xl sm:text-7xl md:text-8xl">
              Your spot.<br />
              <span className="text-[#c7ff00]">Your wallet.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base font-semibold leading-7 text-white/68 sm:text-lg sm:leading-8">
              Confirm the EVM wallet you want on the HoodYØØR guaranteed list. One gasless signature is all it takes.
            </p>
            <div className="mt-7 hidden max-w-xl grid-cols-3 overflow-hidden rounded-2xl border border-[#c7ff00]/20 bg-black/35 backdrop-blur-md sm:grid">
              {[
                ["3,333", "Total supply"],
                ["On-chain", "Collection art"],
                [String(ROBINHOOD_GTD_CHAIN_ID), "Chain ID"],
              ].map(([value, label], index) => (
                <div className={`px-4 py-3 ${index ? "border-l border-[#c7ff00]/15" : ""}`} key={label}>
                  <p className="text-sm font-black uppercase text-white">{value}</p>
                  <p className="mt-1 text-[0.55rem] font-black uppercase tracking-[0.14em] text-[#c7ff00]/65">{label}</p>
                </div>
              ))}
            </div>
            <a className="mt-6 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-[#c7ff00]" href="#confirm-wallet">
              Confirm below <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </section>

      <section id="confirm-wallet" className="relative z-20 mx-auto -mt-12 max-w-6xl scroll-mt-8 px-5 pb-24 sm:-mt-20">
        <div className="grid overflow-hidden rounded-[1.75rem] border border-[#c7ff00]/25 bg-[#0c110b] shadow-[0_30px_100px_rgba(0,0,0,.65),0_0_55px_rgba(199,255,0,.08)] lg:grid-cols-[0.8fr_1.2fr]">
          <div className="relative hidden min-h-[38rem] overflow-hidden bg-[#c7ff00] lg:block">
            <Image
              src="/assets/robinhood/hoodyoor-robinhood-droid.png"
              alt="HoodYØØR droid wearing Robinhood traits"
              fill
              sizes="(min-width: 1024px) 40vw, 0px"
              className="object-cover object-center"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent p-7 pt-24">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]">Built fully on-chain</p>
              <p className="mt-2 max-w-xs text-sm font-bold leading-6 text-white/75">3,333 unique Droids. Dynamic identity. Robinhood-native energy.</p>
            </div>
          </div>

          <div className="p-5 sm:p-8 lg:p-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]">Step 01 / 01</p>
                <h2 className="mt-3 text-3xl font-black uppercase tracking-[-0.045em] text-white sm:text-4xl">Confirm your wallet</h2>
                <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-white/50">
                  Connect the wallet you plan to use on Robinhood Chain, then sign a free ownership confirmation.
                </p>
              </div>
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#c7ff00]/25 bg-[#c7ff00]/10 text-xl font-black text-[#c7ff00] sm:flex">
                01
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-5">
              <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-white/35">Destination wallet</p>
              {walletAddress ? (
                <div className="mt-3 flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#c7ff00] text-sm font-black text-black">
                    0x
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold text-white sm:text-base">{walletAddress}</p>
                    <p className="mt-1 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#c7ff00]/65">
                      Connected · EVM compatible
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  className="mt-3 flex w-full items-center justify-between rounded-xl border border-dashed border-[#c7ff00]/25 bg-[#c7ff00]/[0.04] px-4 py-4 text-left transition hover:border-[#c7ff00]/60 hover:bg-[#c7ff00]/10"
                  type="button"
                  onClick={() => void connectWallet()}
                >
                  <span>
                    <span className="block text-sm font-black uppercase text-white">No wallet connected</span>
                    <span className="mt-1 block text-xs font-semibold text-white/42">Tap to choose your GTD wallet</span>
                  </span>
                  <span className="text-xl text-[#c7ff00]" aria-hidden="true">→</span>
                </button>
              )}
            </div>

            {submitted ? (
              <div className="mt-5 rounded-2xl border border-[#c7ff00]/35 bg-[#c7ff00]/10 p-5" role="status" aria-live="polite">
                <div className="flex gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#c7ff00] text-xl font-black text-black shadow-[0_0_24px_rgba(199,255,0,.22)]" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <h3 className="text-lg font-black uppercase text-[#c7ff00]">You’re confirmed</h3>
                    <p className="mt-1 text-sm font-semibold leading-6 text-white/65">
                      This wallet is recorded for the HoodYØØR GTD list{displayDate(submission?.createdAt) ? ` as of ${displayDate(submission?.createdAt)}` : ""}.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <label className={`mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${confirmed ? "border-[#c7ff00]/35 bg-[#c7ff00]/[0.07]" : "border-white/10 bg-white/[0.025] hover:border-white/20"}`}>
                <input
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#c7ff00]"
                  type="checkbox"
                  checked={confirmed}
                  disabled={!walletAddress || !registrationOpen}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span className="text-sm font-semibold leading-6 text-white/65">
                  I confirm this is the wallet I want listed for HoodYØØR GTD access on Robinhood Chain.
                </span>
              </label>
            )}

            {error ? (
              <div className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-bold leading-6 text-red-100" role="alert" aria-live="assertive">
                {error}
              </div>
            ) : null}

            {!registrationOpen && !submitted ? (
              <div className="mt-5 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-bold text-amber-100" role="status">
                GTD wallet registration is currently closed.
              </div>
            ) : null}

            <button
              className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl border border-[#c7ff00] bg-[#c7ff00] px-5 py-4 text-sm font-black uppercase tracking-[0.08em] text-black shadow-[0_0_30px_rgba(199,255,0,.16)] transition hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_10px_40px_rgba(199,255,0,.2)] active:translate-y-0 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.06] disabled:text-white/28 disabled:shadow-none"
              type="button"
              disabled={busy || submitted || (Boolean(walletAddress) && (!confirmed || !registrationOpen))}
              onClick={() => void submitWallet()}
            >
              {busy ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
              ) : submitted ? (
                <span className="mr-2" aria-hidden="true">✓</span>
              ) : null}
              {buttonLabel}
            </button>

            <div className="mt-5 grid gap-3 border-t border-white/8 pt-5 text-xs font-semibold leading-5 text-white/38 sm:grid-cols-2">
              <div className="flex gap-2">
                <span className="text-[#c7ff00]" aria-hidden="true">◇</span>
                <span>No gas, token approval, or transaction is required.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[#c7ff00]" aria-hidden="true">◇</span>
                <span>Your signature only proves control of this wallet.</span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[0.6rem] font-black uppercase tracking-[0.13em] text-white/28">
              <span>Chain ID {ROBINHOOD_GTD_CHAIN_ID}</span>
              <span>{acceptedCount === null ? "Live registration" : `${acceptedCount.toLocaleString("en-US")} wallet${acceptedCount === 1 ? "" : "s"} confirmed`}</span>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-3xl text-center">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]">What happens next</p>
          <h2 className="mt-3 text-2xl font-black uppercase tracking-[-0.035em] text-white sm:text-3xl">Your wallet goes on the GTD list</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm font-semibold leading-7 text-white/45">
            Keep access to the confirmed wallet and follow official DYOOR updates for collection timing and mint instructions. We will never ask for your seed phrase or private key.
          </p>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[#c7ff00]/12 bg-black/25">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-5 py-7 text-center sm:flex-row sm:text-left">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-white/40">© {new Date().getFullYear()} HoodYØØR · A DYOOR collection</p>
          <p className="text-xs font-semibold text-white/28">Built for Robinhood Chain. Always verify official links.</p>
        </div>
      </footer>
    </main>
  );
}
