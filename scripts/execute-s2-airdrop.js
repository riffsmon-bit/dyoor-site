#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "dotenv";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, formatEther, getAddress, keccak256, toUtf8Bytes } from "ethers";

config({ path: ".env.local" });
config({ path: ".env" });

const MONAD_MAINNET_CHAIN_ID = 143n;
const CONFIRMATION = "AIRDROP_609_DYOOR_MAINNET";
const EXPECTED_TOTAL = 609n;
const EXPECTED_UNIQUE_WALLETS = 56;
const TREASURY_ADDRESS = getAddress("0x4d540f7d0eb841c839334655c9f88313d750c6d5");
const EXPECTED_TREASURY_QUANTITY = 133n;

const AIRDROP_ABI = [
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function AIRDROP_RESERVE() view returns (uint256)",
  "function totalAirdropped() view returns (uint256)",
  "function paused() view returns (bool)",
  "function airdropPaused() view returns (bool)",
  "function airdropBatchExecuted(bytes32 batchId) view returns (bool)",
  "function airdropBatch(bytes32 batchId,uint256 batchIndex,address[] recipients,uint256[] quantities)",
];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  if (quoted) throw new Error(`Malformed CSV line: ${line}`);
  return values;
}

function parseQuantity(value, lineNumber) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid quantity on line ${lineNumber}: ${raw}`);
  const quantity = BigInt(raw);
  if (quantity <= 0n) throw new Error(`Quantity must be positive on line ${lineNumber}`);
  return quantity;
}

function parseAirdropCsv(input) {
  if (!existsSync(input)) throw new Error(`Missing airdrop CSV: ${input}`);
  const text = readFileSync(input, "utf8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim());
  if (headerIndex === -1) throw new Error("CSV is empty.");
  const headers = parseCsvLine(lines[headerIndex]).map((header) => header.toLowerCase());
  const walletIndex = headers.indexOf("wallet");
  const quantityIndex = headers.indexOf("quantity") >= 0 ? headers.indexOf("quantity") : headers.indexOf("amount");
  if (walletIndex === -1 || quantityIndex === -1) throw new Error("CSV must include wallet and quantity/amount.");

  const rows = [];
  const seen = new Set();
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const columns = parseCsvLine(lines[index]);
    const lineNumber = index + 1;
    const wallet = getAddress(String(columns[walletIndex] || "").trim());
    const key = wallet.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate wallet row: ${wallet}`);
    seen.add(key);
    rows.push({ lineNumber, wallet, quantity: parseQuantity(columns[quantityIndex], lineNumber) });
  }
  return { rows, text };
}

function buildBatches({ rows, batchSize, chainId, contractAddress, snapshotChecksum }) {
  const batches = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    const batchRows = rows.slice(index, index + batchSize);
    const batchIndex = batches.length;
    const recipients = batchRows.map((row) => row.wallet);
    const quantities = batchRows.map((row) => row.quantity);
    const batchId = keccak256(AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "uint256", "address[]", "uint256[]"],
      [chainId, contractAddress, snapshotChecksum, BigInt(batchIndex), recipients, quantities],
    ));
    batches.push({
      batchId,
      batchIndex,
      recipients,
      quantities,
      recipientCount: recipients.length,
      quantityMinted: quantities.reduce((total, quantity) => total + quantity, 0n),
      firstWallet: recipients[0],
      lastWallet: recipients[recipients.length - 1],
    });
  }
  return batches;
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(value) {
  if (!value) return;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) throw new Error(`Invalid --wait-until value: ${value}`);
  const delay = target.getTime() - Date.now();
  if (delay <= 0) return;
  console.log(`Waiting until ${target.toISOString()} (${Math.ceil(delay / 1000)} seconds).`);
  await sleep(delay);
}

