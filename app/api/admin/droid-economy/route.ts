import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { NextResponse } from "next/server";
import { adminOwnerWallet, normalizeAdminAddress, verifyAdmin } from "@/lib/adminAuth";
import { checkedDroidProtocolConfig } from "@/lib/droid-accounts/server";
import { droidServerRpcUrl } from "@/lib/droid-accounts/config";
import {
  ECONOMY_REWARDS_ABI,
  EXISTING_DROID_RESOLVER_ABI,
} from "@/lib/droid-economy/abis";
import { DROID_COLLECTION_ABI } from "@/lib/droid-accounts/abis";
import { getDroidEconomyConfig } from "@/lib/droid-economy/config";
import { buildRewardEpochManifest } from "@/lib/droid-economy/manifest";
import type { RewardManifestAllocationInput } from "@/lib/droid-economy/types";
import {
  getRewardEpochManifest,
  listRewardEpochManifestSummaries,
  markRewardEpochManifestOnchain,
  publishRewardEpochManifest,
} from "@/src/lib/storage/droidEconomyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/admin/droid-economy";
const MAX_PREPARE_ALLOCATIONS = 500;
const txPattern = /^0x[a-fA-F0-9]{64}$/;
const rewardInterface = new Interface(ECONOMY_REWARDS_ABI);

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Invalid admin request body."), { status: 400 });
  }
  return value as Record<string, unknown>;
}

function allocationRecords(value: unknown): RewardManifestAllocationInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PREPARE_ALLOCATIONS) {
    throw Object.assign(new Error(`Provide 1-${MAX_PREPARE_ALLOCATIONS} reward allocations.`), { status: 400 });
  }
  return value.map((item) => bodyRecord(item) as RewardManifestAllocationInput);
}

async function validateAccounts(
  allocations: RewardManifestAllocationInput[],
  droidConfig: Awaited<ReturnType<typeof checkedDroidProtocolConfig>>,
  accountVersion: number,
) {
  if (!droidConfig.configured) {
    throw Object.assign(new Error(droidConfig.setupIssue || "Droid Account resolver is not configured."), { status: 503 });
  }
  const provider = new JsonRpcProvider(
    droidServerRpcUrl(droidConfig.chainId),
    droidConfig.chainId,
    { staticNetwork: true },
  );
  const resolver = new Contract(
    droidConfig.registryAddress,
    EXISTING_DROID_RESOLVER_ABI,
    provider,
  );
  const collection = new Contract(
    droidConfig.collectionAddress,
    DROID_COLLECTION_ABI,
    provider,
  );
  for (let start = 0; start < allocations.length; start += 25) {
    const batch = allocations.slice(start, start + 25);
    await Promise.all(batch.map(async (allocation) => {
      if (
        Number(allocation.chainId) !== droidConfig.chainId
        || getAddress(allocation.collectionAddress) !== getAddress(droidConfig.collectionAddress)
      ) throw Object.assign(new Error("Allocation does not target the configured native collection."), { status: 400 });
      if (Number(allocation.accountVersion) !== accountVersion) {
        throw Object.assign(new Error(`The current adapter supports Droid Account version ${accountVersion} only.`), { status: 400 });
      }
      const [expected] = await Promise.all([
        resolver.account(allocation.tokenId) as Promise<string>,
        collection.ownerOf(allocation.tokenId) as Promise<string>,
      ]);
      if (getAddress(expected) !== getAddress(allocation.droidAccount)) {
        throw Object.assign(new Error(`Droid #${allocation.tokenId} account does not match the official resolver.`), { status: 400 });
      }
    }));
  }
}

export async function GET(request: Request) {
  const owner = adminOwnerWallet();
  const wallet = normalizeAdminAddress(new URL(request.url).searchParams.get("wallet"));
  const authorized = Boolean(owner && wallet && owner.toLowerCase() === wallet.toLowerCase());
  const config = getDroidEconomyConfig();
  return json(200, {
    ok: true,
    authorized,
    ownerConfigured: Boolean(owner),
    config,
    manifests: authorized ? await listRewardEpochManifestSummaries(config.chainId) : [],
    broadcastEnabled: false,
  });
}

