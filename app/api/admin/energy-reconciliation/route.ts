import fs from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { ethers } from "ethers";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { DEFAULT_ASCENSION_STAKING_CONTRACT, DEFAULT_ENERGY_BANK_CONTRACT } from "@/lib/contracts/addresses";
import { verifyAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RPC = "https://rpc.monad.xyz";
const GOLDSKY_PAGE_SIZE = 1000;
const LOCAL_HARVEST_LEDGER_PATH = path.join(process.cwd(), "data", "harvested-energy.json");
const REPAIR_BATCH_LIMIT = 10;
const MAX_REPAIR_BATCH_LIMIT = 25;
const ENERGY_REPAIR_GAS_LIMIT = 160_000n;

const ENERGY_BANK_ABI = [
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function paused() view returns (bool)",
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function correctEnergy(address user,int256 delta,bytes32 reason)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "error AccessControlUnauthorizedAccount(address account,bytes32 neededRole)",
  "error ClaimAlreadyUsed()",
  "error EnforcedPause()",
  "error ZeroAddress()",
  "error ZeroAmount()",
];

const ENERGY_BANK_IFACE = new ethers.Interface(ENERGY_BANK_ABI);

type HarvestItem = {
  id: string;
  source: "goldsky" | "legacy";
  wallet: string;
  amountRaw: bigint;
  txHash: string;
  claimKey: string;
  blockNumber: string;
};

type ReconciliationRow = {
  wallet: string;
  totalHarvestedFromEventsRaw: string;
  totalHarvestedFromEvents: string;
  legacyHarvestedRaw: string;
  legacyHarvested: string;
  harvestedShownRaw: string;
  harvestedShown: string;
  lifetimeShownRaw: string;
  lifetimeShown: string;
  bankShownRaw: string;
  bankShown: string;
  spentRaw: string;
  spent: string;
  expectedHarvestedRaw: string;
  expectedHarvested: string;
  expectedLifetimeRaw: string;
  expectedLifetime: string;
  expectedBankRaw: string;
  expectedBank: string;
  creditedHarvestRaw: string;
  creditedHarvest: string;
  uncreditedHarvestRaw: string;
  uncreditedHarvest: string;
  missingRaw: string;
  missing: string;
  affected: "yes" | "no";
  recommendedCreditRaw: string;
  recommendedCredit: string;
  repairable: "yes" | "no";
  evidenceTxHashes: string;
  evidenceClaimKeys: string;
  notes: string;
  repairItems: Array<{
    method: string;
    source: string;
    txHash: string;
    claimKey: string;
    issueId: string;
    amountRaw: string;
  }>;
};

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

function isTestnetLikeUrl(value: string) {
  return /testnet/i.test(value);
}

function configuredMonadRpcUrl() {
  for (const name of ["MONAD_RPC_URL", "DYOOR_S2_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "RPC_URL"]) {
    const value = readEnv(name);
    if (value && !isTestnetLikeUrl(value)) return value;
  }
  return DEFAULT_RPC;
}

function secretsEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || "")).toLowerCase();
  } catch {
    return "";
  }
}

function normalizePrivateKey(value: string) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function isTxHash(value: unknown) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

