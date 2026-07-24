import Link from "next/link";
import Image from "next/image";
import homeBanner from "@/assets/home_banner.png";
import { S2SupplyStat } from "@/components/s2/S2SupplyStat";
import { SwapCard } from "@/components/swap/SwapCard";

const heroStats = [
  ["1:1", "Ascended S1 Allocation"],
  ["Live", "Dynamic Trait Lab"],
  ["Permanent", "On-chain Droid Burns"],
];

const flywheelSteps = [
  {
    step: "01",
    title: "Generate Energy",
    copy: "Ascended Season 1 positions generate the ecosystem resource that powers Droid progression.",
  },
  {
    step: "02",
    title: "Evolve Traits",
    copy: "Spend Energy in Trait Lab to reroll eligible traits, unlock empty slots, and update a Droid’s metadata.",
  },
  {
    step: "03",
    title: "Recycle Or Burn",
    copy: "Recycle eligible wearables or permanently burn a Season 2 Droid to return Energy to the holder.",
  },
  {
    step: "04",
    title: "Reinvest",
    copy: "Use returned Energy on the remaining collection while every Droid burn permanently contracts live supply.",
  },
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
            <p className="mb-3 inline-flex max-w-full rounded-full border border-dyoor-purple/35 bg-dyoor-purple/12 px-3 py-2 text-[0.68rem] font-black uppercase leading-5 tracking-[0.16em] text-dyoor-cyan shadow-[0_0_24px_rgba(131,110,249,.16)] sm:text-xs sm:tracking-[0.24em]">Monad-native deflationary dynamic NFT</p>
            <h1 className="max-w-4xl break-words bg-gradient-to-br from-white via-dyoor-cyan to-dyoor-monad bg-clip-text text-4xl font-black uppercase leading-none text-transparent drop-shadow-[0_0_34px_rgba(57,255,226,.14)] sm:text-5xl md:text-7xl">
              Evolve the Droid. Contract the supply.
            </h1>
            <p className="mt-6 max-w-2xl text-lg font-semibold leading-8 text-white/74">
              D.Y.O.O.R is a deflationary dynamic NFT collection. Energy powers live trait evolution,
              recycling returns resources to holders, and every on-chain Droid burn permanently reduces supply.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary" href="/reroll">
                Enter Trait Lab
              </Link>
              <Link className="btn-secondary" href="/blueprint-checker">
                Check Blueprint
              </Link>
              <Link className="btn-secondary" href="/#swap">
                Swap On Monad
              </Link>
            </div>
          </div>
          <div className="grid gap-3 rounded border border-dyoor-purple/30 bg-[#070616]/58 p-4 shadow-[0_0_44px_rgba(131,110,249,.18)] backdrop-blur-xl md:grid-cols-2">
            <S2SupplyStat className="rounded border border-dyoor-cyan/28 bg-dyoor-cyan/[0.075] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_0_24px_rgba(57,255,226,.08)]" />
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
          ["Trait Lab", "Evolve live metadata, recycle eligible traits, and permanently burn Droids for Energy.", "/reroll"],
        ].map(([title, copy, href]) => (
          <Link key={href} href={href} className="glass-panel hover-lift p-5">
            <h2 className="text-xl font-black uppercase text-white">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/62">{copy}</p>
          </Link>
        ))}
      </section>

      <section id="energy-flywheel" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-12 md:py-16">
        <div className="glass-panel-strong energy-grid overflow-hidden p-5 md:p-8">
          <div className="relative z-10">
            <p className="eyebrow">Dynamic Traits + Energy Flywheel</p>
            <div className="mt-3 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <div>
                <h2 className="heading-gradient text-4xl md:text-6xl">A Droid is no longer a static image.</h2>
                <p className="mt-5 max-w-3xl text-base font-semibold leading-8 text-white/70">
                  Core identity stays recognizable: Background and Droid traits remain locked. Eligible visual layers
                  can evolve through Energy-powered Trait Lab actions, producing versioned metadata and refreshed
                  artwork while preserving the token’s history.
                </p>
              </div>
              <div className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/[0.08] p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-dyoor-cyan">Deflationary By Action</p>
                <p className="mt-3 text-sm font-semibold leading-7 text-white/70">
                  Season 2 began with 1,096 issued Droids. Burning is irreversible, recorded on Monad, and removes that
                  token from the live collection forever. The supply counter above reads this state directly from the
                  contract.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {flywheelSteps.map((item, index) => (
                <article key={item.step} className="relative rounded border border-white/10 bg-black/35 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black tracking-[0.2em] text-dyoor-cyan">{item.step}</span>
                    {index < flywheelSteps.length - 1 && (
                      <span className="text-lg font-black text-dyoor-cyan/50" aria-hidden="true">→</span>
                    )}
                  </div>
                  <h3 className="mt-3 text-lg font-black uppercase text-white">{item.title}</h3>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">{item.copy}</p>
                </article>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link className="btn-primary" href="/reroll">Evolve A Droid</Link>
              <Link className="btn-secondary" href="/whitepaper#dynamic-traits">Explore The System</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 md:py-16">
        <SwapCard />
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 pb-16 md:grid-cols-2 lg:grid-cols-4">
        {[
          ["Dynamic Traits", "Use Energy to reroll, unlock, recycle, and evolve eligible Droid metadata in Trait Lab.", "/reroll"],
          ["Energy Flywheel", "Generate Energy, evolve traits, recycle assets, and reinvest into the remaining collection.", "/#energy-flywheel"],
          ["Deflationary Supply", "Track permanent on-chain burns as the live Season 2 Droid supply contracts.", "/whitepaper#deflationary-supply"],
          ["Role Sync", "Verify Discord roles against holder and Ascension wallet state.", "/verify"],
        ].map(([title, copy, href]) => (
          <Link key={title} href={href} className="glass-panel hover-lift p-5">
            <h2 className="text-xl font-black uppercase text-white">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-white/62">{copy}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
