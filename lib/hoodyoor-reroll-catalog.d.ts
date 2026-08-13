export type HoodYoorTraitSnapshot = {
  layer: number;
  slot: string;
  traitId: number;
  name: string;
  mutable: boolean;
};

export type HoodYoorRerollCandidate = {
  nextTraits: string;
  changedLayers: number[];
  selectedTraitId: number;
};

export function unpackHoodYoorTraits(value: string | number | bigint): number[];
export function packHoodYoorTraits(traits: number[]): bigint;
export function hoodYoorTraitsAreCompatible(value: string | number | bigint | number[]): boolean;
export function hoodYoorTraitSnapshot(value: string | number | bigint): HoodYoorTraitSnapshot[];
export function generateHoodYoorRerollCandidate(input: {
  packedTraits: string | number | bigint;
  action: "single" | "all";
  layer: number;
  randomInt?: (maxExclusive: number) => number;
}): HoodYoorRerollCandidate;
export function renderHoodYoorPackedSvg(value: string | number | bigint): string;

export const hoodYoorCatalogSummary: Readonly<{
  layers: readonly string[];
  mutableLayers: readonly number[];
  traits: number;
  incompatibilities: number;
  expectedPairCount: number;
  rulesHash: string;
}>;
