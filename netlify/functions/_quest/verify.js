import fs from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, getAddress, isAddress } from "viem";
import * as config from "./config.js";

const ERC721_ABI = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }],
}];

const client = createPublicClient({
  transport: http(config.monadRpcUrl),
});

function toAddress(address) {
  if (!isAddress(address)) throw new Error("Invalid wallet address.");
  return getAddress(address);
}

async function getNftBalance(wallet, contract) {
  if (!contract) throw new Error("NFT contract env var is not configured.");
  return client.readContract({
    address: toAddress(contract),
    abi: ERC721_ABI,
    functionName: "balanceOf",
    args: [toAddress(wallet)],
  });
}

async function readBlueprintWallets() {
  const files = [
    path.join(config.root, "data/ascension-blueprint-wallets.json"),
    path.join(config.root, "data/ascension-blueprints.json"),
  ];

  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => config.normalizeAddress(typeof entry === "string" ? entry : entry.wallet))
          .filter(Boolean);
      }
    } catch (_err) {}
  }
  return [];
}

function manual(message, details = {}) {
  return {
    status: "pending",
    details: {
      mode: "manual",
      message,
      ...details,
    },
  };
}

async function verifyQuest({ quest, wallet, proofText, proofUrl, txHash }) {
  switch (quest.quest_type) {
    case "s1_holder": {
      try {
        const balance = await getNftBalance(wallet, config.dyoorS1Contract);
        if (balance > 0n) {
          const bonus = balance >= 20n ? 750 : balance >= 10n ? 500 : balance >= 5n ? 250 : 0;
          return {
            status: "verified",
            details: {
              mode: "contract",
              balance: balance.toString(),
              bonusNote: bonus ? `Eligible for ${bonus} holder-tier bonus in future expansion.` : "",
            },
          };
        }
        return manual("No S1 balance found. Submit OpenSea or transaction proof if this is a new purchase.", { balance: "0" });
      } catch (err) {
        return manual("S1 contract verification is not available yet. Admin approval can verify this quest.", { error: err.message });
      }
    }

    case "ascended_s1":
    case "ascension_tutorial": {
      try {
        const balance = await getNftBalance(wallet, config.ascensionStakingContract);
        if (balance > 0n) {
          return { status: "verified", details: { mode: "contract", ascendedBalance: balance.toString(), badge: "Ascended" } };
        }
        return manual("No ascended balance found yet. Complete Ascension or submit proof for admin review.", { ascendedBalance: "0" });
      } catch (err) {
        return manual("Ascension contract verification needs ASCENSION_STAKING_CONTRACT configured.", { error: err.message });
      }
    }

    case "ascension_blueprint": {
      const wallets = await readBlueprintWallets();
      const found = wallets.includes(config.normalizeAddress(wallet));
      return found
        ? { status: "verified", details: { mode: "blueprint_registry", badge: "Blueprint Architect" } }
        : manual("Wallet was not found in the local Ascension Blueprint registry. Save a blueprint or submit proof.", {});
    }

    case "m3sh_connect":
      // TODO: Replace this stub with a call to the M3SH wallet connection records API.
      return manual("M3SH verification endpoint is stubbed until M3SH exposes wallet proof records.", { m3shUrl: "https://m3sh.netlify.app" });

    case "swap":
      if (/^0x[a-fA-F0-9]{64}$/.test(String(txHash || proofText || ""))) {
        return manual("Swap tx hash captured. Admin can approve until SWAP_CONTRACT event checks are wired.", { txHash: txHash || proofText });
      }
      return manual("Submit a swap transaction hash. Duplicate tx hashes are blocked by the database.", {});

    case "opensea_buy":
      try {
        const balance = await getNftBalance(wallet, config.dyoorS1Contract);
        if (balance > 0n) return { status: "verified", details: { mode: "ownership_after_purchase", balance: balance.toString() } };
      } catch (_err) {}
      return manual("Submit an OpenSea or transaction link for admin review.", {});

    case "discord_join":
      // TODO: Complete Discord OAuth callback flow with DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.
      return manual("Discord OAuth verification is pending configuration. Join Discord and submit your Discord username.", {});

    case "social_follow":
    case "x_like":
    case "x_repost":
    case "x_comment":
      // TODO: Add X OAuth and API checks using X_CLIENT_ID, X_CLIENT_SECRET, and TARGET_DYOOR_POST_ID.
      return manual("X API mode is unavailable until OAuth/API credentials are configured. Manual proof is accepted.", {
        targetPostId: config.targetDyoorPostId || null,
        targetAccount: quest.target || null,
      });

    default:
      return manual("Manual verification required for this quest type.", {});
  }
}

export {
  verifyQuest,
};
