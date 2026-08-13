import Image from "next/image";
import Link from "next/link";
import {
  HOODYOOR_CHAIN_ID,
  HOODYOOR_CONTRACTS,
  HOODYOOR_MAX_SUPPLY,
  HOODYOOR_MINT_ENERGY_REWARD,
  HOODYOOR_MINT_PRICE_ETH,
  HOODYOOR_PROVENANCE_HASH,
  HOODYOOR_ROYALTY_BPS,
  hoodyoorExplorerAddress,
  shortHoodYoorAddress,
} from "@/lib/hoodyoor-public";

const collectionArt = [
  { assignment: 1, image: "/assets/robinhood/collection/hoodyoor-assignment-0001.png" },
  { assignment: 420, image: "/assets/robinhood/collection/hoodyoor-assignment-0420.png" },
  { assignment: 777, image: "/assets/robinhood/collection/hoodyoor-assignment-0777.png" },
  { assignment: 1_337, image: "/assets/robinhood/collection/hoodyoor-assignment-1337.png" },
  { assignment: 2_054, image: "/assets/robinhood/collection/hoodyoor-assignment-2054.png" },
  { assignment: 3_333, image: "/assets/robinhood/collection/hoodyoor-assignment-3333.png" },
] as const;

const systemCards = [
  {
    eyebrow: "Identity",
    title: "Fully onchain art",
    body: "Nine packed layers, 201 committed traits, 329 frozen compatibility rules, 3,323 INDAHOOD backgrounds, and ten one-of-one Project M.A.D. backgrounds. Metadata and SVG art are assembled by the contracts.",
  },
  {
    eyebrow: "Evolution",
    title: "Trait rerolls remain live",
    body: "Activating a Droid Account does not move or modify the parent NFT. The existing Trait Lab still changes eligible layers through the frozen V2 controller with current-owner signatures, nonce protection, and expiry.",
  },
  {
    eyebrow: "Operating resource",
    title: "HoodYØØR Energy",
    body: `Paid mints credit ${HOODYOOR_MINT_ENERGY_REWARD.toLocaleString("en-US")} non-transferable Energy to the minter. Individual mutable layers cost 100–300 Energy; Reroll All costs 1,000. The Droid dashboard reads the existing bank instead of creating a second Energy system.`,
  },
  {
    eyebrow: "Custody",
    title: "A wallet for every Droid",
    body: "Each NFT has a deterministic, counterfactual Droid Account that can receive ETH, configured tokens, ERC-721s, and ERC-1155s. No Droid private key exists: current NFT ownership is the authority.",
  },
] as const;

function ContractCard({
  contract,
}: {
  contract: (typeof HOODYOOR_CONTRACTS)[number];
}) {
  return (
    <a
      href={hoodyoorExplorerAddress(contract.address)}
      target="_blank"
      rel="noreferrer"
      className="group rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:-translate-y-0.5 hover:border-[#c7ff00]/35 hover:bg-[#c7ff00]/[0.035]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-white/80">
          {contract.label}
        </p>
        <span className="text-[#c7ff00] transition group-hover:translate-x-0.5" aria-hidden="true">↗</span>
      </div>
      <p className="mt-2 font-mono text-[0.65rem] text-[#c7ff00]/65">
        {shortHoodYoorAddress(contract.address)}
      </p>
      <p className="mt-3 text-xs font-semibold leading-5 text-white/38">
        {contract.description}
      </p>
    </a>
  );
}

