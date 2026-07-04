import { ethers } from "ethers";
import { getEnergyBalance } from "@/src/lib/storage/energyStore";
import { readPendingEnergyRaw } from "@/src/lib/energy/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnergyRouteContext = {
  params: Promise<{ wallet: string }> | { wallet: string };
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function normalizeWallet(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function format(raw: string) {
  return ethers.formatUnits(BigInt(raw || "0"), 18).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export async function GET(_request: Request, context: EnergyRouteContext) {
  const params = await context.params;
  const wallet = normalizeWallet(params.wallet);
  if (!wallet) return json(400, { ok: false, error: "Invalid wallet address." });

  const pendingRaw = await readPendingEnergyRaw(wallet).catch(() => 0n);
  const balance = await getEnergyBalance(wallet, pendingRaw.toString());

  return json(200, {
    ok: true,
    wallet,
    pendingRaw: balance.pendingRaw,
    pendingEnergy: format(balance.pendingRaw),
    harvestedRaw: balance.harvestedRaw,
    harvestedEnergy: format(balance.harvestedRaw),
    airdroppedRaw: balance.airdroppedRaw,
    airdroppedEnergy: format(balance.airdroppedRaw),
    otherCreditRaw: balance.otherCreditRaw,
    otherCreditEnergy: format(balance.otherCreditRaw),
    spentRaw: balance.spentRaw,
    spentEnergy: format(balance.spentRaw),
    adjustmentRaw: balance.adjustmentRaw,
    adjustmentEnergy: format(balance.adjustmentRaw),
    spendableRaw: balance.spendableRaw,
    spendableEnergy: format(balance.spendableRaw),
    bankedRaw: balance.spendableRaw,
    bankedEnergy: format(balance.spendableRaw),
    lifetimeRaw: balance.lifetimeRaw,
    lifetimeEnergy: format(balance.lifetimeRaw),
    entryCount: balance.entryCount,
    lastUpdatedAt: balance.lastUpdatedAt,
    dataSource: "ledger+staking-pending",
  });
}
