import { DYOOR_BUILDER_LAYER_ORDER, DYOOR_BUILDER_RANDOMIZER, DYOOR_BUILDER_TRAITS } from "@/src/config/dyoorBuilderTraits";
import { DYOOR_BUILDER_RULES } from "@/src/config/dyoorBuilderRules";

export type BuilderCategory = typeof DYOOR_BUILDER_LAYER_ORDER[number];
export type BuilderSelection = Partial<Record<BuilderCategory, string>>;

type TraitRef = {
  category?: BuilderCategory;
  file?: string;
};

type BuilderRule = {
  type?: "disabled" | "incompatible" | "requires" | "onlyWith";
  trait?: TraitRef;
  with?: TraitRef;
  requires?: TraitRef;
  allowedWith?: TraitRef[];
  allowedEmptyCategories?: BuilderCategory[];
  message?: string;
};

export const BUILDER_LAYER_BASE_PATH = "/dyoor-builder/layers";
export const builderLayerOrder = DYOOR_BUILDER_LAYER_ORDER as BuilderCategory[];
export const builderTraits = DYOOR_BUILDER_TRAITS as Record<BuilderCategory, string[]>;
export const builderRandomizer = DYOOR_BUILDER_RANDOMIZER as {
  requiredCategories?: BuilderCategory[];
  optionalCategoryChances?: Partial<Record<BuilderCategory, number>>;
};
const builderRules = DYOOR_BUILDER_RULES as BuilderRule[];

export function traitPath(category: BuilderCategory, file: string) {
  return `${BUILDER_LAYER_BASE_PATH}/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
}

export function fileLabel(file: string) {
  return String(file || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTrait(a?: TraitRef, b?: TraitRef) {
  return a?.category === b?.category && a?.file === b?.file;
}

function selectedCategoriesForRule(rule: BuilderRule) {
  const traits: TraitRef[] = [];
  if (rule.with) traits.push(rule.with);
  if (rule.requires) traits.push(rule.requires);
  if (Array.isArray(rule.allowedWith)) traits.push(...rule.allowedWith);
  if (Array.isArray(rule.allowedEmptyCategories)) {
    traits.push(...rule.allowedEmptyCategories.map((category) => ({ category })));
  }
  return [...new Set(traits.map((trait) => trait?.category).filter(Boolean))] as BuilderCategory[];
}

function onlyWithRuleSatisfied(rule: BuilderRule, selected: BuilderSelection) {
  const allowed = Array.isArray(rule.allowedWith) ? rule.allowedWith : [];
  const allowedEmpty = Array.isArray(rule.allowedEmptyCategories) ? rule.allowedEmptyCategories : [];

  for (const category of selectedCategoriesForRule(rule)) {
    const selectedFile = selected[category] || "";
    if (!selectedFile && allowedEmpty.includes(category)) continue;
    if (allowed.some((item) => item.category === category && item.file === selectedFile)) continue;
    return false;
  }

  return true;
}

export function availableCategories() {
  return builderLayerOrder.filter((category) => Array.isArray(builderTraits[category]) && builderTraits[category].length > 0);
}

export function ruleConflict(candidate: Required<TraitRef>, selected: BuilderSelection) {
  const nextSelected = { ...selected, [candidate.category]: candidate.file };

  for (const rule of builderRules) {
    if (rule?.type === "disabled" && sameTrait(rule.trait, candidate)) {
      return rule.message || "This trait is disabled for the public builder.";
    }

    if (!rule || !sameTrait(rule.trait, candidate)) continue;

    if (rule.type === "incompatible" && nextSelected[rule.with?.category as BuilderCategory] === rule.with?.file) {
      return rule.message || "This trait is incompatible with the current build.";
    }

    if (rule.type === "requires" && nextSelected[rule.requires?.category as BuilderCategory] !== rule.requires?.file) {
      return rule.message || "This trait requires another trait first.";
    }

    if (rule.type === "onlyWith" && !onlyWithRuleSatisfied(rule, nextSelected)) {
      return rule.message || "This trait only works with selected matching traits.";
    }
  }

  for (const rule of builderRules) {
    if (!rule?.trait?.category || !rule.trait.file) continue;
    const selectedFile = nextSelected[rule.trait.category];
    if (selectedFile !== rule.trait.file) continue;

    if (rule.type === "incompatible" && sameTrait(rule.with, candidate)) {
      return rule.message || "This trait is incompatible with the current build.";
    }

    if (
      rule.type === "requires"
      && candidate.category === rule.requires?.category
      && candidate.file !== rule.requires?.file
    ) {
      return rule.message || "The current build requires a different trait here.";
    }

    if (rule.type === "onlyWith" && !onlyWithRuleSatisfied(rule, nextSelected)) {
      return rule.message || "The current build only works with selected matching traits.";
    }
  }

  return "";
}

export function selectedBlueprintTraits(selection: BuilderSelection) {
  return builderLayerOrder.reduce<Record<string, string>>((acc, category) => {
    acc[category.toLowerCase()] = selection[category] ? fileLabel(selection[category] || "") : "";
    return acc;
  }, {});
}

export function hasSelectedTraits(selection: BuilderSelection) {
  return builderLayerOrder.some((category) => Boolean(selection[category]));
}

export function randomSelection() {
  const next: BuilderSelection = {};
  const required = new Set(builderRandomizer.requiredCategories || []);
  const chances = builderRandomizer.optionalCategoryChances || {};

  for (const category of availableCategories()) {
    const isRequired = required.has(category);
    const chance = Number.isFinite(chances[category]) ? Number(chances[category]) : 0.5;
    if (!isRequired && Math.random() > chance) continue;

    const options = (builderTraits[category] || []).filter((file) => !ruleConflict({ category, file }, next));
    if (!options.length) continue;
    next[category] = options[Math.floor(Math.random() * options.length)];
  }

  return next;
}
