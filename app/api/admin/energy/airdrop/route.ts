import { verifyAdmin } from "@/lib/adminAuth";
import { addEnergyLedgerEntry } from "@/src/lib/storage/energyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RECIPIENTS = 500;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function normalizeWallet(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw : "";
}

function requireAmount(value: unknown) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) {
    throw Object.assign(new Error("amountRaw must be an integer string."), { status: 400 });
  }
  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw Object.assign(new Error("amountRaw must be greater than zero."), { status: 400 });
  }
  return amount.toString();
}

function safeCampaignId(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw Object.assign(new Error("campaignId is required."), { status: 400 });
  }
  if (!/^[a-zA-Z0-9:._-]{1,120}$/.test(raw)) {
    throw Object.assign(new Error("campaignId may only use letters, numbers, colon, period, underscore, and dash."), { status: 400 });
  }
  return raw;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await verifyAdmin(body, "energy-airdrop");

    const amountRaw = requireAmount(body.amountRaw);
    const campaignId = safeCampaignId(body.campaignId);
    const note = String(body.note || "").slice(0, 500);
    const normalizedRecipients: string[] = (Array.isArray(body.recipients) ? body.recipients : [])
      .map(normalizeWallet)
      .filter((wallet: string) => Boolean(wallet));
    const recipients: string[] = Array.from(new Set<string>(normalizedRecipients));

    if (!recipients.length) return json(400, { ok: false, error: "At least one valid recipient is required." });
    if (recipients.length > MAX_RECIPIENTS) return json(400, { ok: false, error: `Airdrop at most ${MAX_RECIPIENTS} wallets per request.` });

    const results = [];
    for (const wallet of recipients) {
      try {
        const result = await addEnergyLedgerEntry({
          id: `airdrop:${campaignId}:${wallet}`,
          wallet,
          amountRaw,
          type: "CREDIT_AIRDROP",
          source: `admin-airdrop:${campaignId}`,
          notes: note || "Admin ledger Energy airdrop.",
        });
        results.push({
          wallet,
          status: result.deduped ? "skipped" : "success",
          amountRaw,
          campaignId,
          source: "ledger",
          error: result.deduped ? "Recipient campaign credit already exists." : "",
        });
      } catch (error: any) {
        results.push({
          wallet,
          status: "failed",
          amountRaw,
          campaignId,
          source: "ledger",
          error: error?.message || "Ledger airdrop failed.",
        });
      }
    }

    const successfulWallets = results.filter((row) => row.status === "success").map((row) => row.wallet);
    const skippedWallets = results.filter((row) => row.status === "skipped").map((row) => row.wallet);
    const failedWallets = results.filter((row) => row.status === "failed").map((row) => ({
      wallet: row.wallet,
      error: row.error,
    }));
    const handledCount = successfulWallets.length + skippedWallets.length;

    return json(handledCount ? 200 : 500, {
      ok: handledCount > 0 && failedWallets.length === 0,
      partial: handledCount > 0 && failedWallets.length > 0,
      recipients,
      recipientCount: recipients.length,
      successfulWallets,
      skippedWallets,
      failedWallets,
      successCount: successfulWallets.length,
      skippedCount: skippedWallets.length,
      failureCount: failedWallets.length,
      amountRaw,
      requestedTotalRaw: (BigInt(amountRaw) * BigInt(recipients.length)).toString(),
      totalRaw: (BigInt(amountRaw) * BigInt(successfulWallets.length)).toString(),
      campaignId,
      campaignIds: [campaignId],
      executionMode: "ledger",
      actionId: campaignId,
      note,
      timestamp: new Date().toISOString(),
      results,
      error: failedWallets.length && !successfulWallets.length ? "Energy ledger airdrop failed for every wallet." : undefined,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy ledger airdrop failed." });
  }
}
