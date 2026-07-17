import { timingSafeEqual } from "node:crypto";
import { verifyAdmin } from "@/lib/adminAuth";
import { scanHarvestEvents } from "@/src/lib/energy/chain";
import { getCheckpoint, setCheckpoint, upsertHarvestEvent } from "@/src/lib/storage/energyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ADMIN_INDEX_CHUNKS = 8;

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

function readPositiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function authorize(request: Request, body: Record<string, unknown>) {
  const configuredSecret = readEnv("ENERGY_INDEXER_SECRET", "ADMIN_API_SECRET");
  const incomingSecret = request.headers.get("x-admin-secret") || "";
  if (configuredSecret && incomingSecret && secretsEqual(configuredSecret, incomingSecret)) {
    return { mode: "secret" };
  }
  await verifyAdmin(body, "energy-index");
  return { mode: "wallet" };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const authorization = await authorize(request, body);
    const checkpointName = "energy-global";
    const checkpoint = await getCheckpoint(checkpointName);
    const fromBlock = body.fromBlock
      ? Number(BigInt(String(body.fromBlock)))
      : checkpoint
        ? Number(BigInt(checkpoint.block) + 1n)
        : undefined;
    const scan = await scanHarvestEvents({
      fromBlock,
      maxChunks: readPositiveInt(body.maxChunks, DEFAULT_ADMIN_INDEX_CHUNKS),
    });

    let indexed = 0;
    let deduped = 0;
    const wallets = new Set<string>();
    for (const event of scan.events) {
      const result = await upsertHarvestEvent(event);
      wallets.add(event.wallet);
      if (result.deduped) deduped += 1;
      else indexed += 1;
    }

    const nextCheckpoint = await setCheckpoint(checkpointName, scan.toBlock, {
      latestBlock: scan.latestBlock,
      complete: scan.complete,
      nextBlock: scan.nextBlock,
      chunksScanned: scan.chunksScanned,
    });

    return json(200, {
      ok: true,
      authorization,
      indexed,
      deduped,
      walletsTouched: wallets.size,
      fromBlock: scan.fromBlock,
      toBlock: scan.toBlock,
      latestBlock: scan.latestBlock,
      complete: scan.complete,
      nextBlock: scan.nextBlock,
      chunksScanned: scan.chunksScanned,
      checkpoint: nextCheckpoint,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy reindex failed." });
  }
}
