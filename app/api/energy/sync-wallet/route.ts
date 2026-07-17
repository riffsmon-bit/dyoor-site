import { ethers } from "ethers";
import { harvestEventsFromReceipt, readPendingEnergyRaw, scanHarvestEvents } from "@/src/lib/energy/chain";
import { getCheckpoint, getEnergyBalance, setCheckpoint, upsertHarvestEvent } from "@/src/lib/storage/energyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WALLET_SYNC_CHUNKS = 4;

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const wallet = normalizeWallet(body.wallet || body.address);
    if (!wallet) return json(400, { ok: false, error: "Invalid wallet address." });

    const txHash = String(body.txHash || "").trim().toLowerCase();
    let events = [];
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
        maxChunks: readPositiveInt(body.maxChunks, DEFAULT_WALLET_SYNC_CHUNKS),
      });
      events = scan.events;
      await setCheckpoint(checkpointName, scan.toBlock, {
        latestBlock: scan.latestBlock,
        complete: scan.complete,
        nextBlock: scan.nextBlock,
      });
      checkpoint = await getCheckpoint(checkpointName);
    }

    let indexed = 0;
    let deduped = 0;
    for (const event of events) {
      const result = await upsertHarvestEvent(event);
      if (result.deduped) deduped += 1;
      else indexed += 1;
    }

    const pendingRaw = await readPendingEnergyRaw(wallet).catch(() => 0n);
    const balance = await getEnergyBalance(wallet, pendingRaw.toString());

    return json(200, {
      ok: true,
      wallet,
      indexed,
      deduped,
      checkpoint,
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
      spendableRaw: balance.spendableRaw,
      spendableEnergy: format(balance.spendableRaw),
      bankedRaw: balance.spendableRaw,
      bankedEnergy: format(balance.spendableRaw),
      lifetimeRaw: balance.lifetimeRaw,
      lifetimeEnergy: format(balance.lifetimeRaw),
      lastUpdatedAt: balance.lastUpdatedAt,
      dataSource: "ledger+staking-pending",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy wallet sync failed." });
  }
}