async function readState(contract) {
  const [owner, totalSupply, maxSupply, airdropReserve, totalAirdropped, paused, airdropPaused] = await Promise.all([
    contract.owner(),
    contract.totalSupply(),
    contract.maxSupply(),
    contract.AIRDROP_RESERVE(),
    contract.totalAirdropped(),
    contract.paused(),
    contract.airdropPaused(),
  ]);
  return { owner, totalSupply, maxSupply, airdropReserve, totalAirdropped, paused, airdropPaused };
}

async function main() {
  const input = arg("--input", "airdrop-manifests/dyoor-s2-remaining-airdrop-609.csv");
  const batchSize = Number(arg("--batch-size", env("AIRDROP_BATCH_SIZE", "25")));
  const waitUntilValue = arg("--wait-until", env("S2_AIRDROP_WAIT_UNTIL", ""));
  const execute = env("EXECUTE_S2_AIRDROP") === "1";
  const reportPath = arg("--report", `airdrop-manifests/dyoor-s2-remaining-airdrop-609.${execute ? "execution" : "dry-run"}.json`);
  const deploymentPath = arg("--deployment", "deployments/dyoor-s2-seadrop-mainnet.latest.json");
  const deployment = existsSync(deploymentPath) ? JSON.parse(readFileSync(deploymentPath, "utf8")) : {};
  const contractAddress = getAddress(
    arg("--contract", env("DYOOR_S2_MAINNET_CONTRACT_ADDRESS", deployment.contractAddress || "")),
  );
  const rpcUrl = env("MONAD_MAINNET_RPC_URL", env("MONAD_RPC_URL", env("NEXT_PUBLIC_MONAD_RPC_URL", "")));
  const privateKey = env("DEPLOYER_PRIVATE_KEY", env("PRIVATE_KEY", ""));

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new Error("Batch size must be an integer from 1 to 50.");
  }
  if (!rpcUrl) throw new Error("MONAD_MAINNET_RPC_URL or MONAD_RPC_URL is required.");
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY or PRIVATE_KEY is required.");
  if (execute && env("S2_AIRDROP_CONFIRMATION") !== CONFIRMATION) {
    throw new Error(`S2_AIRDROP_CONFIRMATION=${CONFIRMATION} is required to broadcast.`);
  }

  const { rows, text } = parseAirdropCsv(input);
  const uniqueWallets = new Set(rows.map((row) => row.wallet.toLowerCase())).size;
  const totalQuantity = rows.reduce((total, row) => total + row.quantity, 0n);
  const treasuryRow = rows.find((row) => row.wallet.toLowerCase() === TREASURY_ADDRESS.toLowerCase());
  if (uniqueWallets !== EXPECTED_UNIQUE_WALLETS) throw new Error(`Expected ${EXPECTED_UNIQUE_WALLETS} wallets; found ${uniqueWallets}.`);
  if (totalQuantity !== EXPECTED_TOTAL) throw new Error(`Expected total ${EXPECTED_TOTAL}; found ${totalQuantity}.`);
  if (!treasuryRow || treasuryRow.quantity !== EXPECTED_TREASURY_QUANTITY) {
    throw new Error(`Expected treasury quantity ${EXPECTED_TREASURY_QUANTITY}; found ${treasuryRow?.quantity ?? "missing"}.`);
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== MONAD_MAINNET_CHAIN_ID) {
    throw new Error(`Wrong chain. Expected Monad mainnet 143, got ${network.chainId.toString()}.`);
  }
  const signer = new Wallet(privateKey, provider);
  const signerAddress = await signer.getAddress();
  const contract = new Contract(contractAddress, AIRDROP_ABI, signer);
  const snapshotChecksum = `0x${sha256Hex(text)}`;
  const canonicalChecksum = keccak256(toUtf8Bytes(rows.map((row) => `${row.wallet.toLowerCase()}:${row.quantity.toString()}`).join("|")));
  const batches = buildBatches({ rows, batchSize, chainId: network.chainId, contractAddress, snapshotChecksum });
  const report = {
    generatedAt: new Date().toISOString(),
    execute,
    input,
    csvSha256: snapshotChecksum,
    canonicalChecksum,
    contractAddress,
    chainId: network.chainId,
    signer: signerAddress,
    uniqueWallets,
    totalQuantity,
    batchSize,
    batchCount: batches.length,
    waitUntil: waitUntilValue || null,
    initialState: null,
    finalState: null,
    batches: [],
  };

  const initialState = await readState(contract);
  report.initialState = initialState;
  if (initialState.owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(`Signer ${signerAddress} is not contract owner ${initialState.owner}.`);
  }
  if (initialState.paused) throw new Error("Mint pause is active.");
  if (initialState.airdropPaused) throw new Error("Airdrop pause is active.");
  if (initialState.totalAirdropped + totalQuantity > initialState.airdropReserve) {
    throw new Error(`Airdrop would exceed reserve: ${initialState.totalAirdropped + totalQuantity}/${initialState.airdropReserve}.`);
  }
  if (initialState.totalSupply + totalQuantity > initialState.maxSupply) {
    throw new Error(`Airdrop would exceed max supply: ${initialState.totalSupply + totalQuantity}/${initialState.maxSupply}.`);
  }

  if (execute) await waitUntil(waitUntilValue);

  for (const batch of batches) {
    const before = await readState(contract);
    const batchReport = {
      batchId: batch.batchId,
      batchIndex: batch.batchIndex,
      recipientCount: batch.recipientCount,
      quantityMinted: batch.quantityMinted,
      firstWallet: batch.firstWallet,
      lastWallet: batch.lastWallet,
      alreadyCompleted: false,
      simulationOk: false,
      gasEstimate: null,
      transactionHash: null,
      blockNumber: null,
      status: "pending",
      error: "",
    };

    if (before.owner.toLowerCase() !== signerAddress.toLowerCase()) throw new Error("Contract owner changed.");
    if (before.paused || before.airdropPaused) throw new Error("Airdrop paused before batch execution.");
    if (before.totalAirdropped + batch.quantityMinted > before.airdropReserve) throw new Error("Batch would exceed airdrop reserve.");
    if (before.totalSupply + batch.quantityMinted > before.maxSupply) throw new Error("Batch would exceed max supply.");

    const alreadyCompleted = await contract.airdropBatchExecuted(batch.batchId);
    batchReport.alreadyCompleted = alreadyCompleted;
    if (alreadyCompleted) {
      batchReport.status = "completed";
      report.batches.push(batchReport);
      continue;
    }

    try {
      const gas = await contract.airdropBatch.estimateGas(batch.batchId, batch.batchIndex, batch.recipients, batch.quantities);
      batchReport.simulationOk = true;
      batchReport.gasEstimate = gas;
      if (execute) {
        const tx = await contract.airdropBatch(batch.batchId, batch.batchIndex, batch.recipients, batch.quantities, {
          gasLimit: gas + gas / 5n,
        });
        batchReport.transactionHash = tx.hash;
        const receipt = await tx.wait();
        if (receipt.status !== 1) throw new Error(`Batch transaction reverted: ${tx.hash}`);
        batchReport.blockNumber = receipt.blockNumber;
        batchReport.status = "confirmed";
      } else {
        batchReport.status = "simulated";
      }
    } catch (error) {
      batchReport.status = "failed";
      batchReport.error = error?.shortMessage || error?.message || String(error);
      report.batches.push(batchReport);
      throw error;
    }

    report.batches.push(batchReport);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
  }

  report.finalState = await readState(contract);
  const feeData = await provider.getFeeData();
  report.gasPriceWei = (feeData.gasPrice || feeData.maxFeePerGas || 0n).toString();
  report.signerBalanceMON = formatEther(await provider.getBalance(signerAddress));
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
  console.log(JSON.stringify(report, bigintJson, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
