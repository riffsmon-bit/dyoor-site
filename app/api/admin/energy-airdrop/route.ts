import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const ADMIN_WINDOW_MS = 5 * 60 * 1000;

const ENERGY_BANK_ABI = [
  "function usedAirdropCampaign(bytes32 campaignId) view returns (bool)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function airdropEnergy(address[] recipients,uint256 amount,bytes32 campaignId)",
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

function normalizeAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

function ownerWallet() {
  return normalizeAddress(readEnv("ENERGY_ADMIN_ADDRESS", "DYOOR_OWNER_ADDRESS", "ADMIN_WALLET", "OWNER_WALLET", "ADMIN_WALLETS").split(",")[0]);
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function adminMessage(wallet: string, timestamp: string, nonce: string) {
  return [
    "DYOOR Admin Snapshot",
    `Wallet: ${wallet}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

async function verifyAdmin(body: Record<string, unknown>) {
  const owner = ownerWallet();
  if (!owner) throw Object.assign(new Error("Admin owner wallet is not configured."), { status: 500 });

  const wallet = normalizeAddress(body.wallet);
  const timestamp = String(body.timestamp || "");
  const nonce = String(body.nonce || "");
  const signature = String(body.signature || "");

  if (!wallet) throw Object.assign(new Error("Missing wallet."), { status: 400 });
  if (wallet.toLowerCase() !== owner.toLowerCase()) throw Object.assign(new Error("Not authorized."), { status: 403 });
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > ADMIN_WINDOW_MS) {
    throw Object.assign(new Error("Admin signature expired. Sign again."), { status: 401 });
  }
  if (!nonce || nonce.length < 8 || !signature) {
    throw Object.assign(new Error("Missing admin signature."), { status: 400 });
  }

  let recovered = "";
  try {
    recovered = normalizeAddress(ethers.verifyMessage(adminMessage(wallet, timestamp, nonce), signature));
  } catch {
    recovered = "";
  }
  if (recovered.toLowerCase() !== owner.toLowerCase()) {
    throw Object.assign(new Error("Admin signature does not match owner wallet."), { status: 401 });
  }
  return owner;
}

function requireUint(value: unknown, label: string) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error(`${label} must be an integer string.`), { status: 400 });
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw Object.assign(new Error(`${label} must be greater than zero.`), { status: 400 });
  return parsed;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await verifyAdmin(body);
    const recipients = Array.from(new Set((Array.isArray(body.recipients) ? body.recipients : [])
      .map((item: unknown) => normalizeAddress(item))
      .filter(Boolean)));
    const amount = requireUint(body.amountRaw, "amountRaw");
    const campaignLabel = String(body.campaignId || "").trim();
    if (!recipients.length) return json(400, { ok: false, error: "At least one recipient is required." });
    if (!campaignLabel) return json(400, { ok: false, error: "campaignId is required." });

    const campaignId = /^0x[a-fA-F0-9]{64}$/.test(campaignLabel)
      ? campaignLabel
      : ethers.keccak256(ethers.toUtf8Bytes(campaignLabel));
    if (campaignId === ethers.ZeroHash) return json(400, { ok: false, error: "campaignId cannot be zero." });

    const energyBankAddress = normalizeAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT);
    if (!energyBankAddress) return json(500, { ok: false, error: "ENERGY_BANK_ADDRESS is invalid." });
    const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
    if (!signerKey) return json(500, { ok: false, error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY." });

    const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, MONAD_CHAIN_ID);
    const signer = new ethers.Wallet(signerKey, provider);
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const [network, alreadyUsed, hasAdminRole] = await Promise.all([
      provider.getNetwork(),
      bank.usedAirdropCampaign(campaignId),
      bank.hasRole(ethers.ZeroHash, signer.address),
    ]);
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
    }
    if (alreadyUsed) return json(409, { ok: false, error: "Airdrop campaign was already used.", campaignId });
    if (!hasAdminRole) return json(500, { ok: false, error: "Energy Bank operator does not have DEFAULT_ADMIN_ROLE." });

    await bank.airdropEnergy.staticCall(recipients, amount, campaignId);
    const tx = await bank.airdropEnergy(recipients, amount, campaignId);
    const receipt = await tx.wait();

    return json(200, {
      ok: true,
      recipients,
      recipientCount: recipients.length,
      amountRaw: amount.toString(),
      totalRaw: (amount * BigInt(recipients.length)).toString(),
      campaignId,
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber ?? null,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy airdrop failed." });
  }
}
