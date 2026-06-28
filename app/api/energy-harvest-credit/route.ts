import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ASCENSION_STAKING_CONTRACT, DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RPC = "https://rpc.monad.xyz";

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

const ASCENSION_ABI = [
  "event PointsClaimed(address indexed user,uint256 amount)",
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

function requireTxHash(value: unknown) {
  const txHash = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) throw Object.assign(new Error("txHash must be a transaction hash."), { status: 400 });
  return txHash;
}

function requireUint(value: unknown, label: string) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error(`${label} must be an integer string.`), { status: 400 });
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw Object.assign(new Error(`${label} must be greater than zero.`), { status: 400 });
  return parsed;
}

async function resolveHarvestReceipt(provider: ethers.JsonRpcProvider, txHash: string, user: string, ascensionStaking: string) {
  let receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    receipt = await provider.getTransactionReceipt(txHash);
  }
  if (!receipt) throw Object.assign(new Error("Harvest transaction is not confirmed yet."), { status: 409 });
  if (receipt.status !== 1) throw Object.assign(new Error("Harvest transaction failed on-chain."), { status: 400 });

  const iface = new ethers.Interface(ASCENSION_ABI);
  const claimTopic = ethers.id("PointsClaimed(address,uint256)");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ascensionStaking.toLowerCase() || log.topics?.[0] !== claimTopic) continue;
    const parsed = iface.parseLog(log);
    if (!parsed) continue;
    if (ethers.getAddress(parsed.args.user) !== user) continue;
    return BigInt(parsed.args.amount);
  }
  throw Object.assign(new Error("Harvest transaction did not emit PointsClaimed for this wallet."), { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const user = requireAddress(body.user || body.address, "user");
    const txHash = requireTxHash(body.txHash);
    const requestedAmount = body.amountRaw ? requireUint(body.amountRaw, "amountRaw") : null;
    const energyBankAddress = requireAddress(
      readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT,
      "ENERGY_BANK_ADDRESS",
    );
    const ascensionStaking = requireAddress(
      readEnv("ASCENSION_STAKING_ADDRESS", "ASCENSION_STAKING_CONTRACT", "NEXT_PUBLIC_ASCENSION_STAKING_CONTRACT") || DEFAULT_ASCENSION_STAKING_CONTRACT,
      "ASCENSION_STAKING_ADDRESS",
    );
    const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
    if (!signerKey) return json(500, { ok: false, error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY." });

    const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, MONAD_CHAIN_ID);
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
    }

    const amount = await resolveHarvestReceipt(provider, txHash, user, ascensionStaking);
    if (requestedAmount && requestedAmount !== amount) {
      return json(400, { ok: false, error: "Harvest amount does not match PointsClaimed event." });
    }

    const signer = new ethers.Wallet(signerKey, provider);
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const alreadyUsed = await bank.usedClaimTxHash(txHash);
    if (alreadyUsed) {
      return json(200, {
        ok: true,
        alreadyCredited: true,
        user,
        amountRaw: amount.toString(),
        claimTxHash: txHash,
        energyBankAddress,
      });
    }

    const creditRole = await bank.CREDIT_ROLE();
    const hasCreditRole = await bank.hasRole(creditRole, signer.address);
    if (!hasCreditRole) return json(500, { ok: false, error: "Energy Bank operator does not have CREDIT_ROLE." });

    await bank.creditEnergy.staticCall(user, amount, txHash);
    const creditTx = await bank.creditEnergy(user, amount, txHash);
    const receipt = await creditTx.wait();

    return json(200, {
      ok: true,
      user,
      amountRaw: amount.toString(),
      claimTxHash: txHash,
      energyBankAddress,
      operator: signer.address,
      creditTxHash: creditTx.hash,
      creditBlock: receipt?.blockNumber ?? null,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.shortMessage || error?.message || "Harvest Energy credit failed." });
  }
}
