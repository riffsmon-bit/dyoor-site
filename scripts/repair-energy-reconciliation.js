import dotenv from "dotenv";
import { ethers } from "ethers";
import fs from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const CHAIN_ID = 143n;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const DEFAULT_REPORT_DIR = "data";
const DEFAULT_LOG_PATH = "data/energy-reconciliation-repair-log.json";
const GAS_LIMIT = 160000n;

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function correctEnergy(address user,int256 delta,bytes32 reason)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function paused() view returns (bool)",
];

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : fallback;
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizePrivateKey(value) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function safeBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function formatEnergy(raw) {
  return ethers.formatUnits(raw, 18).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function retryableRpcError(error) {
  const code = error?.info?.error?.code || error?.error?.code || error?.code || error?.cause?.code || "";
  const message = String(error?.shortMessage || error?.info?.error?.message || error?.error?.message || error?.message || "");
  return String(code) === "429" || /rate limit|too many|timeout|timed out|429|ECONNRESET|ETIMEDOUT|coalesce|missing revert data|server error/i.test(message);
}

function formatError(error) {
  return String(
    error?.shortMessage
    || error?.reason
    || error?.info?.error?.message
    || error?.error?.message
    || error?.message
    || "repair failed",
  ).replace(/\s+/g, " ").slice(0, 800);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryRpc(task, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!retryableRpcError(error) || attempt === attempts - 1) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function latestReportPath() {
  const explicit = arg("--report", readEnv("ENERGY_RECONCILIATION_REPORT"));
  if (explicit) return explicit;
  const entries = await fs.readdir(DEFAULT_REPORT_DIR).catch(() => []);
  const reports = entries
    .filter((entry) => /^energy-reconciliation-\d{4}-\d{2}-\d{2}\.json$/u.test(entry))
    .sort();
  if (!reports.length) throw new Error("No data/energy-reconciliation-YYYY-MM-DD.json report found. Run node scripts/generate-energy-reconciliation-report.js first.");
  return path.join(DEFAULT_REPORT_DIR, reports.at(-1));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function waitForTx(tx, provider) {
  try {
    return await tx.wait();
  } catch (error) {
    if (!retryableRpcError(error)) throw error;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(1000 * (attempt + 1));
    const receipt = await retryRpc(() => provider.getTransactionReceipt(tx.hash)).catch(() => null);
    if (!receipt) continue;
    if (receipt.status !== 1) throw new Error(`Submitted transaction ${tx.hash} reverted.`);
    return receipt;
  }
  throw new Error(`Submitted transaction ${tx.hash}, but receipt lookup timed out. Check MonadScan before retrying.`);
}

function candidatesFromReport(report, successfulIssueIds) {
  return (Array.isArray(report.rows) ? report.rows : [])
    .filter((row) => row.affected === "yes" && row.repairable === "yes")
    .flatMap((row) => (Array.isArray(row.repairItems) ? row.repairItems : []).map((item) => ({
      wallet: row.wallet,
      ...item,
    })))
    .filter((item) => item.wallet && item.method && item.amountRaw && item.claimKey)
    .filter((item) => !item.issueId || !successfulIssueIds.has(String(item.issueId)));
}

async function main() {
  const execute = process.argv.includes("--execute") || process.env.EXECUTE_ENERGY_REPAIR === "1";
  const limitInput = Number(arg("--limit", process.env.ENERGY_REPAIR_LIMIT || "5"));
  const limit = Number.isSafeInteger(limitInput) ? Math.max(1, Math.min(25, limitInput)) : 5;
  const reportPath = await latestReportPath();
  const logPath = arg("--log", readEnv("ENERGY_REPAIR_LOG") || DEFAULT_LOG_PATH);
  const report = await readJson(reportPath, null);
  if (!report) throw new Error(`Could not read report: ${reportPath}`);

  const rpcUrl = readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC;
  const energyBankAddress = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK);
  const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
  if (!signerKey) throw new Error("Set ENERGY_BANK_OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY before repair.");

  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID));
  const network = await retryRpc(() => provider.getNetwork());
  if (network.chainId !== CHAIN_ID) throw new Error(`Wrong chain. Expected ${CHAIN_ID}, got ${network.chainId}.`);

  const signer = new ethers.Wallet(signerKey, provider);
  const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
  const [creditRole, adminRole, paused] = await Promise.all([
    retryRpc(() => bank.CREDIT_ROLE()),
    retryRpc(() => bank.DEFAULT_ADMIN_ROLE()),
    retryRpc(() => bank.paused().then(Boolean)),
  ]);
  const [hasCreditRole, hasAdminRole] = await Promise.all([
    retryRpc(() => bank.hasRole(creditRole, signer.address).then(Boolean)),
    retryRpc(() => bank.hasRole(adminRole, signer.address).then(Boolean)),
  ]);
  if (paused) throw new Error("Energy Bank is paused.");
  if (!hasCreditRole) throw new Error(`${signer.address} does not have CREDIT_ROLE.`);

  const repairLog = await readJson(logPath, []);
  const successfulIssueIds = new Set((Array.isArray(repairLog) ? repairLog : []).flatMap((entry) => (
    Array.isArray(entry.results)
      ? entry.results.filter((item) => item.status === "success" && item.issueId).map((item) => String(item.issueId))
      : []
  )));

  const allCandidates = candidatesFromReport(report, successfulIssueIds);
  const selected = allCandidates.slice(0, limit);
  const needsAdmin = selected.some((item) => item.method === "correctEnergy");
  if (needsAdmin && !hasAdminRole) throw new Error(`${signer.address} needs DEFAULT_ADMIN_ROLE for correctEnergy repair rows.`);

  console.log("Energy reconciliation repair");
  console.log("Mode:", execute ? "EXECUTE" : "DRY RUN");
  console.log("Report:", reportPath);
  console.log("Log:", logPath);
  console.log("Operator:", signer.address);
  console.log("Energy Bank:", energyBankAddress);
  console.log("Chain:", network.chainId.toString());
  console.log("Report affected wallets:", report.affectedCount);
  console.log("Report recommended credit:", report.totalRecommendedCredit);
  console.log("Pending repair actions:", allCandidates.length);
  console.log("Selected actions:", selected.length);

  if (!selected.length) {
    console.log("Nothing to repair.");
    return;
  }

  const results = [];
  for (const [index, item] of selected.entries()) {
    const amount = safeBigInt(item.amountRaw);
    const label = `[${index + 1}/${selected.length}] ${item.method} ${item.wallet} ${formatEnergy(amount)} claim=${item.claimKey}`;
    let txHash = "";
    try {
      console.log(execute ? `executing ${label}` : `candidate ${label}`);
      if (amount <= 0n) throw new Error("Invalid repair amount.");
      if (item.method === "creditEnergy") {
        const used = await retryRpc(() => bank.usedClaimTxHash(item.claimKey).then(Boolean));
        if (used) {
          results.push({ ...item, status: "skipped", reason: "Claim key already credited." });
          console.log("  skipped: claim key already credited");
          continue;
        }
        await retryRpc(() => bank.creditEnergy.staticCall(item.wallet, amount, item.claimKey));
        if (execute) {
          const tx = await bank.creditEnergy(item.wallet, amount, item.claimKey, { gasLimit: GAS_LIMIT });
          txHash = tx.hash;
          const receipt = await waitForTx(tx, provider);
          console.log(`  tx=${tx.hash} block=${receipt?.blockNumber ?? "unknown"}`);
          results.push({ ...item, status: "success", creditTxHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
        } else {
          results.push({ ...item, status: "ready" });
        }
      } else if (item.method === "correctEnergy") {
        await retryRpc(() => bank.correctEnergy.staticCall(item.wallet, amount, item.claimKey));
        if (execute) {
          const tx = await bank.correctEnergy(item.wallet, amount, item.claimKey, { gasLimit: GAS_LIMIT });
          txHash = tx.hash;
          const receipt = await waitForTx(tx, provider);
          console.log(`  tx=${tx.hash} block=${receipt?.blockNumber ?? "unknown"}`);
          results.push({ ...item, status: "success", creditTxHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
        } else {
          results.push({ ...item, status: "ready" });
        }
      } else {
        throw new Error(`Unsupported repair method ${item.method}.`);
      }
    } catch (error) {
      const formatted = formatError(error);
      console.log(`  failed: ${formatted}`);
      results.push({ ...item, status: "failed", creditTxHash: txHash || undefined, error: formatted });
    }

    if (execute) {
      const nextLog = [
        ...(Array.isArray(repairLog) ? repairLog : []),
        {
          repairedAt: new Date().toISOString(),
          reportPath,
          operator: signer.address,
          results: [results.at(-1)],
        },
      ];
      await writeJson(logPath, nextLog);
      repairLog.splice(0, repairLog.length, ...nextLog);
    }
  }

  const successCount = results.filter((item) => item.status === "success").length;
  const readyCount = results.filter((item) => item.status === "ready").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  const failureCount = results.filter((item) => item.status === "failed").length;
  console.log("");
  console.log("Repair summary");
  console.log("Ready:", readyCount);
  console.log("Success:", successCount);
  console.log("Skipped:", skippedCount);
  console.log("Failed:", failureCount);
  if (!execute) console.log("Run again with --execute to send this batch.");
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
