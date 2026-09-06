"use client";

import { FormEvent, useState } from "react";
import {
  MONAD_DROID_TRADING_DEFAULT_INPUT,
  MONAD_KURU_MON_USDC_MARKET_ADDRESS,
  MONAD_KURU_ROUTER_ADDRESS,
  MONAD_USDC_ADDRESS,
} from "@/lib/droid-trading/constants";

type TradingQuote = {
  ok: true;
  mode: "SIMULATION_ONLY";
  blockNumber: number;
  owner: string;
  droidAccount: string;
  amountInMon: string;
  expectedAmountOut: string;
  minimumAmountOut: string;
  slippageBps: number;
  deadline: number;
  routeGasEstimate: string;
  routeGasEstimateScope: "DIRECT_ROUTER_LEG_ONLY";
  calldataTarget: string | null;
  calldataTargetStatus: "CONFIGURED" | "UNDEPLOYED";
  expectedBalanceAfterWei: string;
  tokenOutBalanceBefore: string;
  tokenOutBalanceAfter: string;
  ownerTradingEnabled: boolean;
  autonomousTradingEnabled: false;
  broadcastEnabled: false;
};

function usdc(value: string) {
  const amount = BigInt(value || "0");
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function mon(value: string) {
  const amount = BigInt(value || "0");
  const whole = amount / 1_000_000_000_000_000_000n;
  const fraction = (amount % 1_000_000_000_000_000_000n)
    .toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function Row({ label, value, monoValue = false }: {
  label: string;
  value: string;
  monoValue?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/[0.07] py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
      <span className="text-[0.6rem] font-black uppercase tracking-[0.13em] text-white/35">{label}</span>
      <span className={`max-w-full break-all text-sm font-bold text-white/75 sm:text-right ${monoValue ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

export function DroidTradingPanel({
  tokenId,
  owner,
  droidAccount,
  nativeBalance,
  active,
}: {
  tokenId: number;
  owner: string;
  droidAccount: string;
  nativeBalance: string;
  active: boolean;
}) {
  const [amount, setAmount] = useState(MONAD_DROID_TRADING_DEFAULT_INPUT);
  const [slippage, setSlippage] = useState("1.00");
  const [quote, setQuote] = useState<TradingQuote | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function simulate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      const slippageBps = Math.round(Number(slippage) * 100);
      const response = await fetch(
        `/api/droid-trading/quote?tokenId=${tokenId}&amount=${encodeURIComponent(amount)}&slippageBps=${slippageBps}`,
        { cache: "no-store" },
      );
      const value = await response.json().catch(() => null) as TradingQuote | { error?: string } | null;
      if (!response.ok || !value || !("ok" in value) || value.ok !== true) {
        throw new Error(value && "error" in value ? value.error : "Trading simulation unavailable.");
      }
      if (value.owner.toLowerCase() !== owner.toLowerCase()
        || value.droidAccount.toLowerCase() !== droidAccount.toLowerCase()) {
        throw new Error("The live quote no longer matches this Droid. Refresh before trying again.");
      }
      setQuote(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Trading simulation unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="trading" className="scroll-mt-24 rounded-[1.5rem] border border-white/10 bg-[#0c110b]/95 p-5 shadow-[0_22px_70px_rgba(0,0,0,.28)] sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-[#c7ff00]/65">Permission boundary</p>
          <h2 className="mt-2 text-xl font-black uppercase tracking-[-0.035em] text-white sm:text-2xl">Owner-directed trading</h2>
        </div>
        <span className="self-start rounded-full border border-amber-200/25 bg-amber-200/[0.07] px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.12em] text-amber-100">Simulation only</span>
      </div>
      <p className="mt-4 text-sm font-semibold leading-6 text-white/45">
        The current NFT owner may eventually direct an approved trade while acquired assets stay inside the Droid Wallet. Autonomous trading remains off.
      </p>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <Row label="Droid" value={`D.Y.O.O.R #${tokenId}`} />
        <Row label="Current owner" value={owner} monoValue />
        <Row label="Droid Wallet" value={droidAccount} monoValue />
        <Row label="Available MON" value={`${mon(nativeBalance)} MON`} />
        <Row label="Preview route" value="MON → USDC" />
        <Row label="Venue" value="Kuru · official one-hop market" />
        <Row label="ERC-20 approval" value="None — native MON input" />
      </div>

      <form onSubmit={simulate} className="mt-5 rounded-2xl border border-[#c7ff00]/20 bg-[#c7ff00]/[0.04] p-4">
        <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-xl border border-white/10 bg-black/35 p-3"><p className="text-[0.52rem] font-black uppercase tracking-[0.12em] text-white/30">From</p><p className="mt-1 font-black text-white">MON</p></div>
          <span className="text-dyoor-cyan" aria-hidden="true">→</span>
          <div className="rounded-xl border border-white/10 bg-black/35 p-3"><p className="text-[0.52rem] font-black uppercase tracking-[0.12em] text-white/30">To</p><p className="mt-1 font-black text-white">USDC</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[0.6rem] font-black uppercase tracking-[0.12em] text-white/45">
            MON sold · max 0.001
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-sm normal-case tracking-normal text-white outline-none focus:border-[#c7ff00]/50" />
          </label>
          <label className="text-[0.6rem] font-black uppercase tracking-[0.12em] text-white/45">
            Slippage · max 1%
            <input value={slippage} onChange={(event) => setSlippage(event.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-sm normal-case tracking-normal text-white outline-none focus:border-[#c7ff00]/50" />
          </label>
        </div>
        <button disabled={busy || !active} className="mt-4 w-full rounded-xl border border-[#c7ff00]/35 bg-[#c7ff00]/10 px-4 py-3 text-xs font-black uppercase tracking-[0.13em] text-[#c7ff00] disabled:opacity-40">
          {busy ? "Simulating approved route…" : active ? "Simulate micro-trade" : "Activate Droid before simulation"}
        </button>
        <p className="mt-3 text-xs font-semibold leading-5 text-white/30">This button performs a read-only `eth_call`. It cannot sign or submit a trade.</p>
      </form>

      {error ? <p className="mt-4 rounded-xl border border-red-300/25 bg-red-300/[0.07] p-3 text-sm font-bold text-red-100" role="alert">{error}</p> : null}
      {quote ? (
        <div className="mt-5 rounded-2xl border border-sky-200/20 bg-sky-200/[0.04] p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-100">Read-only quote · block {quote.blockNumber}</p>
          <Row label="Asset sold" value={`${quote.amountInMon} MON`} />
          <Row label="Expected output" value={`${usdc(quote.expectedAmountOut)} USDC`} />
          <Row label="Minimum output" value={`${usdc(quote.minimumAmountOut)} USDC`} />
          <Row label="Slippage" value={`${(quote.slippageBps / 100).toFixed(2)}%`} />
          <Row label="Deadline" value={new Date(quote.deadline * 1_000).toLocaleTimeString()} />
          <Row label="Routing-leg gas" value={`${BigInt(quote.routeGasEstimate).toLocaleString()} gas`} />
          <Row label="Router" value={MONAD_KURU_ROUTER_ADDRESS} monoValue />
          <Row label="Market" value={MONAD_KURU_MON_USDC_MARKET_ADDRESS} monoValue />
          <Row label="Output token" value={MONAD_USDC_ADDRESS} monoValue />
          <Row label="Guard calldata target" value={quote.calldataTarget || "UNDEPLOYED"} monoValue={Boolean(quote.calldataTarget)} />
          <Row label="MON before" value={`${mon(nativeBalance)} MON`} />
          <Row label="Simulated MON after" value={`${mon(quote.expectedBalanceAfterWei)} MON before owner transaction gas`} />
          <Row label="USDC before" value={`${usdc(quote.tokenOutBalanceBefore)} USDC`} />
          <Row label="Simulated USDC after" value={`${usdc(quote.tokenOutBalanceAfter)} USDC`} />
          <p className="mt-3 text-xs font-semibold leading-5 text-white/35">Gas shown is the direct Kuru routing leg, not a final transaction estimate. The reviewed guard must be deployed and separately authorized before any owner trade can be built.</p>
        </div>
      ) : null}

      <button type="button" disabled aria-disabled="true" className="mt-5 min-h-12 w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase tracking-[0.13em] text-white/35">
        Execute trade — disabled
      </button>
      <p className="mt-2 text-center text-xs font-semibold leading-5 text-amber-100/60">Live Droid trading is not enabled yet.</p>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="text-[0.58rem] font-black uppercase tracking-[0.15em] text-white/45">When owner-directed trading is eventually enabled</p>
        <ol className="mt-3 space-y-2 text-xs font-semibold leading-5 text-white/40">
          <li>1. You authorize the trade.</li>
          <li>2. The Droid Wallet executes it through an approved route.</li>
          <li>3. The purchased asset stays inside the Droid Wallet.</li>
          <li>4. The Droid portfolio updates.</li>
          <li>5. Current NFT ownership continues determining control.</li>
        </ol>
      </div>

      <div className="mt-5 grid gap-2 text-[0.6rem] font-black uppercase tracking-[0.11em] text-white/30 sm:grid-cols-3">
        <span>Owner trading: off / simulation only</span>
        <span>Autonomous trading: off</span>
        <span>Broadcast: disabled</span>
      </div>
    </section>
  );
}
