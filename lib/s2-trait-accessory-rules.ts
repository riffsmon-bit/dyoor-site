export type S2AccessorySlot = "Accessories" | "Accessories 2";

const ACCESSORY_LAYER_GROUPS = [
  {
    name: "face accessory",
    values: new Set([
      "bandaid",
      "bandana black",
      "bandana pink",
      "mesh bandanna",
    ]),
  },
  {
    name: "neck accessory",
    values: new Set([
      "bob-chain",
      "bob chain",
      "choker necklace",
      "sealuminati chain",
    ]),
  },
  {
    name: "companion accessory",
    values: new Set([
      "10ksquad",
      "molandak",
      "mouch",
      "the hive",
    ]),
  },
  {
    name: "opposite-shoulder companion accessory",
    values: new Set([
      "shramp",
    ]),
  },
];

function normalizeComparable(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function accessoryLayerGroup(value: unknown) {
  const normalized = normalizeComparable(value);
  if (!normalized) return "";
  return ACCESSORY_LAYER_GROUPS.find((group) => group.values.has(normalized))?.name || "";
}

export function accessoryLayersConflict(left: unknown, right: unknown) {
  const leftGroup = accessoryLayerGroup(left);
  return Boolean(leftGroup && leftGroup === accessoryLayerGroup(right));
}

function oppositeAccessorySlot(traitType: string): S2AccessorySlot | "" {
  if (traitType === "Accessories") return "Accessories 2";
  if (traitType === "Accessories 2") return "Accessories";
  return "";
}

export function accessoryLayerSideEffect(
  traits: Record<string, string>,
  changedTraitType: string,
): Partial<Record<S2AccessorySlot, string>> {
  const oppositeTrait = oppositeAccessorySlot(changedTraitType);
  if (!oppositeTrait || !accessoryLayersConflict(traits[changedTraitType], traits[oppositeTrait])) return {};
  return { [oppositeTrait]: "None" };
}
