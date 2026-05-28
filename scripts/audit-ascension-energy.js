import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";

const CHAIN_ID = 143n;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_ENERGY_BANK = "0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767";
const DEFAULT_LEDGER_PATH = "data/harvested-energy.json";
const DEFAULT_CHUNK_SIZE = 5000n;
const DEFAULT_RPC_DELAY_MS = 150;

const ASCENSION_ABI = [
  "event PointsClaimed(address indexed user,uint256 amount)",
  "function pendingPoints(address user) view returns (uint256)"
];

const ENERGY_BANK_ABI = [
  "function creditEnergy(address user,uint256 amount,bytes32 claimTxHash)",
  "function usedClaimTxHash(bytes32 claimTxHash) view returns (bool)",
  "function spendableEnergy(address user) view returns (uint256)",
  "function lifetimeEnergy(address user) view returns (uint256)",
  "function totalSpent(address user) view returns (uint256)",
  "function CREDIT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)"
];

function normalizePrivateKey(value) {
  if (!value) return "";
  return value.startsWith("0x") ? value : `0x${value}`;
}

function toBigInt(value, fallback = 0n) {
  try {
    if (value === undefined || value === null || value === "") return fallback;
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

function readLedgerAddresses() {
  const ledgerPath = process.env.HARVEST_LEDGER_PATH || DEFAULT_LEDGER_PATH;
  if (!fs.existsSync(ledgerPath)) return new Set();

  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  return new Set(Object.keys(ledger || {}).map((address) => ethers.getAddress(address)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(err) {
  const text = String(err?.shortMessage || err?.message || err?.error?.message || "");
  return text.includes("request limit") || text.includes("rate") || text.includes("429");
}

async function getLogsWithSplit(provider, filter, fromBlock, toBlock) {
  const delayMs = Number(toBigInt(process.env.ASCENSION_RPC_DELAY_MS || DEFAULT_RPC_DELAY_MS.toString(), DEFAULT_RPC_DELAY_MS));

  try {
    const logs = await provider.getLogs({ ...filter, fromBlock, toBlock });
    if (delayMs > 0) await sleep(delayMs);
    return logs;
  } catch (err) {
    if (isRateLimit(err)) {
      await sleep(Math.max(delayMs * 4, 1000));
      try {
        const logs = await provider.getLogs({ ...filter, fromBlock, toBlock });
        if (delayMs > 0) await sleep(delayMs);
        return logs;
      } catch (retryErr) {
        err = retryErr;
      }
    }

    if (fromBlock >= toBlock) throw err;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsWithSplit(provider, filter, fromBlock, mid);
    const right = await getLogsWithSplit(provider, filter, mid + 1, toBlock);
    return left.concat(right);
  }
}

async function findContractStartBlock(provider, address, latestBlock) {
  if (process.env.ASCENSION_START_BLOCK) {
    return Number(toBigInt(process.env.ASCENSION_START_BLOCK));
  }

  const latestCode = await provider.getCode(address, latestBlock);
  if (!latestCode || latestCode === "0x") {
    throw new Error(`No contract code found at ${address}`);
  }

  let low = 0;
  let high = latestBlock;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const code = await provider.getCode(address, mid);
    if (code && code !== "0x") high = mid;
    else low = mid + 1;
  }

  return low;
}

async function scanHarvestEvents(provider, staking) {
  const iface = new ethers.Interface(ASCENSION_ABI);
  const latestBlock = await provider.getBlockNumber();
  const fromStart = await findContractStartBlock(provider, staking, latestBlock);
  const chunkSize = Number(toBigInt(process.env.ASCENSION_LOG_CHUNK_SIZE || DEFAULT_CHUNK_SIZE.toString(), DEFAULT_CHUNK_SIZE));
  const claimTopic = ethers.id("PointsClaimed(address,uint256)");
  const harvests = new Map();
  let chunksScanned = 0;
  let logsScanned = 0;

  for (let fromBlock = fromStart; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
    const logs = await getLogsWithSplit(provider, {
      address: staking,
      topics: [claimTopic]
    }, fromBlock, toBlock);

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const user = ethers.getAddress(parsed.args.user);
      const amount = parsed.args.amount;
      const entry = harvests.get(user) || { total: 0n, claims: [] };
      entry.total += amount;
      entry.claims.push({
        txHash: log.transactionHash.toLowerCase(),
        amount,
        blockNumber: log.blockNumber,
        logIndex: log.index
      });
      harvests.set(user, entry);
      logsScanned += 1;
    }

    chunksScanned += 1;
    console.log(`scanned blocks ${fromBlock}-${toBlock}, harvestLogs=${logs.length}`);
  }

  return { latestBlock, fromStart, chunksScanned, logsScanned, harvests };
}

async function main() {
  const execute = process.env.EXECUTE_BACKFILL === "1" || process.argv.includes("--execute");
  const rpcUrl = process.env.MONAD_RPC_URL || DEFAULT_RPC;
  const stakingAddress = ethers.getAddress(process.env.ASCENSION_STAKING_ADDRESS || DEFAULT_STAKING);
  const energyBankAddress = ethers.getAddress(process.env.ENERGY_BANK_ADDRESS || DEFAULT_ENERGY_BANK);
  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID));
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Wrong chain. Expected ${CHAIN_ID}, got ${network.chainId}`);
  }

  const signerKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY || "");
  const signer = signerKey ? new ethers.Wallet(signerKey, provider) : null;
  const bank = new ethers.Contract(energyBankAddress, ENERGY_BANK_ABI, signer || provider);
  const staking = new ethers.Contract(stakingAddress, ASCENSION_ABI, provider);
  const ledgerAddresses = readLedgerAddresses();

  console.log("Ascension energy audit");
  console.log("Mode:", execute ? "EXECUTE" : "DRY RUN");
  console.log("Staking:", stakingAddress);
  console.log("Energy Bank:", energyBankAddress);
  console.log("Operator:", signer?.address || "not configured");

  if (execute) {
    if (!signer) throw new Error("Set DEPLOYER_PRIVATE_KEY to execute missing Energy Bank credits.");
    const creditRole = await bank.CREDIT_ROLE();
    const hasCreditRole = await bank.hasRole(creditRole, signer.address);
    if (!hasCreditRole) throw new Error(`${signer.address} does not have CREDIT_ROLE on the Energy Bank.`);
  }

  const scan = await scanHarvestEvents(provider, stakingAddress);
  const users = new Set([...ledgerAddresses, ...scan.harvests.keys()]);
  const rows = [];
  let missingCredits = 0;
  let missingRaw = 0n;
  let overCreditedUsers = 0;

  for (const user of [...users].sort()) {
    const harvested = scan.harvests.get(user) || { total: 0n, claims: [] };
    const [pendingRaw, bankRaw, bankLifetimeRaw, bankSpentRaw] = await Promise.all([
      staking.pendingPoints(user).catch(() => 0n),
      bank.spendableEnergy(user).catch(() => 0n),
      bank.lifetimeEnergy(user).catch(() => 0n),
      bank.totalSpent(user).catch(() => 0n)
    ]);

    const expectedLifetimeRaw = harvested.total + pendingRaw;
    let remainingShortfall = harvested.total > bankLifetimeRaw
      ? harvested.total - bankLifetimeRaw
      : 0n;
    const missing = [];

    for (const claim of harvested.claims) {
      if (remainingShortfall <= 0n) break;
      const used = await bank.usedClaimTxHash(claim.txHash).catch(() => false);
      if (used) continue;
      missing.push(claim);
      remainingShortfall -= claim.amount;
    }

    if (bankLifetimeRaw > harvested.total) overCreditedUsers += 1;
    missingCredits += missing.length;
    missingRaw += missing.reduce((sum, claim) => sum + claim.amount, 0n);

    rows.push({
      user,
      harvestedRaw: harvested.total,
      pendingRaw,
      expectedLifetimeRaw,
      bankRaw,
      bankLifetimeRaw,
      bankSpentRaw,
      missing
    });

    if (missing.length) {
      console.log("");
      console.log(`missing ${user}`);
      console.log(`  harvested=${ethers.formatEther(harvested.total)} bankLifetime=${ethers.formatEther(bankLifetimeRaw)} pending=${ethers.formatEther(pendingRaw)}`);
      for (const claim of missing) {
        console.log(`  credit ${ethers.formatEther(claim.amount)} tx=${claim.txHash} block=${claim.blockNumber}`);
        if (execute) {
          const tx = await bank.creditEnergy(user, claim.amount, claim.txHash);
          const receipt = await tx.wait();
          console.log(`    submitted ${tx.hash} block=${receipt?.blockNumber ?? "unknown"}`);
        }
      }
    }
  }

  console.log("");
  console.log("Audit summary");
  console.log("Latest block:", scan.latestBlock);
  console.log("Scan start block:", scan.fromStart);
  console.log("Chunks scanned:", scan.chunksScanned);
  console.log("Harvest logs scanned:", scan.logsScanned);
  console.log("Users checked:", users.size);
  console.log("Missing credit txs:", missingCredits);
  console.log("Missing raw:", missingRaw.toString());
  console.log("Missing ENERGY:", ethers.formatEther(missingRaw));
  console.log("Users with bank lifetime greater than harvested events:", overCreditedUsers);

  console.log("");
  console.log("Per-user totals");
  for (const row of rows) {
    console.log([
      row.user,
      `harvested=${ethers.formatEther(row.harvestedRaw)}`,
      `pending=${ethers.formatEther(row.pendingRaw)}`,
      `lifetime=${ethers.formatEther(row.expectedLifetimeRaw)}`,
      `bank=${ethers.formatEther(row.bankRaw)}`,
      `bankLifetime=${ethers.formatEther(row.bankLifetimeRaw)}`,
      `spent=${ethers.formatEther(row.bankSpentRaw)}`,
      `missing=${row.missing.length}`
    ].join(" "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
