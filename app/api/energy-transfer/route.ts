import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const TRANSFER_WINDOW_MS = 5 * 60 * 1000;

const ENERGY_BANK_ABI = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function SPENDER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function spendEnergy(address user,uint256 amount,bytes32 reason)",
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
];

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

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
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

    const energyBankAddress = requireAddress(
      readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT,
      "ENERGY_BANK_ADDRESS",
    );
    const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
    if (!signerKey) return json(500, { ok: false, error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY." });

    const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
    }

    const signer = new ethers.Wallet(signerKey, provider);
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const transferId = ethers.keccak256(ethers.toUtf8Bytes([
      "DYOOR Energy Transfer",
      sender.toLowerCase(),
      recipient.toLowerCase(),
      amount.toString(),
      nonce,
    ].join("|")));

    const alreadyUsed = await bank.usedClaimTxHash(transferId);
    if (alreadyUsed) {
      return json(200, {
        ok: true,
        alreadyTransferred: true,
        sender,
        recipient,
        amountRaw: amount.toString(),
        transferId,
      });
    }

    const [senderBalance] = await Promise.all([
      bank.spendableEnergy(sender),
    ]);
    if (BigInt(senderBalance) < amount) return json(400, { ok: false, error: "Insufficient transferable Energy." });

    await bank.spendEnergy.staticCall(sender, amount, transferId);
    await bank.creditEnergy.staticCall(recipient, amount, transferId);

    const spendTx = await bank.spendEnergy(sender, amount, transferId);
    const spendReceipt = await spendTx.wait();
    const creditTx = await bank.creditEnergy(recipient, amount, transferId);
    const creditReceipt = await creditTx.wait();

    return json(200, {
      ok: true,
      sender,
      recipient,
      amountRaw: amount.toString(),
      transferId,
      spendTxHash: spendTx.hash,
      spendBlock: spendReceipt?.blockNumber ?? null,
      creditTxHash: creditTx.hash,
      creditBlock: creditReceipt?.blockNumber ?? null,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy transfer failed." });
  }
}
