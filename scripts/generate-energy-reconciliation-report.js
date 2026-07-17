import dotenv from "dotenv";
import { ethers } from "ethers";
import fs from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const CHAIN_ID = 143n;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const DEFAULT_LEDGER_PATH = "data/harvested-energy.json";
const GOLDSKY_PAGE_SIZE = 1000;

const ENERGY_BANK_ABI = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
];

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeAddress(value) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
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

function isTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

function retryableRpcError(error) {
  const code = error?.info?.error?.code || error?.error?.code || error?.code || error?.cause?.code || "";
  const message = String(error?.shortMessage || error?.info?.error?.message || error?.error?.message || error?.message || "");
  return String(code) === "429" || /rate limit|too many|timeout|timed out|429|ECONNRESET|ETIMEDOUT|coalesce|missing revert data|server error/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryRpc(task, attempts = 5) {
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

function legacyClaimKey(wallet, txHash, index) {
  if (isTxHash(txHash)) return String(txHash).toLowerCase();
  return ethers.keccak256(ethers.toUtf8Bytes(`dyoor-legacy-harvest:${wallet}:${txHash || index}`));
}

function reconciliationIssueId(wallet, amountRaw, claimKeys) {
  return ethers.keccak256(ethers.toUtf8Bytes([
    "dyoor-reconciliation",
    wallet.toLowerCase(),
    amountRaw.toString(),
    ...claimKeys.map((claimKey) => claimKey.toLowerCase()).sort(),
  ].join("|")));
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

async function readHarvestLedger() {
  try {
    const ledgerPath = readEnv("HARVEST_LEDGER_PATH") || DEFAULT_LEDGER_PATH;
    const local = await fs.readFile(ledgerPath, "utf8");
    const parsed = JSON.parse(local);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function fetchGoldskyHarvests() {
  const endpoint = readEnv("GOLDSKY_SUBGRAPH_URL", "NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL");
  if (!endpoint) throw new Error("Set GOLDSKY_SUBGRAPH_URL or NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL before generating the reconciliation report.");

  const rows = [];
  let indexedBlock = 0;
  for (let skip = 0; skip < 50_000; skip += GOLDSKY_PAGE_SIZE) {
    const query = `
      query DyoorHarvestReconciliation($skip: Int!) {
        _meta { block { number } }
        pointsClaimeds(first: ${GOLDSKY_PAGE_SIZE}, skip: $skip, orderBy: block_number, orderDirection: asc) {
          id
          block_number
          timestamp_
          transactionHash_
          user
          amount
        }
      }
    `;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { skip } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) throw new Error("Goldsky harvest reconciliation query failed.");
    indexedBlock = Math.max(indexedBlock, Number(payload?.data?._meta?.block?.number || 0));
    const batch = Array.isArray(payload?.data?.pointsClaimeds) ? payload.data.pointsClaimeds : [];
    rows.push(...batch);
    if (batch.length < GOLDSKY_PAGE_SIZE) break;
  }

  const seen = new Set();
  const harvests = [];
  for (const row of rows) {
    const wallet = normalizeAddress(row.user);
    const txHash = String(row.transactionHash_ || "").toLowerCase();
    const id = String(row.id || `${txHash}:${row.block_number || ""}`);
    if (!wallet || !isTxHash(txHash) || seen.has(id)) continue;
    seen.add(id);
    const amountRaw = safeBigInt(row.amount);
    if (amountRaw <= 0n) continue;
    harvests.push({
      id,
      source: "goldsky",
      wallet,
      amountRaw,
      txHash,
      claimKey: txHash,
      blockNumber: String(row.block_number || ""),
    });
  }

  return { harvests, indexedBlock };
}

function mergeLegacyHarvests(harvests, ledger) {
  const txHashes = new Set(harvests.map((item) => item.txHash).filter(isTxHash));
  const merged = [...harvests];

  for (const [walletRaw, entry] of Object.entries(ledger)) {
    const wallet = normalizeAddress(walletRaw);
    if (!wallet) continue;
    const claims = Array.isArray(entry?.claims) ? entry.claims : [];
    let claimSum = 0n;

    claims.forEach((claim, index) => {
      const txHash = String(claim?.txHash || "").toLowerCase();
      const amountRaw = safeBigInt(claim?.amountRaw);
      if (amountRaw <= 0n) return;
      claimSum += amountRaw;
      if (isTxHash(txHash) && txHashes.has(txHash)) return;
      merged.push({
        id: `legacy:${wallet}:${txHash || index}`,
        source: "legacy",
        wallet,
        amountRaw,
        txHash: txHash || `legacy-${index}`,
        claimKey: legacyClaimKey(wallet, txHash, index),
        blockNumber: "",
      });
    });

    const ledgerTotal = safeBigInt(entry?.harvestedRaw);
    const indexedForWallet = harvests.filter((item) => item.wallet === wallet).reduce((sum, item) => sum + item.amountRaw, 0n);
    if (ledgerTotal > indexedForWallet + claimSum) {
      const amountRaw = ledgerTotal - indexedForWallet - claimSum;
      merged.push({
        id: `legacy-total-diff:${wallet}`,
        source: "legacy",
        wallet,
        amountRaw,
        txHash: "legacy-total-diff",
        claimKey: legacyClaimKey(wallet, "legacy-total-diff", 0),
        blockNumber: "",
      });
    }
  }

  return merged;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (value) => {
    const printable = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    return `"${printable.replaceAll("\"", "\"\"")}"`;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => esc(row[header])).join(","))].join("\n");
}

async function buildReport() {
  const [indexed, ledger] = await Promise.all([
    fetchGoldskyHarvests(),
    readHarvestLedger(),
  ]);
  const rpcUrl = readEnv("MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL") || DEFAULT_RPC;
  const energyBankAddress = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK);
  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID));
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`Wrong chain. Expected ${CHAIN_ID}, got ${network.chainId}`);

  const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, provider);
  const harvests = mergeLegacyHarvests(indexed.harvests, ledger);
  const wallets = Array.from(new Set(harvests.map((item) => item.wallet))).sort();
  const allClaimKeys = Array.from(new Set(harvests.map((item) => item.claimKey)));
  const usedPairs = await mapLimit(allClaimKeys, 4, async (claimKey) => {
    const used = await retryRpc(() => bank.usedClaimTxHash(claimKey));
    return [claimKey, Boolean(used)];
  });
  const usedClaimKeys = new Map(usedPairs);

  const rows = await mapLimit(wallets, 4, async (wallet) => {
    const walletHarvests = harvests.filter((item) => item.wallet === wallet);
    const eventHarvests = walletHarvests.filter((item) => item.source === "goldsky");
    const legacyHarvests = walletHarvests.filter((item) => item.source === "legacy");
    const [bankRaw, lifetimeRaw, spentRaw] = await Promise.all([
      retryRpc(() => bank.spendableEnergy(wallet)),
      retryRpc(() => bank.lifetimeEnergy(wallet)),
      retryRpc(() => bank.totalSpent(wallet)),
    ]);

    const expectedHarvestedRaw = walletHarvests.reduce((sum, item) => sum + item.amountRaw, 0n);
    const eventHarvestedRaw = eventHarvests.reduce((sum, item) => sum + item.amountRaw, 0n);
    const legacyHarvestedRaw = legacyHarvests.reduce((sum, item) => sum + item.amountRaw, 0n);
    const creditedHarvestRaw = walletHarvests.filter((item) => usedClaimKeys.get(item.claimKey)).reduce((sum, item) => sum + item.amountRaw, 0n);
    const uncreditedItems = walletHarvests.filter((item) => !usedClaimKeys.get(item.claimKey));
    const creditedItems = walletHarvests.filter((item) => usedClaimKeys.get(item.claimKey));
    const uncreditedHarvestRaw = uncreditedItems.reduce((sum, item) => sum + item.amountRaw, 0n);
    const nonHarvestLifetimeRaw = lifetimeRaw > creditedHarvestRaw ? lifetimeRaw - creditedHarvestRaw : 0n;
    const expectedLifetimeRaw = nonHarvestLifetimeRaw + expectedHarvestedRaw;
    const expectedBankRaw = expectedLifetimeRaw > spentRaw ? expectedLifetimeRaw - spentRaw : 0n;
    const missingRaw = expectedBankRaw > bankRaw ? expectedBankRaw - bankRaw : 0n;
    let selectedRepairRaw = 0n;
    const repairItems = [];
    for (const item of uncreditedItems) {
      if (selectedRepairRaw + item.amountRaw > missingRaw) continue;
      selectedRepairRaw += item.amountRaw;
      repairItems.push({
        method: "creditEnergy",
        source: item.source,
        txHash: item.txHash,
        claimKey: item.claimKey,
        issueId: item.claimKey,
        amountRaw: item.amountRaw.toString(),
      });
    }
    const usedClaimShortfallRaw = creditedHarvestRaw > lifetimeRaw ? creditedHarvestRaw - lifetimeRaw : 0n;
    const remainingMissingRaw = missingRaw > selectedRepairRaw ? missingRaw - selectedRepairRaw : 0n;
    const correctionRaw = usedClaimShortfallRaw < remainingMissingRaw ? usedClaimShortfallRaw : remainingMissingRaw;
    if (correctionRaw > 0n) {
      const correctionIssueId = reconciliationIssueId(wallet, correctionRaw, creditedItems.map((item) => item.claimKey));
      repairItems.push({
        method: "correctEnergy",
        source: "reconciliation",
        txHash: creditedItems.map((item) => item.txHash).join(" "),
        claimKey: correctionIssueId,
        issueId: correctionIssueId,
        amountRaw: correctionRaw.toString(),
      });
      selectedRepairRaw += correctionRaw;
    }
    const recommendedCreditRaw = selectedRepairRaw;
    const repairable = missingRaw > 0n && selectedRepairRaw === missingRaw;

    return {
      wallet,
      totalHarvestedFromEvents: formatEnergy(eventHarvestedRaw),
      totalHarvestedFromEventsRaw: eventHarvestedRaw.toString(),
      legacyHarvested: formatEnergy(legacyHarvestedRaw),
      legacyHarvestedRaw: legacyHarvestedRaw.toString(),
      harvestedShown: formatEnergy(expectedHarvestedRaw),
      harvestedShownRaw: expectedHarvestedRaw.toString(),
      lifetimeShown: formatEnergy(lifetimeRaw),
      lifetimeShownRaw: lifetimeRaw.toString(),
      bankShown: formatEnergy(bankRaw),
      bankShownRaw: bankRaw.toString(),
      spent: formatEnergy(spentRaw),
      spentRaw: spentRaw.toString(),
      expectedHarvested: formatEnergy(expectedHarvestedRaw),
      expectedHarvestedRaw: expectedHarvestedRaw.toString(),
      expectedLifetime: formatEnergy(expectedLifetimeRaw),
      expectedLifetimeRaw: expectedLifetimeRaw.toString(),
      expectedBank: formatEnergy(expectedBankRaw),
      expectedBankRaw: expectedBankRaw.toString(),
      creditedHarvest: formatEnergy(creditedHarvestRaw),
      creditedHarvestRaw: creditedHarvestRaw.toString(),
      uncreditedHarvest: formatEnergy(uncreditedHarvestRaw),
      uncreditedHarvestRaw: uncreditedHarvestRaw.toString(),
      missing: formatEnergy(missingRaw),
      missingRaw: missingRaw.toString(),
      affected: missingRaw > 0n ? "yes" : "no",
      recommendedCredit: formatEnergy(recommendedCreditRaw),
      recommendedCreditRaw: recommendedCreditRaw.toString(),
      repairable: repairable ? "yes" : "no",
      evidenceTxHashes: walletHarvests.map((item) => item.txHash).join(" "),
      evidenceClaimKeys: walletHarvests.map((item) => item.claimKey).join(" "),
      notes: missingRaw > 0n && !repairable
        ? "Recommended amount does not align to whole harvest events; review manually before crediting."
        : "",
      repairItems,
    };
  });

  const affectedRows = rows.filter((row) => row.affected === "yes");
  const totalMissingRaw = affectedRows.reduce((sum, row) => sum + safeBigInt(row.missingRaw), 0n);
  const totalRecommendedCreditRaw = affectedRows.reduce((sum, row) => sum + safeBigInt(row.recommendedCreditRaw), 0n);

  return {
    generatedAt: new Date().toISOString(),
    indexedBlock: indexed.indexedBlock,
    energyBankAddress: energyBankAddress.toLowerCase(),
    rowCount: rows.length,
    affectedCount: affectedRows.length,
    totalMissingRaw: totalMissingRaw.toString(),
    totalMissing: formatEnergy(totalMissingRaw),
    totalRecommendedCreditRaw: totalRecommendedCreditRaw.toString(),
    totalRecommendedCredit: formatEnergy(totalRecommendedCreditRaw),
    rows,
  };
}

const report = await buildReport();
const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
const jsonPath = path.join("data", `energy-reconciliation-${stamp}.json`);
const csvPath = path.join("data", `energy-reconciliation-${stamp}.csv`);

await fs.mkdir("data", { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
await fs.writeFile(csvPath, toCsv(report.rows));

console.log("Energy reconciliation report generated");
console.log(`JSON: ${jsonPath}`);
console.log(`CSV: ${csvPath}`);
console.log(`Wallets checked: ${report.rowCount}`);
console.log(`Affected wallets: ${report.affectedCount}`);
console.log(`Recommended credit: ${report.totalRecommendedCredit}`);
