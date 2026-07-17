import crypto from "node:crypto";
import { ethers } from "ethers";
import traitCatalogJson from "@/data/dyoor-s2-trait-catalog.json";
import traitItemMetadataJson from "@/data/dyoor-s2-trait-item-metadata.json";
import { DEFAULT_TREASURY_WALLET, dyoorS2Contract, energyBankContract } from "@/lib/contracts/addresses";
import { builderTraits, fileLabel, ruleConflict, type BuilderCategory, type BuilderSelection } from "@/lib/dyoor-builder";
import {
  S2_EDITABLE_TRAITS,
  S2_GUARANTEED_TRAITS,
  S2_UNLOCKABLE_TRAITS,
  S2_TRAIT_LAB_FLAT_UNLOCK_COST,
  S2_TRAIT_LAB_ENERGY_PER_MON,
  S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY,
  S2_TRAIT_LAB_MON_COSTS,
  S2_TRAIT_LAB_COSTS,
  isS2EditableTrait,
  isS2UnlockableTrait,
  isS2TraitLabAction,
  isS2TraitLabPaymentMode,
  type S2EditableTrait,
  type S2TraitLabAction,
  type S2TraitLabPaymentMode,
} from "@/lib/s2-trait-lab-config";
import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  getRuntimeTraitOverrides,
  mergeMetadata,
  parseTokenId,
  saveRuntimeTraitOverride,
} from "@/lib/dyoor-s2-metadata.js";
import { renderTraitLabImage } from "@/lib/s2-trait-lab-render";
import {
  applyTraitSupplyDeltas,
  assertTraitSupplyAvailable,
  claimTraitLabMonPayment,
  getTraitLabRoll,
  getTraitSupplyLedger,
  saveTraitLabRoll,
  type TraitLabRollRecord,
  type TraitSupplyDelta,
  type TraitSupplyLedger,
} from "@/src/lib/storage/s2TraitLabStore";

type MetadataAttribute = {
  trait_type?: string;
  value?: unknown;
};

type MetadataJson = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: MetadataAttribute[];
  [key: string]: unknown;
};

type TraitOption = {
  traitType: S2EditableTrait;
  file: string;
  value: string;
  assetUri: string;
  traitId?: number | null;
  weight?: number;
  rarity?: string;
  initialSupply?: number;
  maxActiveSupply?: number;
  burnOnEquip?: string;
};

type CatalogTrait = {
  traitId?: number | null;
  name?: string;
  weight?: number;
  selectable?: boolean;
  mutable?: boolean;
};

type CatalogRule = {
  name?: string;
  enabled?: boolean;
  if?: Record<string, string[]>;
  cannot?: Record<string, string[]>;
};

type TraitCatalog = {
  traits?: Record<string, CatalogTrait[]>;
  incompatibilityRules?: CatalogRule[];
};

const SPECIAL_WEARABLE_SIDE_EFFECT_TRAITS = new Set<S2EditableTrait>([
  "Clothes",
  "Hat",
  "Accessories",
  "Accessories 2",
  "Stickers/Body art",
]);

type TraitItemMetadata = {
  slot?: string;
  name?: string;
  rarity?: string;
  initialSupply?: number;
  maxActiveSupply?: number;
  burnOnEquip?: string;
  image?: string;
};

type PreviewPayload = {
  rollId: string;
  wallet: string;
  tokenId: number;
  traitType: S2EditableTrait;
  action: S2TraitLabAction;
  paymentMode: S2TraitLabPaymentMode;
  previousValue: string;
  proposedValue: string;
  proposedAttributes: Record<string, string>;
  costEnergy: number;
  costRaw: string;
  costMon: string;
  costLabel: string;
  assetUri: string;
  metadataVersion: number;
  expiresAt: number;
  nonce: string;
};

const ERC721_ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)",
];

