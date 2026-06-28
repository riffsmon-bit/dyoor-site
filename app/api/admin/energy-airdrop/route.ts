import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";
import { verifyAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const AIRDROP_BATCH_SIZE = 150;

const ENERGY_BANK_ABI = [
  "function usedAirdropCampaign(bytes32 campaignId) view returns (bool)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function airdropEnergy(address[] recipients,uint256 amount,bytes32 campaignId)",
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

function normalizeAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function requireUint(value: unknown, label: string) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error(`${label} must be an integer string.`), { status: 400 });
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw Object.assign(new Error(`${label} must be greater than zero.`), { status: 400 });
  return parsed;
}

function campaignHash(label: string) {
  const campaignId = /^0x[a-fA-F0-9]{64}$/.test(label)
    ? label
    : ethers.keccak256(ethers.toUtf8Bytes(label));
  if (campaignId === ethers.ZeroHash) {
    throw Object.assign(new Error("campaignId cannot be zero."), { status: 400 });
  }
  return campaignId;
}

function recipientClaimHash(campaignLabel: string, wallet: string) {
  return ethers.keccak256(ethers.toUtf8Bytes([
    "dyoor-energy-airdrop",
    campaignLabel,
    wallet.toLowerCase(),
  ].join("|")));
}

function chunkRecipients(recipients: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < recipients.length; index += AIRDROP_BATCH_SIZE) {
    chunks.push(recipients.slice(index, index + AIRDROP_BATCH_SIZE));
  }
  return chunks;
}

async function readRole(bank: ethers.Contract, roleName: "CREDIT_ROLE") {
  try {
    const role = await bank[roleName]();
    return ethers.getBytes(role).length === 32 ? String(role) : "";
  } catch {
    return "";
  }
}

