import { ethers } from "ethers";
import { DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";
import { getEnergyBalance } from "@/src/lib/storage/energyStore";
import { energyRpcProvider, readPendingEnergyRaw } from "@/src/lib/energy/chain";

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

  const [pendingRaw, bankBalance] = await Promise.all([
    readPendingEnergyRaw(wallet).catch(() => 0n),
    readEnergyBankBalance(wallet).catch(() => null),
  ]);
  const balance = await getEnergyBalance(wallet, pendingRaw.toString());
  const spendableRaw = bankBalance?.spendableRaw || balance.spendableRaw;
  const lifetimeRaw = bankBalance?.lifetimeRaw || balance.lifetimeRaw;
  const spentRaw = bankBalance?.spentRaw || balance.spentRaw;

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
    missingSpendableRaw: "0",
    missingSpendableEnergy: "0",
    energyBankSyncPending: false,
    lifetimeRaw,
    lifetimeEnergy: format(lifetimeRaw),
    entryCount: balance.entryCount,
    lastUpdatedAt: balance.lastUpdatedAt,
    dataSource: bankBalance ? "energy-bank+staking-pending" : "ledger+staking-pending",
  });
}
