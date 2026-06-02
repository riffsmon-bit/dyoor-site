import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const CHAIN_ID = 143n;
const DEFAULT_RPC = "https://rpc.monad.xyz";
const DEFAULT_STAKING = "0xf9611226c1CcCcCa37951938d6f358D3d5106549";
const DEFAULT_NFT = "0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f";
const DEFAULT_CHUNK_SIZE = 4000n;
const DEFAULT_MANIFEST_PATH = "data/ascension-recovery-manifest.json";
const DEFAULT_BATCH_SIZE = 12;

const ERC721_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)"
];

const STAKING_ABI = [
  "function stakeInfo(uint256 tokenId) view returns (address owner, uint64 stakedAt)",
  "function stakeDeposited(uint256[] calldata tokenIds)"
];

function normalizeAddress(value) {
  try {
    return ethers.getAddress(value);
  } catch {
    return null;
  }
}

function toBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
    if (typeof value === "string" && value.trim() !== "") return BigInt(value.trim());
    return fallback;
  } catch {
    return fallback;
  }
}

function isRateLimit(err) {
  const text = String(err?.shortMessage || err?.message || err?.error?.message || "");
  return text.includes("request limit") || text.includes("rate") || text.includes("429");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLogsWithSplit(provider, filter, fromBlock, toBlock) {
  const delayMs = Number(toBigInt(process.env.ASCENSION_RPC_DELAY_MS || "150", 150n));
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
  const configured = process.env.ASCENSION_START_BLOCK;
  if (configured) return Number(toBigInt(configured));

  const latestCode = await provider.getCode(address);
  if (!latestCode || latestCode === "0x") {
    throw new Error(`No contract code found at ${address}`);
  }

  return 0;
}

function chunkArray(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

function ensureDataDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readTokenCsv(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) return [];

  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith("tokenid"))
    .map((line) => line.split(",")[0].trim())
    .filter((value) => /^\d+$/.test(value));
}

function formatWalletGroups(groups) {
  return [...groups.entries()]
    .map(([wallet, tokenIds]) => ({
      wallet,
      count: tokenIds.length,
      tokenIds: [...tokenIds].sort((a, b) => Number(BigInt(a) - BigInt(b)))
    }))
    .sort((a, b) => b.count - a.count || a.wallet.localeCompare(b.wallet));
}

