export const S2_ISSUED_SUPPLY_FALLBACK = 1096;
export const S2_POST_BURN_SUPPLY_CAP = 555;

export type S2SupplySource = "chain" | "burn-records" | "fallback";

export type S2SupplySnapshot = {
  issuedSupply: number;
  currentSupply: number;
  burnedSupply: number;
  source: S2SupplySource;
};

function supplyNumber(value: bigint | number, label: string) {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return parsed;
}

export function resolveS2ChainSupply(
  currentSupplyValue: bigint | number,
  issuedSupplyValue: bigint | number,
): S2SupplySnapshot {
  const currentSupply = supplyNumber(currentSupplyValue, "Current S2 supply");
  const issuedSupply = supplyNumber(issuedSupplyValue, "Issued S2 supply");
  if (currentSupply > issuedSupply) {
    throw new Error("Current S2 supply cannot exceed issued S2 supply.");
  }
  return {
    issuedSupply,
    currentSupply,
    burnedSupply: issuedSupply - currentSupply,
    source: "chain",
  };
}

export function resolveS2RecordedBurnSupply(recordedBurnsValue: number): S2SupplySnapshot {
  const recordedBurns = Math.min(
    S2_ISSUED_SUPPLY_FALLBACK,
    supplyNumber(recordedBurnsValue, "Recorded S2 burns"),
  );
  return {
    issuedSupply: S2_ISSUED_SUPPLY_FALLBACK,
    currentSupply: S2_ISSUED_SUPPLY_FALLBACK - recordedBurns,
    burnedSupply: recordedBurns,
    source: recordedBurns > 0 ? "burn-records" : "fallback",
  };
}
