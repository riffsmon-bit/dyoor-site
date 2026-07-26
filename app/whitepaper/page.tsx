import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import homeBanner from "@/assets/home_banner.png";
import { S2SupplyStat } from "@/components/s2/S2SupplyStat";

const TREASURY_ADDRESS = "0x4D540f7D0Eb841c839334655C9f88313D750c6d5";

const callouts = [
  ["1,096", "Season 2 Droids issued before burns"],
  ["1:1", "Ascended S1 allocation"],
  ["70%", "Season 2 mint funds to treasury"],
  ["S1 + S2", "Secondary fees to treasury"],
  ["Swap", "Support fees to treasury"],
  ["Deflationary", "Permanent burns contract live supply"],
];

const overviewCards = [
  {
    title: "Season 1 Was The Key",
    copy: "Season 1 DYOOR NFTs are the foundation of the ecosystem. Ascended Season 1 holders receive a 1:1 D.Y.O.O.R Season 2 allocation.",
  },
  {
    title: "The Ascension Has Begun",
    copy: "Ascension Protocol lets Season 1 holders stake and ascend NFTs, generate Energy over time, and build eligibility for Season 2 participation.",
  },
  {
    title: "Droids Evolve",
    copy: "Season 2 introduces modular Droids with locked core traits and mutable traits designed for future upgrades, rerolls, marketplace systems, and seasonal activations.",
  },
  {
    title: "A Deflationary Dynamic Collection",
    copy: "Trait Lab lets eligible metadata evolve while permanent on-chain Droid burns contract the live collection from its 1,096 issued supply.",
  },
];

const energyUses = [
  "Trait Lab rerolls",
  "Unlocking eligible empty trait slots",
  "Recycling eligible wearable traits",
  "Permanent Droid burn rewards",
  "Dynamic metadata progression",
  "Seasonal trait mechanics",
];

const lockedTraits = ["Droid", "Background"];
const mutableTraits = ["Eyes", "Mouth", "Clothes", "Hat", "Accessories", "Accessories 2", "Stickers / Body Art"];

const blueprintBenefits = [
  "Architect Rank",
  "Ascension Blueprint metadata eligibility",
  "Future reward eligibility",
  "Blueprint verification eligibility",
  "Seasonal reward opportunities",
  "Permanent record of intended Droid design",
];

const treasurySources = [
  "70% of D.Y.O.O.R Season 2 mint proceeds",
  "Secondary market fees from Season 1",
  "Secondary market fees from Season 2",
  "DYOOR Swap support fees",
  "Future ecosystem products and services",
];

const treasuryPurposes = [
  "Future Monad ecosystem DeFi opportunities",
  "Yield-generating strategies",
  "Strategic ecosystem participation",
  "Liquidity opportunities",
  "Partnership initiatives",
  "Community reward campaigns",
  "Product development",
  "Marketplace development",
  "Long-term ecosystem sustainability",
];

const ecosystemInputs = [
  "Season 2 mint proceeds",
  "S1 secondary market fees",
  "S2 secondary market fees",
  "Swap support fees",
  "Trait marketplace activity",
  "Trait reroll mechanics",
  "Future ecosystem products",
  "Strategic Monad ecosystem participation",
];

const traitSystems = [
  "Energy-powered Trait Lab rerolls",
  "Unlocking eligible empty slots",
  "Recycling eligible traits for Energy",
  "Locked core Droid identity",
  "Versioned metadata and artwork refreshes",
  "Supply-aware limited traits",
  "Permanent Droid burns",
  "Burn transaction provenance",
];