async function hasRole(bank: ethers.Contract, role: string, account: string) {
  if (!role) return null;
  try {
    return Boolean(await bank.hasRole(role, account));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    await verifyAdmin(body, "energy-airdrop");
    const inputRecipients: unknown[] = Array.isArray(body.recipients) ? body.recipients : [];
    const recipients = Array.from(new Set<string>(inputRecipients
      .map((item: unknown) => normalizeAddress(item))
      .filter((item): item is string => Boolean(item))));
    const amount = requireUint(body.amountRaw, "amountRaw");
    const campaignLabel = String(body.campaignId || "").trim();
    const note = String(body.note || "").slice(0, 500);
    if (!recipients.length) return json(400, { ok: false, error: "At least one recipient is required." });
    if (!campaignLabel) return json(400, { ok: false, error: "campaignId is required." });

    const energyBankAddress = normalizeAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT);
    if (!energyBankAddress) return json(500, { ok: false, error: "ENERGY_BANK_ADDRESS is invalid." });
    const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
    if (!signerKey) return json(500, { ok: false, error: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY." });

    const provider = new ethers.JsonRpcProvider(readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC);
    const signer = new ethers.Wallet(signerKey, provider);
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const [network, creditRole, hasAdminRole] = await Promise.all([
      provider.getNetwork(),
      readRole(bank, "CREDIT_ROLE"),
      bank.hasRole(ethers.ZeroHash, signer.address).then(Boolean).catch(() => false),
    ]);
    if (network.chainId !== BigInt(MONAD_CHAIN_ID)) {
      throw new Error(`Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`);
    }
    const hasCreditRole = await hasRole(bank, creditRole, signer.address);
    const preferCreditEnergy = hasCreditRole !== false;
    if (!hasAdminRole && hasCreditRole === false) {
      return json(500, { ok: false, error: "Energy Bank operator needs DEFAULT_ADMIN_ROLE or CREDIT_ROLE." });
    }

    const batches = chunkRecipients(recipients);
    const results: Array<Record<string, unknown>> = [];
    const txHashes: string[] = [];
    const blockNumbers: Array<number | null> = [];
    const campaignIds: string[] = [];

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchLabel = batches.length === 1 ? campaignLabel : `${campaignLabel}:batch:${index + 1}/${batches.length}`;
      const campaignId = campaignHash(batchLabel);
      campaignIds.push(campaignId);

      try {
        if (!preferCreditEnergy && hasAdminRole) {
          const alreadyUsed = await bank.usedAirdropCampaign(campaignId);
          if (alreadyUsed) {
            batch.forEach((wallet) => results.push({
              wallet,
              status: "skipped",
              amountRaw: amount.toString(),
              campaignId,
              error: "Airdrop campaign was already used.",
            }));
            continue;
          }

          await bank.airdropEnergy.staticCall(batch, amount, campaignId);
          const tx = await bank.airdropEnergy(batch, amount, campaignId);
          const receipt = await tx.wait();
          txHashes.push(tx.hash);
          blockNumbers.push(receipt?.blockNumber ?? null);
          batch.forEach((wallet) => results.push({
            wallet,
            status: "success",
            method: "airdropEnergy",
            amountRaw: amount.toString(),
            campaignId,
            txHash: tx.hash,
            blockNumber: receipt?.blockNumber ?? null,
          }));
          continue;
        }

        for (const wallet of batch) {
          const claimId = recipientClaimHash(batchLabel, wallet);
          try {
            const alreadyUsed = await bank.usedClaimTxHash(claimId);
            if (alreadyUsed) {
              results.push({
                wallet,
                status: "skipped",
                method: "creditEnergy",
                amountRaw: amount.toString(),
                campaignId: claimId,
                error: "Recipient campaign credit was already used.",
              });
              continue;
            }

            await bank.creditEnergy.staticCall(wallet, amount, claimId);
            const tx = await bank.creditEnergy(wallet, amount, claimId);
            const receipt = await tx.wait();
            txHashes.push(tx.hash);
            blockNumbers.push(receipt?.blockNumber ?? null);
            results.push({
              wallet,
              status: "success",
              method: "creditEnergy",
              amountRaw: amount.toString(),
              campaignId: claimId,
              txHash: tx.hash,
              blockNumber: receipt?.blockNumber ?? null,
            });
          } catch (error: any) {
            results.push({
              wallet,
              status: "failed",
              method: "creditEnergy",
              amountRaw: amount.toString(),
              campaignId: claimId,
              error: error?.shortMessage || error?.message || "Recipient credit failed.",
            });
          }
        }
      } catch (error: any) {
        batch.forEach((wallet) => results.push({
          wallet,
          status: "failed",
          amountRaw: amount.toString(),
          campaignId,
          error: error?.shortMessage || error?.message || "Batch failed.",
        }));
      }
    }

    const successfulWallets = results.filter((row) => row.status === "success").map((row) => String(row.wallet));
    const skippedWallets = results.filter((row) => row.status === "skipped").map((row) => String(row.wallet));
    const failedWallets = results.filter((row) => row.status === "failed").map((row) => ({
      wallet: String(row.wallet),
      error: String(row.error || "Airdrop failed."),
    }));

    const handledWallets = successfulWallets.length + skippedWallets.length;
    return json(handledWallets ? 200 : 500, {
      ok: handledWallets > 0 && failedWallets.length === 0,
      partial: handledWallets > 0 && failedWallets.length > 0,
      recipients,
      recipientCount: recipients.length,
      successfulWallets,
      skippedWallets,
      failedWallets,
      successCount: successfulWallets.length,
      skippedCount: skippedWallets.length,
      failureCount: failedWallets.length,
      amountRaw: amount.toString(),
      requestedTotalRaw: (amount * BigInt(recipients.length)).toString(),
      totalRaw: (amount * BigInt(successfulWallets.length)).toString(),
      campaignId: campaignIds[0] || "",
      campaignIds,
      txHash: txHashes[0] || "",
      txHashes,
      blockNumber: blockNumbers[0] ?? null,
      blockNumbers,
      batchSize: AIRDROP_BATCH_SIZE,
      batchCount: batches.length,
      executionMode: preferCreditEnergy ? "creditEnergy" : "airdropEnergy",
      roleCheck: {
        creditRoleAvailable: Boolean(creditRole),
        hasCreditRole,
        hasAdminRole,
      },
      actionId: txHashes[0] || campaignIds[0] || "",
      note,
      timestamp: new Date().toISOString(),
      results,
      error: failedWallets.length && !successfulWallets.length ? "Energy airdrop failed for every wallet." : undefined,
    });
  } catch (error: any) {
    return json(Number(error?.status || 500), { ok: false, error: error?.message || "Energy airdrop failed." });
  }
}
