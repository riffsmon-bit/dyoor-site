import "server-only";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  isAddress,
  parseUnits,
} from "ethers";
import { DROID_COLLECTION_ABI } from "@/lib/droid-accounts/abis";
import {
  droidServerRpcUrl,
  getDroidProtocolConfig,
} from "@/lib/droid-accounts/config";
import {
  STAGED_REVENUE_SPLIT,
  aggregateRevenueAmounts,
  assertSupportedRevenueSource,
  canonicalRevenueId,
  previewRevenueSplit,
  stagedDroidRewardPool,
} from "@/lib/droid-economy/revenue";
import type {
  EcosystemRevenueSnapshot,
  RevenueReceipt,
  RevenueSourceKind,
  RevenueSourceView,
} from "@/lib/droid-economy/types";
import { listVerifiedRevenueReceipts } from "@/src/lib/storage/droidEconomyStore";

const erc20Interface = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

type RoyaltyConfig = {
  receiver: string;
  basisPoints: number | null;
  verified: boolean;
  issue: string;
};

export type VerifyRevenueReceiptInput = {
  chainId: number;
  transactionHash: string;
  sourceKind: string;
  asset?: string;
  assetSymbol?: string;
  assetDecimals?: number;
  transferIndex?: number;
  marketplace?: string;
};

function providerFor(chainId: number) {
  return new JsonRpcProvider(
    droidServerRpcUrl(chainId),
    chainId,
    { staticNetwork: true },
  );
}

function receiptSources(input: {
  chainId: number;
  receiver: string;
  royaltyVerified: boolean;
  royaltyBps: number | null;
  receipts: RevenueReceipt[];
}): RevenueSourceView[] {
  const definitions: Array<[RevenueSourceKind, string, string]> = [
    ["SECONDARY_MARKET_REVENUE", "SECONDARY MARKET ROYALTIES", input.royaltyBps === null
      ? "Creator receiver is read on-chain. Royalty rate is unavailable. Sale events alone are not receipts."
      : `Creator receiver and ${input.royaltyBps} bps royalty configuration are read on-chain. Sale events alone are not receipts.`],
    ["DYOOR_BUILD", "DYOOR BUILD", "No approved receipt destination or automated accounting source is active."],
    ["PLATFORM_FEES", "PLATFORM FEES", "No approved receipt destination or automated accounting source is active."],
    ["PARTNER_REVENUE", "PARTNER REVENUE", "Unknown partners and destinations remain inactive."],
    ["OTHER_APPROVED", "OTHER APPROVED", "Requires a transparent destination and separate owner approval."],
  ];
  return definitions.map(([sourceKind, name, notes]) => {
    const matching = input.receipts.filter((receipt) => (
      receipt.sourceKind === sourceKind
      && (sourceKind !== "SECONDARY_MARKET_REVENUE" || receipt.attributionStatus === "VERIFIED")
    ));
    const secondary = sourceKind === "SECONDARY_MARKET_REVENUE";
    return {
      sourceKind,
      name,
      chainId: input.chainId,
      receiver: secondary ? input.receiver : "",
      asset: secondary ? ZeroAddress : "",
      assetSymbol: secondary ? "MON" : "",
      verified: secondary && input.royaltyVerified,
      active: false,
      rewardEligible: false,
      totalReceived: aggregateRevenueAmounts(matching),
      notes,
    };
  });
}

async function readRoyaltyConfig(chainId: number): Promise<RoyaltyConfig> {
  const config = getDroidProtocolConfig(chainId);
  const provider = providerFor(chainId);
  const collection = new Contract(config.collectionAddress, DROID_COLLECTION_ABI, provider);
  try {
    const [receiver, bps] = await Promise.all([
      collection.royaltyAddress() as Promise<string>,
      collection.royaltyBasisPoints() as Promise<bigint>,
    ]);
    return {
      receiver: getAddress(receiver),
      basisPoints: Number(bps),
      verified: true,
      issue: "",
    };
  } catch {
    try {
      const result = await collection.royaltyInfo(1, 10_000n) as readonly [string, bigint];
      return {
        receiver: getAddress(result[0]),
        basisPoints: Number(result[1]),
        verified: true,
        issue: "",
      };
    } catch {
      return {
        receiver: "",
        basisPoints: null,
        verified: false,
        issue: "Live creator-revenue configuration is temporarily unavailable.",
      };
    }
  }
}