function safeBigInt(value: unknown) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function formatEnergy(raw: bigint) {
  return ethers.formatUnits(raw, 18).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatContractError(error: any) {
  const data = String(error?.data || error?.error?.data || error?.info?.error?.data || "");
  if (data.startsWith("0x")) {
    try {
      const parsed = ENERGY_BANK_IFACE.parseError(data);
      if (parsed?.name === "AccessControlUnauthorizedAccount") {
        return `Energy Bank operator ${String(parsed.args?.account || "").toLowerCase()} is missing role ${String(parsed.args?.neededRole || "")}.`;
      }
      if (parsed?.name === "ClaimAlreadyUsed") return "Claim key is already credited.";
      if (parsed?.name === "EnforcedPause") return "Energy Bank is paused.";
      if (parsed?.name === "ZeroAddress") return "Recipient wallet is the zero address.";
      if (parsed?.name === "ZeroAmount") return "Repair amount or reason is zero.";
      if (parsed?.name) return `Energy Bank reverted with ${parsed.name}.`;
    } catch {}
  }
  return String(
    error?.shortMessage
    || error?.reason
    || error?.info?.payload?.method && `${error.info.payload.method} failed`
    || error?.info?.error?.message
    || error?.error?.message
    || error?.message
    || "Credit failed.",
  ).replace(/\s+/g, " ").slice(0, 800);
}

function formatPreflightError(step: string, error: any) {
  const message = formatContractError(error);
  const rpcCode = error?.info?.error?.code || error?.error?.code || error?.code || "";
  const rpcMethod = error?.info?.payload?.method || "";
  const details = [
    `Energy Bank preflight failed at ${step}: ${message}`,
    rpcMethod ? `rpc=${rpcMethod}` : "",
    rpcCode ? `code=${rpcCode}` : "",
  ].filter(Boolean);
  return details.join(" ");
}

function retryableRpcError(error: any) {
  const code = error?.info?.error?.code || error?.error?.code || error?.code || error?.cause?.code || "";
  const message = String(
    error?.shortMessage
    || error?.info?.error?.message
    || error?.error?.message
    || error?.message
    || "",
  );
  return String(code) === "429" || /rate limit|too many|timeout|timed out|429|ECONNRESET|ETIMEDOUT/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryRpc<T>(task: () => Promise<T>) {
  let lastError: any;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await task();
    } catch (error: any) {
      lastError = error;
      if (!retryableRpcError(error) || attempt === 3) break;
      await sleep(350 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function preflightStep<T>(step: string, task: () => Promise<T>) {
  try {
    return await retryRpc(task);
  } catch (error: any) {
    throw Object.assign(new Error(formatPreflightError(step, error)), { step, cause: error });
  }
}

function legacyClaimKey(wallet: string, txHash: string, index: number) {
  if (isTxHash(txHash)) return String(txHash).toLowerCase();
  return ethers.keccak256(ethers.toUtf8Bytes(`dyoor-legacy-harvest:${wallet}:${txHash || index}`));
}

function reconciliationIssueId(wallet: string, amountRaw: bigint, claimKeys: string[]) {
  return ethers.keccak256(ethers.toUtf8Bytes([
    "dyoor-reconciliation",
    wallet.toLowerCase(),
    amountRaw.toString(),
    ...claimKeys.map((claimKey) => claimKey.toLowerCase()).sort(),
  ].join("|")));
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
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
    const local = await fs.readFile(LOCAL_HARVEST_LEDGER_PATH, "utf8");
    const value = JSON.parse(local);
    return value && typeof value === "object" ? value as Record<string, any> : {};
  } catch {
    return {};
  }
}

async function fetchGoldskyHarvests() {
  const endpoint = readEnv("GOLDSKY_SUBGRAPH_URL", "NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL");
  if (!endpoint) throw new Error("GOLDSKY_SUBGRAPH_URL is required for reconciliation.");
  const rows: any[] = [];
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
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) throw new Error("Goldsky harvest reconciliation query failed.");
    indexedBlock = Math.max(indexedBlock, Number(payload?.data?._meta?.block?.number || 0));
    const batch = Array.isArray(payload?.data?.pointsClaimeds) ? payload.data.pointsClaimeds : [];
    rows.push(...batch);
    if (batch.length < GOLDSKY_PAGE_SIZE) break;
  }

  const seen = new Set<string>();
  const harvests: HarvestItem[] = [];
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

function mergeLegacyHarvests(harvests: HarvestItem[], ledger: Record<string, any>) {
  const txHashes = new Set(harvests.map((item) => item.txHash).filter(isTxHash));
  const merged = [...harvests];

  for (const [walletRaw, entry] of Object.entries(ledger)) {
    const wallet = normalizeAddress(walletRaw);
    if (!wallet) continue;
    const claims = Array.isArray(entry?.claims) ? entry.claims : [];
    let claimSum = 0n;

    claims.forEach((claim: any, index: number) => {
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

async function buildReport() {
  const [indexed, ledger] = await Promise.all([
    fetchGoldskyHarvests(),
    readHarvestLedger(),
  ]);
  const energyBankAddress = ethers.getAddress(readEnv("ENERGY_BANK_ADDRESS", "NEXT_PUBLIC_ENERGY_BANK_ADDRESS") || DEFAULT_ENERGY_BANK_CONTRACT);
  const provider = new ethers.JsonRpcProvider(configuredMonadRpcUrl());
  const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, provider);
  const harvests = mergeLegacyHarvests(indexed.harvests, ledger);
  const wallets = Array.from(new Set(harvests.map((item) => item.wallet))).sort();

  const allClaimKeys = Array.from(new Set(harvests.map((item) => item.claimKey)));
  const usedPairs = await mapLimit(allClaimKeys, 12, async (claimKey) => {
    const used = await bank.usedClaimTxHash(claimKey).catch(() => false);
    return [claimKey, Boolean(used)] as const;
  });
  const usedClaimKeys = new Map(usedPairs);

  const rows = await mapLimit(wallets, 8, async (wallet): Promise<ReconciliationRow> => {
    const walletHarvests = harvests.filter((item) => item.wallet === wallet);
    const eventHarvests = walletHarvests.filter((item) => item.source === "goldsky");
    const legacyHarvests = walletHarvests.filter((item) => item.source === "legacy");
    const [bankRaw, lifetimeRaw, spentRaw] = await Promise.all([
      bank.spendableEnergy(wallet).catch(() => 0n),
      bank.lifetimeEnergy(wallet).catch(() => 0n),
      bank.totalSpent(wallet).catch(() => 0n),
    ]);

    const expectedHarvestedRaw = walletHarvests.reduce((sum, item) => sum + item.amountRaw, 0n);
    const eventHarvestedRaw = eventHarvests.reduce((sum, item) => sum + item.amountRaw, 0n);
    const legacyHarvestedRaw = legacyHarvests.reduce((sum, item) => sum + item.amountRaw, 0n);
    const creditedHarvestRaw = walletHarvests
      .filter((item) => usedClaimKeys.get(item.claimKey))
      .reduce((sum, item) => sum + item.amountRaw, 0n);
    const uncreditedItems = walletHarvests.filter((item) => !usedClaimKeys.get(item.claimKey));
    const creditedItems = walletHarvests.filter((item) => usedClaimKeys.get(item.claimKey));
    const uncreditedHarvestRaw = uncreditedItems.reduce((sum, item) => sum + item.amountRaw, 0n);
    const nonHarvestLifetimeRaw = lifetimeRaw > creditedHarvestRaw ? lifetimeRaw - creditedHarvestRaw : 0n;
    const expectedLifetimeRaw = nonHarvestLifetimeRaw + expectedHarvestedRaw;
    const expectedBankRaw = expectedLifetimeRaw > spentRaw ? expectedLifetimeRaw - spentRaw : 0n;
    const missingRaw = expectedBankRaw > bankRaw ? expectedBankRaw - bankRaw : 0n;

    let selectedRepairRaw = 0n;
    const repairItems: ReconciliationRow["repairItems"] = [];
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
    const fullyRepairable = missingRaw > 0n && selectedRepairRaw === missingRaw;

    return {
      wallet,
      totalHarvestedFromEventsRaw: eventHarvestedRaw.toString(),
      totalHarvestedFromEvents: formatEnergy(eventHarvestedRaw),
      legacyHarvestedRaw: legacyHarvestedRaw.toString(),
      legacyHarvested: formatEnergy(legacyHarvestedRaw),
      harvestedShownRaw: expectedHarvestedRaw.toString(),
      harvestedShown: formatEnergy(expectedHarvestedRaw),
      lifetimeShownRaw: lifetimeRaw.toString(),
      lifetimeShown: formatEnergy(lifetimeRaw),
      bankShownRaw: bankRaw.toString(),
      bankShown: formatEnergy(bankRaw),
      spentRaw: spentRaw.toString(),
      spent: formatEnergy(spentRaw),
      expectedHarvestedRaw: expectedHarvestedRaw.toString(),
      expectedHarvested: formatEnergy(expectedHarvestedRaw),
      expectedLifetimeRaw: expectedLifetimeRaw.toString(),
      expectedLifetime: formatEnergy(expectedLifetimeRaw),
      expectedBankRaw: expectedBankRaw.toString(),
      expectedBank: formatEnergy(expectedBankRaw),
      creditedHarvestRaw: creditedHarvestRaw.toString(),
      creditedHarvest: formatEnergy(creditedHarvestRaw),
      uncreditedHarvestRaw: uncreditedHarvestRaw.toString(),
      uncreditedHarvest: formatEnergy(uncreditedHarvestRaw),
      missingRaw: missingRaw.toString(),
      missing: formatEnergy(missingRaw),
      affected: missingRaw > 0n ? "yes" : "no",
      recommendedCreditRaw: recommendedCreditRaw.toString(),
      recommendedCredit: formatEnergy(recommendedCreditRaw),
      repairable: fullyRepairable ? "yes" : "no",
      evidenceTxHashes: walletHarvests.map((item) => item.txHash).join(" "),
      evidenceClaimKeys: walletHarvests.map((item) => item.claimKey).join(" "),
      notes: missingRaw > 0n && !fullyRepairable
        ? "Recommended amount does not align to whole harvest events; review manually before crediting."
        : "",
      repairItems,
    };
  });

  const affectedRows = rows.filter((row) => row.affected === "yes");
  const totalMissingRaw = affectedRows.reduce((sum, row) => sum + safeBigInt(row.missingRaw), 0n);
  const totalRecommendedRaw = affectedRows.reduce((sum, row) => sum + safeBigInt(row.recommendedCreditRaw), 0n);
  return {
    generatedAt: new Date().toISOString(),
    indexedBlock: indexed.indexedBlock,
    energyBankAddress: energyBankAddress.toLowerCase(),
    repairPreflight: await repairPreflight(provider, energyBankAddress),
    rowCount: rows.length,
    affectedCount: affectedRows.length,
    totalMissingRaw: totalMissingRaw.toString(),
    totalMissing: formatEnergy(totalMissingRaw),
    totalRecommendedCreditRaw: totalRecommendedRaw.toString(),
    totalRecommendedCredit: formatEnergy(totalRecommendedRaw),
    rows,
  };
}

async function readRole(bank: ethers.Contract, roleName: "DEFAULT_ADMIN_ROLE" | "CREDIT_ROLE", fallback = "") {
  const role = await bank[roleName]();
  return ethers.getBytes(role).length === 32 ? String(role) : fallback;
}

async function hasRole(bank: ethers.Contract, role: string, account: string) {
  if (!role) return null;
  return Boolean(await bank.hasRole(role, account));
}

async function repairPreflight(provider: ethers.JsonRpcProvider, energyBankAddress: string) {
  const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
  if (!signerKey) {
    return {
      ready: false,
      reason: "Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY.",
      operator: "",
      chainId: "",
      hasCreditRole: null,
      hasAdminRole: null,
      paused: null,
    };
  }

  let operator = "";
  let signer: ethers.Wallet;
  try {
    signer = new ethers.Wallet(signerKey, provider);
    operator = signer.address.toLowerCase();
  } catch (error: any) {
    return {
      ready: false,
      reason: `Invalid ENERGY_BANK_OPERATOR_PRIVATE_KEY: ${formatContractError(error)}`,
      operator: "",
      chainId: "",
      hasCreditRole: null,
      hasAdminRole: null,
      paused: null,
      operatorKeyConfigured: true,
    };
  }

  try {
    const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer);
    const network = await preflightStep("network", () => provider.getNetwork());
    let bytecodeWarning = "";
    const code = await retryRpc(() => provider.getCode(energyBankAddress)).catch((error: any) => {
      bytecodeWarning = `${formatPreflightError("energyBank bytecode", error)}. Role and pause checks will decide repair readiness.`;
      return "";
    });
    if (code === "0x") {
      return {
        ready: false,
        reason: `No contract bytecode found at Energy Bank address ${energyBankAddress}.`,
        operator,
        chainId: network.chainId.toString(),
        hasCreditRole: null,
        hasAdminRole: null,
        paused: null,
      operatorKeyConfigured: true,
    };
  }

    const creditRole = await preflightStep("CREDIT_ROLE", () => readRole(bank, "CREDIT_ROLE"));
    const adminRole = await preflightStep("DEFAULT_ADMIN_ROLE", () => readRole(bank, "DEFAULT_ADMIN_ROLE", ethers.ZeroHash));
    const paused = await preflightStep("paused", () => bank.paused().then(Boolean));
    const hasCreditRole = await preflightStep("has CREDIT_ROLE", () => hasRole(bank, creditRole, signer.address));
    const hasAdminRole = await preflightStep("has DEFAULT_ADMIN_ROLE", () => hasRole(bank, adminRole, signer.address));
    const wrongNetwork = network.chainId !== BigInt(MONAD_CHAIN_ID);
    const ready = !wrongNetwork && paused !== true && hasCreditRole === true;
    const reason = wrongNetwork
      ? `Wrong RPC network. Expected chain ${MONAD_CHAIN_ID}, got ${network.chainId.toString()}.`
      : paused === true
        ? "Energy Bank is paused."
        : hasCreditRole !== true
          ? "Energy Bank operator needs CREDIT_ROLE to apply harvest reconciliation credits."
          : "";

    return {
      ready,
      reason,
      operator,
      chainId: network.chainId.toString(),
      hasCreditRole,
      hasAdminRole,
      paused,
      warning: bytecodeWarning,
      creditRoleAvailable: Boolean(creditRole),
      adminRoleAvailable: Boolean(adminRole),
      operatorKeyConfigured: true,
    };
  } catch (error: any) {
    return {
      ready: false,
      reason: formatContractError(error),
      operator,
      chainId: "",
      hasCreditRole: null,
      hasAdminRole: null,
      paused: null,
      operatorKeyConfigured: true,
    };
  }
}

async function appendRepairLog(entry: Record<string, unknown>) {
  try {
    const store = getStore("energy-reconciliation");
    const current = await store.get("repair-log.json", { type: "json" }).catch(() => []);
    const entries = Array.isArray(current) ? current : [];
    entries.push(entry);
    await store.set("repair-log.json", JSON.stringify(entries, null, 2));
    return true;
  } catch {
    return false;
  }
}

async function readRepairLog() {
  try {
    const store = getStore("energy-reconciliation");
    const current = await store.get("repair-log.json", { type: "json" }).catch(() => []);
    return Array.isArray(current) ? current as Array<Record<string, any>> : [];
  } catch {
    return [];
  }
}

async function repairMissingCredits(report: Awaited<ReturnType<typeof buildReport>>, body: Record<string, unknown>) {
  const signerKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
  if (!signerKey) throw Object.assign(new Error("Missing ENERGY_BANK_OPERATOR_PRIVATE_KEY."), { status: 500 });
  const provider = new ethers.JsonRpcProvider(configuredMonadRpcUrl());
  const signer = new ethers.Wallet(signerKey, provider);
  const bank = new ethers.Contract(report.energyBankAddress, ENERGY_BANK_ABI, signer);
  const preflight = await repairPreflight(provider, report.energyBankAddress);
  if (!preflight.ready) throw Object.assign(new Error(preflight.reason || "Energy reconciliation repair preflight failed."), { status: 500, preflight });

  const requestedWallets = Array.isArray(body.wallets)
    ? new Set(body.wallets.map(normalizeAddress).filter(Boolean))
    : null;
  const limitInput = Number(body.limit || REPAIR_BATCH_LIMIT);
  const limit = Number.isSafeInteger(limitInput) ? Math.min(MAX_REPAIR_BATCH_LIMIT, Math.max(1, limitInput)) : REPAIR_BATCH_LIMIT;
  const candidates = report.rows
    .filter((row) => row.affected === "yes" && row.repairable === "yes")
    .filter((row) => !requestedWallets || requestedWallets.has(row.wallet))
    .flatMap((row) => row.repairItems.map((item) => ({ wallet: row.wallet, ...item })))
    .slice(0, limit);
  if (candidates.some((item) => item.method === "correctEnergy") && preflight.hasAdminRole !== true) {
    throw Object.assign(new Error("Energy Bank operator needs DEFAULT_ADMIN_ROLE for correction repair rows."), { status: 500, preflight });
  }

  const previousLog = await readRepairLog();
  const successfulIssueIds = new Set(previousLog.flatMap((entry) => (
    Array.isArray(entry?.results)
      ? entry.results.filter((item: any) => item?.status === "success" && item?.issueId).map((item: any) => String(item.issueId))
      : []
  )));

  const results = [];
  for (const item of candidates) {
    try {
      const amount = safeBigInt(item.amountRaw);
      if (amount <= 0n) throw new Error("Invalid repair amount.");
      if (item.issueId && successfulIssueIds.has(item.issueId)) {
        results.push({ ...item, status: "skipped", reason: "Reconciliation issue already repaired." });
        continue;
      }

      let tx;
      if (item.method === "correctEnergy") {
        await bank.correctEnergy.staticCall(item.wallet, amount, item.claimKey);
        tx = await bank.correctEnergy(item.wallet, amount, item.claimKey, { gasLimit: ENERGY_REPAIR_GAS_LIMIT });
      } else {
        const alreadyUsed = await bank.usedClaimTxHash(item.claimKey);
        if (alreadyUsed) {
          results.push({ ...item, status: "skipped", reason: "Claim key already credited." });
          continue;
        }
        await bank.creditEnergy.staticCall(item.wallet, amount, item.claimKey);
        tx = await bank.creditEnergy(item.wallet, amount, item.claimKey, { gasLimit: ENERGY_REPAIR_GAS_LIMIT });
      }
      const receipt = await tx.wait();
      results.push({
        ...item,
        status: "success",
        creditTxHash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
      });
    } catch (error: any) {
      results.push({
        ...item,
        status: "failed",
        error: formatContractError(error),
      });
    }
  }

  const entry = {
    repairedAt: new Date().toISOString(),
    operator: signer.address,
    limit,
    requestedWallets: requestedWallets ? Array.from(requestedWallets) : [],
    preflight,
    results,
  };
  const logged = await appendRepairLog(entry);
  return {
    ...entry,
    logged,
    successCount: results.filter((item) => item.status === "success").length,
    failureCount: results.filter((item) => item.status === "failed").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
  };
}

async function authorizeRequest(request: Request, body: Record<string, unknown>) {
  const automationSecret = readEnv("ENERGY_RECONCILIATION_AUTOMATION_SECRET");
  const providedSecret = String(request.headers.get("x-dyoor-automation-secret") || body.automationSecret || "");
  if (automationSecret && providedSecret && secretsEqual(automationSecret, providedSecret)) {
    return { source: "automation" };
  }
  await verifyAdmin(body, "energy-reconciliation");
  return { source: "owner-wallet" };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const authorization = await authorizeRequest(request, body);
    const mode = String(body.mode || "report");
    const report = await buildReport();

    if (mode === "report") {
      return json(200, { ok: true, authorization, report });
    }

    if (mode === "repair") {
      const repair = await repairMissingCredits(report, body);
      const firstFailure = repair.results.find((item) => item.status === "failed");
      const failureError = firstFailure
        ? `Energy reconciliation repair failed: ${String((firstFailure as Record<string, unknown>).error || "first credit failed")}`
        : undefined;
      return json(repair.failureCount && !repair.successCount ? 500 : 200, {
        ok: repair.failureCount === 0,
        partial: repair.successCount > 0 && repair.failureCount > 0,
        authorization,
        reportSummary: {
          generatedAt: report.generatedAt,
          affectedCount: report.affectedCount,
          totalRecommendedCreditRaw: report.totalRecommendedCreditRaw,
          totalRecommendedCredit: report.totalRecommendedCredit,
        },
        repair,
        error: failureError,
      });
    }

    return json(400, { ok: false, error: "Unsupported reconciliation mode." });
  } catch (error: any) {
    return json(Number(error?.status || 500), {
      ok: false,
      error: error?.message || "Energy reconciliation failed.",
      preflight: error?.preflight,
    });
  }
}
