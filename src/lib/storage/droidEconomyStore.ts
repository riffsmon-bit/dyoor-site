import { createJsonStore } from "@/src/lib/storage/fileStore";
import { canonicalDroidId, normalizeBytes32 } from "@/lib/droid-economy/identity";
import type {
  ChainQualifiedDroidId,
  RewardEpochManifest,
  RewardEpochManifestSummary,
} from "@/lib/droid-economy/types";

const store = createJsonStore("dyoor-economic-droids");
const INDEX_KEY = "reward-epochs/index.json";

type ManifestIndexEntry = RewardEpochManifestSummary;

function manifestKey(chainId: number, epochId: string) {
  return `reward-epochs/${chainId}/${normalizeBytes32(epochId, "reward epoch ID").slice(2)}.json`;
}

function indexEntry(manifest: RewardEpochManifest): ManifestIndexEntry {
  return {
    epochId: manifest.epochId,
    chainId: manifest.chainId,
    asset: manifest.asset,
    assetSymbol: manifest.assetSymbol,
    startsAt: manifest.startsAt,
    endsAt: manifest.endsAt,
    merkleRoot: manifest.merkleRoot,
    manifestHash: manifest.manifestHash,
    totalAllocated: manifest.totalAllocated,
    allocationCount: manifest.allocationCount,
    preparedAt: manifest.preparedAt,
    deploymentStatus: manifest.deploymentStatus,
    transactionHash: manifest.transactionHash,
  };
}

export async function publishRewardEpochManifest(manifest: RewardEpochManifest) {
  const key = manifestKey(manifest.chainId, manifest.epochId);
  const existing = await store.getJsonStrict<RewardEpochManifest>(key);
  if (existing && existing.manifestHash !== manifest.manifestHash) {
    throw Object.assign(new Error("This reward epoch ID already has a different immutable manifest."), { status: 409 });
  }
  if (existing) return { manifest: existing, deduped: true };

  await store.setJson(key, manifest);
  const index = await store.getJson<ManifestIndexEntry[]>(INDEX_KEY, []);
  const next = [indexEntry(manifest), ...index.filter((entry) => !(
    entry.chainId === manifest.chainId && entry.epochId === manifest.epochId
  ))].sort((left, right) => right.preparedAt.localeCompare(left.preparedAt));
  await store.setJson(INDEX_KEY, next);
  return { manifest, deduped: false };
}

export async function getRewardEpochManifest(chainId: number, epochId: string) {
  return await store.getJsonStrict<RewardEpochManifest>(manifestKey(chainId, epochId));
}

export async function markRewardEpochManifestOnchain(
  chainId: number,
  epochId: string,
  transactionHash: string,
) {
  const key = manifestKey(chainId, epochId);
  const existing = await store.getJsonStrict<RewardEpochManifest>(key);
  if (!existing) throw Object.assign(new Error("Reward epoch manifest was not found."), { status: 404 });
  const updated: RewardEpochManifest = {
    ...existing,
    deploymentStatus: "onchain",
    transactionHash: transactionHash.toLowerCase(),
  };
  await store.setJson(key, updated);
  const index = await store.getJson<ManifestIndexEntry[]>(INDEX_KEY, []);
  await store.setJson(INDEX_KEY, index.map((entry) => (
    entry.chainId === chainId && entry.epochId === existing.epochId
      ? indexEntry(updated)
      : entry
  )));
  return updated;
}

export async function listRewardEpochManifests(chainId?: number) {
  const index = await store.getJson<ManifestIndexEntry[]>(INDEX_KEY, []);
  const selected = chainId ? index.filter((entry) => entry.chainId === chainId) : index;
  const manifests = await Promise.all(selected.map(async (entry) => (
    await getRewardEpochManifest(entry.chainId, entry.epochId)
  )));
  return manifests.filter((manifest): manifest is RewardEpochManifest => Boolean(manifest));
}

/** Lists only public epoch commitments; allocation proofs remain in the protected manifest. */
export async function listRewardEpochManifestSummaries(chainId?: number) {
  const index = await store.getJson<ManifestIndexEntry[]>(INDEX_KEY, []);
  return chainId ? index.filter((entry) => entry.chainId === chainId) : index;
}

export async function getDroidRewardAllocations(identity: ChainQualifiedDroidId) {
  const id = canonicalDroidId(identity);
  const manifests = await listRewardEpochManifests(identity.chainId);
  return manifests.flatMap((manifest) => {
    const allocation = manifest.allocations.find((item) => canonicalDroidId(item) === id);
    return allocation ? [{ manifest, allocation }] : [];
  });
}