export async function getEcosystemRevenueSnapshot(
  chainId: number,
): Promise<EcosystemRevenueSnapshot> {
  const config = getDroidProtocolConfig(chainId);
  const [royalty, receipts] = await Promise.all([
    readRoyaltyConfig(chainId),
    listVerifiedRevenueReceipts(chainId),
  ]);
  const secondaryReceipts = receipts.filter(
    (receipt) => receipt.sourceKind === "SECONDARY_MARKET_REVENUE"
      && receipt.attributionStatus === "VERIFIED",
  );
  const otherReceipts = receipts.filter(
    (receipt) => receipt.sourceKind !== "SECONDARY_MARKET_REVENUE"
      || receipt.attributionStatus !== "VERIFIED",
  );
  const simulatedGross = parseUnits("10", 18);
  const simulation = previewRevenueSplit(simulatedGross);
  return {
    chainId,
    chainName: config.chainName,
    collectionAddress: config.collectionAddress,
    accountingStatus: "STAGED",
    receiptCoverage: "PARTIAL_MANUAL_VERIFICATION",
    verifiedReceiptCount: receipts.length,
    totalVerifiedRevenueReceived: aggregateRevenueAmounts(receipts),
    secondaryMarketRevenueReceived: aggregateRevenueAmounts(secondaryReceipts),
    otherRevenueReceived: aggregateRevenueAmounts(otherReceipts),
    sources: receiptSources({
      chainId,
      receiver: royalty.receiver,
      royaltyVerified: royalty.verified,
      royaltyBps: royalty.basisPoints,
      receipts,
    }),
    policy: STAGED_REVENUE_SPLIT,
    rewardPool: stagedDroidRewardPool(),
    simulation: {
      label: "SIMULATION_ONLY",
      assetSymbol: "MON",
      assetDecimals: 18,
      grossAmount: simulation.grossAmount.toString(),
      projectTreasuryAmount: simulation.projectTreasuryAmount.toString(),
      droidRewardsAmount: simulation.droidRewardsAmount.toString(),
      otherApprovedAmount: simulation.otherApprovedAmount.toString(),
    },
    warnings: [
      "Secondary-sale revenue actually received by the ecosystem may contribute to funded Droid Reward pools.",
      "Rewards are funded and eligibility-based. Marketplace creator revenue is not guaranteed.",
      "Receipt coverage is partial until a production indexer verifies every native and token transfer to an approved destination.",
      "A free-form marketplace label is not attribution proof; secondary-market classification remains undetermined without an approved source or trace.",
      royalty.issue,
    ].filter(Boolean),
  };
}

function safeMarketplace(value: string | undefined) {
  const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9 ._/-]/g, "");
  return cleaned.slice(0, 80) || "UNDETERMINED";
}

/**
 * Verifies a concrete inbound transfer. It deliberately does not infer a
 * receipt from an NFT sale event. Native internal transfers require a trace
 * indexer and are rejected by this direct-RPC verifier.
 */
