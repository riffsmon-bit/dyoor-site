#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
} from "viem";
import {
  S2_ASCENDED_AIRDROP_EXPECTED,
  buildAirdropBatches,
  canonicalRecipientChecksum,
  parseAirdropCsv,
  projectedSupplyStatus,
  validateFinalAirdropCsv,
} from "../lib/s2-airdrop.ts";

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function AIRDROP_RESERVE() view returns (uint256)",
  "function totalAirdropped() view returns (uint256)",
  "function paused() view returns (bool)",
  "function airdropPaused() view returns (bool)",
  "function airdropBatchExecuted(bytes32 batchId) view returns (bool)",
  "function airdropBatch(bytes32 batchId,uint256 batchIndex,address[] recipients,uint256[] quantities)",
]);

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : String(process.argv[index + 1] || fallback);
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
  const input = arg("--input", S2_ASCENDED_AIRDROP_EXPECTED.csvFilename);
  const batchSize = Number(arg("--batch-size", env("AIRDROP_BATCH_SIZE", "25")));
  const rpcUrl = arg("--rpc-url", env("MONAD_TESTNET_RPC_URL", env("DYOOR_S2_RPC_URL", env("NEXT_PUBLIC_DYOOR_S2_RPC_URL", ""))));
  const contractAddressRaw = arg("--contract", env("DYOOR_S2_CONTRACT_ADDRESS", env("NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS", "")));
  const chainId = BigInt(arg("--chain-id", env("NEXT_PUBLIC_DYOOR_S2_CHAIN_ID", "10143")));
  const reportPath = arg("--report", "airdrop-manifests/dyoor-s2-ascended-airdrop.dry-run.json");

  if (!existsSync(input)) throw new Error(`Missing finalized CSV: ${input}`);
  const contents = readFileSync(input, "utf8");
  const csvSha256 = `0x${sha256Hex(contents)}`;
  const parsed = parseAirdropCsv(contents);
  const finalValidation = validateFinalAirdropCsv(parsed);
  const uniqueWallets = new Set(parsed.rows.map((row) => row.wallet.toLowerCase())).size;

  const report = {
    generatedAt: new Date().toISOString(),
    dryRunOnly: true,
    input,
    csvSha256,
    canonicalRecipientChecksum: canonicalRecipientChecksum(parsed.rows),
    summary: {
      uniqueWallets,
      totalQuantity: parsed.totalQuantity,
      invalidRows: parsed.invalidRows.length,
      duplicateWallets: parsed.duplicateRows.length,
      holderSnapshotAllocation: S2_ASCENDED_AIRDROP_EXPECTED.holderSnapshotQuantity,
      additionalTreasuryAllocation: S2_ASCENDED_AIRDROP_EXPECTED.additionalTreasuryQuantity,
      combinedAirdropAllocation: S2_ASCENDED_AIRDROP_EXPECTED.totalQuantity,
      treasuryFinalAllocation: S2_ASCENDED_AIRDROP_EXPECTED.treasuryFinalQuantity,
    },
    finalValidation,
    contract: null,
    batches: [],
    simulationSkipped: "",
  };

  if (!finalValidation.ok) {
    report.simulationSkipped = "Final CSV totals are invalid.";
  } else if (!rpcUrl || !contractAddressRaw) {
    report.simulationSkipped = "Set MONAD_TESTNET_RPC_URL and DYOOR_S2_CONTRACT_ADDRESS to simulate contract calls.";
  } else {
    const contractAddress = getAddress(contractAddressRaw);
    const client = createPublicClient({ transport: http(rpcUrl) });
    const [owner, totalSupply, maxSupply, airdropReserve, totalAirdropped, paused, airdropPaused] = await Promise.all([
      client.readContract({ address: contractAddress, abi: ABI, functionName: "owner" }),
      client.readContract({ address: contractAddress, abi: ABI, functionName: "totalSupply" }),
      client.readContract({ address: contractAddress, abi: ABI, functionName: "maxSupply" }),
      client.readContract({ address: contractAddress, abi: ABI, functionName: "AIRDROP_RESERVE" }),
      client.readContract({ address: contractAddress, abi: ABI, functionName: "totalAirdropped" }),
      client.readContract({ address: contractAddress, abi: ABI, functionName: "paused" }),
      client.readContract({ address: contractAddress, abi: ABI, functionName: "airdropPaused" }),
    ]);

    const projected = projectedSupplyStatus(totalSupply, maxSupply, parsed.totalQuantity);
    const projectedAirdropped = totalAirdropped + parsed.totalQuantity;
    const exceedsAirdropReserve = projectedAirdropped > airdropReserve;
    const batches = buildAirdropBatches({
      batchSize,
      chainId,
      contractAddress,
      rows: parsed.rows,
      snapshotChecksum: csvSha256,
    });

    report.contract = {
      chainId: chainId.toString(),
      contractAddress,
      owner,
      totalSupply,
      maxSupply,
      airdropReserve,
      totalAirdropped,
      remainingSupply: maxSupply > totalSupply ? maxSupply - totalSupply : 0n,
      remainingAirdropReserve: airdropReserve > totalAirdropped ? airdropReserve - totalAirdropped : 0n,
      paused,
      airdropPaused,
      projectedFinalSupply: projected.projected,
      exceedsSupply: projected.exceedsSupply,
      projectedAirdropped,
      exceedsAirdropReserve,
    };

    for (const batch of batches) {
      const data = encodeFunctionData({
        abi: ABI,
        functionName: "airdropBatch",
        args: [batch.batchId, BigInt(batch.batchIndex), batch.recipients, batch.quantities],
      });
      const alreadyCompleted = await client.readContract({
        address: contractAddress,
        abi: ABI,
        functionName: "airdropBatchExecuted",
        args: [batch.batchId],
      });
      const result = {
        batchId: batch.batchId,
        batchIndex: batch.batchIndex,
        recipientCount: batch.recipientCount,
        quantityMinted: batch.quantityMinted,
        firstWallet: batch.firstWallet,
        lastWallet: batch.lastWallet,
        alreadyCompleted,
        simulationOk: false,
        gasEstimate: null,
        error: "",
      };
      if (!alreadyCompleted && !projected.exceedsSupply && !exceedsAirdropReserve && !paused && !airdropPaused) {
        try {
          await client.simulateContract({
            account: owner,
            address: contractAddress,
            abi: ABI,
            functionName: "airdropBatch",
            args: [batch.batchId, BigInt(batch.batchIndex), batch.recipients, batch.quantities],
          });
          const gas = await client.estimateGas({ account: owner, to: contractAddress, data });
          result.simulationOk = true;
          result.gasEstimate = gas;
        } catch (error) {
          result.error = error?.shortMessage || error?.message || String(error);
        }
      }
      report.batches.push(result);
    }
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, bigintJson, 2)}\n`);
  console.log(JSON.stringify(report, bigintJson, 2));

  if (!finalValidation.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
