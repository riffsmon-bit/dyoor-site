import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { network } from "hardhat";

const DEFAULT_WALLET_FILE = "dyoor_wallet_addresses.txt";
const DEFAULT_AMOUNT_ENERGY = "25000";
const CAMPAIGN_LABEL = "DYOOR_STAKE_BY_JUNE_9_2026_25000_ENERGY";
const DEFAULT_CAMPAIGN_LEDGER = "data/airdrop-campaigns.json";
const SPOT_CHECK_COUNT = 3;

function usage() {
  console.log("Usage:");
  console.log("  npm run airdrop:energy:dry-run -- --network monad");
  console.log("  npm run airdrop:energy:broadcast -- --network monad");
  console.log("");
  console.log("Required env:");
  console.log("  ENERGY_BANK_ADDRESS=<deployed DYOOREnergyBank>");
  console.log("  MONAD_RPC_URL=<RPC URL>");
  console.log("  DEPLOYER_PRIVATE_KEY=<admin private key>");
}

function getArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

function resolveWalletFile(argv) {
  return (
    getArgValue(argv, "--wallet-file")
    || process.env.AIRDROP_WALLET_FILE
    || DEFAULT_WALLET_FILE
  );
}

function resolveCampaignLedgerPath() {
  return process.env.AIRDROP_CAMPAIGN_LEDGER || DEFAULT_CAMPAIGN_LEDGER;
}

export function buildRecipientList(ethers, walletFile) {
  if (!fs.existsSync(walletFile)) {
    throw new Error(`Wallet list not found: ${walletFile}`);
  }

  const seen = new Set();
  const recipients = [];
  const lines = fs.readFileSync(walletFile, "utf8").split(/\r?\n/u);

  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;

    if (!ethers.isAddress(raw)) {
      throw new Error(`Invalid wallet address on line ${index + 1}: ${raw}`);
    }

    const address = ethers.getAddress(raw);
    const key = address.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    recipients.push(address);
  });

  if (!recipients.length) {
    throw new Error("Wallet list did not contain any valid recipient addresses.");
  }

  return recipients;
}

function loadCampaignLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return { campaigns: {} };

  const raw = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  if (raw && typeof raw === "object" && raw.campaigns && typeof raw.campaigns === "object") {
    return raw;
  }

  return { campaigns: {} };
}

function saveCampaignLedger(ledgerPath, ledger) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

function formatEnergy(ethers, amount) {
  return ethers.formatEther(amount);
}

