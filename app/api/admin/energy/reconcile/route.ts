import { timingSafeEqual } from "node:crypto";
import { verifyAdmin } from "@/lib/adminAuth";
import { getEnergyBalance, getEnergyLedger, getEnergyWalletIndex, safeBigInt } from "@/src/lib/storage/energyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function secretsEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function authorize(request: Request, body: Record<string, unknown>) {
  const configuredSecret = readEnv("ENERGY_INDEXER_SECRET", "ADMIN_API_SECRET");
  const incomingSecret = request.headers.get("x-admin-secret") || "";
  if (configuredSecret && incomingSecret && secretsEqual(configuredSecret, incomingSecret)) {
    return { mode: "secret" };
  }
  await verifyAdmin(body, "energy-reconciliation", { route: "/api/admin/energy/reconcile" });
  return { mode: "wallet" };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const authorization = await authorize(request, body);
    const wallets = await getEnergyWalletIndex();
    const rows = await Promise.all(wallets.map(async (wallet) => {
      const ledger = await getEnergyLedger(wallet);
      const balance = await getEnergyBalance(wallet);
      const harvestEntryTotal = ledger.entries
        .filter((entry) => entry.type === "CREDIT_HARVEST")
        .reduce((total, entry) => total + safeBigInt(entry.amountRaw), 0n);
      const mismatchRaw = harvestEntryTotal - safeBigInt(balance.harvestedRaw);
      return {
        wallet,
        entryCount: ledger.entries.length,
        harvestedRaw: balance.harvestedRaw,
        harvestedEntryTotalRaw: harvestEntryTotal.toString(),
        airdroppedRaw: balance.airdroppedRaw,
        otherCreditRaw: balance.otherCreditRaw,
        spentRaw: balance.spentRaw,
        spendableRaw: balance.spendableRaw,
        lifetimeRaw: balance.lifetimeRaw,
        mismatchRaw: mismatchRaw.toString(),
        affected: mismatchRaw !== 0n ? "yes" : "no",
        notes: mismatchRaw === 0n
          ? "Ledger-derived totals are internally consistent."
          : "Ledger harvest total differs from computed harvested total.",
      };
    }));

    return json(200, {
      ok: true,
      authorization,
      dryRun: body.dryRun !== false,
      generatedAt: new Date().toISOString(),
      walletCount: wallets.length,
      affectedCount: rows.filter((row) => row.affected === "yes").length,
      rows,
      note: "Reconciliation is diagnostic. Normal spendable Energy is derived from ledger credits and debits.",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy reconciliation failed." });
  }
}
