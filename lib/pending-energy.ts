import { formatUnits } from "ethers";
import { withReadTimeout } from "./read-timeout.ts";

// Display evidence only. Never use this result to credit or spend Energy.
export async function readPendingEnergySnapshot(read: () => Promise<bigint>, timeoutMs = 4_000) {
  try {
    const raw = await withReadTimeout(Promise.resolve().then(read), timeoutMs);
    if (typeof raw !== "bigint" || raw < 0n) throw new Error("Invalid pending balance.");
    return { pendingReadStatus: "ok" as const, pendingRaw: raw.toString(), pendingEnergy: formatUnits(raw, 18) };
  } catch {
    return { pendingReadStatus: "unavailable" as const, pendingRaw: null, pendingEnergy: null };
  }
}

function validAmount(value: unknown): value is string {
  return typeof value === "string" && /^\d+(?:\.\d{1,18})?$/.test(value);
}

export function resolvePendingEnergy(direct: unknown, api?: { pendingReadStatus?: unknown; pendingEnergy?: unknown }) {
  // A successful direct read, including real zero, wins over a concurrent API read.
  if (validAmount(direct)) return direct;
  // Older responses may disguise an RPC failure as zero. Require explicit evidence.
  if (api?.pendingReadStatus === "ok" && validAmount(api.pendingEnergy)) return api.pendingEnergy;
  return "Unavailable";
}

export function hasPendingEnergy(value: unknown) {
  return validAmount(value) && /[1-9]/.test(value);
}