async function scanStuckDeposits(provider, stakingAddress, nftAddress, walletFilter = null) {
  const nft = new ethers.Contract(nftAddress, ERC721_ABI, provider);
  const staking = new ethers.Contract(stakingAddress, STAKING_ABI, provider);
  const erc721 = new ethers.Interface(ERC721_ABI);
  const latestBlock = Number(await provider.getBlockNumber());
  const startBlock = await findContractStartBlock(provider, nftAddress, latestBlock);
  const chunkSize = Number(toBigInt(process.env.ASCENSION_LOG_CHUNK_SIZE || DEFAULT_CHUNK_SIZE.toString(), DEFAULT_CHUNK_SIZE));
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const stakingTopic = ethers.zeroPadValue(ethers.getAddress(stakingAddress), 32);
  const candidates = new Map();
  const explicitTokenIds = new Set(
    readTokenCsv(process.env.ASCENSION_TOKEN_FILE || process.argv.find((arg) => arg.startsWith("--tokens-file="))?.split("=", 2)[1] || "")
  );
  let logsScanned = 0;
  let chunksScanned = 0;

  if (explicitTokenIds.size > 0) {
    const directIds = [...explicitTokenIds].sort((a, b) => Number(BigInt(a) - BigInt(b)));
    for (const tokenIdText of directIds) {
      const tokenId = BigInt(tokenIdText);
      candidates.set(tokenIdText, {
        tokenId: tokenIdText,
        depositor: "unknown",
        txHash: "",
        blockNumber: 0
      });
      chunksScanned += 1;
      console.log(`checked token ${tokenIdText}`);
    }
  } else {
    for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
      const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
      const logs = await getLogsWithSplit(provider, {
        address: nftAddress,
        topics: [transferTopic, null, stakingTopic]
      }, fromBlock, toBlock);

      for (const log of logs || []) {
        const parsed = erc721.parseLog(log);
        const tokenId = BigInt(parsed.args.tokenId);
        const depositor = ethers.getAddress(parsed.args.from);
        candidates.set(tokenId.toString(), {
          tokenId: tokenId.toString(),
          depositor,
          txHash: String(log.transactionHash || "").toLowerCase(),
          blockNumber: Number(log.blockNumber || 0)
        });
        logsScanned += 1;
      }

      chunksScanned += 1;
      console.log(`scanned ${fromBlock}-${toBlock}, candidateTransfers=${logs.length}`);
    }
  }

  const stuck = [];
  for (const [tokenIdText, transfer] of candidates.entries()) {
    const tokenId = BigInt(tokenIdText);
    try {
      const owner = await nft.ownerOf(tokenId);
      if (ethers.getAddress(owner) !== ethers.getAddress(stakingAddress)) continue;
    } catch {
      continue;
    }

    try {
      const info = await staking.stakeInfo(tokenId);
      if (info?.owner && ethers.getAddress(info.owner) !== ethers.ZeroAddress) continue;
    } catch {
      // Treat read failures as stuck/degraded records.
    }

    if (walletFilter && ethers.getAddress(transfer.depositor) !== walletFilter) continue;
    if (explicitTokenIds.size > 0 && !explicitTokenIds.has(transfer.tokenId)) continue;
    stuck.push(transfer);
  }

  const byWallet = new Map();
  for (const item of stuck) {
    const bucket = byWallet.get(item.depositor) || [];
    bucket.push(item.tokenId);
    byWallet.set(item.depositor, bucket);
  }

  return {
    latestBlock,
    startBlock,
    chunksScanned,
    logsScanned,
    stuck,
    byWallet: formatWalletGroups(byWallet)
  };
}

