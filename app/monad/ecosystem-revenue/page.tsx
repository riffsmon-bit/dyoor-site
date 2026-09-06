import Link from "next/link";
import { EcosystemRevenueDashboard } from "@/components/droids/EcosystemRevenueDashboard";

export const dynamic = "force-dynamic";

export default function MonadEcosystemRevenuePage() {
  return (
    <main className="dyoor-site-droid-theme min-h-screen bg-[#03030a] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7">
          <Link href="/monad/droids" className="text-[0.6rem] font-black uppercase tracking-[0.17em] text-[#c7ff00]/60">← Monad Droid Squad</Link>
          <p className="mt-4 text-xs font-semibold text-white/35">Read-only accounting preview · no claims · no distributions · no fund movement</p>
        </div>
        <EcosystemRevenueDashboard chainId={143} />
      </div>
    </main>
  );
}