export async function POST(request: Request) {
  try {
    const body = bodyRecord(await request.json());
    const mode = String(body.mode || "");
    const config = getDroidEconomyConfig();
    await verifyAdmin(body, "droid-economy", { route: ROUTE, chainId: config.chainId });

    if (mode === "prepare-epoch") {
      const allocations = allocationRecords(body.allocations);
      const droidConfig = await checkedDroidProtocolConfig();
      await validateAccounts(allocations, droidConfig, config.defaultAccountVersion);
      const manifest = buildRewardEpochManifest({
        epochId: String(body.epochId || ""),
        chainId: Number(body.targetChainId),
        asset: String(body.asset || ""),
        assetSymbol: String(body.assetSymbol || ""),
        assetDecimals: Number(body.assetDecimals),
        startsAt: Number(body.startsAt),
        endsAt: Number(body.endsAt),
        metadataUri: String(body.metadataUri || ""),
        allocations,
      });
      if (manifest.chainId !== config.chainId) {
        throw Object.assign(new Error("Epoch target chain does not match this configured admin adapter."), { status: 400 });
      }
      const saved = await publishRewardEpochManifest(manifest);
      return json(200, {
        ok: true,
        manifest: saved.manifest,
        deduped: saved.deduped,
        broadcast: false,
        nextStep: "Review the manifest and run the separate no-broadcast deployment preflight.",
      });
    }

    if (mode === "mark-epoch-onchain") {
      if (!config.contractsConfigured || !config.addresses.rewardsDistributor) {
        throw Object.assign(new Error(config.setupIssue), { status: 503 });
      }
      const epochId = String(body.epochId || "");
      const transactionHash = String(body.transactionHash || "");
      if (!txPattern.test(transactionHash)) {
        throw Object.assign(new Error("Invalid reward epoch transaction hash."), { status: 400 });
      }
      const manifest = await getRewardEpochManifest(config.chainId, epochId);
      if (!manifest) throw Object.assign(new Error("Prepared epoch manifest was not found."), { status: 404 });
      const provider = new JsonRpcProvider(
        droidServerRpcUrl(config.chainId),
        config.chainId,
        { staticNetwork: true },
      );
      const receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt || receipt.status !== 1) {
        throw Object.assign(new Error("Reward epoch transaction is missing or unsuccessful."), { status: 400 });
      }
      const event = receipt.logs.flatMap((log) => {
        if (getAddress(log.address) !== getAddress(config.addresses.rewardsDistributor)) return [];
        try {
          const parsed = rewardInterface.parseLog(log);
          return parsed?.name === "RewardEpochCreated" ? [parsed] : [];
        } catch {
          return [];
        }
      }).find((parsed) => String(parsed.args.epochId).toLowerCase() === manifest.epochId.toLowerCase());
      if (
        !event
        || String(event.args.merkleRoot).toLowerCase() !== manifest.merkleRoot.toLowerCase()
        || String(event.args.manifestHash).toLowerCase() !== manifest.manifestHash.toLowerCase()
        || BigInt(event.args.totalAllocated) !== BigInt(manifest.totalAllocated)
        || getAddress(event.args.asset) !== getAddress(manifest.asset)
      ) throw Object.assign(new Error("On-chain epoch event does not match the prepared manifest."), { status: 400 });
      const updated = await markRewardEpochManifestOnchain(
        config.chainId,
        manifest.epochId,
        transactionHash,
      );
      return json(200, { ok: true, manifest: updated, broadcast: false });
    }

    return json(400, { ok: false, error: "Unsupported Droid economy admin mode." });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    return json(status, {
      ok: false,
      error: error instanceof Error ? error.message : "Droid economy admin request failed.",
    });
  }
}
