import { SwapCard } from "@/components/swap/SwapCard";

export default function SwapPage() {
  return (
    <main className="page-enter mx-auto max-w-7xl px-5 py-10 md:py-14">
      <section className="mb-7 max-w-3xl">
        <p className="eyebrow">DYOOR Swap</p>
        <h1 className="heading-gradient mt-3 text-4xl sm:text-5xl md:text-6xl">Swap On Monad</h1>
        <p className="mt-4 text-sm font-semibold leading-6 text-white/64 md:text-base">
          Search, quote, and prepare Monad token swaps with the same mobile-safe selector used across the site.
        </p>
      </section>
      <SwapCard />
    </main>
  );
}