export async function verifyRevenueReceipt(
  input: VerifyRevenueReceiptInput,
): Promise<RevenueReceipt> {
  const config = getDroidProtocolConfig(input.chainId);
  const sourceKind = assertSupportedRevenueSource(input.sourceKind);
  const royalty = await readRoyaltyConfig(input.chainId);
  if (!royalty.verified || !royalty.receiver) {
    throw Object.assign(new Error("The approved creator-revenue receiver could not be verified on-chain."), { status: 503 });
  }
  if (sourceKind !== "SECONDARY_MARKET_REVENUE") {
    throw Object.assign(new Error("This staged verifier has no approved destination for that revenue source."), { status: 400 });
  }

  const provider = providerFor(input.chainId);
  const [receipt, transaction] = await Promise.all([
    provider.getTransactionReceipt(input.transactionHash),
    provider.getTransaction(input.transactionHash),
  ]);
  if (!receipt || receipt.status !== 1 || !transaction) {
    throw Object.assign(new Error("Revenue transaction is missing or unsuccessful."), { status: 400 });
  }

  const receiverAddress = getAddress(royalty.receiver);
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) throw Object.assign(new Error("Revenue transaction block is unavailable."), { status: 503 });

  let asset = ZeroAddress;
  let assetSymbol = "MON";
  let assetDecimals = 18;
  let grossAmount = 0n;
  let transferIndex = 0;
  let sourceAddress = transaction.from;
  let verificationMethod: RevenueReceipt["verificationMethod"] = "DIRECT_NATIVE_TRANSFER";

  if (input.asset && getAddress(input.asset) !== ZeroAddress) {
    if (!isAddress(input.asset)) throw Object.assign(new Error("Revenue asset address is invalid."), { status: 400 });
    asset = getAddress(input.asset);
    assetSymbol = String(input.assetSymbol || "TOKEN").trim().toUpperCase().slice(0, 12) || "TOKEN";
    assetDecimals = Number(input.assetDecimals);
    if (!Number.isSafeInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 36) {
      throw Object.assign(new Error("Revenue asset decimals are invalid."), { status: 400 });
    }
    const matching = receipt.logs.flatMap((log) => {
      if (getAddress(log.address) !== asset) return [];
      try {
        const parsed = erc20Interface.parseLog(log);
        if (parsed?.name !== "Transfer" || getAddress(parsed.args.to) !== receiverAddress) return [];
        return [{ log, amount: BigInt(parsed.args.value), from: getAddress(parsed.args.from) }];
      } catch {
        return [];
      }
    });
    const requestedIndex = input.transferIndex;
    const selected = requestedIndex === undefined
      ? (matching.length === 1 ? matching[0] : null)
      : matching.find(({ log }) => log.index === requestedIndex) || null;
    if (!selected) {
      throw Object.assign(new Error(
        matching.length > 1
          ? "Multiple matching token receipts exist; provide the exact transfer index."
          : "No verified ERC-20 transfer to the creator-revenue receiver was found.",
      ), { status: 400 });
    }
    grossAmount = selected.amount;
    transferIndex = selected.log.index;
    sourceAddress = selected.from;
    verificationMethod = "ERC20_TRANSFER_EVENT";
  } else {
    if (!transaction.to || getAddress(transaction.to) !== receiverAddress || transaction.value <= 0n) {
      throw Object.assign(new Error(
        "No direct native transfer to the verified receiver was found. Internal native receipts require the trace indexer and cannot be inferred from a sale event.",
      ), { status: 400 });
    }
    grossAmount = transaction.value;
  }

  if (grossAmount <= 0n) {
    throw Object.assign(new Error("Verified revenue amount must be greater than zero."), { status: 400 });
  }
  const revenueId = canonicalRevenueId({
    chainId: input.chainId,
    collectionAddress: config.collectionAddress,
    receiverAddress,
    transactionHash: receipt.hash,
    transferIndex,
    asset,
  });
  return {
    schemaVersion: 1,
    revenueId,
    chainId: input.chainId,
    collectionAddress: getAddress(config.collectionAddress),
    receiverAddress,
    sourceKind,
    sourceAddress: getAddress(sourceAddress),
    marketplace: safeMarketplace(input.marketplace),
    attributionStatus: "UNDETERMINED",
    transactionHash: receipt.hash.toLowerCase(),
    transferIndex,
    asset,
    assetSymbol,
    assetDecimals,
    grossAmount: grossAmount.toString(),
    blockNumber: receipt.blockNumber,
    receivedAt: new Date(block.timestamp * 1_000).toISOString(),
    verificationMethod,
    accountingStatus: "VERIFIED_RECEIVED",
    rewardEligible: false,
    indexedAt: new Date().toISOString(),
  };
}
