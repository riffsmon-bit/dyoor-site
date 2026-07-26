"use client";

import { useEffect, useState } from "react";
import {
  S2_ISSUED_SUPPLY_FALLBACK,
  type S2SupplySnapshot,
  type S2SupplySource,
} from "@/lib/s2-supply";

type SupplyResponse = S2SupplySnapshot & {
  ok?: boolean;
  updatedAt?: string;
};

type S2SupplyStatProps = {
  className?: string;
  valueClassName?: string;
  label?: string;
};

const initialSnapshot: SupplyResponse = {
  issuedSupply: S2_ISSUED_SUPPLY_FALLBACK,
  currentSupply: S2_ISSUED_SUPPLY_FALLBACK,
  burnedSupply: 0,
  source: "fallback",
};

function isSupplySource(value: unknown): value is S2SupplySource {
  return value === "chain" || value === "burn-records" || value === "fallback";
}

function validSupplyResponse(value: unknown): value is SupplyResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate.issuedSupply)
    && Number(candidate.issuedSupply) >= 0
    && Number.isSafeInteger(candidate.currentSupply)
    && Number(candidate.currentSupply) >= 0
    && Number.isSafeInteger(candidate.burnedSupply)
    && Number(candidate.burnedSupply) >= 0
    && Number(candidate.currentSupply) + Number(candidate.burnedSupply) === Number(candidate.issuedSupply)
    && isSupplySource(candidate.source)
  );
}

function formatSupply(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function S2SupplyStat({
  className = "",
  valueClassName = "text-3xl",
  label = "Live Season 2 Droid Supply",
}: S2SupplyStatProps) {
  const [snapshot, setSnapshot] = useState<SupplyResponse>(initialSnapshot);
  const [hasRefreshed, setHasRefreshed] = useState(false);

  useEffect(() => {
    let active = true;
    let inFlight = false;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/s2/supply", { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok || !validSupplyResponse(payload)) throw new Error("Invalid S2 supply response.");
        if (active) setSnapshot(payload);
      } catch {
        // Keep the last verified value or the explicit 1,096 fallback.
      } finally {
        if (active) setHasRefreshed(true);
        inFlight = false;
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const isVerified = snapshot.source === "chain";
  const detail = hasRefreshed
    ? `${formatSupply(snapshot.issuedSupply)} issued · ${formatSupply(snapshot.burnedSupply)} burned`
    : `${formatSupply(snapshot.issuedSupply)} issued · syncing burns`;

  return (
    <div className={className} aria-live="polite">
      <div className={`${valueClassName} font-black text-dyoor-cyan drop-shadow-[0_0_14px_rgba(57,255,226,.25)]`}>
        {formatSupply(snapshot.currentSupply)}
      </div>
      <div className="mt-2 text-xs font-black uppercase leading-5 text-white/58">{label}</div>
      <div className="mt-2 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-white/42">
        <span
          className={`h-1.5 w-1.5 rounded-full ${isVerified ? "bg-dyoor-cyan shadow-[0_0_8px_rgba(57,255,226,.7)]" : "animate-pulse bg-white/38"}`}
          aria-hidden="true"
        />
        <span>{detail}</span>
      </div>
    </div>
  );
}
