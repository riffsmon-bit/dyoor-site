import { timingSafeEqual } from "node:crypto";
import { exportEnergyLedgers } from "@/src/lib/storage/energyStore";

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

function requireSecret(request: Request) {
  const configuredSecret = readEnv("ENERGY_INDEXER_SECRET", "ADMIN_API_SECRET");
  if (!configuredSecret) throw Object.assign(new Error("Admin export secret is not configured."), { status: 500 });
  const incoming = request.headers.get("x-admin-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!incoming || !secretsEqual(configuredSecret, incoming)) {
    throw Object.assign(new Error("Unauthorized."), { status: 401 });
  }
}

export async function GET(request: Request) {
  try {
    requireSecret(request);
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Unauthorized." });
  }
  const exportPayload = await exportEnergyLedgers();
  return json(200, {
    ok: true,
    ...exportPayload,
  });
}
