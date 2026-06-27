import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ENERGY_BANK_CONTRACT, DEFAULT_TREASURY_WALLET } from "@/lib/contracts/addresses";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const ENERGY_PER_MON = 50n;

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function requireAddress(value: unknown, label: string) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid address.`);
  }
}

function requireTxHash(value: unknown) {
  const txHash = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) throw new Error("txHash must be a transaction hash.");
  return txHash;
}

function requireUint(value: unknown, label: string) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be an integer string.`);
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function rechargeConfig() {
  const treasuryWallet = readEnv(
    "VITE_TREASURY_WALLET",
    "TREASURY_WALLET",
    "NEXT_PUBLIC_TREASURY_WALLET",
    "DYOOR_TREASURY",
    "VITE_DYOOR_TREASURY",
    "DYOOR_TREASURY_ADDRESS",
  ) || DEFAULT_TREASURY_WALLET;
  return {
    treasuryWallet: treasuryWallet ? ethers.getAddress(treasuryWallet) : "",
    rate: Number(ENERGY_PER_MON),
  };
}

export async function GET() {
  try {
    const energyBankAddress = requireAddress(
      readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT,
      "ENERGY_BANK_ADDRESS",
    );
    const signerKey = normalizePrivateKey(
      readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"),
    );
    const body: Record<string, unknown> = {
      ok: true,
      ...rechargeConfig(),
      energyBankAddress,
      creditReady: Boolean(signerKey),
    };

    if (signerKey) {
      const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, MONAD_CHAIN_ID);
      const signer = new ethers.Wallet(signerKey, provider);
      const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
      const creditRole = await bank.CREDIT_ROLE();
      const hasCreditRole = await bank.hasRole(creditRole, signer.address);
      body.operatorAddress = signer.address;
      body.creditReady = hasCreditRole;
      if (!hasCreditRole) body.creditUnavailableReason = "Energy Bank operator does not have CREDIT_ROLE.";
    } else {
      body.creditUnavailableReason = "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY.";
    }

    return json(200, body);
  } catch (error) {
    return json(500, { ok: false, error: error instanceof Error ? error.message : "Recharge config unavailable." });
  }
}

export async function POST(request: Request) {
  try {
    const { treasuryWallet } = rechargeConfig();
    if (!treasuryWallet) return json(500, { ok: false, error: "Missing VITE_TREASURY_WALLET." });

    const energyBankAddress = requireAddress(
      readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT,
      "ENERGY_BANK_ADDRESS",
    );
    const signerKey = normalizePrivateKey(
      readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"),
    );
    if (!signerKey) return json(500, { ok: false, error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY." });

    const body = await request.json().catch(() => ({}));
    const user = requireAddress(body.user || body.address, "user");
    const txHash = requireTxHash(body.txHash);
    const requestedMonAmountRaw = body.monAmountRaw ? requireUint(body.monAmountRaw, "monAmountRaw") : null;

    const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC, MONAD_CHAIN_ID);
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
    }

    const [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ]);
    if (!tx) return json(409, { ok: false, error: "Recharge transaction is not available yet." });
    if (!receipt) return json(409, { ok: false, error: "Recharge transaction is not confirmed yet." });
    if (receipt.status !== 1) return json(400, { ok: false, error: "Recharge transaction failed on-chain." });

    if (ethers.getAddress(tx.from) !== user) {
      return json(400, { ok: false, error: "Recharge sender does not match connected wallet." });
    }
    if (!tx.to || ethers.getAddress(tx.to) !== treasuryWallet) {
      return json(400, { ok: false, error: "Recharge recipient does not match treasury wallet." });
    }
    if (requestedMonAmountRaw && tx.value !== requestedMonAmountRaw) {
      return json(400, { ok: false, error: "Recharge amount does not match requested MON amount." });
    }
    if (tx.value <= 0n) {
      return json(400, { ok: false, error: "Recharge transaction did not send MON." });
    }

    const monAmountRaw = tx.value;
    const expectedEnergyRaw = monAmountRaw * ENERGY_PER_MON;

    const signer = new ethers.Wallet(signerKey, provider);
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const alreadyUsed = await bank.usedClaimTxHash(txHash);
    if (alreadyUsed) {
      return json(200, {
        ok: true,
        alreadyCredited: true,
        user,
        treasuryWallet,
        energyBankAddress,
        monAmountRaw: monAmountRaw.toString(),
        energyAmountRaw: expectedEnergyRaw.toString(),
        paymentTxHash: txHash,
      });
    }

    const creditRole = await bank.CREDIT_ROLE();
    const hasCreditRole = await bank.hasRole(creditRole, signer.address);
    if (!hasCreditRole) {
      return json(500, { ok: false, error: "Energy Bank operator does not have CREDIT_ROLE." });
    }

    const creditTx = await bank.creditEnergy(user, expectedEnergyRaw, txHash);
    const creditReceipt = await creditTx.wait();

    return json(200, {
      ok: true,
      user,
      treasuryWallet,
      energyBankAddress,
      monAmountRaw: monAmountRaw.toString(),
      energyAmountRaw: expectedEnergyRaw.toString(),
      paymentTxHash: txHash,
      creditTxHash: creditTx.hash,
      creditBlock: creditReceipt?.blockNumber ?? null,
    });
  } catch (error) {
    return json(500, { ok: false, error: error instanceof Error ? error.message : "Recharge failed. Please try again." });
  }
}
