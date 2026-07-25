import { ethers } from "ethers";
import { DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";
import { effectiveEnergyBalance } from "@/lib/trait-lab-energy-accounting";
import { assertMonadMainnet, energyRpcProvider, harvestEventsFromReceipt, readPendingEnergyRaw, scanHarvestEvents } from "@/src/lib/energy/chain";
import { getCheckpoint, getEnergyBalance, setCheckpoint, upsertHarvestEvent } from "@/src/lib/storage/energyStore";
import { getTraitLabEnergyDebitSummary } from "@/src/lib/storage/s2TraitLabStore";
import type { HarvestEvent } from "@/src/lib/storage/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WALLET_SYNC_CHUNKS = 4;
const DEFAULT_BANK_CREDIT_LIMIT = 10;
const MAX_WALLET_SYNC_CHUNKS = 20;
const MAX_BANK_CREDIT_LIMIT = 25;
const ENERGY_CREDIT_GAS_LIMIT = 160_000n;

const ENERGY_BANK_ABI = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)",
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
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

function readPositiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedPositiveInt(value: unknown, fallback: number, maximum: number) {
  return Math.min(readPositiveInt(value, fallback), maximum);
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function energyBankAddress() {
  return ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT);
}

function errorMessage(error: any, fallback: string) {
  return error?.shortMessage || error?.reason || error?.message || fallback;
}

