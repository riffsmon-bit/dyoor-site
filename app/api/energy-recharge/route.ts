import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ENERGY_BANK_CONTRACT, DEFAULT_TREASURY_WALLET } from "@/lib/contracts/addresses";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const ENERGY_PER_MON = 50n;
const ENERGY_CREDIT_GAS_LIMIT = 160_000n;

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

type TraceCall = {
  from?: string;
  to?: string;
  value?: string;
  calls?: TraceCall[];
};

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

function traceValue(value: unknown) {
  try {
    return BigInt(String(value || "0x0"));
  } catch {
    return 0n;
  }
}

function findTracePayment(call: TraceCall | null | undefined, user: string, treasuryWallet: string): bigint {
  if (!call) return 0n;
  const from = normalizeAddressOrEmpty(call.from);
  const to = normalizeAddressOrEmpty(call.to);
  const value = traceValue(call.value);
  if (from === user.toLowerCase() && to === treasuryWallet.toLowerCase() && value > 0n) return value;
  for (const child of call.calls || []) {
    const childValue = findTracePayment(child, user, treasuryWallet);
    if (childValue > 0n) return childValue;
  }
  return 0n;
}

async function tracePaymentValue(
  txHash: string,
  user: string,
  treasuryWallet: string,
  providers: ethers.JsonRpcProvider[],
) {
  for (const provider of providers) {
    const trace = await provider.send("debug_traceTransaction", [txHash, { tracer: "callTracer" }]).catch(() => null) as TraceCall | null;
    const tracedValue = findTracePayment(trace, user, treasuryWallet);
    if (tracedValue > 0n) return tracedValue;
  }
  return 0n;
}

function normalizeAddressOrEmpty(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

async function resolveRechargePayment(
  provider: ethers.JsonRpcProvider,
  txHash: string,
  user: string,
  treasuryWallet: string,
  fallbackTraceProvider?: ethers.JsonRpcProvider,
) {
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!tx) throw Object.assign(new Error("Recharge transaction is not available yet."), { status: 409 });
  if (!receipt) throw Object.assign(new Error("Recharge transaction is not confirmed yet."), { status: 409 });
  if (receipt.status !== 1) throw Object.assign(new Error("Recharge transaction failed on-chain."), { status: 400 });

  const directSenderMatches = ethers.getAddress(tx.from) === user;
  const directRecipientMatches = Boolean(tx.to && ethers.getAddress(tx.to) === treasuryWallet);
  if (directSenderMatches && directRecipientMatches && tx.value > 0n) {
    return { monAmountRaw: tx.value, paymentSource: "direct-transfer" };
  }

  const traceProviders = fallbackTraceProvider ? [provider, fallbackTraceProvider] : [provider];
  const tracedValue = await tracePaymentValue(txHash, user, treasuryWallet, traceProviders);
  if (tracedValue > 0n) {
    return { monAmountRaw: tracedValue, paymentSource: "smart-wallet-trace" };
  }

  if (!directSenderMatches) throw Object.assign(new Error("Recharge sender does not match connected wallet."), { status: 400 });
  if (!directRecipientMatches) throw Object.assign(new Error("Recharge recipient does not match treasury wallet."), { status: 400 });
  throw Object.assign(new Error("Recharge transaction did not send MON."), { status: 400 });
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
      const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
      const signer = new ethers.Wallet(signerKey, provider);
      const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
      body.operatorAddress = signer.address;
      try {
        const creditRole = await bank.CREDIT_ROLE();
        const hasCreditRole = await bank.hasRole(creditRole, signer.address);
        body.creditReady = hasCreditRole;
        if (!hasCreditRole) body.creditUnavailableReason = "Energy Bank operator does not have CREDIT_ROLE.";
      } catch {
        body.creditReady = true;
        body.creditUnavailableReason = "Role preflight unavailable; credit transaction will validate on submit.";
      }
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

    const rpcUrl = readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const fallbackTraceProvider = rpcUrl === DEFAULT_RPC ? undefined : new ethers.JsonRpcProvider(DEFAULT_RPC);
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
    }

    const payment = await resolveRechargePayment(provider, txHash, user, treasuryWallet, fallbackTraceProvider);
    if (requestedMonAmountRaw && payment.monAmountRaw !== requestedMonAmountRaw) {
      return json(400, { ok: false, error: "Recharge amount does not match requested MON amount." });
    }

    const monAmountRaw = payment.monAmountRaw;
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
        paymentSource: payment.paymentSource,
      });
    }

    await bank.creditEnergy.staticCall(user, expectedEnergyRaw, txHash);
    const creditTx = await bank.creditEnergy(user, expectedEnergyRaw, txHash, { gasLimit: ENERGY_CREDIT_GAS_LIMIT });
    const creditReceipt = await creditTx.wait();

    return json(200, {
      ok: true,
      user,
      treasuryWallet,
      energyBankAddress,
      monAmountRaw: monAmountRaw.toString(),
      energyAmountRaw: expectedEnergyRaw.toString(),
      paymentTxHash: txHash,
      paymentSource: payment.paymentSource,
      creditTxHash: creditTx.hash,
      creditBlock: creditReceipt?.blockNumber ?? null,
    });
  } catch (error) {
    return json(Number((error as any)?.status || 500), { ok: false, error: error instanceof Error ? error.message : "Recharge failed. Please try again." });
  }
}
