import { ethers } from "ethers";
import { energyBankContract } from "@/lib/contracts/addresses";
import { addEnergyLedgerEntry } from "@/src/lib/storage/energyStore";
import { createJsonStore } from "@/src/lib/storage/fileStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSFER_WINDOW_MS = 5 * 60 * 1000;
const MONAD_CHAIN_ID = 143n;
const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";
const ENERGY_TRANSFER_PREFIX = "energy-transfers";

const ENERGY_BANK_ABI = [
  "function spendEnergy(address user,uint256 amount,bytes32 reason)",
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function spendableEnergy(address user) view returns (uint256)",
  "function SPENDER_ROLE() view returns (bytes32)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

type EnergyTransferJob = {
  transferId: string;
  sender: string;
  recipient: string;
  amountRaw: string;
  status: "spending" | "spent" | "credited" | "failed";
  spendReason: string;
  spendTxHash?: string;
  spendBlockNumber?: string;
  creditTxHash?: string;
  creditBlockNumber?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

const transferStore = createJsonStore("dyoor-energy-ledger");

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

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizePrivateKey(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function rpcUrl() {
  return readEnv("ENERGY_BANK_RPC_URL", "MONAD_RPC_URL", "DYOOR_S2_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "RPC_URL") || DEFAULT_MONAD_RPC_URL;
}

function energyBankSigner() {
  const privateKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY"));
  if (!privateKey) {
    throw Object.assign(new Error("ENERGY_BANK_OPERATOR_PRIVATE_KEY is required for Energy transfers."), { status: 500 });
  }
  return new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpcUrl()));
}

function nowIso() {
  return new Date().toISOString();
}

function transferKey(transferId: string) {
  return `${ENERGY_TRANSFER_PREFIX}/${transferId.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`;
}

async function getTransferJob(transferId: string) {
  return await transferStore.getJson<EnergyTransferJob | null>(transferKey(transferId), null);
}

async function saveTransferJob(job: EnergyTransferJob) {
  const now = nowIso();
  const next = {
    ...job,
    createdAt: job.createdAt || now,
    updatedAt: now,
  };
  await transferStore.setJson(transferKey(job.transferId), next);
  return next;
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

function transferSpendReason(transferId: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(`DYOOR Energy Transfer Spend:${transferId}`));
}

async function safeAddLedger(input: Parameters<typeof addEnergyLedgerEntry>[0]) {
  try {
    const result = await addEnergyLedgerEntry(input);
    return { ok: true, deduped: result.deduped };
  } catch (error: any) {
    return { ok: false, error: error?.message || "Ledger write failed." };
  }
}

async function settleExistingSpend(job: EnergyTransferJob, signer: ethers.Wallet) {
  if (!job.spendTxHash || job.status !== "spending") return job;
  const receipt = await signer.provider?.getTransactionReceipt(job.spendTxHash);
  if (!receipt) {
    throw Object.assign(new Error("Energy transfer spend transaction is still pending. Retry after confirmation."), { status: 409 });
  }
  if (receipt.status !== 1) {
    return await saveTransferJob({ ...job, status: "failed", error: "Spend transaction reverted." });
  }
  return await saveTransferJob({ ...job, status: "spent", spendBlockNumber: String(receipt.blockNumber || "") });
}

async function executeOnChainTransfer(sender: string, recipient: string, amount: bigint, transferId: string) {
  const signer = energyBankSigner();
  const network = await signer.provider?.getNetwork();
  if (network?.chainId !== MONAD_CHAIN_ID) {
    throw Object.assign(new Error(`Energy transfer RPC is on chain ${network?.chainId?.toString() || "unknown"}, expected Monad mainnet 143.`), { status: 500 });
  }

  const signerAddress = await signer.getAddress();
  const bank = new ethers.Contract(energyBankContract, ENERGY_BANK_ABI, signer);
  const [spenderRole, creditRole] = await Promise.all([bank.SPENDER_ROLE(), bank.CREDIT_ROLE()]);
  const [hasSpendRole, hasCreditRole] = await Promise.all([
    bank.hasRole(spenderRole, signerAddress).then(Boolean),
    bank.hasRole(creditRole, signerAddress).then(Boolean),
  ]);
  if (!hasSpendRole || !hasCreditRole) {
    throw Object.assign(new Error("Energy Bank operator needs SPENDER_ROLE and CREDIT_ROLE for wallet Energy transfers."), { status: 500 });
  }

  let job = await getTransferJob(transferId);
  if (job?.status === "credited") return { job, alreadyTransferred: true };
  if (job) job = await settleExistingSpend(job, signer);
  if (job?.status === "failed" && job.spendTxHash && !job.creditTxHash) {
    const spendReceipt = await signer.provider?.getTransactionReceipt(job.spendTxHash);
    if (spendReceipt?.status === 1) {
      job = await saveTransferJob({
        ...job,
        status: "spent",
        spendBlockNumber: job.spendBlockNumber || String(spendReceipt.blockNumber || ""),
        error: "",
      });
    }
  }
  if (job?.status === "failed") {
    throw Object.assign(new Error(job.error || "Previous Energy transfer attempt failed."), { status: 409 });
  }

  const spendReason = job?.spendReason || transferSpendReason(transferId);
  if (!job?.spendTxHash) {
    const spendable = BigInt(await bank.spendableEnergy(sender));
    if (spendable < amount) throw Object.assign(new Error("Insufficient spendable Energy."), { status: 400 });
    await bank.spendEnergy.staticCall(sender, amount, spendReason);
    let nextJob = await saveTransferJob({
      transferId,
      sender,
      recipient,
      amountRaw: amount.toString(),
      status: "spending",
      spendReason,
      createdAt: job?.createdAt || "",
      updatedAt: "",
    });
    const spendTx = await bank.spendEnergy(sender, amount, spendReason, { gasLimit: 160000n });
    nextJob = await saveTransferJob({ ...nextJob, spendTxHash: spendTx.hash });
    const spendReceipt = await spendTx.wait();
    if (spendReceipt?.status !== 1) {
      await saveTransferJob({ ...nextJob, status: "failed", error: "Spend transaction reverted." });
      throw Object.assign(new Error("Energy transfer spend transaction failed."), { status: 500 });
    }
    job = await saveTransferJob({ ...nextJob, status: "spent", spendBlockNumber: String(spendReceipt?.blockNumber || "") });
  }

  const alreadyCredited = await bank.usedClaimTxHash(transferId).then(Boolean).catch(() => false);
  if (!alreadyCredited) {
    await bank.creditEnergy.staticCall(recipient, amount, transferId);
    const creditTx = await bank.creditEnergy(recipient, amount, transferId, { gasLimit: 160000n });
    const creditReceipt = await creditTx.wait();
    if (creditReceipt?.status !== 1) {
      await saveTransferJob({ ...job, status: "failed", error: "Credit transaction reverted." });
      throw Object.assign(new Error("Energy transfer credit transaction failed. Retry before starting a new transfer."), { status: 500 });
    }
    job = await saveTransferJob({
      ...job,
      status: "credited",
      creditTxHash: creditTx.hash,
      creditBlockNumber: String(creditReceipt?.blockNumber || ""),
    });
  } else {
    job = await saveTransferJob({ ...job, status: "credited" });
  }

  return { job, alreadyTransferred: alreadyCredited };
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

    const { job, alreadyTransferred } = await executeOnChainTransfer(sender, recipient, amount, transferId);

    const debit = await safeAddLedger({
      id: `transfer:${transferId}:debit`,
      wallet: sender,
      amountRaw: amount.toString(),
      type: "DEBIT_TRANSFER",
      source: "wallet-energy-transfer",
      txHash: job.spendTxHash,
      blockNumber: job.spendBlockNumber,
      notes: `Transfer to ${recipient}.`,
    });
    const credit = await safeAddLedger({
      id: `transfer:${transferId}:credit`,
      wallet: recipient,
      amountRaw: amount.toString(),
      type: "CREDIT_TRANSFER",
      source: "wallet-energy-transfer",
      txHash: job.creditTxHash,
      blockNumber: job.creditBlockNumber,
      notes: `Transfer from ${sender}.`,
    });

    return json(200, {
      ok: true,
      alreadyTransferred,
      sender,
      recipient,
      amountRaw: amount.toString(),
      transferId,
      spendTxHash: job.spendTxHash || "",
      spendBlockNumber: job.spendBlockNumber || "",
      creditTxHash: job.creditTxHash || "",
      creditBlockNumber: job.creditBlockNumber || "",
      debitLedger: debit,
      creditLedger: credit,
      executionMode: "energy-bank",
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy transfer failed." });
  }
}