async function main() {
  const argv = process.argv.slice(2);
  const execute = process.env.EXECUTE_AIRDROP === "1" || argv.includes("--broadcast") || argv.includes("--execute");
  const walletFile = resolveWalletFile(argv);

  const { ethers } = await network.create();
  const [admin] = await ethers.getSigners();

  if (!admin) {
    throw new Error("No signer found. Set DEPLOYER_PRIVATE_KEY before running the airdrop.");
  }

  const chain = await ethers.provider.getNetwork();
  const expectedChainId = process.env.EXPECTED_CHAIN_ID ? BigInt(process.env.EXPECTED_CHAIN_ID) : null;
  if (expectedChainId !== null && chain.chainId !== expectedChainId) {
    throw new Error(`Wrong network. Expected chain id ${expectedChainId.toString()}, got ${chain.chainId.toString()}.`);
  }

  if (!ethers.isAddress(process.env.ENERGY_BANK_ADDRESS || "")) {
    throw new Error("ENERGY_BANK_ADDRESS must be set to the deployed DYOOREnergyBank address.");
  }

  const energyBankAddress = ethers.getAddress(process.env.ENERGY_BANK_ADDRESS);
  const amount = ethers.parseEther(process.env.AIRDROP_AMOUNT_ENERGY || DEFAULT_AMOUNT_ENERGY);
  const campaignId = ethers.id(CAMPAIGN_LABEL);
  const recipients = buildRecipientList(ethers, walletFile);
  const totalEnergy = amount * BigInt(recipients.length);
  const campaignLedgerPath = resolveCampaignLedgerPath();
  const campaignLedger = loadCampaignLedger(campaignLedgerPath);

  const bank = await ethers.getContractAt("DYOOREnergyBank", energyBankAddress, admin);
  const adminRole = await bank.DEFAULT_ADMIN_ROLE();
  const hasAdminRole = await bank.hasRole(adminRole, admin.address);
  let campaignUsed = false;
  let legacyMode = false;

  try {
    campaignUsed = await bank.usedAirdropCampaign(campaignId);
  } catch {
    legacyMode = true;
    campaignUsed = Boolean(campaignLedger.campaigns?.[campaignId]);
  }

  console.log("DYOOR Energy airdrop");
  console.log("Mode:", execute ? "BROADCAST" : "DRY RUN");
  console.log("Chain ID:", chain.chainId.toString());
  console.log("Energy Bank:", energyBankAddress);
  console.log("Caller:", admin.address);
  console.log("Caller has DEFAULT_ADMIN_ROLE:", hasAdminRole);
  console.log("Wallet file:", walletFile);
  console.log("Recipient count:", recipients.length);
  console.log("Amount per recipient:", formatEnergy(ethers, amount));
  console.log("Total Energy distributed:", formatEnergy(ethers, totalEnergy));
  console.log("Campaign label:", CAMPAIGN_LABEL);
  console.log("Campaign ID:", campaignId);
  console.log("Campaign already used:", campaignUsed);
  console.log("Legacy contract mode:", legacyMode);
  if (legacyMode) {
    console.log("Campaign ledger:", campaignLedgerPath);
  }

  if (!hasAdminRole) {
    throw new Error("Caller is not a DYOOREnergyBank admin. Refusing to continue.");
  }

  if (campaignUsed) {
    throw new Error(`Airdrop campaign has already been used: ${campaignId}`);
  }

  const spotChecks = recipients.slice(0, SPOT_CHECK_COUNT);
  const beforeBalances = await Promise.all(spotChecks.map((address) => bank.spendableEnergy(address)));

  if (legacyMode) {
    for (const recipient of recipients) {
      await bank.correctEnergy.staticCall(recipient, amount, campaignId);
    }
  } else {
    await bank.airdropEnergy.staticCall(recipients, amount, campaignId);
  }
  console.log("Simulation: passed");

  let txHash = "(dry run, no transaction broadcast)";

  if (execute) {
    if (legacyMode) {
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const tx = await bank.correctEnergy(recipient, amount, campaignId);
        console.log(`tx[${i + 1}/${recipients.length}]:`, tx.hash, recipient);
        const receipt = await tx.wait();
        txHash = tx.hash;
        console.log(`  confirmed block: ${receipt?.blockNumber ?? "unknown"}`);
      }

      campaignLedger.campaigns[campaignId] = {
        label: CAMPAIGN_LABEL,
        walletFile,
        recipientCount: recipients.length,
        amountPerRecipient: amount.toString(),
        totalEnergy: totalEnergy.toString(),
        updatedAt: new Date().toISOString(),
      };
      saveCampaignLedger(campaignLedgerPath, campaignLedger);
      console.log("Campaign ledger updated:", campaignLedgerPath);
    } else {
      const tx = await bank.airdropEnergy(recipients, amount, campaignId);
      txHash = tx.hash;
      console.log("Transaction hash:", txHash);

      const receipt = await tx.wait();
      console.log("Confirmed block:", receipt?.blockNumber ?? "unknown");
    }
  } else {
    console.log("Transaction hash:", txHash);
    usage();
  }

  console.log("Spot checks:");
  for (let i = 0; i < spotChecks.length; i++) {
    const address = spotChecks[i];
    const before = beforeBalances[i];
    const after = execute ? await bank.spendableEnergy(address) : before + amount;
    console.log(
      `  ${address} before=${formatEnergy(ethers, before)} after=${formatEnergy(ethers, after)}`
    );
  }
}

const directRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (directRun) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
