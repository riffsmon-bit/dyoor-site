import { ethers } from "ethers";
import { DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";
import { effectiveEnergyBalance } from "@/lib/trait-lab-energy-accounting";
import { getEnergyBalance } from "@/src/lib/storage/energyStore";
import { energyRpcProvider, readPendingEnergyRaw } from "@/src/lib/energy/chain";
import { getTraitLabEnergyDebitSummary } from "@/src/lib/storage/s2TraitLabStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnergyRouteContext = {
  params: Promise<{ wallet: string }>;
};

const ENERGY_BANK_ABI = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)",
];

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

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

async function readEnergyBankBalance(wallet: string) {
  const address = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT);
  const bank = new ethers.Contract(address, ENERGY_BANK_ABI, energyRpcProvider());
  const [spendableRaw, lifetimeRaw, spentRaw] = await Promise.all([
    bank.spendableEnergy(wallet),
    bank.lifetimeEnergy(wallet),
    bank.totalSpent(wallet),
  ]);
  return {
    spendableRaw: BigInt(spendableRaw || 0n).toString(),
    lifetimeRaw: BigInt(lifetimeRaw || 0n).toString(),
    spentRaw: BigInt(spentRaw || 0n).toString(),
  };
}

export async function GET(_request: Request, context: EnergyRouteContext) {
  const params = await context.params;
  const wallet = normalizeWallet(params.wallet);
  if (!wallet) return json(400, { ok: false, error: "Invalid wallet address." });

  const [pendingRaw, bankBalance, traitLabDebits] = await Promise.all([
    readPendingEnergyRaw(wallet).catch(() => 0n),
    readEnergyBankBalance(wallet).catch(() => null),
    getTraitLabEnergyDebitSummary(wallet),
  ]);
  const balance = await getEnergyBalance(wallet, pendingRaw.toString());
  if (!bankBalance) {
    return json(503, {
      ok: false,
      wallet,
      error: "Energy Bank balance is temporarily unavailable.",
      pendingRaw: balance.pendingRaw,
      pendingEnergy: format(balance.pendingRaw),
      ledgerSpendableRaw: balance.spendableRaw,
      ledgerSpendableEnergy: format(balance.spendableRaw),
      dataSource: "ledger-diagnostic-only",
    });
  }
  const effective = effectiveEnergyBalance({
    energyBankSpendableRaw: bankBalance.spendableRaw,
    energyBankSpentRaw: bankBalance.spentRaw,
    serverSettledDebitRaw: traitLabDebits.debitRaw,
  });
  const spendableRaw = effective.spendableRaw;
  const lifetimeRaw = bankBalance.lifetimeRaw;
  const spentRaw = effective.spentRaw;

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
    spentRaw,
    spentEnergy: format(spentRaw),
    adjustmentRaw: balance.adjustmentRaw,
    adjustmentEnergy: format(balance.adjustmentRaw),
    spendableRaw,
    spendableEnergy: format(spendableRaw),
    bankedRaw: spendableRaw,
    bankedEnergy: format(spendableRaw),
    ledgerSpendableRaw: balance.spendableRaw,
    ledgerSpendableEnergy: format(balance.spendableRaw),
    energyBankSpendableRaw: bankBalance.spendableRaw,
    energyBankSpendableEnergy: format(bankBalance.spendableRaw),
    serverSettledTraitLabDebitRaw: traitLabDebits.debitRaw,
    serverSettledTraitLabDebitEnergy: format(traitLabDebits.debitRaw),
    serverSettledTraitLabDebitCount: traitLabDebits.debitCount,
    missingSpendableRaw: "0",
    missingSpendableEnergy: "0",
    energyBankSyncPending: false,
    lifetimeRaw,
    lifetimeEnergy: format(lifetimeRaw),
    entryCount: balance.entryCount,
    lastUpdatedAt: balance.lastUpdatedAt,
    dataSource: "energy-bank+server-trait-lab-ledger+staking-pending",
  });
}
