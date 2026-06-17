import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
} from "viem";
import * as config from "./config.js";

const ERC721_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const ASCENSION_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function stakedBalance(address owner) view returns (uint256)",
  "function tokensOfStaker(address owner) view returns (uint256[])",
  "function getStakedTokens(address owner) view returns (uint256[])",
  "function ascendedCount(address owner) view returns (uint256)",
  "function registeredCount(address owner) view returns (uint256)",
]);

const client = createPublicClient({
  transport: http(config.monadRpcUrl),
});

function verified(details = {}) {
  return {
    completed: true,
    status: "verified",
    reason: details.reason || "Verified on-chain",
    pointsAwarded: 0,
    proofTxHash: details.proofTxHash || null,
    proofSource: details.proofSource || details.mode || "server",
    verifiedAt: new Date().toISOString(),
    details,
  };
}

function notComplete(reason, details = {}) {
  return {
    completed: false,
    status: "pending",
    reason,
    pointsAwarded: 0,
    proofTxHash: details.proofTxHash || null,
    proofSource: details.proofSource || details.mode || null,
    verifiedAt: null,
    details: {
      mode: details.mode || "server_check",
      reason,
      ...details,
    },
  };
}

function manual(reason, details = {}) {
  return notComplete(reason, { mode: "manual_review", ...details });
}

function toAddress(address) {
  if (!isAddress(address)) throw new Error("Invalid wallet address.");
  return getAddress(address);
}

function normalizedTopicAddress(address) {
  const normalized = config.normalizeAddress(address);
  return normalized ? `0x${"0".repeat(24)}${normalized.slice(2)}` : "";
}

function isTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
}

async function getNftBalance(wallet, contract) {
  if (!contract) throw new Error("DYOOR S1 contract env var is not configured.");
  return client.readContract({
    address: toAddress(contract),
    abi: ERC721_ABI,
    functionName: "balanceOf",
    args: [toAddress(wallet)],
  });
}

async function tryReadContract(contract, functionName, wallet) {
  try {
    return await client.readContract({
      address: toAddress(contract),
      abi: ASCENSION_ABI,
      functionName,
      args: [toAddress(wallet)],
    });
  } catch (_err) {
    return null;
  }
}

async function getAscendedCount(wallet) {
  if (!config.ascensionStakingContract) throw new Error("ASCENSION_STAKING_CONTRACT is not configured.");
  const methods = ["tokensOfStaker", "getStakedTokens", "stakedBalance", "ascendedCount", "registeredCount", "balanceOf"];
  for (const method of methods) {
    const value = await tryReadContract(config.ascensionStakingContract, method, wallet);
    if (Array.isArray(value)) return { count: BigInt(value.length), proofSource: method, tokenIds: value.map((item) => item.toString()) };
    if (typeof value === "bigint") return { count: value, proofSource: method };
  }
  throw new Error("Ascension contract does not expose a supported staking read method.");
}

function parseBlueprintEntries(parsed) {
  if (!parsed) return [];
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.wallets)
      ? parsed.wallets
      : Array.isArray(parsed.blueprints)
        ? parsed.blueprints
        : Array.isArray(parsed.entries)
          ? parsed.entries
          : [];
  return source
    .map((entry, index) => {
      const wallet = config.normalizeAddress(typeof entry === "string" ? entry : entry.wallet || entry.wallet_address || entry.address);
      if (!wallet) return null;
      return {
        wallet,
        rank: Number(entry.rank || entry.first500Rank || entry.first_500_rank || index + 1) || null,
        id: entry.id || entry.blueprint_id || null,
      };
    })
    .filter(Boolean);
}

