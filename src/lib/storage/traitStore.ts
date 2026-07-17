import { createJsonStore } from "./fileStore";
import type { TraitOverride } from "./types";

const STORE_NAME = "dyoor-s2-metadata";
const OVERRIDES_KEY = "overrides.json";
const store = createJsonStore(STORE_NAME);

export async function getTraitOverrides(tokenId: string | number) {
  const overrides = await store.getJson<Record<string, TraitOverride>>(OVERRIDES_KEY, {});
  return overrides[String(tokenId)] || null;
}

export async function saveTraitOverride(tokenId: string | number, override: TraitOverride) {
  const overrides = await store.getJson<Record<string, TraitOverride>>(OVERRIDES_KEY, {});
  const next = {
    ...overrides,
    [String(tokenId)]: {
      ...override,
      updatedAt: override.updatedAt || new Date().toISOString(),
    },
  };
  await store.setJson(OVERRIDES_KEY, next);
  return next[String(tokenId)];
}

export async function exportTraitOverrides() {
  return await store.getJson<Record<string, TraitOverride>>(OVERRIDES_KEY, {});
}
