import { ethers } from "ethers";
import { addEnergyLedgerEntry } from "@/src/lib/storage/energyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSFER_WINDOW_MS = 5 * 60 * 1000;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function requireAddress(value: unknown, label: string) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    throw Object.assign(new Error(`${label} must be a valid address.`), { status: 400 });
  }
}

function requireUint(value: unknown, label: string) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error(`${label} must be an integer string.`), { status: 400 });
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw Object.assign(new Error(`${label} must be greater than zero.`), { status: 400 });
  return parsed;
}

function transferMessage(sender: string, recipient: string, amountRaw: string, timestamp: string, nonce: string) {
  return [
    "DYOOR Energy Transfer",
    `From: ${sender}`,
    `To: ${recipient}`,
    `AmountRaw: ${amountRaw}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sender = requireAddress(body.sender, "sender");
    const recipient = requireAddress(body.recipient, "recipient");
    const amount = requireUint(body.amountRaw, "amountRaw");
    const timestamp = String(body.timestamp || "");
    const nonce = String(body.nonce || "");
    const signature = String(body.signature || "");

    if (recipient === ethers.ZeroAddress) return json(400, { ok: false, error: "Recipient cannot be the zero address." });
    if (recipient.toLowerCase() === sender.toLowerCase()) return json(400, { ok: false, error: "Recipient must be a different wallet." });
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > TRANSFER_WINDOW_MS) {
      return json(401, { ok: false, error: "Energy transfer authorization expired. Sign again." });
    }
    if (!nonce || nonce.length < 8 || !signature) return json(400, { ok: false, error: "Missing transfer signature." });

    const message = transferMessage(sender, recipient, amount.toString(), timestamp, nonce);
    let recovered = "";
    try {
      recovered = ethers.getAddress(ethers.verifyMessage(message, signature));
    } catch {
      recovered = "";
    }
    if (recovered.toLowerCase() !== sender.toLowerCase()) {
      return json(401, { ok: false, error: "Signature does not match sender wallet." });
    }

    const transferId = ethers.keccak256(ethers.toUtf8Bytes([
      "DYOOR Energy Transfer",
      sender.toLowerCase(),
      recipient.toLowerCase(),
      amount.toString(),
      nonce,
    ].join("|")));

    const debit = await addEnergyLedgerEntry({
      id: `transfer:${transferId}:debit`,
      wallet: sender,
      amountRaw: amount.toString(),
      type: "DEBIT_TRANSFER",
      source: "wallet-energy-transfer",
      notes: `Transfer to ${recipient}.`,
    });
    const credit = await addEnergyLedgerEntry({
      id: `transfer:${transferId}:credit`,
      wallet: recipient,
      amountRaw: amount.toString(),
      type: "CREDIT_TRANSFER",
      source: "wallet-energy-transfer",
      notes: `Transfer from ${sender}.`,
    });

    return json(200, {
      ok: true,
      alreadyTransferred: debit.deduped && credit.deduped,
      sender,
      recipient,
      amountRaw: amount.toString(),
      transferId,
      debitDeduped: debit.deduped,
      creditDeduped: credit.deduped,
      executionMode: "ledger",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy transfer failed." });
  }
}