const roadmap = [
  {
    phase: "Phase 1",
    title: "Origin And Ascension",
    items: ["Season 1 Mint", "Ascension Protocol", "Energy generation", "S1 holder rewards"],
  },
  {
    phase: "Phase 2",
    title: "Blueprints And Droids",
    items: ["Ascension Blueprints", "D.Y.O.O.R Season 2 Mint", "1:1 allocation for Ascended S1", "Droid reveal"],
  },
  {
    phase: "Phase 3",
    title: "Staking And Trait Systems",
    items: ["Season 2 staking", "Treasury activation", "Dynamic trait systems", "Trait rerolls", "Trait marketplace", "Energy utility expansion"],
  },
  {
    phase: "Phase 4",
    title: "Deflationary World Expansion",
    items: ["Live Droid burns", "dYOOR World holder community", "Owner announcements", "Energy flywheel growth", "Ecosystem partnerships", "Additional trait systems"],
  },
];

function Panel({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`glass-panel hover-lift p-5 md:p-6 ${className}`}>
      {children}
    </section>
  );
}

function SectionHeading({ eyebrow, title, copy }: { eyebrow?: string; title: string; copy?: string }) {
  return (
    <div className="mb-5">
      {eyebrow && <p className="text-xs font-black uppercase tracking-[0.22em] text-dyoor-cyan">{eyebrow}</p>}
      <h2 className="mt-2 text-3xl font-black uppercase leading-tight text-white md:text-5xl">{title}</h2>
      {copy && <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-white/68 md:text-base">{copy}</p>}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item} className="terminal-panel px-3 py-2 text-sm font-bold leading-6 text-white/70">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function WhitepaperPage() {
  return (
    <main className="page-shell">
      <section className="glass-panel-strong energy-grid relative overflow-hidden">
        <Image
          src={homeBanner}
          alt="DYOOR banner"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,6,13,.96),rgba(5,6,13,.80)_52%,rgba(5,6,13,.50)),radial-gradient(800px_460px_at_84%_20%,rgba(57,255,226,.18),transparent_60%)]" />
        <div className="relative z-10 grid gap-8 p-6 md:grid-cols-[1.1fr_0.9fr] md:p-8 lg:p-10">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-dyoor-cyan">Monad Season 2 Whitepaper</p>
            <h1 className="mt-4 max-w-4xl text-5xl font-black uppercase leading-none text-white md:text-7xl">
              D.Y.O.O.R
            </h1>
            <p className="mt-3 text-xl font-black uppercase tracking-tight text-white/88 md:text-2xl">
              Directive: Yield Opportunity Optimization Robots
            </p>
            <p className="mt-5 max-w-3xl text-base font-semibold leading-8 text-white/72 md:text-lg">
              D.Y.O.O.R is a deflationary dynamic NFT ecosystem built on Monad. Season 1 was the key. Season 2 connects
              Ascension, Energy, Blueprints, live trait evolution, and permanent Droid burns in one participation
              flywheel.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link className="btn-primary" href="/blueprint-checker">
                Check Blueprint
              </Link>
              <Link className="btn-secondary" href="/ascension">
                Open Ascension
              </Link>
              <Link className="btn-secondary" href="/#swap">
                Swap On Monad
              </Link>
            </div>
          </div>
          <div className="grid content-end gap-3">
            <div className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/[0.08] p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-cyan">Chain</div>
              <div className="mt-2 text-3xl font-black uppercase text-white">Monad</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {callouts.slice(0, 4).map(([value, label]) => (
                <div key={label} className="rounded border border-white/12 bg-black/35 p-4">
                  <div className="text-2xl font-black text-white">{value}</div>
                  <div className="mt-1 text-xs font-bold uppercase leading-5 text-white/56">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {callouts.map(([value, label]) => (
          <div key={label} className="glass-panel hover-lift p-4">
            <div className="text-2xl font-black text-dyoor-cyan">{value}</div>
            <div className="mt-2 text-xs font-black uppercase leading-5 text-white/60">{label}</div>
          </div>
        ))}
      </section>

      <div className="mt-8 grid gap-6">
        <Panel id="overview">
          <SectionHeading
            eyebrow="Overview"
            title="A Deflationary Dynamic NFT Ecosystem"
            copy="D.Y.O.O.R Season 2 is built around active participation: ascend S1, generate Energy, register Blueprints, evolve modular Droids, recycle eligible traits, and permanently contract supply through on-chain burns."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {overviewCards.map((card) => (
              <article key={card.title} className="terminal-panel hover-lift p-4">
                <h3 className="text-lg font-black uppercase text-white">{card.title}</h3>
                <p className="mt-3 text-sm font-semibold leading-6 text-white/66">{card.copy}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel id="season-one-season-two">
          <SectionHeading
            eyebrow="Season 1 To Season 2"
            title="Season 1 Was The Key"
            copy="Season 1 DYOOR NFTs are the foundation. Ascended Season 1 holders receive a 1:1 D.Y.O.O.R Season 2 allocation. For example, 20 Ascended Season 1 NFTs means 20 D.Y.O.O.R Season 2 allocations."
          />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded border border-dyoor-cyan/20 bg-dyoor-cyan/[0.07] p-4">
              <S2SupplyStat
                valueClassName="text-5xl"
                label="Live Season 2 Supply"
              />
              <p className="mt-3 text-sm font-semibold leading-6 text-white/62">
                The counter starts from 1,096 issued Droids and decreases with verified on-chain burns.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-black/25 p-4 md:col-span-2">
              <h3 className="text-xl font-black uppercase text-white">Ascension Protocol</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-white/68">
                Ascension Protocol allows Season 1 holders to stake and ascend their NFTs, generate Energy over time,
                and build eligibility for Season 2 and future ecosystem participation. The Ascension has begun.
              </p>
            </div>
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel id="energy">
            <SectionHeading
              eyebrow="Energy"
              title="Energy Powers The Flywheel"
              copy="Energy is the participation resource of the DYOOR ecosystem, not a publicly tradeable token. Ascension generates it, Trait Lab spends it, and recycling or burning can return it for use on the remaining collection."
            />
            <BulletList items={energyUses} />
          </Panel>

          <Panel id="droids">
            <SectionHeading
              eyebrow="Season 2 Droid System"
              title="Droids Evolve"
              copy="Core identity traits stay locked while eligible visual layers can evolve now through Energy-powered Trait Lab rerolls, unlocks, recycling, metadata versioning, and artwork refreshes."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Locked Traits</h3>
                <BulletList items={lockedTraits} />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Mutable Traits</h3>
                <BulletList items={mutableTraits} />
              </div>
            </div>
          </Panel>
        </div>

        <Panel id="blueprints" className="overflow-hidden">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <SectionHeading
                eyebrow="Ascension Blueprints"
                title="Register The Intended Droid"
                copy="Ascension Blueprints allow users to register their intended Droid build before Season 2. The first 500 wallets to save an Ascension Blueprint receive special ecosystem recognition and a permanent record of intended design."
              />
              <BulletList items={blueprintBenefits} />
            </div>
            <div className="relative min-h-[320px] overflow-hidden rounded border border-white/10 bg-black/40">
              <Image src="/assets/dyoor_builder.PNG" alt="D.Y.O.O.R Droid builder preview" fill sizes="(max-width: 1024px) 100vw, 420px" className="object-cover opacity-90" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(5,6,13,.76))]" />
              <div className="absolute bottom-0 p-5">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-cyan">Architect Rank</p>
                <p className="mt-2 text-sm font-bold leading-6 text-white/72">Blueprints are part of the long-term identity layer for D.Y.O.O.R.</p>
              </div>
            </div>
          </div>
        </Panel>

        <Panel id="dyoor-world" className="relative overflow-hidden border-dyoor-purple/35 bg-dyoor-purple/[0.06]">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-dyoor-cyan/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-dyoor-purple/20 blur-3xl" />
          <div className="relative">
            <div className="mb-5 inline-flex rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.16em] text-emerald-200">
              S2 holder gate active
            </div>
            <SectionHeading
              eyebrow="dYOOR World"
              title="The Holder-Exclusive Community Layer"
              copy="dYOOR World is the primary private community for active Season 2 holders. A read-only ownership check and wallet signature unlock persistent identity, live conversation, verified ecosystem feeds, and participation rewards without handing custody of a Droid to the site."
            />
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Identity", "Claim one .dYOOR name and use an owned Season 2 Droid as your World PFP."],
                  ["Community", "Join holder threads, reply, tag channels, share media, and earn capped Energy for meaningful messages."],
                  ["Verified Activity", "Follow confirmed sales, burns, direct MON tips, and non-custodial Trade Desk activity."],
                  ["Official Dispatches", "Read owner-wallet announcements and open official HTTPS links posted directly inside the World."],
                ].map(([title, copy]) => (
                  <article key={title} className="terminal-panel hover-lift p-4">
                    <h3 className="text-sm font-black uppercase tracking-[0.14em] text-dyoor-cyan">{title}</h3>
                    <p className="mt-3 text-sm font-semibold leading-6 text-white/64">{copy}</p>
                  </article>
                ))}
              </div>
              <aside className="rounded border border-dyoor-monad/30 bg-[linear-gradient(145deg,rgba(131,110,249,.15),rgba(5,6,13,.72))] p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-dyoor-monad">Community map</p>
                <div className="mt-4 grid gap-3">
                  <div className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/[0.08] p-4">
                    <p className="text-xs font-black uppercase text-dyoor-cyan">Primary home</p>
                    <p className="mt-2 text-lg font-black uppercase text-white">dYOOR World</p>
                    <p className="mt-2 text-xs font-bold leading-5 text-white/55">Exclusive, holder-gated conversation and ecosystem activity.</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/25 p-4">
                    <p className="text-xs font-black uppercase text-white/55">Public onboarding</p>
                    <p className="mt-2 text-lg font-black uppercase text-white">Discord + Telegram</p>
                    <p className="mt-2 text-xs font-bold leading-5 text-white/48">Welcome newcomers, answer entry questions, and guide future holders into the ecosystem.</p>
                  </div>
                </div>
                <p className="mt-4 text-xs font-bold leading-5 text-white/42">
                  Official public posts can be linked manually from the owner-only announcements stream.
                </p>
                <Link className="btn-primary mt-5 w-full justify-center" href="/dyoor-world">
                  Enter dYOOR World
                </Link>
              </aside>
            </div>
          </div>
        </Panel>

        <Panel id="treasury" className="border-dyoor-cyan/25 bg-dyoor-cyan/[0.055]">
          <SectionHeading
            eyebrow="Treasury & Ecosystem Growth"
            title="Treasury Growth Fuels Future Opportunities"
            copy="The D.Y.O.O.R Treasury is designed to support long-term ecosystem expansion and future opportunities across Monad. Funds go directly into the treasury wallet and may be used for strategic ecosystem participation, product development, marketplace systems, and reward campaigns."
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Treasury Funding Sources</h3>
              <BulletList items={treasurySources} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Treasury Purpose</h3>
              <BulletList items={treasuryPurposes} />
            </div>
          </div>
          <div className="mt-6 overflow-hidden rounded border border-white/12 bg-black/30 p-4">
            <div className="grid gap-3 text-center text-sm font-black uppercase leading-5 text-white/72 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] md:items-center">
              {["Mint / Secondary / Swap Activity", "D.Y.O.O.R Treasury", "Product Development", "Trait + Energy Systems", "Long-Term Ecosystem Growth"].map((step, index) => (
                <div key={step} className="contents">
                  <div className="rounded border border-white/12 bg-white/[0.05] p-3">{step}</div>
                  {index < 4 && <div className="text-dyoor-cyan md:px-1">↓</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 overflow-auto rounded border border-white/10 bg-black/35 p-4">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/48">Treasury Wallet</div>
            <code className="mt-2 block text-sm font-bold text-dyoor-cyan">{TREASURY_ADDRESS}</code>
          </div>
          <a
            className="mt-4 inline-flex rounded border border-white/20 px-4 py-3 text-sm font-black uppercase text-white/80"
            href={`https://monad.socialscan.io/address/${TREASURY_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View On MonadScan
          </a>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel id="staking">
            <SectionHeading
              eyebrow="D.Y.O.O.R Season 2 Staking"
              title="Staking Signals Active Participation"
              copy="Season 2 Droids are designed for a dedicated staking system that can establish participation status for utility, access, and future seasonal mechanics."
            />
            <p className="text-sm font-semibold leading-7 text-white/68">
              Staking mechanics remain separate from ownership and Trait Lab. Eligibility rules, lock behavior, and
              utility integrations will be published before activation.
            </p>
          </Panel>

          <Panel id="deflationary-supply">
            <SectionHeading
              eyebrow="Deflationary Supply"
              title="Burned Means Gone"
              copy="Season 2 issued 1,096 Droids. Every successful on-chain burn permanently removes one token from the live supply."
            />
            <p className="text-sm font-semibold leading-7 text-white/68">
              The collection contract reports live supply after burns, while the Trait Lab burn gallery preserves each
              claimed burn’s token and transaction provenance. Burning is irreversible: the remaining collection gets
              smaller as the Energy flywheel continues.
            </p>
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel id="ecosystem-inputs">
            <SectionHeading
              eyebrow="Ecosystem Inputs"
              title="Multiple Paths Support The System"
              copy="Primary mint activity, secondary markets, swap support, trait systems, future products, and strategic Monad participation can support continued ecosystem development."
            />
            <BulletList items={ecosystemInputs} />
          </Panel>

          <Panel id="dynamic-traits">
            <SectionHeading
              eyebrow="Dynamic Traits + Energy"
              title="NFTs That Evolve With Participation"
              copy="Trait Lab lets eligible D.Y.O.O.R metadata change through Energy-powered rerolls, unlocks, recycling, and supply-aware trait mechanics while core Droid identity remains locked."
            />
            <BulletList items={traitSystems} />
          </Panel>
        </div>

        <Panel id="roadmap">
          <SectionHeading
            eyebrow="Roadmap"
            title="From Ascension To A Living Collection"
            copy="The roadmap keeps the Season 1 foundation intact while expanding Season 2 staking, dynamic traits, the Energy flywheel, permanent burns, and future Monad ecosystem opportunities."
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {roadmap.map((phase) => (
              <article key={phase.phase} className="rounded border border-white/10 bg-black/25 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-cyan">{phase.phase}</p>
                <h3 className="mt-2 text-lg font-black uppercase text-white">{phase.title}</h3>
                <ul className="mt-4 grid gap-2">
                  {phase.items.map((item) => (
                    <li key={item} className="text-sm font-semibold leading-6 text-white/66">{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Panel>

        <Panel className="border-white/10 bg-black/35">
          <SectionHeading
            eyebrow="Living Mechanics"
            title="Built For Participation"
            copy="D.Y.O.O.R combines evolving metadata with permanent on-chain supply reduction. Each action is governed by explicit Trait Lab rules, Energy accounting, and verifiable burn transactions."
          />
          <div className="flex flex-wrap gap-3">
            <Link className="rounded border border-dyoor-cyan bg-dyoor-cyan px-4 py-3 text-sm font-black uppercase text-black" href="/blueprint-checker">
              Check Blueprint
            </Link>
            <Link className="rounded border border-white/20 px-4 py-3 text-sm font-black uppercase text-white/80" href="/verify">
              Verify Roles
            </Link>
            <Link className="rounded border border-dyoor-purple/45 bg-dyoor-purple/10 px-4 py-3 text-sm font-black uppercase text-dyoor-monad" href="/dyoor-world">
              Enter dYOOR World
            </Link>
          </div>
        </Panel>
      </div>
    </main>
  );
}
