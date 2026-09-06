// Display only: keep all accounting in raw integer units. Truncate rather than
// round up spendable Energy, and avoid Number precision loss for large amounts.
export function formatEnergyDisplay(value: string | undefined) {
  if (value === undefined) return "-";
  if (!/^\d+(?:\.\d+)?$/.test(value)) return "Unavailable";
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.slice(0, 2).replace(/0+$/, "");
  return BigInt(whole).toLocaleString("en-US") + (decimals ? `.${decimals}` : "");
}