export function HoodYoorCollectionInfo() {
  return (
    <div className="relative z-10 border-t border-[#c7ff00]/10">
      <section id="collection" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20 sm:py-28">
        <div className="grid items-end gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-[#c7ff00]">
              The collection
            </p>
            <h2 className="mt-4 max-w-3xl text-4xl font-black uppercase leading-[0.92] tracking-[-0.06em] sm:text-6xl">
              Identity is the NFT.<br /><span className="text-[#c7ff00]">Inventory is the account.</span>
            </h2>
          </div>
          <p className="max-w-2xl text-sm font-semibold leading-7 text-white/48 sm:text-base sm:leading-8">
            HoodYØØR is a fixed collection of {HOODYOOR_MAX_SUPPLY.toLocaleString("en-US")} programmable pixel Droids on Robinhood Chain. Art, traits, compatibility, Energy, rerolls, and now each Droid&apos;s deterministic smart account are anchored to public contracts.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {collectionArt.map((art) => (
            <figure key={art.assignment} className="overflow-hidden rounded-2xl border border-white/10 bg-[#10160c]">
              <div className="relative aspect-square">
                <Image
                  src={art.image}
                  alt={`Exact HoodYØØR frozen assignment ${art.assignment} render`}
                  fill
                  sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover [image-rendering:pixelated]"
                />
              </div>
              <figcaption className="border-t border-white/10 px-3 py-2 text-[0.52rem] font-black uppercase tracking-[0.11em] text-white/38">
                Art sample {String(art.assignment).padStart(4, "0")}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-4 text-xs font-semibold leading-5 text-white/28">
          These are exact renders from the frozen assignment payload, not concept art. Final token-to-assignment mapping is established by the collection reveal.
        </p>
      </section>

      <section className="border-y border-[#c7ff00]/10 bg-[#0a0f08]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["3,333", "Fixed supply"],
            ["201", "Onchain traits"],
            ["9", "Render layers"],
            ["329", "Trait rules"],
            [`${HOODYOOR_ROYALTY_BPS / 100}%`, "Creator royalty"],
            [String(HOODYOOR_CHAIN_ID), "Robinhood chain ID"],
          ].map(([value, label], index) => (
            <div className={`px-3 py-6 sm:px-5 ${index % 2 ? "border-l border-white/[0.07]" : ""} sm:border-l sm:first:border-l-0`} key={label}>
              <p className="text-xl font-black uppercase text-white sm:text-2xl">{value}</p>
              <p className="mt-1 text-[0.52rem] font-black uppercase tracking-[0.14em] text-[#c7ff00]/50">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:py-28">
        <div className="grid gap-5 md:grid-cols-2">
          {systemCards.map((card) => (
            <article key={card.title} className="rounded-[1.5rem] border border-white/10 bg-[#0c110b] p-6 sm:p-8">
              <p className="text-[0.56rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/60">{card.eyebrow}</p>
              <h3 className="mt-3 text-2xl font-black uppercase tracking-[-0.04em]">{card.title}</h3>
              <p className="mt-4 text-sm font-semibold leading-7 text-white/42">{card.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-12 overflow-hidden rounded-[1.75rem] border border-[#c7ff00]/25 bg-[linear-gradient(135deg,rgba(199,255,0,.105),rgba(12,17,11,.96)_52%)] p-6 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#c7ff00]/25 bg-black/25 px-3 py-2 text-[0.57rem] font-black uppercase tracking-[0.17em] text-[#c7ff00]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#c7ff00] shadow-[0_0_10px_#c7ff00]" />
                Droid Account V1 · Mainnet online
              </p>
              <h3 className="mt-5 text-3xl font-black uppercase leading-[0.94] tracking-[-0.055em] sm:text-5xl">
                The Droid is the identity.<br /><span className="text-[#c7ff00]">The account is its body.</span>
              </h3>
              <p className="mt-5 max-w-xl text-sm font-semibold leading-7 text-white/48">
                Open any eligible HoodYØØR to see its address before activation, activate it lazily, fund it, inspect inventory, and execute owner-authorized sends. Activation does not alter the NFT or its reroll mechanics.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/robinhood/droids" className="rounded-xl bg-[#c7ff00] px-5 py-3 text-xs font-black uppercase tracking-[0.11em] text-black transition hover:brightness-105">
                  Open Droid OS
                </Link>
                <Link href="/robinhood/trait-lab" className="rounded-xl border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.11em] text-white/65 transition hover:border-[#c7ff00]/45 hover:text-[#c7ff00]">
                  Open Trait Lab
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["01", "Deterministic", "The address exists counterfactually before code is deployed."],
                ["02", "NFT-controlled", "Current parent-NFT ownership is checked at execution time."],
                ["03", "Owner rescue", "The current owner can send otherwise-unlocked account assets out."],
                ["04", "Agent authority: zero", "V1 ships no session key, AI executor, or admin withdrawal path."],
              ].map(([step, title, body]) => (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4" key={step}>
                  <p className="font-mono text-xs font-black text-[#c7ff00]/55">{step}</p>
                  <p className="mt-3 text-sm font-black uppercase text-white/80">{title}</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/35">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div id="economic-droids" className="mt-8 scroll-mt-24 overflow-hidden rounded-[1.75rem] border border-sky-300/20 bg-[linear-gradient(145deg,rgba(125,211,252,.08),rgba(12,17,11,.97)_58%)] p-6 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-black/25 px-3 py-2 text-[0.57rem] font-black uppercase tracking-[0.17em] text-sky-100/75">
                Economic Droid upgrade · staged, not live
              </p>
              <h3 className="mt-5 text-3xl font-black uppercase leading-[0.94] tracking-[-0.055em] sm:text-5xl">
                Activity builds identity.<br /><span className="text-sky-200">Funded rewards build inventory.</span>
              </h3>
            </div>
            <p className="max-w-2xl text-sm font-semibold leading-7 text-white/45">
              The economic foundation keeps progression and money separate. Energy powers rerolls, crafting, unlocks, and achievements. Real assets can enter a Droid only from explicit deposits or reviewed, funded reward epochs—and a claim pays the Droid Account, not the commander wallet.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["01", "Energy ≠ money", "Energy keeps its existing utility and has no token price or dollar conversion."],
              ["02", "Explicit revenue", "Approved sources can fund separate treasury and Droid reward accounting."],
              ["03", "Claim to Droid", "A current owner can claim a published allocation only into the active Droid Account."],
              ["04", "Future strategy", "A preference can affect future rewards without selling or moving existing inventory."],
            ].map(([step, title, body]) => (
              <article className="rounded-2xl border border-white/10 bg-black/25 p-4" key={step}>
                <p className="font-mono text-xs font-black text-sky-200/55">{step}</p>
                <p className="mt-3 text-sm font-black uppercase text-white/80">{title}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/35">{body}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-4 border-t border-white/[0.07] pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl text-xs font-semibold leading-6 text-white/32">
              Rewards are never guaranteed by NFT ownership. Economic contracts, cross-chain treasury aggregation, and strategies remain disabled pending deployment review. Automatic bridging and Droid agents are not enabled.
            </p>
            <Link href="/droids" className="shrink-0 rounded-xl border border-sky-200/25 px-5 py-3 text-center text-xs font-black uppercase tracking-[0.11em] text-sky-100/75 transition hover:border-sky-200/55 hover:text-sky-100">
              View Droid network
            </Link>
          </div>
        </div>

        <div className="mt-8 rounded-[1.5rem] border border-amber-300/30 bg-amber-300/[0.065] p-5 sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-amber-200">Asset-bearing NFT warning</p>
          <p className="mt-3 max-w-5xl text-sm font-semibold leading-7 text-amber-50/65">
            Transferring or selling a HoodYØØR transfers control of its Droid Account to the new NFT owner immediately. ETH, tokens, NFTs, and equipment inside are not automatically returned to the seller, and outside marketplaces may not show or value those assets. Withdraw anything you do not intend to transfer first.
          </p>
        </div>
      </section>

      <section id="contracts" className="border-t border-[#c7ff00]/10 bg-[#0a0f08] scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:py-28">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-[#c7ff00]">Live protocol</p>
              <h2 className="mt-4 text-4xl font-black uppercase tracking-[-0.055em] sm:text-5xl">Verify every layer.</h2>
            </div>
            <div>
              <p className="text-sm font-semibold leading-7 text-white/42">
                These are the production HoodYØØR contracts on Robinhood Chain. The Droid contracts are immutable and publicly source-verified. The collection&apos;s renderer, initial traits, Energy configuration, and reroll-controller selection are frozen.
              </p>
              <p className="mt-3 font-mono text-[0.62rem] leading-5 text-white/25 break-all">
                Art provenance: {HOODYOOR_PROVENANCE_HASH}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HOODYOOR_CONTRACTS.map((contract) => <ContractCard contract={contract} key={contract.address} />)}
          </div>

          <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-5 text-xs font-semibold leading-6 text-white/35 sm:flex-row sm:items-center sm:justify-between">
            <p>Configured mint price: {HOODYOOR_MINT_PRICE_ETH} ETH. Sale availability is controlled and announced separately; this page does not imply an active mint.</p>
            <p className="shrink-0 text-white/25">V1 is tested and fork-simulated, but not represented as independently audited.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
