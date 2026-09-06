import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import homeBanner from "@/assets/home_banner.png";
import { S2SupplyStat } from "@/components/s2/S2SupplyStat";
import {
  DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS,
  DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP,
  DYOOR_WORLD_CHAT_REWARD_ENERGY,
  DYOOR_WORLD_DAILY_REWARD_TABLE,
  DYOOR_WORLD_TIP_REWARD_DAILY_CAP,
  DYOOR_WORLD_TIP_REWARD_ENERGY,
  DYOOR_WORLD_TIP_REWARD_MIN_MON,
  DYOOR_WORLD_TRADE_REWARD_DAILY_CAP,
  DYOOR_WORLD_TRADE_REWARD_ENERGY,
} from "@/lib/dyoor-world-rewards";
import {
  S2_TRAIT_LAB_COSTS,
  S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY,
  S2_TRAIT_LAB_FLAT_UNLOCK_COST,
  S2_TRAIT_LAB_RECYCLE_REWARDS,
  S2_TRAIT_LAB_REROLL_ALL_COST,
} from "@/lib/s2-trait-lab-config";
import { S2_POST_BURN_SUPPLY_CAP } from "@/lib/s2-supply";

const TREASURY_ADDRESS = "0x4D540f7D0Eb841c839334655C9f88313D750c6d5";
const S1_ENERGY_PER_DAY = 24;
const INITIAL_S2_SUPPLY = 1_096;
const INITIAL_TRAIT_BOUNTY_ENERGY = 25_000;
const WORLD_WHEEL_MIN = DYOOR_WORLD_DAILY_REWARD_TABLE[0].energy;
const WORLD_WHEEL_MAX = DYOOR_WORLD_DAILY_REWARD_TABLE.at(-1)?.energy || 1_000;
const WORLD_CHAT_COOLDOWN_MINUTES = DYOOR_WORLD_CHAT_REWARD_COOLDOWN_MS / 60_000;
const worldWheelOdds = DYOOR_WORLD_DAILY_REWARD_TABLE.map((entry, index) => {
  const previousUpperBound = index === 0 ? 0 : DYOOR_WORLD_DAILY_REWARD_TABLE[index - 1].upperBound;
  return `${entry.energy.toLocaleString("en-US")} Energy: ${entry.upperBound - previousUpperBound}%`;
}).join(" · ");

const callouts = [
  [INITIAL_S2_SUPPLY.toLocaleString("en-US"), "Season 2 Droids issued before burns"],
  [S2_POST_BURN_SUPPLY_CAP.toLocaleString("en-US"), "Target final live supply"],
  [String(S1_ENERGY_PER_DAY), "Energy per Ascended S1 each day"],
  [`${WORLD_WHEEL_MIN}–${WORLD_WHEEL_MAX.toLocaleString("en-US")}`, "Daily World wheel range"],
  ["Gasless", "Trait Lab Energy settlement"],
  ["Holder-gated", "dYOOR World access"],
];

const flywheelSteps = [
  ["01", "Ascend S1", "Generate pending Energy through Ascension."],
  ["02", "Harvest", "Credit verified Energy into the spendable Energy Bank."],
  ["03", "Evolve S2", "Use Energy for compatible Trait Lab reveals and unlocks."],
  ["04", "Recycle Or Burn", "Return Energy through trait recycling or an irreversible Droid burn."],
  ["05", "Participate", "Earn capped rewards from verified activity inside dYOOR World."],
  ["06", "Reinvest", "Use the returned Energy on the remaining live collection."],
];

const lockedTraits = ["Droid", "Background"];
const mutableTraits = ["Eyes", "Mouth", "Clothes", "Hat", "Accessories", "Accessories 2", "Stickers / Body Art"];

const energyEarningPaths = [
  {
    title: "Ascend Season 1",
    value: `${S1_ENERGY_PER_DAY} Energy / NFT / day`,
    copy: "Energy accrues as pending Energy and becomes spendable after a confirmed harvest credits the Energy Bank.",
  },
  {
    title: "Recycle A Standard Trait",
    value: `${S2_TRAIT_LAB_RECYCLE_REWARDS.Hat} Energy`,
    copy: "Eligible Clothes, Hat, Accessories, Accessories 2, or Stickers/Body Art return the slot to None.",
  },
  {
    title: "Recycle A Special Trait",
    value: `${S2_TRAIT_LAB_RECYCLE_REWARDS.Special} Energy`,
    copy: "An eligible existing Special trait can return a larger recycling reward where its compatibility rules allow removal.",
  },
  {
    title: "Burn A Season 2 Droid",
    value: `${S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY.toLocaleString("en-US")} Energy`,
    copy: "The reward is credited only after the permanent on-chain NFT burn is verified.",
  },
  {
    title: "Daily World Wheel",
    value: `${WORLD_WHEEL_MIN}–${WORLD_WHEEL_MAX.toLocaleString("en-US")} Energy`,
    copy: `One verified spin per UTC day. Current odds: ${worldWheelOdds}.`,
  },
  {
    title: "Meaningful World Messages",
    value: `${DYOOR_WORLD_CHAT_REWARD_ENERGY} Energy / qualifying message`,
    copy: `${WORLD_CHAT_COOLDOWN_MINUTES}-minute reward cooldown with a ${DYOOR_WORLD_CHAT_REWARD_DAILY_ENERGY_CAP} Energy daily cap.`,
  },
  {
    title: "Verified Holder Tips",
    value: `${DYOOR_WORLD_TIP_REWARD_ENERGY} Energy`,
    copy: `Awarded to the sender for a direct tip of at least ${DYOOR_WORLD_TIP_REWARD_MIN_MON} MON, up to ${DYOOR_WORLD_TIP_REWARD_DAILY_CAP} rewarded tips per UTC day.`,
  },
  {
    title: "Completed World Trades",
    value: `${DYOOR_WORLD_TRADE_REWARD_ENERGY} Energy / participant`,
    copy: `Both parties can earn the reward after a verified completed escrow trade, up to ${DYOOR_WORLD_TRADE_REWARD_DAILY_CAP} rewarded trade per wallet each UTC day.`,
  },
  {
    title: "Trait Bounty Campaigns",
    value: "Campaign-specific",
    copy: `The initial BOB Mask discovery campaign funded a ${INITIAL_TRAIT_BOUNTY_ENERGY.toLocaleString("en-US")} Energy first-reveal bounty. Live Trait Lab terms control eligibility.`,
  },
];

