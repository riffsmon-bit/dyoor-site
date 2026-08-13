import { createHash } from "node:crypto";
import path from "node:path";
import { pathExists, readJsonOrNull } from "./json";
import { PIXEL_LAYER_ROOT, REPOSITORY_ROOT } from "./paths";
import type { NormalizedMetadata } from "./metadata";

export type TraitFrequency = {
  count: number;
  frequency: number;
  rarityWeight: number;
};

export type TraitManifestValue = TraitFrequency & {
  value: string;
  layerId: string;
  layerSheet: string | null;
  spriteStatus: "ready" | "missing";
};

export type TraitManifest = {
  schemaVersion: 1;
  recordCount: number;
  attributeOrder: string[];
  renderOrder: string[];
  categories: Record<string, TraitManifestValue[]>;
};

function safeSlug(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "trait";
}

export function traitLayerId(traitType: string, value: string) {
  const digest = createHash("sha256").update(`${traitType}\0${value}`).digest("hex").slice(0, 10);
  return `${safeSlug(traitType)}--${safeSlug(value)}--${digest}`;
}

export function computeTraitManifest(
  records: NormalizedMetadata[],
  preferredOrder: string[] = [],
): TraitManifest {
  const counts = new Map<string, Map<string, number>>();
  const discoveredOrder: string[] = [];
  for (const record of records) {
    for (const attribute of record.attributes) {
      if (!counts.has(attribute.traitType)) {
        counts.set(attribute.traitType, new Map());
        discoveredOrder.push(attribute.traitType);
      }
      const values = counts.get(attribute.traitType);
      values?.set(attribute.value, (values.get(attribute.value) || 0) + 1);
    }
  }
  const order = [
    ...preferredOrder.filter((traitType) => counts.has(traitType)),
    ...discoveredOrder.filter((traitType) => !preferredOrder.includes(traitType)),
  ];
  const categories: Record<string, TraitManifestValue[]> = {};
  for (const traitType of order) {
    const values = counts.get(traitType);
    if (!values) continue;
    categories[traitType] = [...values.entries()]
      .map(([value, count]) => {
        const layerId = traitLayerId(traitType, value);
        return {
          value,
          count,
          frequency: count / records.length,
          rarityWeight: records.length / count,
          layerId,
          layerSheet: null,
          spriteStatus: "missing" as const,
        };
      })
      .sort((left, right) => left.count - right.count || left.value.localeCompare(right.value));
  }
  return {
    schemaVersion: 1,
    recordCount: records.length,
    attributeOrder: order,
    renderOrder: order,
    categories,
  };
}

export async function attachLayerStatus(manifest: TraitManifest) {
  for (const [traitType, values] of Object.entries(manifest.categories)) {
    for (const entry of values) {
      const sheet = path.join(PIXEL_LAYER_ROOT, safeSlug(traitType), `${entry.layerId}.png`);
      if (await pathExists(sheet)) {
        entry.layerSheet = path.relative(REPOSITORY_ROOT, sheet).split(path.sep).join("/");
        entry.spriteStatus = "ready";
      }
    }
  }
  return manifest;
}

export async function existingTraitOrder() {
  const catalog = await readJsonOrNull<{ attributeOrder?: unknown }>(
    path.join(REPOSITORY_ROOT, "data", "dyoor-s2-trait-catalog.json"),
  );
  return Array.isArray(catalog?.attributeOrder)
    ? catalog.attributeOrder.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function compactFrequencyReport(manifest: TraitManifest) {
  return {
    schemaVersion: 1,
    recordCount: manifest.recordCount,
    categories: Object.fromEntries(
      Object.entries(manifest.categories).map(([traitType, values]) => [
        traitType,
        Object.fromEntries(values.map((entry) => [
          entry.value,
          {
            count: entry.count,
            frequency: Number(entry.frequency.toFixed(10)),
            rarityWeight: Number(entry.rarityWeight.toFixed(6)),
          },
        ])),
      ]),
    ),
  };
}
