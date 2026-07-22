import Link from "next/link";
import Image from "next/image";
import homeBanner from "@/assets/home_banner.png";
import { SwapCard } from "@/components/swap/SwapCard";

const heroStats = [
  ["3,333", "Season 2 Droid Supply"],
  ["1:1", "Ascended S1 Allocation"],
  ["Live", "Trait Lab Rerolls"],
  ["Quarterly", "Planned Staked Droid Rewards"],
];

export default function HomePage() {
  return (
    <main className="page-enter">
      <section className="relative min-h-[calc(100vh-80px)] overflow-hidden">
        <Image
          src={homeBanner}
          alt="DYOOR Monad artwork"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,3,10,.96),rgba(6,5,21,.74)_46%,rgba(17,10,45,.42)),radial-gradient(960px_560px_at_78%_22%,rgba(131,110,249,.34),transparent_58%),radial-gradient(760px_420px_at_52%_64%,rgba(57,255,226,.15),transparent_60%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-dyoor-bg to-transparent" />
        <div className="relative z-10 mx-auto grid min-h-[calc(100vh-80px)] max-w-7xl items-center gap-8 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="mb-3 inline-flex rounded-full border border-dyoor-purple/35 bg-dyoor-purple/12 px-3 py-2 text-xs font-black uppercase tracking-[0.24em] text-dyoor-cyan shadow-[0_0_24px_rgba(131,110,249,.16)]">Monad-native modular NFT ecosystem</p>
            <h1 className="max-w-4xl break-words bg-gradient-to-br from-white via-dyoor-cyan to-dyoor-monad bg-clip-text text-4xl font-black uppercase leading-none text-transparent drop-shadow-[0_0_34px_rgba(57,255,226,.14)] sm:text-5xl md:text-7xl">
              Season 1 was the key. Droids are next.
            </h1>
            <p className="mt-6 max-w-2xl text-lg font-semibold leading-8 text-white/74">
              D.Y.O.O.R expands through Ascension, Energy, blueprints, dynamic traits, Season 2 staking,
              planned rewards, and long-term treasury growth.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary" href="/blueprint-checker">
                Check Blueprint
              </Link>
              <Link className="btn-secondary" href="/whitepaper">
                Read Whitepaper
              </Link>
              <Link className="btn-secondary" href="/#swap">
                Swap On Monad
              </Link>
            </div>
          </div>
          <div className="grid gap-3 rounded border border-dyoor-purple/30 bg-[#070616]/58 p-4 shadow-[0_0_44px_rgba(131,110,249,.18)] backdrop-blur-xl md:grid-cols-2">
            {heroStats.map(([value, label]) => (
              <div key={label} className="rounded border border-dyoor-purple/22 bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.06)]">
                <div className="text-3xl font-black text-dyoor-cyan drop-shadow-[0_0_14px_rgba(57,255,226,.25)]">{value}</div>
                <div className="mt-2 text-xs font-black uppercase leading-5 text-white/58">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-12 md:grid-cols-3">
        {[
          ["Ascension", "Ascend S1, generate Energy, and unlock Season 2 allocation eligibility.", "/ascension"],
          ["Blueprints", "Check saved Ascension Blueprints against minted Season 2 Droid traits.", "/blueprint-checker"],
          ["Trait Lab", "Reroll traits, unlock empty slots, recycle wearables, and burn Droids for Energy.", "/reroll"],
        ].map(([title, copy, href]) => (
          <Link key={href} href={href} className="glass-panel hover-lift p-5">
            <h2 className="text-xl font-black uppercase text-white">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/62">{copy}</p>
          </Link>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 md:py-16">
        <SwapCard />
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 pb-16 md:grid-cols-2 lg:grid-cols-4">
        {[
          ["Dynamic Traits", "Droids are designed to evolve through future trait upgrades, rerolls, and marketplace systems.", "/whitepaper#dynamic-traits"],
          ["Revenue Vision", "Read the careful quarterly revenue-sharing vision for eligible staked Droids.", "/whitepaper#quarterly-revenue-sharing"],
          ["Role Sync", "Verify Discord roles against holder and Ascension wallet state.", "/verify"],
          ["Treasury", "Track the Season 2 treasury model after the core Droid and Energy loops.", "/whitepaper#treasury"],
        ].map(([title, copy, href]) => (
          <Link key={href} href={href} className="glass-panel hover-lift p-5">
            <h2 className="text-xl font-black uppercase text-white">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/62">{copy}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
