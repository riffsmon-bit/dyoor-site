import Link from "next/link";
import { S2SupplyStat } from "@/components/s2/S2SupplyStat";
import { S2_POST_BURN_SUPPLY_CAP } from "@/lib/s2-supply";

const productLinks = [
  { index: "01", title: "Ascension", copy: "Move Season 1 Droids into the protocol and generate Energy.", href: "/ascension" },
  { index: "02", title: "Trait Lab", copy: "Evolve live metadata, recycle traits, and permanently burn Droids.", href: "/reroll" },
  { index: "03", title: "dYOOR World", copy: "The private communication layer for verified collection holders.", href: "/dyoor-world" },
];

const flywheelSteps = [
  ["Generate", "Ascended Season 1 positions create Energy."],
  ["Evolve", "Spend Energy on verifiable trait changes."],
  ["Recycle", "Return eligible traits or burn a Droid."],
  ["Reinvest", "Use recovered Energy on the remaining supply."],
];

export default function HomePage() {
  return (
    <main className="page-enter home-atmosphere">
      <div className="orbital-backdrop" aria-hidden="true"><div className="orbital-horizon" /><div className="orbital-arc orbital-arc-one" /><div className="orbital-arc orbital-arc-two" /><div className="orbital-grain" /></div>
      <section className="relative mx-auto max-w-7xl px-5 pb-12 pt-20 sm:px-6 md:pb-20 md:pt-28">
        <div className="flex min-h-[24rem] items-center pb-14 md:min-h-[31rem]">
          <div className="relative z-10">
            <div className="mb-7 flex items-center gap-3 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-dyoor-cyan/80">
              <span className="h-px w-8 bg-dyoor-cyan/60" />
              Built on Monad
            </div>
            <h1 className="max-w-5xl text-[clamp(3.6rem,9vw,8.4rem)] font-semibold leading-[0.9] tracking-[-0.065em] text-white">
              Droids that<br />change onchain.
            </h1>
            <p className="mt-7 max-w-xl text-base leading-8 text-white/60 sm:text-lg">
              D.Y.O.O.R is a dynamic NFT system where Energy powers visible trait evolution,
              recycling returns resources, and every burn permanently contracts supply.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary" href="/reroll">Open Trait Lab</Link>
              <Link className="btn-secondary" href="/dyoor-world">Enter dYOOR World ↗</Link>
              <a className="btn-ghost" href="https://opensea.io/collection/d-y-o-o-r" rel="noopener noreferrer" target="_blank">OpenSea ↗</a>
            </div>
          </div>

        </div>

        <div className="mt-12 grid overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] sm:grid-cols-3 lg:mt-16">
          <S2SupplyStat className="p-5 sm:border-r sm:border-white/[0.08]" />
          <div className="border-t border-white/[0.08] p-5 sm:border-r sm:border-t-0">
            <p className="text-2xl font-semibold tracking-[-0.03em] text-white">{S2_POST_BURN_SUPPLY_CAP.toLocaleString("en-US")}</p>
            <p className="mt-2 text-xs text-white/[0.44]">Long-term live supply target</p>
          </div>
          <div className="border-t border-white/[0.08] p-5 sm:border-t-0">
            <p className="text-2xl font-semibold tracking-[-0.03em] text-white">Dynamic</p>
            <p className="mt-2 text-xs text-white/[0.44]">Versioned metadata and rendered traits</p>
          </div>
        </div>
      </section>

      <section className="border-y border-white/[0.07] bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 md:py-24">
          <div className="grid gap-8 md:grid-cols-[0.72fr_1.28fr] md:gap-16">
            <div>
              <p className="eyebrow">One connected system</p>
              <h2 className="mt-4 max-w-sm text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white md:text-5xl">Every action has a visible consequence.</h2>
            </div>
            <div className="grid border-t border-white/10">
              {productLinks.map((item) => (
                <Link className="group grid gap-3 border-b border-white/10 py-6 sm:grid-cols-[3rem_10rem_1fr_auto] sm:items-center" href={item.href} key={item.href}>
                  <span className="text-xs font-medium text-dyoor-cyan/60">{item.index}</span>
                  <h3 className="text-xl font-medium text-white">{item.title}</h3>
                  <p className="text-sm leading-6 text-white/[0.46]">{item.copy}</p>
                  <span className="text-lg text-white/30 transition group-hover:translate-x-1 group-hover:text-dyoor-cyan" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="energy-flywheel" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16 sm:px-6 md:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-start lg:gap-16">
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow">Energy flywheel</p>
            <h2 className="mt-4 text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white md:text-5xl">Designed to become scarcer through use.</h2>
            <p className="mt-5 max-w-lg text-base leading-8 text-white/[0.54]">Background and Droid identity stay locked. Eligible layers evolve through signed, versioned actions while onchain burns reduce the live collection permanently.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link className="btn-primary" href="/reroll">Evolve a Droid</Link>
              <Link className="btn-secondary" href="/whitepaper#dynamic-traits">Read the system</Link>
            </div>
          </div>
          <ol className="grid gap-3">
            {flywheelSteps.map(([title, copy], index) => (
              <li className="glass-panel grid gap-4 p-5 sm:grid-cols-[3rem_1fr] sm:p-6" key={title}>
                <span className="text-sm font-medium text-dyoor-cyan/[0.55]">0{index + 1}</span>
                <div>
                  <h3 className="text-2xl font-medium tracking-[-0.025em] text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/[0.48]">{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

    </main>
  );
}
