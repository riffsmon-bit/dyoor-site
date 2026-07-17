import { createJsonStore } from "./fileStore";
import type { AscendedS1Snapshot } from "./types";

const STORE_NAME = "dyoor-s1-snapshots";
const LATEST_KEY = "latest.json";
const store = createJsonStore(STORE_NAME);

function snapshotKey(id: string) {
  return `snapshots/${id.replace(/[^a-zA-Z0-9:_-]/g, "-")}.json`;
}

export async function saveSnapshot(snapshot: AscendedS1Snapshot) {
  await store.setJson(snapshotKey(snapshot.id), snapshot);
  await store.setJson(LATEST_KEY, {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    fromBlock: snapshot.fromBlock,
    toBlock: snapshot.toBlock,
    totalAscendedTokens: snapshot.totalAscendedTokens,
    uniqueWallets: snapshot.uniqueWallets,
  });
  return snapshot;
}

export async function getLatestSnapshotSummary() {
  return await store.getJson<Record<string, unknown> | null>(LATEST_KEY, null);
}

export async function getLatestSnapshot() {
  const latest = await getLatestSnapshotSummary();
  const id = typeof latest?.id === "string" ? latest.id : "";
  if (!id) return null;
  return await store.getJson<AscendedS1Snapshot | null>(snapshotKey(id), null);
}
