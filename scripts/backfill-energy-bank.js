import "dotenv/config";
import fs from "node:fs";
import { network } from "hardhat";

const MONAD_CHAIN_ID = 143n;
const DEFAULT_LEDGER_PATH = "data/harvested-energy.json";

function usage() {
  console.log("Usage:");
  console.log("  npm run backfill:energy-bank");
  console.log("  npm run backfill:energy-bank:execute");
  console.log("");
  console.log("Dry-run is the default. Set EXECUTE_BACKFILL=1 to submit transactions.");
}

function toBigInt(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function normalizeClaimId(ethers, address, claim, index) {
  const raw = String(claim?.txHash || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(raw)) return raw.toLowerCase();
  return ethers.id(`dyoor-historical-harvest:${address.toLowerCase()}:${index}:${raw}`);
}

function buildCredits(ethers, ledger) {
  const credits = [];

  for (const [addressRaw, record] of Object.entries(ledger || {})) {
    const address = ethers.getAddress(addressRaw);
    const claims = Array.isArray(record?.claims) ? record.claims : [];

    if (!claims.length) {
      const amount = toBigInt(record?.harvestedRaw);
      if (amount > 0n) {
        credits.push({
          address,
          amount,
          claimId: ethers.id(`dyoor-historical-harvest:${address.toLowerCase()}:total`),
          source: "synthetic-total"
        });
      }
      continue;
    }

    claims.forEach((claim, index) => {
      const amount = toBigInt(claim?.amountRaw);
      if (amount <= 0n) return;
      credits.push({
        address,
        amount,
        claimId: normalizeClaimId(ethers, address, claim, index),
        source: String(claim?.txHash || `claim-${index}`)
      });
    });
  }

  return credits;
}

const { ethers } = await network.create();
const [operator] = await ethers.getSigners();

if (!operator) {
  throw new Error("No operator signer found. Set DEPLOYER_PRIVATE_KEY before backfilling.");
}

const chain = await ethers.provider.getNetwork();
if (chain.chainId !== MONAD_CHAIN_ID) {
  throw new Error(`Wrong network. Expected Monad chain id 143, got ${chain.chainId.toString()}.`);
}

const energyBankAddress = process.env.ENERGY_BANK_ADDRESS;
if (!ethers.isAddress(energyBankAddress)) {
  throw new Error("ENERGY_BANK_ADDRESS must be set to the deployed DYOOREnergyBank address.");
}

const ledgerPath = process.env.HARVEST_LEDGER_PATH || DEFAULT_LEDGER_PATH;
if (!fs.existsSync(ledgerPath)) {
  throw new Error(`Harvest ledger not found: ${ledgerPath}`);
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const credits = buildCredits(ethers, ledger);
const execute = process.env.EXECUTE_BACKFILL === "1" || process.argv.includes("--execute");

const bank = await ethers.getContractAt("DYOOREnergyBank", energyBankAddress, operator);
const creditRole = await bank.CREDIT_ROLE();
const hasCreditRole = await bank.hasRole(creditRole, operator.address);

console.log("Energy Bank backfill");
console.log("Mode:", execute ? "EXECUTE" : "DRY RUN");
console.log("Operator:", operator.address);
console.log("Energy Bank:", energyBankAddress);
console.log("Chain ID:", chain.chainId.toString());
console.log("Ledger:", ledgerPath);
console.log("Candidate credits:", credits.length);
console.log("Operator has CREDIT_ROLE:", hasCreditRole);

if (!hasCreditRole) {
  throw new Error("Operator does not have CREDIT_ROLE on DYOOREnergyBank.");
}

let alreadyCredited = 0;
let pendingCount = 0;
let pendingTotal = 0n;

for (const credit of credits) {
  const used = await bank.usedClaimTxHash(credit.claimId);
  if (used) {
    alreadyCredited += 1;
    continue;
  }

  pendingCount += 1;
  pendingTotal += credit.amount;

  console.log(
    `${execute ? "crediting" : "pending"} ${credit.address} amount=${credit.amount.toString()} claim=${credit.claimId} source=${credit.source}`
  );

  if (execute) {
    const tx = await bank.creditEnergy(credit.address, credit.amount, credit.claimId);
    const receipt = await tx.wait();
    console.log(`  tx=${tx.hash} block=${receipt?.blockNumber ?? "unknown"}`);
  }
}

console.log("Already credited:", alreadyCredited);
console.log("Pending credits:", pendingCount);
console.log("Pending total raw:", pendingTotal.toString());
console.log("Pending total ENERGY:", ethers.formatEther(pendingTotal));

if (!execute && pendingCount > 0) {
  console.log("");
  usage();
}