const ENERGY_BANK_ABI = [
  "function spendEnergy(address user,uint256 amount,bytes32 reason)",
  "function spendableEnergy(address user) view returns (uint256)",
  "function SPENDER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_TRAIT_ASSETS_CID = "bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu";
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const CONFIRM_WINDOW_MS = 5 * 60 * 1000;
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const DEFAULT_MONAD_MAINNET_RPC_URL = "https://rpc.monad.xyz";
const DEFAULT_MONAD_MAINNET_EXPLORER_URL = "https://monadscan.com";
const DEFAULT_S2_DEPLOYMENT_BLOCK = 87616887;
const SERVERLESS_LOG_SPAN = 25_000;
const MIN_OWNED_TOKEN_LOG_SPAN = 10_000;
const OWNED_TOKEN_CACHE_VERSION = "s2-owned-v8";
const DEFAULT_OWNER_OF_CONCURRENCY = 8;
const ALCHEMY_TRANSFER_PAGE_SIZE = "0x3e8";
const CLOTHES_ALLOWED_SPECIALS = new Set([
  "anime mask",
  "gimp",
  "green ski mask laser",
  "pink ski mask laser",
]);

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const ownedTokenCache = new Map<string, { tokenIds: string[]; expiresAt: number }>();

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizePrivateKey(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function optionalAddress(value: unknown) {
  try {
    return ethers.getAddress(String(value || ""));
  } catch {
    return "";
  }
}

function traitLabTreasuryWallet() {
  const value = readEnv(
    "DYOOR_TRAIT_LAB_TREASURY_WALLET",
    "NEXT_PUBLIC_DYOOR_TRAIT_LAB_TREASURY_WALLET",
    "TREASURY_WALLET",
    "NEXT_PUBLIC_TREASURY_WALLET",
    "DYOOR_TREASURY",
    "DYOOR_TREASURY_ADDRESS",
  ) || DEFAULT_TREASURY_WALLET;
  const address = optionalAddress(value);
  if (!address) throw Object.assign(new Error("Trait Lab treasury wallet is not configured."), { status: 500 });
  return address;
}

function requireTxHash(value: unknown) {
  const txHash = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    throw Object.assign(new Error("A wallet transaction is required for this roll."), { status: 400 });
  }
  return txHash;
}

function monCostRaw(value: string) {
  try {
    return ethers.parseUnits(String(value || "0"), 18);
  } catch {
    throw Object.assign(new Error("Invalid MON cost configuration."), { status: 500 });
  }
}

function configuredS2ChainId() {
  return 143;
}

function isTestnetLikeUrl(value: string) {
  return /testnet/i.test(value);
}

function firstUsableRpc(names: string[], mainnet: boolean) {
  for (const name of names) {
    const value = readEnv(name);
    if (!value) continue;
    if (mainnet && isTestnetLikeUrl(value)) continue;
    return value;
  }
  return "";
}

function configuredS2RpcUrl() {
  return firstUsableRpc(
    ["DYOOR_S2_RPC_URL", "MONAD_RPC_URL", "NEXT_PUBLIC_MONAD_RPC_URL", "NEXT_PUBLIC_DYOOR_S2_RPC_URL", "RPC_URL"],
    true,
  ) || DEFAULT_MONAD_MAINNET_RPC_URL;
}

function configuredS2ExplorerUrl() {
  const configured = readEnv("NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL");
  if (configured && !isTestnetLikeUrl(configured)) return configured.replace(/\/+$/, "");
  return DEFAULT_MONAD_MAINNET_EXPLORER_URL;
}

function alchemyTransferLookupEnabled() {
  const configured = readEnv("DYOOR_S2_ENABLE_ALCHEMY_TRANSFERS", "NEXT_PUBLIC_DYOOR_S2_ENABLE_ALCHEMY_TRANSFERS");
  if (/^(1|true|yes|on)$/i.test(configured)) return true;
  if (/^(0|false|no|off)$/i.test(configured)) return false;
  return /alchemy/i.test(configuredS2RpcUrl());
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ownerOfConcurrency() {
  const configured = readEnv("DYOOR_S2_OWNER_OF_CONCURRENCY", "NEXT_PUBLIC_DYOOR_S2_OWNER_OF_CONCURRENCY");
  return Math.min(20, Math.max(1, parsePositiveInt(configured, DEFAULT_OWNER_OF_CONCURRENCY)));
}

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

function titleValue(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw || "None";
}

function timingSafeEqualText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomChoice<T>(items: T[]) {
  if (!items.length) return null;
  return items[crypto.randomInt(0, items.length)];
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function traitOptionWeight(option: TraitOption) {
  const weight = Number(option.weight ?? 1);
  return Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : 0;
}

function weightedOptionOrder(options: TraitOption[]) {
  const pool = options.filter((option) => traitOptionWeight(option) > 0);
  const ordered: TraitOption[] = [];

  while (pool.length) {
    const total = pool.reduce((sum, option) => sum + traitOptionWeight(option), 0);
    if (total <= 0) break;

    let target = crypto.randomInt(total);
    const index = pool.findIndex((option) => {
      target -= traitOptionWeight(option);
      return target < 0;
    });
    const [picked] = pool.splice(index >= 0 ? index : pool.length - 1, 1);
    ordered.push(picked);
  }

  return ordered;
}

function topicAddress(address: string) {
  return ethers.zeroPadValue(address, 32);
}

function traitAssetCid() {
  return readEnv("DYOOR_S2_TRAIT_ASSETS_CID", "NEXT_PUBLIC_DYOOR_S2_TRAIT_ASSETS_CID") || DEFAULT_TRAIT_ASSETS_CID;
}

function slugFile(value: string) {
  return `${String(value || "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase()}.png`;
}

function traitAssetUri(_category: string, fileOrValue: string) {
  return `ipfs://${traitAssetCid()}/${encodeURIComponent(slugFile(fileOrValue))}`;
}

function traitCatalog() {
  return traitCatalogJson as unknown as TraitCatalog;
}

function traitItemMetadata(traitType: string, value: string) {
  const items = traitItemMetadataJson as Record<string, TraitItemMetadata>;
  return items[`${traitType}::${value}`] || null;
}

function traitLabSecret() {
  const secret = readEnv("DYOOR_TRAIT_LAB_SECRET", "ADMIN_API_SECRET", "NETLIFY_BLOBS_TOKEN", "NETLIFY_AUTH_TOKEN");
  if (!secret && process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("DYOOR_TRAIT_LAB_SECRET is required for Trait Lab previews."), { status: 500 });
  }
  return secret || "local-development-trait-lab-secret";
}

function previewSignature(encodedPayload: string) {
  return crypto.createHmac("sha256", traitLabSecret()).update(encodedPayload).digest("base64url");
}

function encodePreview(payload: PreviewPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${previewSignature(encodedPayload)}`;
}

function decodePreview(previewId: unknown): PreviewPayload {
  const raw = String(previewId || "").trim();
  const [encodedPayload, signature, extra] = raw.split(".");
  if (!encodedPayload || !signature || extra) {
    throw Object.assign(new Error("Invalid preview ID."), { status: 400 });
  }
  const expected = previewSignature(encodedPayload);
  if (!timingSafeEqualText(signature, expected)) {
    throw Object.assign(new Error("Preview ID could not be verified."), { status: 401 });
  }
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as PreviewPayload;
  if (!payload || typeof payload !== "object" || Date.now() > Number(payload.expiresAt || 0)) {
    throw Object.assign(new Error("Preview expired. Generate a new preview."), { status: 401 });
  }
  return payload;
}

export function normalizeWallet(value: unknown) {
  try {
    const address = ethers.getAddress(String(value || "")).toLowerCase();
    return address === ZERO_ADDRESS ? "" : address;
  } catch {
    return "";
  }
}

export function isEmptyTraitValue(value: unknown) {
  const normalized = normalizeComparable(value);
  return !normalized
    || normalized === "none"
    || normalized === "null"
    || normalized === "undefined"
    || normalized === "n a"
    || normalized === "na"
    || normalized === "unknown";
}

export function formatTraitLabEnergyRaw(value: number) {
  return ethers.parseUnits(String(value), 18).toString();
}

export function traitLabCost(traitType: S2EditableTrait, action: S2TraitLabAction) {
  const costEnergy = S2_TRAIT_LAB_COSTS[action][traitType];
  return {
    costEnergy,
    costRaw: formatTraitLabEnergyRaw(costEnergy),
  };
}

function monTestModeEnabled() {
  const raw = readEnv("DYOOR_TRAIT_LAB_ENABLE_MON_TEST", "NEXT_PUBLIC_DYOOR_TRAIT_LAB_ENABLE_MON_TEST");
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  return process.env.NODE_ENV !== "production";
}

function parsePaymentMode(value: unknown) {
  const paymentMode = String(value || "energy").trim().toLowerCase();
  if (!isS2TraitLabPaymentMode(paymentMode)) {
    throw Object.assign(new Error("Invalid Trait Lab payment mode."), { status: 400 });
  }
  if (paymentMode === "mon" && !monTestModeEnabled()) {
    throw Object.assign(new Error("MON Trait Lab testing is not enabled."), { status: 403 });
  }
  return paymentMode;
}

function traitLabPaymentCost(traitType: S2EditableTrait, action: S2TraitLabAction, paymentMode: S2TraitLabPaymentMode) {
  const energyCost = traitLabCost(traitType, action);
  if (paymentMode === "mon") {
    const costMon = S2_TRAIT_LAB_MON_COSTS[action][traitType];
    return {
      costEnergy: 0,
      costRaw: "0",
      costMon,
      costLabel: `${costMon} MON`,
    };
  }
  return {
    ...energyCost,
    costMon: "0",
    costLabel: `${energyCost.costEnergy} Energy`,
  };
}

export function traitLabPublicConfig() {
  const chainId = configuredS2ChainId();
  const configuredChainName = readEnv("DYOOR_S2_CHAIN_NAME", "NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME");
  const safeChainName = !configuredChainName || /testnet/i.test(configuredChainName) ? "Monad" : configuredChainName;
  return {
    ok: true,
    treasuryWallet: traitLabTreasuryWallet(),
    monTestMode: monTestModeEnabled(),
    chainId,
    chainHex: chainId > 0 ? `0x${chainId.toString(16)}` : "",
    chainName: safeChainName,
    rpcUrl: configuredS2RpcUrl(),
    explorerUrl: configuredS2ExplorerUrl(),
    energyPerMon: S2_TRAIT_LAB_ENERGY_PER_MON,
    flatUnlockCostEnergy: S2_TRAIT_LAB_FLAT_UNLOCK_COST,
    specialMaxActiveSupply: S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY,
    guaranteedTraits: S2_GUARANTEED_TRAITS,
    unlockableTraits: S2_UNLOCKABLE_TRAITS,
    monCosts: S2_TRAIT_LAB_MON_COSTS,
  };
}

export function assertTraitLabRateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw Object.assign(new Error("Too many Trait Lab requests. Wait a moment and try again."), { status: 429 });
  }
  bucket.count += 1;
}

export function traitLabMessage(payload: PreviewPayload, timestamp: string, nonce: string) {
  return [
    "DYOOR Trait Lab",
    `Wallet: ${payload.wallet}`,
    `Token ID: ${payload.tokenId}`,
    `Trait: ${payload.traitType}`,
    `Action: ${payload.action}`,
    `Payment: ${payload.paymentMode}`,
    `Value: ${payload.proposedValue}`,
    `Cost: ${payload.costLabel}`,
    `CostRaw: ${payload.costRaw}`,
    `Preview ID: ${encodePreview(payload)}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function confirmationMessageFromPreviewId(previewId: string, timestamp: string, nonce: string) {
  const payload = decodePreview(previewId);
  return traitLabMessage(payload, timestamp, nonce);
}

export function traitMapFromMetadata(metadata: MetadataJson) {
  const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
  return attributes.reduce<Record<string, string>>((acc, attribute) => {
    const traitType = String(attribute?.trait_type || "").trim();
    if (traitType) acc[traitType] = titleValue(attribute?.value);
    return acc;
  }, {});
}

export function metadataVersion(metadata: MetadataJson) {
  const value = traitMapFromMetadata(metadata)["Metadata Version"];
  const parsed = Number.parseInt(String(value || "1"), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function traitRegistry() {
  return S2_EDITABLE_TRAITS.reduce<Record<S2EditableTrait, TraitOption[]>>((acc, traitType) => {
    const catalogTraits = traitCatalog()?.traits?.[traitType] || [];
    const fromCatalog: TraitOption[] = catalogTraits
      .filter((trait) => trait?.selectable !== false && trait?.mutable !== false && !isEmptyTraitValue(trait.name))
      .map((trait) => {
        const value = String(trait.name || "").trim();
        const file = `${value}.png`;
        const item = traitItemMetadata(traitType, value);
        return {
          traitType,
          file,
          value,
          traitId: trait.traitId,
          weight: trait.weight,
          rarity: item?.rarity,
          initialSupply: item?.initialSupply,
          maxActiveSupply: item?.maxActiveSupply || (traitType === "Special" ? S2_TRAIT_LAB_SPECIAL_MAX_ACTIVE_SUPPLY : undefined),
          burnOnEquip: item?.burnOnEquip,
          assetUri: item?.image || traitAssetUri(traitType, value),
        };
      });

    const category = traitType as BuilderCategory;
    const fromBuilder: TraitOption[] = (builderTraits[category] || []).map((file) => ({
      traitType,
      file,
      value: fileLabel(file),
      assetUri: traitAssetUri(traitType, file),
    }));
    const seen = new Set<string>();
    acc[traitType] = fromCatalog.concat(fromBuilder).filter((option) => {
      const key = normalizeComparable(option.value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return acc;
  }, {} as Record<S2EditableTrait, TraitOption[]>);
}

function optionsForTrait(traitType: S2EditableTrait) {
  return traitRegistry()[traitType] || [];
}

function resolveTraitOption(traitType: string, value: unknown) {
  if (!isS2EditableTrait(traitType) || isEmptyTraitValue(value)) return null;
  const normalized = normalizeComparable(value);
  return optionsForTrait(traitType).find((option) => {
    return normalizeComparable(option.value) === normalized || normalizeComparable(option.file) === normalized;
  }) || null;
}

function supplyKey(traitType: string, value: string) {
  return `${traitType}::${value}`.toLowerCase();
}

function positiveNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function optionInitialSupply(option: TraitOption | null) {
  return positiveNumber(option?.initialSupply);
}

function optionMaxActiveSupply(option: TraitOption | null) {
  return positiveNumber(option?.maxActiveSupply);
}

function activeSupplyForOption(option: TraitOption, supplyLedger?: TraitSupplyLedger) {
  const item = supplyLedger?.items?.[supplyKey(option.traitType, option.value)];
  if (!item) return optionInitialSupply(option);
  return positiveNumber(item.activeSupply);
}

function isOptionSupplyAvailable(option: TraitOption, supplyLedger?: TraitSupplyLedger) {
  const maxActiveSupply = optionMaxActiveSupply(option);
  if (maxActiveSupply <= 0) return true;
  return activeSupplyForOption(option, supplyLedger) < maxActiveSupply;
}

function supplyDeltaForTrait(traitType: string, value: string, delta: number, reason: TraitSupplyDelta["reason"]): TraitSupplyDelta | null {
  if (!isS2EditableTrait(traitType) || isEmptyTraitValue(value)) return null;
  const option = resolveTraitOption(traitType, value);
  return {
    traitType,
    value: option?.value || titleValue(value),
    delta,
    reason,
    initialSupply: optionInitialSupply(option),
    maxActiveSupply: optionMaxActiveSupply(option),
  };
}

function supplyDeltasForPatch(currentTraits: Record<string, string>, proposedAttributes: Record<string, string>) {
  const deltas: TraitSupplyDelta[] = [];

  for (const [traitType, nextValue] of Object.entries(proposedAttributes)) {
    if (!isS2EditableTrait(traitType)) continue;
    const currentValue = currentTraits[traitType];
    if (valuesMatch(currentValue, nextValue)) continue;

    const burnDelta = supplyDeltaForTrait(traitType, currentValue, -1, "burn");
    if (burnDelta) deltas.push(burnDelta);

    const equipDelta = supplyDeltaForTrait(traitType, nextValue, 1, "equip");
    if (equipDelta) deltas.push(equipDelta);
  }

  return deltas;
}

async function assertSupplyDeltasAvailable(deltas: TraitSupplyDelta[]) {
  for (const delta of deltas) {
    await assertTraitSupplyAvailable(delta);
  }
}

function valuesMatch(left: unknown, right: unknown) {
  if (isEmptyTraitValue(left) && isEmptyTraitValue(right)) return true;
  return normalizeComparable(left) === normalizeComparable(right);
}

function selectionFromTraits(traits: Record<string, string>) {
  const selection: BuilderSelection = {};
  for (const traitType of S2_EDITABLE_TRAITS) {
    const option = resolveTraitOption(traitType, traits[traitType]);
    if (option) selection[traitType as BuilderCategory] = option.file;
  }
  return selection;
}

function isBandanna(value: unknown) {
  const normalized = normalizeComparable(value);
  return normalized.includes("bandana") || normalized.includes("bandanna");
}

function isBlockedBandannaMouth(value: unknown) {
  const normalized = normalizeComparable(value);
  return normalized.includes("ahhh tongue")
    || normalized.includes("ahhhh tongue")
    || normalized.includes("gold bar")
    || normalized.includes("joint")
    || normalized.includes("cigar")
    || normalized.includes("cigarette")
    || normalized.includes("ahhh flame")
    || normalized.includes("ahhhh flame")
    || normalized.includes("toothpick");
}

function explicitCompatibilityConflict(traits: Record<string, string>) {
  if (!isEmptyTraitValue(traits.Accessories)
    && !isEmptyTraitValue(traits["Accessories 2"])
    && valuesMatch(traits.Accessories, traits["Accessories 2"])) {
    return "Accessories and Accessories 2 cannot use the same trait.";
  }

  if ((isBandanna(traits.Accessories) || isBandanna(traits["Accessories 2"])) && isBlockedBandannaMouth(traits.Mouth)) {
    return "Bandanna cannot be combined with this mouth trait.";
  }
  return "";
}

function catalogRuleMatches(rulePart: Record<string, string[]> | undefined, traits: Record<string, string>) {
  if (!rulePart || typeof rulePart !== "object") return false;
  return Object.entries(rulePart).every(([traitType, values]) => {
    const current = traits[traitType];
    return Array.isArray(values) && values.some((value) => valuesMatch(current, value));
  });
}

function catalogCompatibilityConflict(traits: Record<string, string>) {
  const rules = traitCatalog()?.incompatibilityRules || [];
  for (const rule of rules) {
    if (rule?.enabled === false || !catalogRuleMatches(rule.if, traits)) continue;
    for (const [traitType, values] of Object.entries(rule.cannot || {})) {
      if (Array.isArray(values) && values.some((value) => valuesMatch(traits[traitType], value))) {
        return rule.name || `${traitType} is incompatible with the current trait combination.`;
      }
    }
  }
  return "";
}

function validationConflict(traits: Record<string, string>) {
  const explicit = explicitCompatibilityConflict(traits);
  if (explicit) return explicit;

  const catalogConflict = catalogCompatibilityConflict(traits);
  if (catalogConflict) return catalogConflict;

  const selection = selectionFromTraits(traits);
  for (const [category, file] of Object.entries(selection)) {
    if (!file) continue;
    const rest = { ...selection };
    delete rest[category as BuilderCategory];
    const conflict = ruleConflict({ category: category as BuilderCategory, file }, rest);
    if (conflict) return conflict;
  }
  return "";
}

function specialConflictForCategory(specialFile: string, traitType: S2EditableTrait, value: string) {
  if (traitType === "Special" || isEmptyTraitValue(value)) return "";
  if (!SPECIAL_WEARABLE_SIDE_EFFECT_TRAITS.has(traitType)) return "";

  const normalizedSpecial = normalizeComparable(specialFile);
  if (traitType === "Hat" || traitType === "Accessories" || traitType === "Accessories 2") return "Special hides this trait.";
  if (traitType === "Clothes" && !CLOTHES_ALLOWED_SPECIALS.has(normalizedSpecial)) return "Special hides this trait.";
  if (traitType === "Stickers/Body art") return "Special hides this trait.";

  const option = resolveTraitOption(traitType, value);
  if (!option) return SPECIAL_WEARABLE_SIDE_EFFECT_TRAITS.has(traitType) ? "Special hides this trait." : "";
  return ruleConflict({ category: traitType as BuilderCategory, file: option.file }, { Special: specialFile } as BuilderSelection);
}

function applySpecialSideEffects(traits: Record<string, string>) {
  const next = { ...traits };
  const special = resolveTraitOption("Special", next.Special);
  if (!special) return next;

  for (const traitType of S2_EDITABLE_TRAITS) {
    if (traitType === "Special") continue;
    if (specialConflictForCategory(special.file, traitType, next[traitType])) {
      next[traitType] = "None";
    }
  }

  return next;
}

function proposedAttributePatch(previous: Record<string, string>, next: Record<string, string>, traitType: S2EditableTrait) {
  const patch: Record<string, string> = { [traitType]: next[traitType] };
  for (const editable of S2_EDITABLE_TRAITS) {
    if (editable === traitType) continue;
    if (!valuesMatch(previous[editable], next[editable])) patch[editable] = next[editable] || "None";
  }
  return patch;
}

function assertValidRequestedChange(traits: Record<string, string>, traitType: S2EditableTrait, action: S2TraitLabAction) {
  const currentValue = traits[traitType];
  if (action === "unlock" && !isS2UnlockableTrait(traitType)) {
    throw Object.assign(new Error(`${traitType} is guaranteed and cannot be unlocked.`), { status: 400 });
  }
  if (action === "unlock" && !isEmptyTraitValue(currentValue)) {
    throw Object.assign(new Error(`${traitType} already has a trait. Use reroll instead.`), { status: 400 });
  }
  if (action === "reroll" && isEmptyTraitValue(currentValue)) {
    throw Object.assign(new Error(`${traitType} is an empty slot. Unlock it before rerolling.`), { status: 400 });
  }
}

function generateCandidate(
  traits: Record<string, string>,
  traitType: S2EditableTrait,
  action: S2TraitLabAction,
  supplyLedger?: TraitSupplyLedger,
) {
  assertValidRequestedChange(traits, traitType, action);

  const currentValue = traits[traitType];
  const candidates = weightedOptionOrder(optionsForTrait(traitType).filter((option) => {
    return isOptionSupplyAvailable(option, supplyLedger) && (action === "unlock" || !valuesMatch(option.value, currentValue));
  }));

  for (const option of candidates) {
    const changed = {
      ...traits,
      [traitType]: option.value,
    };
    const next = applySpecialSideEffects(changed);
    const conflict = validationConflict(next);
    if (!conflict) {
      return {
        option,
        nextTraits: next,
        proposedAttributes: proposedAttributePatch(traits, next, traitType),
      };
    }
  }

  const fallback = randomChoice(optionsForTrait(traitType));
  throw Object.assign(new Error(fallback
    ? `No valid ${traitType} result is available with the current trait combination.`
    : `${traitType} does not have approved Trait Lab options.`), { status: 409 });
}

function validateProposedPatch(currentTraits: Record<string, string>, payload: PreviewPayload) {
  const changedValue = payload.proposedAttributes[payload.traitType];
  const approved = optionsForTrait(payload.traitType).some((option) => valuesMatch(option.value, changedValue));
  if (!approved || !valuesMatch(changedValue, payload.proposedValue)) {
    throw Object.assign(new Error("Preview contains an unapproved trait result."), { status: 400 });
  }

  for (const [traitType, value] of Object.entries(payload.proposedAttributes)) {
    if (!isS2EditableTrait(traitType)) {
      throw Object.assign(new Error("Preview contains a locked or invalid trait update."), { status: 400 });
    }
    if (traitType !== payload.traitType && !isEmptyTraitValue(value)) {
      throw Object.assign(new Error("Preview contains an unexpected side-effect trait value."), { status: 400 });
    }
  }

  const nextTraits = { ...currentTraits, ...payload.proposedAttributes };
  const conflict = validationConflict(nextTraits);
  if (conflict) throw Object.assign(new Error(conflict), { status: 409 });
  return nextTraits;
}

function provider() {
  const rpcUrl = configuredS2RpcUrl();
  if (!rpcUrl) {
    throw Object.assign(new Error("DYOOR_S2_RPC_URL or MONAD_RPC_URL is required before Trait Lab can verify ownership."), { status: 500 });
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

function energyBankSigner() {
  const privateKey = normalizePrivateKey(readEnv("ENERGY_BANK_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"));
  if (!privateKey) {
    throw Object.assign(new Error("ENERGY_BANK_OPERATOR_PRIVATE_KEY is required for Energy Trait Lab rolls."), { status: 500 });
  }
  return new ethers.Wallet(privateKey, provider());
}

function traitLabEnergySpendReason(payload: PreviewPayload) {
  return ethers.keccak256(ethers.toUtf8Bytes([
    "trait-lab",
    payload.rollId,
    String(payload.tokenId),
    payload.traitType,
    payload.action,
    payload.proposedValue,
  ].join(":")));
}

async function spendTraitLabEnergy(payload: PreviewPayload) {
  const amount = BigInt(payload.costRaw || "0");
  if (amount <= 0n) {
    throw Object.assign(new Error("Invalid Energy roll cost."), { status: 500 });
  }
  const signer = energyBankSigner();
  const signerAddress = await signer.getAddress();
  const bank = new ethers.Contract(energyBankContract, ENERGY_BANK_ABI, signer);
  const spenderRole = await bank.SPENDER_ROLE();
  const hasRole = await bank.hasRole(spenderRole, signerAddress).then(Boolean);
  if (!hasRole) {
    throw Object.assign(new Error("Energy Bank operator is missing SPENDER_ROLE."), { status: 500 });
  }
  const reason = traitLabEnergySpendReason(payload);
  await bank.spendEnergy.staticCall(payload.wallet, amount, reason);
  const tx = await bank.spendEnergy(payload.wallet, amount, reason, { gasLimit: 160000n });
  const receipt = await tx.wait();
  if (receipt?.status !== 1) {
    throw Object.assign(new Error("Energy spend transaction failed."), { status: 500 });
  }
  return {
    txHash: tx.hash,
    blockNumber: String(receipt?.blockNumber || ""),
    reason,
  };
}

async function verifyTraitLabMonPayment({
  wallet,
  txHash,
  expectedAmountRaw,
}: {
  wallet: string;
  txHash: string;
  expectedAmountRaw: bigint;
}) {
  const treasuryWallet = traitLabTreasuryWallet();
  const rpcProvider = provider();
  const [tx, receipt] = await Promise.all([
    rpcProvider.getTransaction(txHash),
    rpcProvider.getTransactionReceipt(txHash),
  ]);
  if (!tx) throw Object.assign(new Error("Roll transaction is not available yet."), { status: 409 });
  if (!receipt) throw Object.assign(new Error("Roll transaction is not confirmed yet."), { status: 409 });
  if (receipt.status !== 1) throw Object.assign(new Error("Roll transaction failed on-chain."), { status: 400 });

  const sender = normalizeWallet(tx.from);
  const recipient = optionalAddress(tx.to).toLowerCase();
  if (sender !== wallet) throw Object.assign(new Error("Roll transaction sender does not match connected wallet."), { status: 400 });
  if (recipient !== treasuryWallet.toLowerCase()) throw Object.assign(new Error("Roll transaction recipient does not match Trait Lab treasury."), { status: 400 });
  if (tx.value < expectedAmountRaw) throw Object.assign(new Error("Roll transaction MON amount is below the required cost."), { status: 400 });

  return {
    txHash,
    treasuryWallet,
    amountRaw: tx.value.toString(),
    blockNumber: String(receipt.blockNumber || ""),
  };
}

function s2ContractAddress() {
  if (!dyoorS2Contract) {
    throw Object.assign(new Error("DYOOR_S2_CONTRACT_ADDRESS or NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS is required before Trait Lab can be enabled."), { status: 500 });
  }
  return dyoorS2Contract;
}

function s2Contract() {
  return new ethers.Contract(s2ContractAddress(), ERC721_ABI, provider());
}

export async function verifyS2TokenOwner(tokenId: number, wallet: string, maxSupply = 3333) {
  const contract = s2Contract();
  const { owner } = await ownerOfToken(contract, tokenId);
  if (owner === wallet) return owner;

  const tokenIds: string[] = await ownedS2TokenIds(wallet, maxSupply).catch((): string[] => []);
  if (!tokenIds.includes(String(tokenId))) {
    throw Object.assign(new Error("Wallet does not own this D.Y.O.O.R Season 2 token."), { status: 403 });
  }
  return wallet;
}

async function getLogsWithSplit(
  rpcProvider: ethers.JsonRpcProvider,
  filter: ethers.Filter,
  fromBlock: number,
  toBlock: number,
): Promise<ethers.Log[]> {
  if (fromBlock > toBlock) return [];
  try {
    return await rpcProvider.getLogs({ ...filter, fromBlock, toBlock });
  } catch (error) {
    if (fromBlock === toBlock) throw error;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const [left, right] = await Promise.all([
      getLogsWithSplit(rpcProvider, filter, fromBlock, mid),
      getLogsWithSplit(rpcProvider, filter, mid + 1, toBlock),
    ]);
    return left.concat(right);
  }
}

async function ownedTokensFromEnumerable(contract: ethers.Contract, wallet: string, balance: number) {
  const tokenIds: string[] = [];
  for (let index = 0; index < balance; index += 1) {
    const tokenId = await contract.tokenOfOwnerByIndex(wallet, BigInt(index));
    tokenIds.push(BigInt(tokenId).toString());
  }
  return tokenIds;
}

function hexQuantity(value: number) {
  return `0x${Math.max(0, Math.floor(value)).toString(16)}`;
}

function tokenIdFromAssetTransfer(transfer: Record<string, unknown>) {
  const rawContract = transfer.rawContract as Record<string, unknown> | undefined;
  const value = transfer.tokenId ?? transfer.erc721TokenId ?? rawContract?.tokenId;
  try {
    return BigInt(String(value || "")).toString();
  } catch {
    return "";
  }
}

async function alchemyAssetTransfers(
  rpcProvider: ethers.JsonRpcProvider,
  params: Record<string, unknown>,
) {
  const transfers: Array<Record<string, unknown>> = [];
  let pageKey = "";

  for (let page = 0; page < 50; page += 1) {
    const response = await rpcProvider.send("alchemy_getAssetTransfers", [{
      ...params,
      ...(pageKey ? { pageKey } : {}),
    }]) as { transfers?: Array<Record<string, unknown>>; pageKey?: string };
    transfers.push(...(Array.isArray(response?.transfers) ? response.transfers : []));
    pageKey = String(response?.pageKey || "");
    if (!pageKey) break;
  }

  return transfers;
}

async function verifyCandidateTokenIds(
  contract: ethers.Contract,
  wallet: string,
  candidateIds: Iterable<string>,
  expectedBalance = 0,
) {
  const candidates = Array.from(new Set(candidateIds))
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  const verified: string[] = [];
  const concurrency = Math.max(1, Math.min(12, ownerOfConcurrency()));

  for (let start = 0; start < candidates.length; start += concurrency) {
    const batch = candidates.slice(start, start + concurrency);
    const owners = await Promise.all(batch.map(async (tokenId) => {
      const result = await ownerOfToken(contract, Number(tokenId), 3);
      return { tokenId, ...result };
    }));
    for (const item of owners) {
      if (item.owner === wallet) verified.push(item.tokenId);
    }
    if (expectedBalance > 0 && verified.length >= expectedBalance) break;
  }

  return verified;
}

async function ownedTokensFromAlchemyTransfers(contract: ethers.Contract, wallet: string, balance: number) {
  if (!alchemyTransferLookupEnabled()) return [];
  const rpcProvider = provider();
  const baseParams = {
    fromBlock: hexQuantity(DEFAULT_S2_DEPLOYMENT_BLOCK),
    toBlock: "latest",
    contractAddresses: [s2ContractAddress()],
    category: ["erc721"],
    withMetadata: false,
    excludeZeroValue: false,
    maxCount: ALCHEMY_TRANSFER_PAGE_SIZE,
    order: "asc",
  };
  const [incoming, outgoing] = await Promise.all([
    alchemyAssetTransfers(rpcProvider, { ...baseParams, toAddress: wallet }),
    alchemyAssetTransfers(rpcProvider, { ...baseParams, fromAddress: wallet }),
  ]);
  const candidates = incoming.concat(outgoing).map(tokenIdFromAssetTransfer).filter(Boolean);
  if (!candidates.length) return [];
  return verifyCandidateTokenIds(contract, wallet, candidates, balance);
}

async function ownedTokensFromTransferLogs(contract: ethers.Contract, wallet: string) {
  const rpcProvider = provider();
  const latest = await rpcProvider.getBlockNumber();
  const startBlock = Math.max(
    0,
    parsePositiveInt(readEnv("DYOOR_S2_START_BLOCK", "NEXT_PUBLIC_DYOOR_S2_START_BLOCK"), DEFAULT_S2_DEPLOYMENT_BLOCK),
  );
  const configuredChunk = readEnv(
    "DYOOR_S2_OWNED_TOKEN_LOG_CHUNK_SIZE",
    "NEXT_PUBLIC_DYOOR_S2_OWNED_TOKEN_LOG_CHUNK_SIZE",
    "DYOOR_S2_LOG_CHUNK_SIZE",
    "NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE",
  );
  const chunkSize = Math.max(
    MIN_OWNED_TOKEN_LOG_SPAN,
    parsePositiveInt(configuredChunk, SERVERLESS_LOG_SPAN),
  );
  const changes: Array<{ tokenId: string; owns: boolean; blockNumber: number; logIndex: number }> = [];

  for (let fromBlock = startBlock; fromBlock <= latest; fromBlock += chunkSize) {
    const toBlock = Math.min(latest, fromBlock + chunkSize - 1);
    const [incoming, outgoing] = await Promise.all([
      getLogsWithSplit(rpcProvider, {
        address: s2ContractAddress(),
        topics: [TRANSFER_TOPIC, null, topicAddress(wallet)],
      }, fromBlock, toBlock),
      getLogsWithSplit(rpcProvider, {
        address: s2ContractAddress(),
        topics: [TRANSFER_TOPIC, topicAddress(wallet), null],
      }, fromBlock, toBlock),
    ]);

    for (const log of incoming) {
      const tokenId = BigInt(log.topics[3] || "0").toString();
      changes.push({ tokenId, owns: true, blockNumber: Number(log.blockNumber || 0), logIndex: Number(log.index || 0) });
    }
    for (const log of outgoing) {
      const tokenId = BigInt(log.topics[3] || "0").toString();
      changes.push({ tokenId, owns: false, blockNumber: Number(log.blockNumber || 0), logIndex: Number(log.index || 0) });
    }
  }

  changes.sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber);
  const tokenIds = new Set<string>();
  for (const change of changes) {
    if (change.owns) tokenIds.add(change.tokenId);
    else tokenIds.delete(change.tokenId);
  }

  return verifyCandidateTokenIds(contract, wallet, tokenIds);
}

function isTransientOwnerReadError(error: unknown) {
  const message = String((error as { shortMessage?: string; message?: string })?.shortMessage || (error as Error)?.message || "");
  return /429|timeout|timed out|rate|coalesce|missing revert data|network|server|fetch|ECONN/i.test(message);
}

async function ownerOfToken(contract: ethers.Contract, tokenId: number, attempts = 3) {
  let transient = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const owner = normalizeWallet(await contract.ownerOf(BigInt(tokenId)));
      if (owner) return { owner, transient: false };
    } catch (error) {
      transient = transient || isTransientOwnerReadError(error);
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 125 * (attempt + 1)));
  }
  return { owner: "", transient };
}

function ownerScanOrder(maxSupply: number) {
  const firstWindow = Math.min(250, maxSupply);
  const tailStart = Math.max(firstWindow + 1, maxSupply - 250 + 1);
  const tokenIds: number[] = [];
  const seen = new Set<number>();

  function add(tokenId: number) {
    if (tokenId >= 1 && tokenId <= maxSupply && !seen.has(tokenId)) {
      seen.add(tokenId);
      tokenIds.push(tokenId);
    }
  }

  for (let tokenId = 1; tokenId <= firstWindow; tokenId += 1) add(tokenId);
  for (let tokenId = tailStart; tokenId <= maxSupply; tokenId += 1) add(tokenId);
  for (let tokenId = firstWindow + 1; tokenId < tailStart; tokenId += 1) add(tokenId);

  return tokenIds;
}

async function ownedTokensFromOwnerScan(contract: ethers.Contract, wallet: string, maxSupply: number, expectedBalance = 0) {
  const tokenIds: string[] = [];
  const concurrency = ownerOfConcurrency();
  const transientFailures: number[] = [];
  const scanOrder = ownerScanOrder(maxSupply);

  async function scanBatch(batch: number[], attempts: number) {
    const owners = await Promise.all(batch.map(async (tokenId) => {
      const result = await ownerOfToken(contract, tokenId, attempts);
      return { tokenId, ...result };
    }));
    for (const item of owners) {
      if (item.owner === wallet) tokenIds.push(String(item.tokenId));
      else if (!item.owner && item.transient) transientFailures.push(item.tokenId);
    }
  }

  for (let start = 0; start < scanOrder.length; start += concurrency) {
    const batch = scanOrder.slice(start, start + concurrency);
    await scanBatch(batch, 4);
    if (expectedBalance > 0 && tokenIds.length >= expectedBalance) return tokenIds;
  }

  if (expectedBalance > 0 && tokenIds.length < expectedBalance && transientFailures.length > 0) {
    const retryTokenIds = Array.from(new Set(transientFailures));
    const retryConcurrency = Math.max(1, Math.min(8, concurrency));
    for (let start = 0; start < retryTokenIds.length; start += retryConcurrency) {
      await scanBatch(retryTokenIds.slice(start, start + retryConcurrency), 4);
      if (tokenIds.length >= expectedBalance) return tokenIds;
    }
  }

  return tokenIds;
}

async function ownedTokenScanMax(contract: ethers.Contract, configuredMaxSupply: number, balance = 0) {
  const envMax = parsePositiveInt(readEnv("DYOOR_S2_OWNED_TOKEN_SCAN_MAX", "NEXT_PUBLIC_DYOOR_S2_OWNED_TOKEN_SCAN_MAX"), 0);
  if (envMax > 0) return envMax;

  const chainValues = await Promise.all([
    contract.totalSupply().catch(() => 0n),
    contract.totalMinted().catch(() => 0n),
  ]);
  const chainMax = Math.max(...chainValues.map((value) => Number(value || 0n)).filter(Number.isFinite));
  if (chainMax > 0) return chainMax;

  const balanceBound = Number.isFinite(balance) && balance > 0 ? Math.max(100, Math.ceil(balance * 4)) : configuredMaxSupply;
  return Math.min(configuredMaxSupply, balanceBound);
}

export async function ownedS2TokenIds(wallet: string, maxSupply: number) {
  const cacheKey = `${OWNED_TOKEN_CACHE_VERSION}:${s2ContractAddress().toLowerCase()}:${wallet}:${maxSupply}`;
  const cached = ownedTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return [...cached.tokenIds];

  const contract = s2Contract();
  const balance = Number(await contract.balanceOf(wallet).catch(() => 0n));
  const tokenIds = new Set<string>();

  if (Number.isFinite(balance) && balance <= 0) {
    ownedTokenCache.set(cacheKey, { tokenIds: [], expiresAt: Date.now() + 120_000 });
    return [];
  }

  function done() {
    return Number.isFinite(balance) && balance > 0 && tokenIds.size >= balance;
  }

  function sortedResult() {
    return Array.from(tokenIds).sort((a, b) => Number(a) - Number(b));
  }

  if (Number.isFinite(balance) && balance > 0) {
    try {
      for (const tokenId of await ownedTokensFromEnumerable(contract, wallet, balance)) tokenIds.add(tokenId);
      if (done()) {
        const sorted = sortedResult();
        ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
        return sorted;
      }
    } catch {}
  }

  try {
    for (const tokenId of await ownedTokensFromAlchemyTransfers(contract, wallet, balance)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  const scanMax = await ownedTokenScanMax(contract, maxSupply, balance);
  try {
    for (const tokenId of await ownedTokensFromOwnerScan(contract, wallet, scanMax, balance)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  try {
    for (const tokenId of await ownedTokensFromTransferLogs(contract, wallet)) tokenIds.add(tokenId);
    if (done()) {
      const sorted = sortedResult();
      ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
      return sorted;
    }
  } catch {}

  const sorted = sortedResult();
  if (!Number.isFinite(balance) || balance <= 0 || sorted.length >= balance) {
    ownedTokenCache.set(cacheKey, { tokenIds: sorted, expiresAt: Date.now() + 120_000 });
  }
  return sorted;
}

function parseInputTokenId(value: unknown, maxSupply: number) {
  const parsed = parseTokenId(value, maxSupply);
  if (!parsed.ok || typeof parsed.tokenId !== "number") {
    throw Object.assign(new Error(parsed.error || "Invalid token ID."), { status: parsed.status || 400 });
  }
  return parsed.tokenId;
}

function parseTraitType(value: unknown) {
  const traitType = String(value || "").trim();
  if (!isS2EditableTrait(traitType)) {
    throw Object.assign(new Error("Invalid trait type. Background and Droid are locked."), { status: 400 });
  }
  return traitType;
}

function parseAction(value: unknown) {
  const action = String(value || "").trim();
  if (!isS2TraitLabAction(action)) {
    throw Object.assign(new Error("Invalid Trait Lab action."), { status: 400 });
  }
  return action;
}

export async function createTraitLabPreview(input: Record<string, unknown>) {
  const wallet = normalizeWallet(input.wallet);
  if (!wallet) throw Object.assign(new Error("wallet must be a valid address."), { status: 400 });

  const config = await getRuntimeMetadataConfig();
  const tokenId = parseInputTokenId(input.tokenId, config.maxSupply);
  const traitType = parseTraitType(input.traitType);
  const action = parseAction(input.action);
  const paymentMode = parsePaymentMode(input.paymentMode);

  await verifyS2TokenOwner(tokenId, wallet, config.maxSupply);

  const { metadata } = await buildTokenMetadataAsync(tokenId, config);
  const traits = traitMapFromMetadata(metadata as MetadataJson);
  const supplyLedger = await getTraitSupplyLedger();
  const candidate = generateCandidate(traits, traitType, action, supplyLedger);
  const version = metadataVersion(metadata as MetadataJson) + 1;
  const { costEnergy, costRaw, costMon, costLabel } = traitLabPaymentCost(traitType, action, paymentMode);
  const supplyDeltas = supplyDeltasForPatch(traits, candidate.proposedAttributes);
  await assertSupplyDeltasAvailable(supplyDeltas);
  const rollId = crypto.randomUUID();
  const energyDebitId = `trait-lab-roll:${rollId}`;
  const payload: PreviewPayload = {
    rollId,
    wallet,
    tokenId,
    traitType,
    action,
    paymentMode,
    previousValue: titleValue(traits[traitType]),
    proposedValue: candidate.option.value,
    proposedAttributes: candidate.proposedAttributes,
    costEnergy,
    costRaw,
    costMon,
    costLabel,
    assetUri: candidate.option.assetUri,
    metadataVersion: version,
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    nonce: crypto.randomUUID(),
  };
  const previewId = encodePreview(payload);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const proposedMetadata = mergeMetadata(metadata, {
    version,
    attributes: candidate.proposedAttributes,
  }, tokenId, config);
  let energyDebitDeduped = false;
  let energySpend: Awaited<ReturnType<typeof spendTraitLabEnergy>> | null = null;
  let monPayment: Awaited<ReturnType<typeof verifyTraitLabMonPayment>> | null = null;

  if (paymentMode === "mon") {
    const txHash = requireTxHash(input.paymentTxHash);
    monPayment = await verifyTraitLabMonPayment({
      wallet,
      txHash,
      expectedAmountRaw: monCostRaw(costMon),
    });
    await claimTraitLabMonPayment({
      txHash: monPayment.txHash,
      rollId,
      wallet,
      tokenId: String(tokenId),
      traitType,
      action,
      amountRaw: monPayment.amountRaw,
      treasuryWallet: monPayment.treasuryWallet,
      blockNumber: monPayment.blockNumber,
      createdAt: new Date().toISOString(),
    });
  }

  await saveTraitLabRoll({
    rollId,
    previewId,
    wallet,
    tokenId: String(tokenId),
    traitType,
    action,
    paymentMode,
    costRaw,
    costLabel,
    previousValue: payload.previousValue,
    proposedValue: payload.proposedValue,
    proposedAttributes: payload.proposedAttributes,
    status: "created",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(payload.expiresAt).toISOString(),
    energyDebitId: paymentMode === "energy" ? energyDebitId : undefined,
    monPaymentTxHash: monPayment?.txHash,
    monPaymentAmountRaw: monPayment?.amountRaw,
    monPaymentBlockNumber: monPayment?.blockNumber,
  });

  if (paymentMode === "energy") {
    energySpend = await spendTraitLabEnergy(payload);
  }

  await saveTraitLabRoll({
    rollId,
    previewId,
    wallet,
    tokenId: String(tokenId),
    traitType,
    action,
    paymentMode,
    costRaw,
    costLabel,
    previousValue: payload.previousValue,
    proposedValue: payload.proposedValue,
    proposedAttributes: payload.proposedAttributes,
    status: "charged",
    createdAt: new Date().toISOString(),
    chargedAt: new Date().toISOString(),
    expiresAt: new Date(payload.expiresAt).toISOString(),
    energyDebitId: paymentMode === "energy" ? energyDebitId : undefined,
    energyDebitDeduped,
    energySpendTxHash: energySpend?.txHash,
    energySpendBlockNumber: energySpend?.blockNumber,
    monPaymentTxHash: monPayment?.txHash,
    monPaymentAmountRaw: monPayment?.amountRaw,
    monPaymentBlockNumber: monPayment?.blockNumber,
  });

  return {
    ok: true,
    wallet,
    tokenId,
    traitType,
    action,
    paymentMode,
    costEnergy,
    costRaw,
    costMon,
    costLabel,
    previousValue: payload.previousValue,
    proposedValue: payload.proposedValue,
    proposedAttributes: payload.proposedAttributes,
    proposedAsset: {
      cid: traitAssetCid(),
      uri: payload.assetUri,
      rarity: candidate.option.rarity || "",
      initialSupply: candidate.option.initialSupply || 0,
      maxActiveSupply: candidate.option.maxActiveSupply || 0,
      burnOnEquip: candidate.option.burnOnEquip || "",
      weight: candidate.option.weight || 0,
    },
    rollId,
    rollCharged: true,
    energyDebitSkipped: paymentMode !== "energy",
    energyDebitDeduped,
    paymentTxHash: monPayment?.txHash || energySpend?.txHash || "",
    paymentAmountRaw: monPayment?.amountRaw || (energySpend ? costRaw : ""),
    paymentBlockNumber: monPayment?.blockNumber || energySpend?.blockNumber || "",
    supplyDeltas,
    previewId,
    expiresAt: new Date(payload.expiresAt).toISOString(),
    currentMetadata: metadata,
    proposedMetadata,
    confirmation: {
      timestamp,
      nonce,
      message: traitLabMessage(payload, timestamp, nonce),
    },
    imageRecomposition: {
      status: "preview",
      note: "Preview shows the proposed layer result. The composed token image is generated after Confirm Change.",
    },
  };
}

export async function confirmTraitLabPreview(input: Record<string, unknown>) {
  const wallet = normalizeWallet(input.wallet);
  if (!wallet) throw Object.assign(new Error("wallet must be a valid address."), { status: 400 });

  const previewId = String(input.previewId || "").trim();
  const payload = decodePreview(previewId);
  if (!payload.rollId) {
    throw Object.assign(new Error("Generate a new paid roll before confirming."), { status: 400 });
  }
  const tokenIdInput = Number(input.tokenId);
  const traitTypeInput = String(input.traitType || "").trim();
  const actionInput = String(input.action || "").trim();
  if (payload.wallet !== wallet || payload.tokenId !== tokenIdInput || payload.traitType !== traitTypeInput || payload.action !== actionInput) {
    throw Object.assign(new Error("Confirm request does not match the preview."), { status: 400 });
  }
  const paidRoll = await getTraitLabRoll(payload.rollId);
  if (!paidRoll || paidRoll.previewId !== previewId || paidRoll.status === "created") {
    throw Object.assign(new Error("This roll was not paid or is no longer available."), { status: 402 });
  }
  if (payload.paymentMode === "mon" && !paidRoll.monPaymentTxHash) {
    throw Object.assign(new Error("This roll is missing its wallet transaction."), { status: 402 });
  }
  if (payload.paymentMode === "energy" && !paidRoll.energyDebitId) {
    throw Object.assign(new Error("This roll is missing its Energy debit."), { status: 402 });
  }

  const timestamp = String(input.timestamp || "");
  const nonce = String(input.nonce || "");
  const signature = String(input.signature || "");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > CONFIRM_WINDOW_MS) {
    throw Object.assign(new Error("Trait Lab authorization expired. Preview and sign again."), { status: 401 });
  }
  if (!nonce || !signature) {
    throw Object.assign(new Error("Missing wallet signature."), { status: 400 });
  }

  const expectedMessage = traitLabMessage(payload, timestamp, nonce);
  const recovered = normalizeWallet(ethers.verifyMessage(expectedMessage, signature));
  if (!recovered || recovered !== wallet) {
    throw Object.assign(new Error("Signature does not match connected wallet."), { status: 401 });
  }

  const config = await getRuntimeMetadataConfig();
  const tokenId = parseInputTokenId(payload.tokenId, config.maxSupply);
  await verifyS2TokenOwner(tokenId, wallet, config.maxSupply);

  const { metadata } = await buildTokenMetadataAsync(tokenId, config);
  const currentTraits = traitMapFromMetadata(metadata as MetadataJson);
  assertValidRequestedChange(currentTraits, payload.traitType, payload.action);
  if (!valuesMatch(currentTraits[payload.traitType], payload.previousValue)) {
    throw Object.assign(new Error("Metadata changed since preview. Generate a new preview."), { status: 409 });
  }
  validateProposedPatch(currentTraits, payload);
  const supplyDeltas = supplyDeltasForPatch(currentTraits, payload.proposedAttributes);
  await assertSupplyDeltasAvailable(supplyDeltas);

  const currentOverride = await getRuntimeTraitOverrides(tokenId);
  if (currentOverride?.frozen) {
    throw Object.assign(new Error("Token metadata is frozen."), { status: 409 });
  }

  const nextVersion = Math.max(Number(currentOverride?.version || metadataVersion(metadata as MetadataJson)) + 1, 2);
  const draftOverride = {
    ...(currentOverride || {}),
    version: nextVersion,
    attributes: {
      ...(currentOverride?.attributes || {}),
      ...payload.proposedAttributes,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: wallet,
    notes: `Trait Lab ${payload.action} ${payload.traitType}.`,
  };
  const draftMetadata = mergeMetadata(metadata, draftOverride, tokenId, config);
  const renderedImage = await renderTraitLabImage(tokenId, draftMetadata as MetadataJson, String(input.origin || ""));
  const nextOverride = {
    ...draftOverride,
    ...(renderedImage.rendered ? { image: renderedImage.imageUrl } : {}),
    imageRender: renderedImage.rendered ? {
      imageId: renderedImage.imageId,
      url: renderedImage.imageUrl,
      rendererVersion: renderedImage.rendererVersion,
      renderedAt: new Date().toISOString(),
    } : undefined,
  };
  const override = await saveRuntimeTraitOverride(tokenId, nextOverride);
  const supplyEvent = await applyTraitSupplyDeltas({
    id: `trait-lab-confirm:${payload.rollId}`,
    rollId: payload.rollId,
    wallet,
    tokenId: String(tokenId),
    action: payload.action,
    traitType: payload.traitType,
    deltas: supplyDeltas,
    createdAt: new Date().toISOString(),
  });
  const rollRecord: TraitLabRollRecord = {
    ...paidRoll,
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
  };
  await saveTraitLabRoll(rollRecord);
  const updated = await buildTokenMetadataAsync(tokenId, config);

  return {
    ok: true,
    wallet,
    tokenId,
    traitType: payload.traitType,
    action: payload.action,
    paymentMode: payload.paymentMode,
    costEnergy: payload.costEnergy,
    costRaw: payload.costRaw,
    costMon: payload.costMon,
    costLabel: payload.costLabel,
    rollId: payload.rollId,
    rollCharged: true,
    debitDeduped: Boolean(paidRoll.energyDebitDeduped),
    energyDebitSkipped: payload.paymentMode !== "energy",
    paymentTxHash: paidRoll.monPaymentTxHash || paidRoll.energySpendTxHash || "",
    paymentAmountRaw: paidRoll.monPaymentAmountRaw || (paidRoll.energySpendTxHash ? payload.costRaw : ""),
    paymentBlockNumber: paidRoll.monPaymentBlockNumber || paidRoll.energySpendBlockNumber || "",
    supplyDeltas,
    supplyEventDeduped: supplyEvent.deduped,
    override,
    metadata: updated.metadata,
    imageRecomposition: {
      status: renderedImage.rendered ? "rendered" : "unchanged",
      imageUrl: renderedImage.imageUrl,
      note: renderedImage.rendered
        ? "Composed token image generated and saved with the metadata override."
        : "No matching layer assets were found, so the existing token image URL was preserved.",
    },
  };
}

export function zeroAddress() {
  return ZERO_ADDRESS;
}