async function readEnergyBankBalance(wallet: string) {
  const bank = new ethers.Contract(energyBankAddress(), ENERGY_BANK_ABI, energyRpcProvider());
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

async function creditEnergyBankHarvests(events: HarvestEvent[], limit: number) {
  const creditableEvents = events
    .filter((event) => BigInt(event.amountRaw || "0") > 0n && /^0x[a-f0-9]{64}$/i.test(event.txHash))
    .slice(0, Math.max(1, limit));

  if (!creditableEvents.length) {
    return {
      attempted: 0,
      credited: 0,
      deduped: 0,
      failures: [] as Array<{ txHash: string; error: string }>,
      txHashes: [] as string[],
      operator: "",
      energyBankAddress: energyBankAddress(),
      ok: true,
    };
  }

  const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
  if (!signerKey) {
    return {
      attempted: creditableEvents.length,
      credited: 0,
      deduped: 0,
      failures: creditableEvents.map((event) => ({
        txHash: event.txHash,
        error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY.",
      })),
      txHashes: [] as string[],
      operator: "",
      energyBankAddress: energyBankAddress(),
      ok: false,
    };
  }

  const provider = energyRpcProvider();
  await assertMonadMainnet(provider);

  const signer = new ethers.Wallet(signerKey, provider);
  const bank = new ethers.Contract(energyBankAddress(), ENERGY_BANK_ABI, signer);
  const creditRole = await bank.CREDIT_ROLE();
  const hasCreditRole = await bank.hasRole(creditRole, signer.address);
  if (!hasCreditRole) {
    return {
      attempted: creditableEvents.length,
      credited: 0,
      deduped: 0,
      failures: creditableEvents.map((event) => ({
        txHash: event.txHash,
        error: "Energy Bank operator is missing CREDIT_ROLE.",
      })),
      txHashes: [] as string[],
      operator: signer.address,
      energyBankAddress: energyBankAddress(),
      ok: false,
    };
  }

  let credited = 0;
  let deduped = 0;
  const failures: Array<{ txHash: string; error: string }> = [];
  const txHashes: string[] = [];

  for (const event of creditableEvents) {
    const claimKey = event.txHash.toLowerCase();
    const amount = BigInt(event.amountRaw || "0");
    try {
      const alreadyUsed = await bank.usedClaimTxHash(claimKey).then(Boolean);
      if (alreadyUsed) {
        deduped += 1;
        continue;
      }
      await bank.creditEnergy.staticCall(event.wallet, amount, claimKey);
      const tx = await bank.creditEnergy(event.wallet, amount, claimKey, { gasLimit: ENERGY_CREDIT_GAS_LIMIT });
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error("Energy Bank credit transaction failed.");
      credited += 1;
      txHashes.push(tx.hash);
    } catch (error: any) {
      failures.push({
        txHash: event.txHash,
        error: errorMessage(error, "Energy Bank credit failed."),
      });
    }
  }

  return {
    attempted: creditableEvents.length,
    credited,
    deduped,
    failures,
    txHashes,
    operator: signer.address,
    energyBankAddress: energyBankAddress(),
    ok: failures.length === 0,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const wallet = normalizeWallet(body.wallet || body.address);
    if (!wallet) return json(400, { ok: false, error: "Invalid wallet address." });

    const txHash = String(body.txHash || "").trim().toLowerCase();
    let events: HarvestEvent[] = [];
    let checkpoint = null;

    if (txHash) {
      events = await harvestEventsFromReceipt(txHash, wallet);
      if (!events.length) return json(400, { ok: false, error: "No PointsClaimed event found for this wallet." });
    } else {
      const checkpointName = `energy-wallet:${wallet}`;
      checkpoint = await getCheckpoint(checkpointName);
      const fromBlock = checkpoint ? Number(BigInt(checkpoint.block) + 1n) : undefined;
      const scan = await scanHarvestEvents({
        wallet,
        fromBlock,
        maxChunks: readBoundedPositiveInt(body.maxChunks, DEFAULT_WALLET_SYNC_CHUNKS, MAX_WALLET_SYNC_CHUNKS),
      });
      events = scan.events;
      checkpoint = {
        name: checkpointName,
        block: String(scan.toBlock),
        updatedAt: "",
        meta: {
          latestBlock: scan.latestBlock,
          complete: scan.complete,
          nextBlock: scan.nextBlock,
        },
      };
    }

    let indexed = 0;
    let deduped = 0;
    for (const event of events) {
      const result = await upsertHarvestEvent(event);
      if (result.deduped) deduped += 1;
      else indexed += 1;
    }
    if (!txHash && checkpoint) {
      checkpoint = await setCheckpoint(checkpoint.name, checkpoint.block, checkpoint.meta);
    }

    const bankCredit = await creditEnergyBankHarvests(
      events,
      readBoundedPositiveInt(
        body.bankCreditLimit || process.env.ENERGY_SYNC_BANK_CREDIT_LIMIT,
        DEFAULT_BANK_CREDIT_LIMIT,
        MAX_BANK_CREDIT_LIMIT,
      ),
    );
    const pendingRaw = await readPendingEnergyRaw(wallet).catch(() => 0n);
    const balance = await getEnergyBalance(wallet, pendingRaw.toString());
    const [bankBalance, traitLabDebits] = await Promise.all([
      readEnergyBankBalance(wallet).catch(() => null),
      getTraitLabEnergyDebitSummary(wallet),
    ]);
    const effective = effectiveEnergyBalance({
      energyBankSpendableRaw: bankBalance?.spendableRaw || balance.spendableRaw,
      energyBankSpentRaw: bankBalance?.spentRaw || balance.spentRaw,
      serverSettledDebitRaw: traitLabDebits.debitRaw,
    });
    const spendableRaw = effective.spendableRaw;
    const lifetimeRaw = bankBalance?.lifetimeRaw || balance.lifetimeRaw;
    const spentRaw = effective.spentRaw;

    return json(200, {
      ok: true,
      wallet,
      indexed,
      deduped,
      energyBankCreditOk: bankCredit.ok,
      energyBankCreditAttempted: bankCredit.attempted,
      energyBankCredited: bankCredit.credited,
      energyBankDeduped: bankCredit.deduped,
      energyBankCreditFailures: bankCredit.failures,
      energyBankCreditTxHashes: bankCredit.txHashes,
      energyBankOperator: bankCredit.operator,
      energyBankAddress: bankCredit.energyBankAddress,
      checkpoint,
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
      spendableRaw,
      spendableEnergy: format(spendableRaw),
      bankedRaw: spendableRaw,
      bankedEnergy: format(spendableRaw),
      ledgerSpendableRaw: balance.spendableRaw,
      ledgerSpendableEnergy: format(balance.spendableRaw),
      energyBankSpendableRaw: bankBalance?.spendableRaw || "",
      energyBankSpendableEnergy: bankBalance?.spendableRaw ? format(bankBalance.spendableRaw) : "",
      serverSettledTraitLabDebitRaw: traitLabDebits.debitRaw,
      serverSettledTraitLabDebitEnergy: format(traitLabDebits.debitRaw),
      serverSettledTraitLabDebitCount: traitLabDebits.debitCount,
      lifetimeRaw,
      lifetimeEnergy: format(lifetimeRaw),
      lastUpdatedAt: balance.lastUpdatedAt,
      dataSource: bankBalance
        ? "energy-bank+server-trait-lab-ledger+staking-pending"
        : "ledger+server-trait-lab-ledger+staking-pending",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy wallet sync failed." });
  }
}