const rerollCosts = [
  ["Eyes / Mouth", `${S2_TRAIT_LAB_COSTS.reroll.Eyes} Energy`],
  ["Hat / Clothes", `${S2_TRAIT_LAB_COSTS.reroll.Hat} Energy`],
  ["Accessories / Accessories 2 / Stickers", `${S2_TRAIT_LAB_COSTS.reroll.Accessories} Energy`],
  ["Eligible empty-slot unlock", `${S2_TRAIT_LAB_FLAT_UNLOCK_COST} Energy`],
  ["Reroll All filled mutable traits", `${S2_TRAIT_LAB_REROLL_ALL_COST.toLocaleString("en-US")} Energy`],
];

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

const roadmap = [
  {
    phase: "Phase 1",
    title: "Origin And Ascension",
    items: ["Season 1 Mint", "Ascension Protocol", "Energy generation", "S1 holder rewards"],
  },
  {
    phase: "Phase 2",
    title: "Blueprints And Droids",
    items: ["Ascension Blueprints", "D.Y.O.O.R Season 2 Mint", "Ascended S1 allocation", "Droid reveal"],
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
              <Link className="btn-primary" href="/reroll">
                Enter Trait Lab
              </Link>
              <Link className="btn-secondary" href="/ascension">
                Open Ascension
              </Link>
            </div>
          </div>
          <div className="grid content-end gap-3">
            <div className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/[0.08] p-4">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-cyan">Chain</div>
              <div className="mt-2 text-3xl font-black uppercase text-white">Monad</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {callouts.map(([value, label]) => (
                <div key={label} className="rounded border border-white/12 bg-black/35 p-4">
                  <div className="text-2xl font-black text-white">{value}</div>
                  <div className="mt-1 text-xs font-bold uppercase leading-5 text-white/56">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-6">
        <Panel id="season-one-season-two">
          <SectionHeading
            eyebrow="Season 1 To Season 2"
            title="Season 1 Was The Key"
            copy="Season 1 established the collection and provided the historical bridge into Season 2. Its continuing role is Ascension: each ascended S1 NFT currently generates 24 Energy per day for the holder to harvest and use."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-cyan">Historical Bridge</p>
              <h3 className="mt-2 text-xl font-black uppercase text-white">The Ascended Allocation</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-white/68">
                Ascended Season 1 holders originally received a 1:1 D.Y.O.O.R Season 2 allocation, connecting the
                collection’s origin directly to the Droid generation.
              </p>
            </div>
            <div className="rounded border border-dyoor-cyan/20 bg-dyoor-cyan/[0.07] p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-cyan">Continuing Utility</p>
              <h3 className="mt-2 text-xl font-black uppercase text-white">Ascension Energy</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-white/68">
                Energy accrues as pending Energy while an S1 NFT remains ascended. A confirmed harvest moves it into
                the holder’s spendable Energy Bank balance.
              </p>
            </div>
          </div>
        </Panel>

        <Panel id="energy" className="overflow-hidden border-dyoor-cyan/25 bg-dyoor-cyan/[0.04]">
          <SectionHeading
            eyebrow="Energy Flywheel"
            title="Participation Becomes Progression"
            copy="Energy is the internal participation resource of D.Y.O.O.R, not a publicly tradeable token. Ascension creates it, verified ecosystem actions can return it, and Trait Lab converts it into dynamic Season 2 progression."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flywheelSteps.map(([step, title, copy]) => (
              <article key={step} className="relative rounded border border-white/10 bg-black/30 p-4">
                <p className="text-xs font-black tracking-[0.2em] text-dyoor-cyan">{step}</p>
                <h3 className="mt-2 text-lg font-black uppercase text-white">{title}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-white/60">{copy}</p>
              </article>
            ))}
          </div>
          <div className="mt-7">
            <h3 className="text-xl font-black uppercase text-white">Current Ways To Earn Energy</h3>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-white/55">
              Reward caps and verification rules make each path explicit. World rewards accumulate as pending Energy
              until the holder claims them into the Energy Bank.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {energyEarningPaths.map((path) => (
                <article key={path.title} className="terminal-panel hover-lift p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-dyoor-cyan">{path.title}</p>
                  <p className="mt-2 text-xl font-black text-white">{path.value}</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/52">{path.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </Panel>

        <Panel id="dynamic-traits" className="overflow-hidden">
          <SectionHeading
            eyebrow="Dynamic Traits + Rerolls"
            title="One Reveal. One Decision."
            copy="Trait Lab generates one approved, compatibility-checked result at a time. Energy is spent to reveal it; the holder may accept the update, leave the current metadata unchanged, or roll again and permanently close the previous result."
          />
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div>
                <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Locked Identity</h3>
                <BulletList items={lockedTraits} />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Mutable Layers</h3>
                <BulletList items={mutableTraits} />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-black uppercase tracking-[0.18em] text-dyoor-cyan">Current Energy Costs</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {rerollCosts.map(([action, cost]) => (
                  <div key={action} className="rounded border border-white/10 bg-black/25 p-3">
                    <p className="text-xs font-bold leading-5 text-white/48">{action}</p>
                    <p className="mt-1 text-lg font-black text-white">{cost}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded border border-dyoor-purple/30 bg-dyoor-purple/[0.08] p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-dyoor-monad">Settlement Model</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
                  Rerolls and unlocks use gasless wallet signatures rather than MON transactions. Accepting a result
                  writes versioned metadata and refreshed artwork. Recycling clears an eligible optional layer and
                  returns Energy; only a full Droid burn destroys the NFT on-chain.
                </p>
              </div>
            </div>
          </div>
        </Panel>

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
              S1 + Ascended + S2 gates active
            </div>
            <SectionHeading
              eyebrow="dYOOR World"
              title="Holder-Exclusive Community Layer"
              copy="dYOOR World is the primary private community for active Season 1, Ascended, and Season 2 holders. It anchors access to verified ownership while Discord and Telegram remain public onboarding channels for newcomers."
            />
            <div className="mb-5 rounded border border-dyoor-monad/25 bg-dyoor-monad/[0.07] p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-dyoor-monad">Why The Community Model Changed</p>
              <p className="mt-3 text-sm font-semibold leading-7 text-white/64">
                General-purpose public servers separate conversation from asset ownership and create familiar attack
                surfaces: impersonated staff, fake support accounts, malicious links, unsolicited DMs, bot spam, and
                unverifiable holder roles. dYOOR World narrows that surface with live multi-chain ownership gates,
                wallet signatures, collection-specific chats, owner-wallet announcements, and activity relays tied
                to confirmed public events.
              </p>
            </div>
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Persistent Identity", "Claim one .dYOOR name and use an owned Season 2 Droid as a recognizable World PFP."],
                  ["Holder Conversation", "Use focused threads, replies, channel tags, direct messages, and approved media sharing."],
                  ["Verified Exchange", "Send direct wallet-to-wallet MON tips and coordinate S2 swaps through smart-contract escrow."],
                  ["Official Signals", "Follow confirmed sales and burns, plus announcements restricted to the designated owner wallet."],
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
            <p className="mt-5 rounded border border-white/10 bg-black/25 p-4 text-xs font-semibold leading-6 text-white/46">
              Token gating reduces common impersonation and role-verification problems; it does not make every user or
              link automatically trustworthy. Wallet connection is non-custodial, World bots only relay verified
              activity, and holders should still inspect every signature and transaction before approval.
            </p>
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
              copy={`Season 2 issued ${INITIAL_S2_SUPPLY.toLocaleString("en-US")} Droids and targets a final live supply of ${S2_POST_BURN_SUPPLY_CAP.toLocaleString("en-US")}. Every successful on-chain burn moves the collection one step toward that cap.`}
            />
            <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr] sm:items-start">
              <div className="rounded border border-dyoor-cyan/20 bg-dyoor-cyan/[0.07] p-4">
                <S2SupplyStat valueClassName="text-5xl" label="Live Season 2 Supply" />
              </div>
              <p className="text-sm font-semibold leading-7 text-white/68">
                The collection contract reports live supply directly. The Trait Lab burn gallery preserves each
                claimed burn’s token and transaction provenance, but the NFT itself is irrecoverable after
                confirmation.
              </p>
            </div>
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
            eyebrow="Live Interfaces"
            title="Enter The System"
            copy="Live interfaces display current balances, active reward parameters, campaign availability, and wallet-specific eligibility."
          />
          <div className="flex flex-wrap gap-3">
            <Link className="rounded border border-white/20 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase text-white/75" href="/ascension">
              Open Ascension
            </Link>
            <Link className="rounded border border-dyoor-cyan bg-dyoor-cyan px-4 py-3 text-sm font-black uppercase text-black" href="/reroll">
              Open Trait Lab
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