async function readBlueprintEntries() {
  const files = [
    path.join(config.root, "data/ascension-blueprint-wallets.json"),
    path.join(config.root, "data/ascension-blueprints.json"),
  ];

  for (const file of files) {
    try {
      const entries = parseBlueprintEntries(JSON.parse(await fs.readFile(file, "utf8")));
      if (entries.length) return entries;
    } catch (_err) {}
  }

  try {
    const store = getStore({ name: "ascension-blueprints", consistency: "strong" });
    const parsed = await store.get("ascension-blueprints.json", { type: "json", consistency: "strong" });
    const entries = parseBlueprintEntries(parsed);
    if (entries.length) return entries;
  } catch (_err) {}

  return [];
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Proof source returned ${res.status}`);
  return res.json();
}

async function verifyM3sh(wallet) {
  if (!config.m3shProofUrl) {
    // TODO: Set M3SH_PROOF_URL once M3SH exposes wallet session/profile/node proof records.
    return notComplete("M3SH proof source not configured yet", { proofSource: "m3sh_api_missing" });
  }
  const url = new URL(config.m3shProofUrl);
  url.searchParams.set("wallet", config.normalizeAddress(wallet));
  const data = await fetchJson(url);
  const connected = Boolean(data.connected || data.session || data.profile || data.node || data.wallet);
  return connected
    ? verified({ reason: "M3SH wallet connection verified", proofSource: "m3sh_api", m3sh: data })
    : notComplete("M3SH connection not found for this wallet", { proofSource: "m3sh_api", m3sh: data });
}

async function verifyBlueprint(wallet) {
  if (config.blueprintProofUrl) {
    const url = new URL(config.blueprintProofUrl);
    url.searchParams.set("wallet", config.normalizeAddress(wallet));
    const data = await fetchJson(url);
    if (data.exists || data.saved || data.blueprint) {
      return verified({
        reason: "Ascension Blueprint found",
        proofSource: "blueprint_api",
        badge: "Blueprint Architect",
        first500Rank: data.rank || data.first500Rank || data.first_500_rank || null,
      });
    }
    return notComplete("Blueprint not found for this wallet", { proofSource: "blueprint_api" });
  }

  const found = (await readBlueprintEntries()).find((entry) => entry.wallet === config.normalizeAddress(wallet));
  return found
    ? verified({
      reason: "Ascension Blueprint found",
      proofSource: "blueprint_registry",
      badge: "Blueprint Architect",
      first500Rank: found.rank && found.rank <= 500 ? found.rank : null,
      blueprintId: found.id,
    })
    : notComplete("Blueprint not found for this wallet", { proofSource: "blueprint_registry" });
}

async function verifySwapTx(wallet, txHash) {
  if (!isTxHash(txHash)) return null;
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const tx = await client.getTransaction({ hash: txHash });
  if (config.normalizeAddress(tx.from) !== config.normalizeAddress(wallet)) {
    return notComplete("Swap transaction was not sent by the connected wallet", { proofTxHash: txHash, proofSource: "rpc_receipt" });
  }
  if (receipt.status !== "success") {
    return notComplete("Swap transaction did not succeed", { proofTxHash: txHash, proofSource: "rpc_receipt" });
  }

  const router = config.normalizeAddress(config.dyoorSwapRouter || config.swapContract);
  const treasury = config.normalizeAddress(config.dyoorTreasuryAddress);
  const txTo = config.normalizeAddress(tx.to);
  const interactedWithRouter = Boolean(router && txTo === router);
  const paidTreasury = Boolean(treasury && receipt.logs.some((log) => {
    const addressMatch = config.normalizeAddress(log.address) === treasury;
    const topicMatch = log.topics.map((topic) => String(topic).toLowerCase()).includes(normalizedTopicAddress(treasury));
    return addressMatch || topicMatch;
  }));

  if (interactedWithRouter || paidTreasury) {
    return verified({
      reason: "Verified on-chain",
      proofTxHash: txHash,
      proofSource: interactedWithRouter ? "swap_router_tx" : "treasury_fee_event",
      router,
      treasury,
    });
  }
  return notComplete("Transaction did not interact with the configured DYOOR swap/router or treasury", {
    proofTxHash: txHash,
    proofSource: "rpc_receipt",
    router,
    treasury,
  });
}

async function verifySwap(wallet, txHash) {
  const txResult = await verifySwapTx(wallet, txHash);
  if (txResult) return txResult;
  if (!config.dyoorSwapRouter && !config.swapContract && !config.dyoorTreasuryAddress) {
    return notComplete("DYOOR swap/router or treasury proof config is missing", { proofSource: "swap_config_missing" });
  }
  // TODO: Add MONAD_EXPLORER_API_URL/MONADSCAN_API_KEY support for wallet-history scanning without a tx hash.
  return notComplete("No qualifying transaction found yet", {
    proofSource: "rpc_history_unavailable",
    hint: "Submit a swap tx hash or configure an explorer/indexer for wallet history scanning.",
  });
}

async function verifyOpenSea(wallet) {
  if (!config.dyoorS1Contract) return notComplete("DYOOR S1 contract env var is not configured", { proofSource: "s1_config_missing" });
  // TODO: Use OPENSEA_API_KEY for marketplace sale attribution when OpenSea event access is available.
  if (!config.openseaBuyStartBlock) {
    return notComplete("OpenSea quest start block is not configured", { proofSource: "opensea_start_block_missing" });
  }
  const toTopic = normalizedTopicAddress(wallet);
  const logs = await client.getLogs({
    address: toAddress(config.dyoorS1Contract),
    event: ERC721_ABI.find((item) => item.type === "event" && item.name === "Transfer"),
    args: { to: toAddress(wallet) },
    fromBlock: BigInt(config.openseaBuyStartBlock),
    toBlock: "latest",
  });
  const saleLog = logs.find((log) => {
    const from = String(log.topics?.[1] || "").toLowerCase();
    const to = String(log.topics?.[2] || "").toLowerCase();
    return to === toTopic && from !== normalizedTopicAddress(zeroAddress);
  });
  if (!saleLog) return notComplete("No qualifying OpenSea purchase transfer found yet", { proofSource: "s1_transfer_fallback" });
  let tokenId = null;
  try {
    const decoded = decodeEventLog({ abi: ERC721_ABI, data: saleLog.data, topics: saleLog.topics });
    tokenId = decoded.args.tokenId?.toString() || null;
  } catch (_err) {}
  return verified({
    reason: "DYOOR S1 transfer into wallet found",
    proofTxHash: saleLog.transactionHash,
    proofSource: "s1_transfer_fallback",
    weakerProof: true,
    tokenId,
  });
}

async function verifyQuest({ quest, wallet, proofText, txHash }) {
  switch (quest.quest_type) {
    case "m3sh_connect":
      return verifyM3sh(wallet);

    case "s1_holder": {
      const balance = await getNftBalance(wallet, config.dyoorS1Contract);
      return balance > 0n
        ? verified({ reason: "Verified on-chain", proofSource: "s1_balance", balance: balance.toString(), badge: "S1 Holder" })
        : notComplete("No DYOOR S1 balance found for this wallet", { proofSource: "s1_balance", balance: "0" });
    }

    case "swap":
      return verifySwap(wallet, txHash || (isTxHash(proofText) ? proofText : ""));

    case "ascension_blueprint":
      return verifyBlueprint(wallet);

    case "opensea_buy":
      return verifyOpenSea(wallet);

    case "ascended_s1":
    case "ascension_tutorial": {
      const ascended = await getAscendedCount(wallet);
      return ascended.count > 0n
        ? verified({
          reason: "Verified on-chain",
          proofSource: ascended.proofSource,
          ascendedCount: ascended.count.toString(),
          tokenIds: ascended.tokenIds || [],
          badge: "Ascended",
        })
        : notComplete("No ascended or staked S1 found for this wallet", { proofSource: ascended.proofSource, ascendedCount: "0" });
    }

    case "discord_join":
      return manual("Discord OAuth verification is pending configuration. Join Discord and submit your Discord username.");

    case "social_follow":
    case "x_like":
    case "x_repost":
    case "x_comment":
      return manual("X API mode is unavailable until OAuth/API credentials are configured. Manual proof is accepted.", {
        targetPostId: config.targetDyoorPostId || null,
        targetAccount: quest.target || null,
      });

    default:
      return manual("Manual verification required for this quest type.");
  }
}

export {
  verifyQuest,
};