async function attemptRecovery(provider, signer, stakingAddress, stuckItems) {
  const staking = new ethers.Contract(stakingAddress, STAKING_ABI, signer);
  const execute = process.env.EXECUTE_RECOVERY === "1" || process.argv.includes("--execute");
  const batchSize = Number(toBigInt(process.env.ASCENSION_RECOVERY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), BigInt(DEFAULT_BATCH_SIZE)));
  const batches = chunkArray(stuckItems.map((item) => BigInt(item.tokenId)), batchSize);
  const results = [];

  console.log("");
  console.log("Recovery execution");
  console.log("Mode:", execute ? "EXECUTE" : "DRY RUN");
  console.log("Operator:", signer.address);
  console.log("Batch size:", batchSize);

  for (const batch of batches) {
    const tokenIds = batch.map((id) => id.toString());
    const label = `[${tokenIds.join(", ")}]`;

    try {
      await staking.stakeDeposited.staticCall(batch);
    } catch (err) {
      results.push({ tokenIds, status: "reverted", error: String(err?.shortMessage || err?.message || err) });
      console.log(`recovery reverted ${label}`);
      continue;
    }

    if (!execute) {
      results.push({ tokenIds, status: "callable" });
      console.log(`recovery callable ${label}`);
      continue;
    }

    try {
      const tx = await staking.stakeDeposited(batch);
      const receipt = await tx.wait();
      results.push({ tokenIds, status: "submitted", txHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
      console.log(`recovery submitted ${label} tx=${tx.hash}`);
    } catch (err) {
      results.push({ tokenIds, status: "failed", error: String(err?.shortMessage || err?.message || err) });
      console.log(`recovery failed ${label}: ${err?.shortMessage || err?.message || err}`);
    }
  }

  return results;
}

async function main() {
  const execute = process.env.EXECUTE_RECOVERY === "1" || process.argv.includes("--execute");
  const rpcUrl = process.env.MONAD_RPC_URL || DEFAULT_RPC;
  const stakingAddress = normalizeAddress(process.env.ASCENSION_STAKING_ADDRESS || DEFAULT_STAKING);
  const nftAddress = normalizeAddress(process.env.ASCENSION_NFT_ADDRESS || DEFAULT_NFT);
  const walletFilterRaw = process.env.RECOVERY_WALLET || process.argv.find((arg) => arg.startsWith("--wallet="))?.split("=", 2)[1] || "";
  const walletFilter = walletFilterRaw ? normalizeAddress(walletFilterRaw) : null;
  const tokenFile = process.env.ASCENSION_TOKEN_FILE || process.argv.find((arg) => arg.startsWith("--tokens-file="))?.split("=", 2)[1] || "";

  if (!stakingAddress) throw new Error("ASCENSION_STAKING_ADDRESS is invalid.");
  if (!nftAddress) throw new Error("ASCENSION_NFT_ADDRESS is invalid.");

  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID));
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Wrong network. Expected ${CHAIN_ID}, got ${network.chainId.toString()}.`);
  }

  const signerKey = String(process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  const signer = signerKey
    ? new ethers.Wallet(signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`, provider)
    : null;

  console.log("Ascension recovery audit");
  console.log("Mode:", execute ? "EXECUTE" : "DRY RUN");
  console.log("Staking:", stakingAddress);
  console.log("NFT:", nftAddress);
  console.log("Operator:", signer?.address || "not configured");
  console.log("Wallet filter:", walletFilter || "all wallets");
  console.log("Token file:", tokenFile || "none");

  const scan = await scanStuckDeposits(provider, stakingAddress, nftAddress, walletFilter);
  const manifest = {
    createdAt: new Date().toISOString(),
    chainId: CHAIN_ID.toString(),
    stakingAddress,
    nftAddress,
    walletFilter,
    latestBlock: scan.latestBlock,
    startBlock: scan.startBlock,
    chunksScanned: scan.chunksScanned,
    logsScanned: scan.logsScanned,
    stuckCount: scan.stuck.length,
    byWallet: scan.byWallet,
    stuck: scan.stuck
  };

  const manifestPath = process.env.ASCENSION_RECOVERY_MANIFEST_PATH || DEFAULT_MANIFEST_PATH;
  ensureDataDir(manifestPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("");
  console.log("Recovery summary");
  console.log("Latest block:", scan.latestBlock);
  console.log("Start block:", scan.startBlock);
  console.log("Chunks scanned:", scan.chunksScanned);
  console.log("Transfer logs scanned:", scan.logsScanned);
  console.log("Stuck deposits:", scan.stuck.length);
  console.log("Manifest written to:", manifestPath);

  for (const row of scan.byWallet) {
    console.log(`- ${row.wallet}: ${row.count} token(s) -> ${row.tokenIds.join(", ")}`);
  }

  if (execute) {
    if (!signer) {
      throw new Error("Set DEPLOYER_PRIVATE_KEY to attempt recovery transactions.");
    }
    const attemptResults = await attemptRecovery(provider, signer, stakingAddress, scan.stuck);
    const succeeded = attemptResults.filter((row) => row.status === "submitted").length;
    const callable = attemptResults.filter((row) => row.status === "callable").length;
    const reverted = attemptResults.filter((row) => row.status === "reverted").length;
    const failed = attemptResults.filter((row) => row.status === "failed").length;

    console.log("");
    console.log("Attempt summary");
    console.log("Callable batches:", callable);
    console.log("Submitted batches:", succeeded);
    console.log("Reverted batches:", reverted);
    console.log("Failed batches:", failed);

    if (failed > 0 || reverted > 0) {
      console.log("Current contract did not accept the recovery call. No on-chain changes were made for those batches.");
    }
  }

  if (!execute && scan.stuck.length > 0) {
    console.log("");
    console.log("Dry-run only. Use --execute with DEPLOYER_PRIVATE_KEY only if the contract starts accepting the recovery call.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
