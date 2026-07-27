"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { encodeFunctionData } from "viem";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
import bobMaskTeaserImage from "@/dyoor-builder/layers/Hat/BOB Mask.png";
import traitRevealAuditJson from "@/data/dyoor-s2-trait-reveal-audit.json";
import {
  S2_EDITABLE_TRAITS,
  S2_GUARANTEED_TRAITS,
  S2_LOCKED_TRAITS,
  S2_RECYCLABLE_TRAITS,
  S2_REQUIRED_TRAITS,
  S2_TRAIT_LAB_TRAITS,
  S2_TRAIT_LAB_COSTS,
  S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY,
  S2_TRAIT_LAB_REROLL_ALL_COST,
  S2_TRAIT_LAB_RECYCLE_REWARDS,
  S2_UNLOCKABLE_TRAITS,
  type S2TraitLabTrait,
  type S2TraitLabAction,
  type S2TraitLabPaymentMode,
} from "@/lib/s2-trait-lab-config";
import {
  canonicalTraitLabPreviewAction,
  traitLabConfirmationAuthorizationMessage,
  traitLabForfeitAuthorizationMessage,
  traitLabPreviewAuthorizationMessage,
} from "@/lib/s2-trait-lab-auth";
import { getStorageItem, removeStorageItem, setStorageJson } from "@/lib/browser-storage";
import { useWalletService } from "@/providers/WalletServiceProvider";

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

type TokenCard = {
  tokenId: string;
  name: string;
  image: string;
};

type OwnedResponse = {
  ok?: boolean;
  tokenIds?: string[];
  error?: string;
};

type EnergyResponse = {
  ok?: boolean;
  spendableEnergy?: string;
  spendableRaw?: string;
  ledgerSpendableEnergy?: string;
  ledgerSpendableRaw?: string;
  missingSpendableEnergy?: string;
  missingSpendableRaw?: string;
  energyBankSyncPending?: boolean;
  pendingEnergy?: string;
  spentEnergy?: string;
  error?: string;
};

type PreviewResponse = {
  ok?: boolean;
  wallet?: string;
  tokenId?: number;
  traitType?: S2TraitLabTrait;
  action?: S2TraitLabAction;
  paymentMode?: S2TraitLabPaymentMode;
  costEnergy?: number;
  costRaw?: string;
  costMon?: string;
  costLabel?: string;
  rewardEnergy?: number;
  rewardRaw?: string;
  rewardLabel?: string;
  previousValue?: string;
  proposedValue?: string;
  proposedAttributes?: Record<string, string>;
  proposedAsset?: {
    cid?: string;
    uri?: string;
    rarity?: string;
    initialSupply?: number;
    maxActiveSupply?: number;
    burnOnEquip?: string;
    weight?: number;
  };
  rollId?: string;
  operationStatus?: string;
  rollCharged?: boolean;
  energySettlementMode?: "server-ledger" | "energy-bank" | "none";
  paymentTxHash?: string;
  paymentBurnTxHash?: string;
  paymentToken?: string;
  paymentTokenSymbol?: string;
  paymentTreasuryAmountRaw?: string;
  paymentBurnAmountRaw?: string;
  paymentAmountRaw?: string;
  paymentBlockNumber?: string;
  supplyDeltas?: Array<{
    traitType: string;
    value: string;
    delta: number;
    reason: "equip" | "burn";
    initialSupply?: number;
    maxActiveSupply?: number;
  }>;
  previewId?: string;
  expiresAt?: string;
  currentMetadata?: MetadataJson;
  proposedMetadata?: MetadataJson;
  confirmation?: {
    timestamp: string;
    nonce: string;
    message: string;
  };
  imageRecomposition?: {
    status?: string;
    todo?: string;
    imageUrl?: string;
    previewDataUrl?: string;
    storage?: {
      persisted?: boolean;
      readable?: boolean;
      location?: string;
      error?: string;
    };
  };
  openSeaMetadataRefresh?: {
    status?: "queued" | "scheduled" | "skipped" | "failed";
    note?: string;
    error?: string;
    runAt?: string;
    delayMs?: number;
    immediate?: {
      status?: "queued" | "scheduled" | "skipped" | "failed";
      note?: string;
      error?: string;
    };
  };
  error?: string;
  recoveryRequired?: boolean;
  recoveryPreview?: PreviewResponse;
  bountySettlements?: Array<{
    bountyId?: string;
    bountyLabel?: string;
    traitType?: string;
    traitValue?: string;
    rewardRaw?: string;
    rewardEnergy?: string;
    status?: "settled" | "deduped" | "pending" | "ineligible";
    txHash?: string;
    error?: string;
  }>;
};

type TraitLabConfigResponse = {
  ok?: boolean;
  treasuryWallet?: string;
  contractAddress?: string;
  chainId?: number;
  chainHex?: string;
  chainName?: string;
  rpcUrl?: string;
  explorerUrl?: string;
  flatUnlockCostEnergy?: number;
  specialMaxActiveSupply?: number;
  guaranteedTraits?: readonly string[];
  unlockableTraits?: readonly string[];
  recyclableTraits?: readonly string[];
  recycleRewards?: Record<string, number>;
  droidBurnEnabled?: boolean;
  droidBurnRewardEnergy?: number;
  rerollSettlementMode?: "server-ledger";
  rerollRequiresTransaction?: boolean;
  rerollAllCostEnergy?: number;
  leaderboardEnabled?: boolean;
  bountyEnabled?: boolean;
  error?: string;
};

type BurnedDroidCard = {
  tokenId: string;
  wallet: string;
  burnTxHash: string;
  rewardEnergy: number;
  rewardLabel: string;
  burnedAt: string;
  name?: string;
  image?: string;
  metadataVersion?: string;
  rewardTxHash?: string;
};

type BurnedGalleryResponse = {
  ok?: boolean;
  items?: BurnedDroidCard[];
  error?: string;
};

type PendingBurnClaim = {
  wallet: string;
  tokenId: string;
  burnTxHash: string;
  createdAt: string;
  confirmedAt?: string;
};

type PendingTraitLabOperation = {
  wallet: string;
  rollId: string;
  tokenId: string;
  savedAt: string;
  preview: PreviewResponse;
};

type TraitLabOperationResponse = {
  ok?: boolean;
  active?: boolean;
  operation?: {
    rollId?: string;
    tokenId?: string;
    action?: string;
    traitType?: string;
    status?: string;
    chargeStatus?: string;
    isCurrent?: boolean;
    recoveryRequired?: boolean;
    canRetryConfirmation?: boolean;
    lastError?: string;
  };
  completion?: PreviewResponse & { metadata?: MetadataJson };
  retryPreview?: PreviewResponse;
  error?: string;
};

type TraitLabLeaderboardRow = {
  rank: number;
  wallet: string;
  completedOperations: number;
  rerolls: number;
  rerollAlls: number;
  unlocks: number;
  recycles: number;
  energySpentRaw: string;
  energyEarnedRaw: string;
  lastCompletedAt: string;
};

type TraitLabLeaderboardResponse = {
  ok?: boolean;
  enabled?: boolean;
  bountyEnabled?: boolean;
  rows?: TraitLabLeaderboardRow[];
  error?: string;
};

type TraitBountyCard = {
  id: string;
  label: string;
  traitType: string;
  traitValue: string;
  rewardEnergy: string;
  maxClaims: number;
  totalClaims: number;
  remainingClaims: number;
  perWalletLimit: number;
  perTokenLimit: number;
  actions: string[];
  startsAt: string;
  endsAt: string;
  status: "draft" | "upcoming" | "active" | "ended" | "complete" | "closed";
};

type TraitBountyWinner = {
  settlementKey: string;
  bountyId: string;
  bountyLabel: string;
  wallet: string;
  tokenId: string;
  traitType: string;
  traitValue: string;
  rewardEnergy: string;
  settledAt: string;
  txHash?: string;
};

type TraitBountyTeaser = {
  id: string;
  traitType: string;
  traitValue: string;
  maskedLabel: string;
  rarity: string;
  weight: number;
  imageAsset: string;
  hint: string;
};

type TraitRevealAudit = {
  generatedAt: string;
  displayDate: string;
  scanned: {
    successful: number;
    failed: number;
  };
  unrevealed: TraitBountyTeaser[];
};

type TraitBountyResponse = {
  ok?: boolean;
  configured?: boolean;
  enabled?: boolean;
  contractAddress?: string;
  bounties?: TraitBountyCard[];
  settlements?: TraitBountyWinner[];
  error?: string;
};

const S2_DROID_BURN_ABI = [{
  type: "function",
  name: "burn",
  stateMutability: "nonpayable",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [],
}] as const;

const editableTraits = new Set<string>(S2_EDITABLE_TRAITS);
const lockedTraits = new Set<string>(S2_LOCKED_TRAITS);
const guaranteedTraits = new Set<string>(S2_GUARANTEED_TRAITS);
const unlockableTraits = new Set<string>(S2_UNLOCKABLE_TRAITS);
const recyclableTraits = new Set<string>(S2_RECYCLABLE_TRAITS);
const renderTraits = [
  "Background",
  "Droid",
  "Conditions",
  "Stickers/Body art",
  "Clothes",
  "Mouth",
  "Eyes",
  "Hat",
  "Accessories",
  "Accessories 2",
  "Special",
];
const TOKEN_CARD_METADATA_CONCURRENCY = 6;
const MAX_PENDING_TRAIT_LAB_OPERATIONS = 8;
const traitRevealAudit = traitRevealAuditJson as TraitRevealAudit;
const bountyTeaserImages: Record<string, StaticImageData> = {
  "dyoor-builder/layers/Hat/BOB Mask.png": bobMaskTeaserImage,
};

function currentPendingTraitLabOperations(items: PendingTraitLabOperation[]) {
  const latestByToken = new Map<string, PendingTraitLabOperation>();
  for (const item of [...items].sort((left, right) => right.savedAt.localeCompare(left.savedAt))) {
    if (!latestByToken.has(item.tokenId)) latestByToken.set(item.tokenId, item);
  }
  return [...latestByToken.values()]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, MAX_PENDING_TRAIT_LAB_OPERATIONS);
}

function browserLocalStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function persistPendingTraitLabOperations(key: string, operations: PendingTraitLabOperation[]) {
  const storage = browserLocalStorage();
  if (!storage || !key) return false;
  return operations.length
    ? setStorageJson(storage, key, operations)
    : removeStorageItem(storage, key);
}

function normalizeAddress(address?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address || "") ? String(address).toLowerCase() : "";
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function mediaUrl(uri?: string) {
  const value = String(uri || "").trim();
  if (!value) return "";
  if (value.startsWith("ipfs://")) {
    const gateway = (process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL || "https://jade-efficient-beaver-697.mypinata.cloud").replace(/\/+$/, "");
    return `${gateway}/ipfs/${value.slice(7)}`;
  }
  if (value.startsWith("ar://")) return `https://arweave.net/${value.slice(5)}`;
  return value;
}

function normalizeTraitValue(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEmptyTraitValue(value: unknown) {
  const normalized = normalizeTraitValue(value);
  return !normalized || ["none", "null", "undefined", "n a", "na", "unknown"].includes(normalized);
}

function displayTraitValue(value: unknown) {
  return isEmptyTraitValue(value) ? "Empty Slot" : String(value ?? "").trim();
}

function traitMap(metadata?: MetadataJson | null) {
  const map: Record<string, string> = {};
  for (const attribute of Array.isArray(metadata?.attributes) ? metadata.attributes : []) {
    const traitType = String(attribute?.trait_type || "").trim();
    if (traitType) map[traitType] = String(attribute?.value ?? "").trim();
  }
  return map;
}

function metadataVersion(metadata?: MetadataJson | null) {
  return traitMap(metadata)["Metadata Version"] || "1";
}

function metadataVersionNumber(metadata?: MetadataJson | null) {
  const parsed = Number.parseInt(metadataVersion(metadata), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function actionOptionsForTrait(traitType: string, value: unknown): S2TraitLabAction[] {
  if (!S2_TRAIT_LAB_TRAITS.includes(traitType as S2TraitLabTrait)) return [];
  if (isEmptyTraitValue(value)) return unlockableTraits.has(traitType) ? ["unlock"] : [];
  const actions: S2TraitLabAction[] = [];
  if (editableTraits.has(traitType)) actions.push("reroll");
  if (recyclableTraits.has(traitType)) actions.push("recycle");
  return actions;
}

function actionForTrait(traitType: string, value: unknown): S2TraitLabAction | "" {
  return actionOptionsForTrait(traitType, value)[0] || "";
}

function actionLabel(action: S2TraitLabAction | "") {
  if (action === "unlock") return "Unlock Slot";
  if (action === "remove") return "Remove Trait";
  if (action === "recycle") return "Recycle Trait";
  if (action === "rerollAll") return "Reroll All";
  if (action === "reroll") return "Reroll";
  return "Unavailable";
}

function actionVerb(action: S2TraitLabAction | "") {
  if (action === "unlock") return "Unlock";
  if (action === "remove") return "Remove";
  if (action === "recycle") return "Recycle";
  if (action === "rerollAll") return "Reroll All";
  if (action === "reroll") return "Reroll";
  return "Roll";
}

function costFor(traitType: string, action: S2TraitLabAction | "") {
  if (action === "rerollAll") return `${S2_TRAIT_LAB_REROLL_ALL_COST} Energy`;
  if (!action || !S2_TRAIT_LAB_TRAITS.includes(traitType as S2TraitLabTrait)) return null;
  if (action === "recycle") {
    const reward = S2_TRAIT_LAB_RECYCLE_REWARDS[traitType as S2TraitLabTrait];
    return typeof reward === "number" ? `Earn ${reward} Energy` : null;
  }
  const energyCost = S2_TRAIT_LAB_COSTS[action]?.[traitType as S2TraitLabTrait];
  return typeof energyCost === "number" ? `${energyCost} Energy` : null;
}

function tokenTitle(tokenId: string, metadata?: MetadataJson | null) {
  return metadata?.name || `D.Y.O.O.R #${tokenId}`;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function previewRows(current?: MetadataJson | null, proposed?: MetadataJson | null) {
  const before = traitMap(current);
  const after = traitMap(proposed);
  return S2_REQUIRED_TRAITS.map((trait) => ({
    trait,
    before: displayTraitValue(before[trait]),
    after: displayTraitValue(after[trait]),
    changed: normalizeTraitValue(before[trait]) !== normalizeTraitValue(after[trait]),
  }));
}

function metadataJson(metadata?: MetadataJson | null) {
  return metadata ? JSON.stringify(metadata, null, 2) : "";
}

function supplyDeltaLabel(delta: NonNullable<PreviewResponse["supplyDeltas"]>[number]) {
  return delta.reason === "burn" ? "Burn" : "Equip";
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTraitLabOperationId(value: unknown) {
  const operationId = String(value || "");
  return /^0x[a-f0-9]{64}$/i.test(operationId)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId);
}

function traitLabErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/Trait image composition failed/i.test(message)) {
    return `Image render safety check blocked this change. ${message}`;
  }
  return message || fallback;
}

async function fetchJsonWithRetry<T>(url: string, fallbackMessage: string, attempts = 3): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const separator = url.includes("?") ? "&" : "?";
      const response = await fetch(`${url}${separator}_=${Date.now()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as T & { ok?: boolean; error?: string };
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `${fallbackMessage} (${response.status})`);
      }
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error.message : fallbackMessage;
      if (attempt < attempts - 1) await sleep(700 * (attempt + 1));
    }
  }
  throw new Error(lastError || fallbackMessage);
}

function slugFile(value: unknown) {
  return `${String(value ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase()}.png`;
}

function ipfsUrl(cid: string, pathParts: string[]) {
  const cleanCid = String(cid || "").trim();
  if (!cleanCid) return "";
  return mediaUrl(`ipfs://${cleanCid}/${pathParts.map((part) => encodeURIComponent(part)).join("/")}`);
}

function localLayerUrl(traitType: string, value: unknown) {
  if (isEmptyTraitValue(value)) return "";
  const folder = traitType === "Stickers/Body art" ? "Stickers:Body art" : traitType;
  return `/dyoor-builder/layers/${encodeURIComponent(folder)}/${encodeURIComponent(String(value).trim())}.png`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function layerSources(traitType: string, value: unknown) {
  if (isEmptyTraitValue(value)) return [];
  const fullLayerCid = process.env.NEXT_PUBLIC_DYOOR_S2_LAYER_IMAGE_CID || "";
  const traitItemImageCid = process.env.NEXT_PUBLIC_DYOOR_S2_TRAIT_ASSETS_CID || "bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu";
  const folder = traitType === "Stickers/Body art" ? "Stickers:Body art" : traitType;
  const rawName = String(value).trim();
  const slug = slugFile(value);

  return uniqueStrings([
    localLayerUrl(traitType, value),
    ipfsUrl(fullLayerCid, ["layers", folder, `${rawName}.png`]),
    ipfsUrl(fullLayerCid, ["layers", folder, `${rawName}.PNG`]),
    ipfsUrl(fullLayerCid, [folder, `${rawName}.png`]),
    ipfsUrl(fullLayerCid, [folder, `${rawName}.PNG`]),
    ipfsUrl(traitItemImageCid, [slug]),
  ]);
}

function layerEntries(metadata?: MetadataJson | null) {
  const traits = traitMap(metadata);
  return renderTraits
    .map((traitType) => ({
      traitType,
      value: traits[traitType],
      sources: layerSources(traitType, traits[traitType]),
    }))
    .filter((layer) => layer.sources.length);
}

function LayerPreview({ fallbackImage, metadata, title }: { fallbackImage?: string; metadata?: MetadataJson | null; title: string }) {
  const layers = layerEntries(metadata);
  const [failedFallbackImage, setFailedFallbackImage] = useState("");
  const useFallbackImage = Boolean(fallbackImage && failedFallbackImage !== fallbackImage);
  const useLayerStack = layers.length > 0 && !useFallbackImage;
  return (
    <div className="aspect-square bg-black/45">
      {useFallbackImage || useLayerStack ? (
        <div className="relative h-full w-full overflow-hidden bg-black/35">
          {useFallbackImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={title}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setFailedFallbackImage(fallbackImage || "")}
              src={fallbackImage}
            />
          ) : null}
          {useLayerStack ? layers.map((layer, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${title} ${layer.traitType} ${layer.value}`}
              className="absolute inset-0 h-full w-full object-cover"
              key={`${layer.traitType}-${layer.value}-${index}`}
              data-next-source-index="1"
              data-sources={JSON.stringify(layer.sources)}
              onError={(event) => {
                const img = event.currentTarget;
                const sources = JSON.parse(img.dataset.sources || "[]") as string[];
                const nextIndex = Number(img.dataset.nextSourceIndex || "1");
                const nextSource = sources[nextIndex];
                if (nextSource) {
                  img.dataset.nextSourceIndex = String(nextIndex + 1);
                  img.src = nextSource;
                  return;
                }
                img.style.display = "none";
              }}
              src={layer.sources[0]}
            />
          )) : null}
        </div>
      ) : (
        <div className="grid h-full place-items-center text-xs font-black uppercase tracking-[0.16em] text-white/35">No Image</div>
      )}
    </div>
  );
}

function RollProgress({
  action,
  traitType,
}: {
  action?: string;
  traitType?: string;
}) {
  const actionLabel = action === "unlock"
    ? "Rolling unlock"
    : action === "remove"
      ? "Removing trait"
      : action === "recycle"
        ? "Recycling trait"
        : action === "rerollAll"
          ? "Rolling all filled traits"
          : "Rolling reroll";
  const paymentLabel = action === "recycle" ? "Energy reward" : "Energy spend";
  const displayTraitType = action === "rerollAll" ? "All Filled Traits" : traitType || "-";

  return (
    <div className="mt-5 overflow-hidden rounded border border-dyoor-cyan/30 bg-dyoor-cyan/10">
      <div className="grid gap-5 p-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <div className="relative grid h-20 w-20 place-items-center rounded-full border border-dyoor-cyan/35 bg-black/45 shadow-[0_0_28px_rgba(57,255,226,.18)]">
          <div className="absolute inset-2 rounded-full border border-dyoor-cyan/20" />
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-dyoor-cyan/20 border-t-dyoor-cyan" />
          <div className="absolute h-3 w-3 rounded-full bg-dyoor-cyan shadow-[0_0_18px_rgba(57,255,226,.8)]" />
        </div>
        <div className="min-w-0">
          <p className="eyebrow text-dyoor-cyan">Roll In Progress</p>
          <h3 className="mt-2 text-2xl font-black uppercase text-white">{actionLabel}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
            {action === "recycle"
              ? `Preparing a ${traitType || "trait"} burn and Energy reward while preserving the current metadata view.`
              : action === "rerollAll"
                ? "Generating one compatible bundle result from the filled mutable slots on this Droid."
              : `Generating a compatible ${traitType || "trait"} result and preserving the current metadata view.`}
          </p>
          <div className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/56 sm:grid-cols-2">
            <div className="rounded border border-white/10 bg-black/30 px-3 py-2">
              <span className="text-white/35">Trait</span>
              <span className="ml-2 text-white">{displayTraitType}</span>
            </div>
            <div className="rounded border border-white/10 bg-black/30 px-3 py-2">
              <span className="text-white/35">Payment</span>
              <span className="ml-2 text-dyoor-cyan">{paymentLabel}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="h-1 overflow-hidden bg-black/40">
        <div className="h-full w-1/2 animate-pulse bg-gradient-to-r from-dyoor-cyan via-dyoor-magenta to-dyoor-cyan" />
      </div>
    </div>
  );
}

export function TraitLabClient() {
  const wallet = useWalletService();
  const walletAddress = normalizeAddress(wallet.address);
  const [ownedTokenIds, setOwnedTokenIds] = useState<string[]>([]);
  const [tokenCards, setTokenCards] = useState<TokenCard[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [metadata, setMetadata] = useState<MetadataJson | null>(null);
  const [energy, setEnergy] = useState<EnergyResponse | null>(null);
  const [traitLabConfig, setTraitLabConfig] = useState<TraitLabConfigResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selectedTrait, setSelectedTrait] = useState<S2TraitLabTrait>("Eyes");
  const [selectedAction, setSelectedAction] = useState<S2TraitLabAction | "">("");
  const [burnedGallery, setBurnedGallery] = useState<BurnedDroidCard[]>([]);
  const [burnConfirmText, setBurnConfirmText] = useState("");
  const [pendingBurnClaim, setPendingBurnClaim] = useState<PendingBurnClaim | null>(null);
  const [pendingTraitLabOperations, setPendingTraitLabOperations] = useState<PendingTraitLabOperation[]>([]);
  const [operationRecoveryLoading, setOperationRecoveryLoading] = useState("");
  const [leaderboardRows, setLeaderboardRows] = useState<TraitLabLeaderboardRow[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [traitBounties, setTraitBounties] = useState<TraitBountyCard[]>([]);
  const [traitBountyWinners, setTraitBountyWinners] = useState<TraitBountyWinner[]>([]);
  const [traitBountyLoading, setTraitBountyLoading] = useState(false);
  const [burnedGalleryLoading, setBurnedGalleryLoading] = useState(false);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [status, setStatus] = useState("Connect wallet to load D.Y.O.O.R Season 2 droids.");
  const [error, setError] = useState("");
  const selectedTokenIdRef = useRef("");
  const metadataRequestRef = useRef(0);
  const activeRestoreRequestRef = useRef(0);

  const selectedTraits = useMemo(() => traitMap(metadata), [metadata]);
  const emptySlots = useMemo(() => S2_EDITABLE_TRAITS.filter((trait) => isEmptyTraitValue(selectedTraits[trait])), [selectedTraits]);
  const baseDroidDetected = emptySlots.length === S2_EDITABLE_TRAITS.length;
  const selectedImage = mediaUrl(metadata?.image);
  const rows = previewRows(preview?.currentMetadata || metadata, preview?.proposedMetadata || metadata);
  const selectedTraitValue = selectedTraits[selectedTrait];
  const selectedTraitActions = useMemo(() => actionOptionsForTrait(selectedTrait, selectedTraitValue), [selectedTrait, selectedTraitValue]);
  const selectedTraitAction = selectedTraitActions.includes(selectedAction as S2TraitLabAction)
    ? selectedAction as S2TraitLabAction
    : selectedTraitActions[0] || "";
  const rerollAllTraits = useMemo(() => S2_EDITABLE_TRAITS.filter((trait) => (
    !isEmptyTraitValue(selectedTraits[trait])
      && actionOptionsForTrait(trait, selectedTraits[trait]).includes("reroll")
  )), [selectedTraits]);
  const rerollAllTraitAnchor = (rerollAllTraits[0] || selectedTrait) as S2TraitLabTrait;
  const rerollAllCostEnergy = traitLabConfig?.rerollAllCostEnergy || S2_TRAIT_LAB_REROLL_ALL_COST;
  const selectedTraitReward = selectedTraitAction === "recycle"
    ? traitLabConfig?.recycleRewards?.[selectedTrait] ?? S2_TRAIT_LAB_RECYCLE_REWARDS[selectedTrait] ?? 0
    : 0;
  const selectedTraitIsEmpty = isEmptyTraitValue(selectedTraitValue);
  const selectedTraitGuaranteedEmpty = selectedTraitIsEmpty && guaranteedTraits.has(selectedTrait);
  const rollLoading = Boolean(actionLoading && !["confirm", "burn-droid", "burn-claim"].includes(actionLoading));
  const burnLoading = actionLoading === "burn-droid";
  const burnClaimLoading = actionLoading === "burn-claim";
  const [rollingAction, rollingTraitType] = rollLoading ? actionLoading.split(":") : ["", ""];
  const droidBurnRewardEnergy = traitLabConfig?.droidBurnRewardEnergy || S2_TRAIT_LAB_DROID_BURN_REWARD_ENERGY;
  const droidBurnEnabled = traitLabConfig?.droidBurnEnabled !== false;
  const burnConfirmationPhrase = selectedTokenId ? `BURN DROID #${selectedTokenId}` : "";
  const pendingBurnStorageKey = walletAddress ? `dyoor:s2:pending-droid-burn:${walletAddress}` : "";
  const pendingTraitLabStorageKey = walletAddress ? `dyoor:s2:pending-trait-lab:${walletAddress}` : "";
  const burnReady = Boolean(
    walletAddress
    && selectedTokenId
    && metadata
    && traitLabConfig?.contractAddress
    && burnConfirmText.trim() === burnConfirmationPhrase,
  );
  const previewCurrentMetadata = preview?.currentMetadata || null;
  const previewProposedMetadata = preview?.proposedMetadata || null;
  const previewBeforeImage = mediaUrl(previewCurrentMetadata?.image || metadata?.image);
  const previewProposedImage = mediaUrl(preview?.imageRecomposition?.previewDataUrl || previewProposedMetadata?.image || previewBeforeImage);
  const previewTraitAssetImage = mediaUrl(preview?.proposedAsset?.uri);
  const previewImageChanged = normalizeTraitValue(previewCurrentMetadata?.image) !== normalizeTraitValue(previewProposedMetadata?.image);
  const previewIsFinalizing = ["confirming", "metadata_committed", "confirmed"].includes(String(preview?.operationStatus || ""));

  useEffect(() => {
    selectedTokenIdRef.current = selectedTokenId;
    const timer = window.setTimeout(() => setBurnConfirmText(""), 0);
    return () => window.clearTimeout(timer);
  }, [selectedTokenId]);

  useEffect(() => {
    if (!metadata || selectedTraitAction) return;
    const nextTrait = S2_TRAIT_LAB_TRAITS.find((trait) => actionForTrait(trait, selectedTraits[trait]));
    if (nextTrait && nextTrait !== selectedTrait) {
      const timer = window.setTimeout(() => {
        setSelectedTrait(nextTrait);
        setSelectedAction(actionForTrait(nextTrait, selectedTraits[nextTrait]));
        setPreview(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [metadata, selectedTrait, selectedTraitAction, selectedTraits]);

  useEffect(() => {
    if (selectedAction === selectedTraitAction) return;
    const timer = window.setTimeout(() => setSelectedAction(selectedTraitAction), 0);
    return () => window.clearTimeout(timer);
  }, [selectedAction, selectedTraitAction]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!pendingBurnStorageKey) {
        setPendingBurnClaim(null);
        return;
      }

      try {
        const raw = getStorageItem(browserLocalStorage(), pendingBurnStorageKey);
        const parsed = raw ? JSON.parse(raw) as PendingBurnClaim : null;
        setPendingBurnClaim(parsed?.wallet === walletAddress && parsed.burnTxHash ? parsed : null);
      } catch {
        setPendingBurnClaim(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingBurnStorageKey, walletAddress]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!pendingTraitLabStorageKey) {
        setPendingTraitLabOperations([]);
        return;
      }

      try {
        const raw = getStorageItem(browserLocalStorage(), pendingTraitLabStorageKey);
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        const operations = currentPendingTraitLabOperations((Array.isArray(parsed) ? parsed : [])
          .filter((item): item is PendingTraitLabOperation => Boolean(
            item
            && typeof item === "object"
            && (item as PendingTraitLabOperation).wallet === walletAddress
            && isTraitLabOperationId((item as PendingTraitLabOperation).rollId)
            && (item as PendingTraitLabOperation).preview?.previewId,
          )));
        persistPendingTraitLabOperations(pendingTraitLabStorageKey, operations);
        setPendingTraitLabOperations(operations);
      } catch {
        setPendingTraitLabOperations([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingTraitLabStorageKey, walletAddress]);

  useEffect(() => {
    let active = true;
    async function loadTraitLabConfig() {
      try {
        const response = await fetch("/api/s2/trait-lab/config", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as TraitLabConfigResponse;
        if (active && response.ok && data.ok !== false) setTraitLabConfig(data);
      } catch {}
    }
    void loadTraitLabConfig();
    return () => {
      active = false;
    };
  }, []);

  const loadEnergy = useCallback(async () => {
    if (!walletAddress) {
      setEnergy(null);
      return;
    }
    setEnergyLoading(true);
    try {
      const response = await fetch(`/api/energy/${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as EnergyResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load Energy balance.");
      setEnergy(data);
    } catch (err) {
      setEnergy({ ok: false, error: err instanceof Error ? err.message : "Could not load Energy balance." });
    } finally {
      setEnergyLoading(false);
    }
  }, [walletAddress]);

  const loadBurnedGallery = useCallback(async () => {
    setBurnedGalleryLoading(true);
    try {
      const response = await fetch("/api/s2/trait-lab/burned-droids", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as BurnedGalleryResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load burned Droid gallery.");
      setBurnedGallery(Array.isArray(data.items) ? data.items : []);
    } catch {
      setBurnedGallery([]);
    } finally {
      setBurnedGalleryLoading(false);
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (!traitLabConfig?.leaderboardEnabled) {
      setLeaderboardRows([]);
      return;
    }
    setLeaderboardLoading(true);
    try {
      const response = await fetch("/api/s2/trait-lab/leaderboard?limit=25", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as TraitLabLeaderboardResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load Trait Lab leaderboard.");
      setLeaderboardRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setLeaderboardRows([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [traitLabConfig?.leaderboardEnabled]);

  const loadTraitBounties = useCallback(async () => {
    if (!traitLabConfig?.bountyEnabled) {
      setTraitBounties([]);
      setTraitBountyWinners([]);
      return;
    }
    setTraitBountyLoading(true);
    try {
      const response = await fetch("/api/s2/trait-lab/bounties", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as TraitBountyResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load Trait Lab bounties.");
      setTraitBounties(Array.isArray(data.bounties) ? data.bounties : []);
      setTraitBountyWinners(Array.isArray(data.settlements) ? data.settlements : []);
    } catch {
      setTraitBounties([]);
      setTraitBountyWinners([]);
    } finally {
      setTraitBountyLoading(false);
    }
  }, [traitLabConfig?.bountyEnabled]);

  const loadTokenMetadata = useCallback(async (tokenId: string) => {
    const requestId = ++metadataRequestRef.current;
    if (!tokenId) {
      if (requestId === metadataRequestRef.current) setMetadata(null);
      return;
    }
    setMetadataLoading(true);
    setPreview(null);
    try {
      const response = await fetch(`/api/metadata/${encodeURIComponent(tokenId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as MetadataJson & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load token metadata.");
      if (requestId !== metadataRequestRef.current || selectedTokenIdRef.current !== tokenId) return;
      setMetadata(data);
      setStatus(`Loaded live metadata for D.Y.O.O.R #${tokenId}.`);
      setError("");
    } catch (err) {
      if (requestId !== metadataRequestRef.current || selectedTokenIdRef.current !== tokenId) return;
      setMetadata(null);
      setError(err instanceof Error ? err.message : "Could not load token metadata.");
    } finally {
      if (requestId === metadataRequestRef.current) setMetadataLoading(false);
    }
  }, []);

  const restoreActiveTraitLabOperation = useCallback(async (tokenId: string, silent = false) => {
    if (!walletAddress || !tokenId) return;
    const requestId = ++activeRestoreRequestRef.current;
    try {
      const response = await fetch(
        `/api/s2/trait-lab/active?wallet=${encodeURIComponent(walletAddress)}&tokenId=${encodeURIComponent(tokenId)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({})) as TraitLabOperationResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not check the current Trait Lab result.");
      if (requestId !== activeRestoreRequestRef.current || selectedTokenIdRef.current !== tokenId) return;
      if (!data.active || !data.retryPreview?.rollId || !data.retryPreview.previewId) {
        setPendingTraitLabOperations((current) => {
          const next = current.filter((item) => item.tokenId !== tokenId);
          persistPendingTraitLabOperations(pendingTraitLabStorageKey, next);
          return next;
        });
        return;
      }

      const recoveredPreview = data.retryPreview;
      const recoveredRollId = String(recoveredPreview.rollId);
      const pending: PendingTraitLabOperation = {
        wallet: walletAddress,
        rollId: recoveredRollId,
        tokenId,
        savedAt: new Date().toISOString(),
        preview: recoveredPreview,
      };
      setPendingTraitLabOperations((current) => {
        const next = currentPendingTraitLabOperations([pending].concat(current.filter((item) => item.tokenId !== tokenId)));
        persistPendingTraitLabOperations(pendingTraitLabStorageKey, next);
        return next;
      });
      setPreview(recoveredPreview);
      setError("");
      setStatus(`Restored D.Y.O.O.R #${tokenId}'s current result from the server. Accept it to finish, or leave it behind if it is not already finalizing.`);
    } catch (restoreError) {
      if (
        !silent
        && requestId === activeRestoreRequestRef.current
        && selectedTokenIdRef.current === tokenId
      ) {
        setError(restoreError instanceof Error ? restoreError.message : "Could not check the current Trait Lab result.");
      }
    }
  }, [pendingTraitLabStorageKey, walletAddress]);

  const loadOwnedTokens = useCallback(async () => {
    if (!walletAddress) {
      setOwnedTokenIds([]);
      setTokenCards([]);
      selectedTokenIdRef.current = "";
      setSelectedTokenId("");
      setMetadata(null);
      setStatus("Connect wallet to load D.Y.O.O.R Season 2 droids.");
      return;
    }

    setOwnedLoading(true);
    setError("");
    try {
      const data = await fetchJsonWithRetry<OwnedResponse>(
        `/api/s2/owned-tokens?wallet=${encodeURIComponent(walletAddress)}`,
        "Could not load owned Season 2 tokens.",
      );
      const tokenIds = Array.from(new Set(Array.isArray(data.tokenIds)
        ? data.tokenIds.map((tokenId) => String(tokenId)).filter(Boolean)
        : []));
      setOwnedTokenIds(tokenIds);
      setStatus(tokenIds.length ? "Select a D.Y.O.O.R Droid" : "No D.Y.O.O.R Season 2 droids found for this wallet.");

      const cards = await mapWithConcurrency(tokenIds.slice(0, 36), TOKEN_CARD_METADATA_CONCURRENCY, async (tokenId) => {
        try {
          const metadataResponse = await fetch(`/api/metadata/${encodeURIComponent(tokenId)}`, { cache: "no-store" });
          const tokenMetadata = await metadataResponse.json().catch(() => ({})) as MetadataJson;
          return {
            tokenId,
            name: tokenTitle(tokenId, tokenMetadata),
            image: mediaUrl(tokenMetadata.image),
          };
        } catch {
          return { tokenId, name: `D.Y.O.O.R #${tokenId}`, image: "" };
        }
      });
      setTokenCards(cards);
      const currentSelected = selectedTokenIdRef.current;
      const nextSelected = currentSelected && tokenIds.includes(currentSelected) ? currentSelected : tokenIds[0] || "";
      selectedTokenIdRef.current = nextSelected;
      setSelectedTokenId(nextSelected);
      if (nextSelected) {
        await loadTokenMetadata(nextSelected);
        if (selectedTokenIdRef.current === nextSelected) {
          await restoreActiveTraitLabOperation(nextSelected, true);
        }
      }
    } catch (err) {
      setOwnedTokenIds([]);
      setTokenCards([]);
      selectedTokenIdRef.current = "";
      setSelectedTokenId("");
      setMetadata(null);
      setError(err instanceof Error ? err.message : "Could not load owned Season 2 tokens.");
    } finally {
      setOwnedLoading(false);
    }
  }, [loadTokenMetadata, restoreActiveTraitLabOperation, walletAddress]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOwnedTokens();
      void loadEnergy();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEnergy, loadOwnedTokens]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBurnedGallery();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBurnedGallery]);

  useEffect(() => {
    if (!traitLabConfig?.leaderboardEnabled) return;
    const timer = window.setTimeout(() => {
      void loadLeaderboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeaderboard, traitLabConfig?.leaderboardEnabled]);

  useEffect(() => {
    if (!traitLabConfig?.bountyEnabled) return;
    const timer = window.setTimeout(() => {
      void loadTraitBounties();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTraitBounties, traitLabConfig?.bountyEnabled]);

  async function connectWallet() {
    setError("");
    await wallet.connect().catch((err) => setError(err instanceof Error ? err.message : "Wallet connection failed."));
  }

  async function selectToken(tokenId: string) {
    selectedTokenIdRef.current = tokenId;
    setSelectedTokenId(tokenId);
    await loadTokenMetadata(tokenId);
    if (selectedTokenIdRef.current === tokenId) {
      await restoreActiveTraitLabOperation(tokenId, true);
    }
  }

  async function refreshConfirmedToken(tokenId: string, fallbackMetadata?: MetadataJson | null) {
    let nextMetadata = fallbackMetadata || metadata;
    try {
      // Event-driven cache buster; this function is only called from async user/recovery flows.
      // eslint-disable-next-line react-hooks/purity
      const response = await fetch(`/api/metadata/${encodeURIComponent(tokenId)}?confirmed=${Date.now()}`, { cache: "no-store" });
      const fresh = await response.json().catch(() => ({})) as MetadataJson & { error?: string };
      if (response.ok && !fresh.error) {
        const fallbackVersion = metadataVersionNumber(nextMetadata);
        const freshVersion = metadataVersionNumber(fresh);
        if (!nextMetadata || freshVersion >= fallbackVersion) nextMetadata = fresh;
      }
    } catch {}

    if (nextMetadata) {
      setMetadata(nextMetadata);
      setTokenCards((cards) => cards.map((card) => card.tokenId === tokenId
        ? {
          ...card,
          name: tokenTitle(tokenId, nextMetadata),
          image: mediaUrl(nextMetadata.image),
        }
        : card));
    }
  }

  async function switchToTraitLabChain() {
    if (!traitLabConfig?.chainHex) return;
    const provider = await wallet.getProvider();
    const currentChain = await provider.request({ method: "eth_chainId" }).catch(() => "");
    if (String(currentChain || "").toLowerCase() === traitLabConfig.chainHex.toLowerCase()) return;

    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: traitLabConfig.chainHex }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: traitLabConfig.chainHex,
          chainName: traitLabConfig.chainName || "Monad",
          rpcUrls: [traitLabConfig.rpcUrl || "https://rpc.monad.xyz"],
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          blockExplorerUrls: [traitLabConfig.explorerUrl || "https://monadscan.com"],
        }],
      });
    }
  }

  async function waitForTransactionReceipt(txHash: string) {
    const provider = await wallet.getProvider();
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] }).catch(() => null) as { status?: string } | null;
      if (receipt) {
        if (String(receipt.status || "").toLowerCase() === "0x0") throw new Error("Roll transaction failed on-chain.");
        return receipt;
      }
      await sleep(1500);
    }
    throw new Error("Roll transaction is still pending. Wait a moment and try again.");
  }

  function savePendingTraitLabOperation(nextPreview: PreviewResponse) {
    if (!walletAddress || !nextPreview.rollId || !nextPreview.previewId || !pendingTraitLabStorageKey) return;
    setPendingTraitLabOperations((current) => {
      const tokenId = String(nextPreview.tokenId || selectedTokenId);
      const next = currentPendingTraitLabOperations([{
        wallet: walletAddress,
        rollId: nextPreview.rollId as string,
        tokenId,
        savedAt: new Date().toISOString(),
        preview: nextPreview,
      }]
        .concat(current.filter((item) => item.tokenId !== tokenId)));
      persistPendingTraitLabOperations(pendingTraitLabStorageKey, next);
      return next;
    });
  }

  function clearPendingTraitLabOperation(rollId: string) {
    if (!rollId) return;
    setPendingTraitLabOperations((current) => {
      const next = current.filter((item) => item.rollId !== rollId);
      persistPendingTraitLabOperations(pendingTraitLabStorageKey, next);
      return next;
    });
  }

  async function recoverPendingTraitLabOperation(item: PendingTraitLabOperation) {
    setOperationRecoveryLoading(item.rollId);
    setError("");
    setStatus(`Checking Trait Lab operation for D.Y.O.O.R #${item.tokenId}.`);
    try {
      const response = await fetch(
        `/api/s2/trait-lab/operations/${encodeURIComponent(item.rollId)}?wallet=${encodeURIComponent(item.wallet)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({})) as TraitLabOperationResponse;
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load Trait Lab operation.");

      if (data.operation?.status === "completed" && data.completion) {
        clearPendingTraitLabOperation(item.rollId);
        await refreshConfirmedToken(item.tokenId, data.completion.metadata || item.preview.proposedMetadata || null);
        await loadEnergy();
        if (traitLabConfig?.leaderboardEnabled) await loadLeaderboard();
        if (traitLabConfig?.bountyEnabled) await loadTraitBounties();
        setStatus(`Recovered completed ${data.operation.action || "Trait Lab"} operation for D.Y.O.O.R #${item.tokenId}.`);
        return;
      }

      if (
        data.operation?.isCurrent === false
        || data.operation?.status === "superseded"
        || data.operation?.status === "forfeited"
      ) {
        clearPendingTraitLabOperation(item.rollId);
        if (preview?.rollId === item.rollId) setPreview(null);
        setStatus(`D.Y.O.O.R #${item.tokenId}'s saved result was already left behind. Only its latest roll can be accepted.`);
        return;
      }

      if (!data.operation?.canRetryConfirmation) {
        throw new Error(data.operation?.lastError
          || (data.operation?.chargeStatus === "pending_or_unverified"
            ? "The Energy spend is still pending or not indexed. Retry recovery shortly."
            : "This operation was not charged. Generate a fresh preview."));
      }

      selectedTokenIdRef.current = item.tokenId;
      setSelectedTokenId(item.tokenId);
      await loadTokenMetadata(item.tokenId);
      const recoveredPreview = data.retryPreview || item.preview;
      setPreview(recoveredPreview);
      savePendingTraitLabOperation(recoveredPreview);
      const finalizing = ["confirming", "metadata_committed", "confirmed"].includes(String(recoveredPreview.operationStatus || ""));
      setStatus(finalizing
        ? `Restored D.Y.O.O.R #${item.tokenId}'s finalizing result. Retry Accept Result to finish it.`
        : `Restored D.Y.O.O.R #${item.tokenId}'s current result. Accept it, leave it, or pay for one new roll that permanently replaces it.`);
    } catch (err) {
      setError(traitLabErrorMessage(err, "Trait Lab recovery failed."));
    } finally {
      setOperationRecoveryLoading("");
    }
  }

  function savePendingBurnClaim(claim: PendingBurnClaim) {
    setStorageJson(browserLocalStorage(), `dyoor:s2:pending-droid-burn:${claim.wallet}`, claim);
    setPendingBurnClaim(claim);
  }

  function clearPendingBurnClaim(claim: PendingBurnClaim) {
    const storage = browserLocalStorage();
    if (storage) {
      const key = `dyoor:s2:pending-droid-burn:${claim.wallet}`;
      const raw = getStorageItem(storage, key);
      try {
        const parsed = raw ? JSON.parse(raw) as PendingBurnClaim : null;
        if (!parsed || parsed.burnTxHash === claim.burnTxHash) removeStorageItem(storage, key);
      } catch {
        removeStorageItem(storage, key);
      }
    }
    setPendingBurnClaim(null);
  }

  async function submitDroidBurnRewardClaim(claim: PendingBurnClaim) {
    const response = await fetch("/api/s2/trait-lab/burn-droid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: claim.wallet,
        tokenId: claim.tokenId,
        burnTxHash: claim.burnTxHash,
      }),
    });
    const data = await response.json().catch(() => ({})) as {
      ok?: boolean;
      error?: string;
      rewardEnergy?: number;
      rewardTxHash?: string;
      burnRecord?: BurnedDroidCard;
    };
    if (!response.ok || data.ok === false) throw new Error(data.error || "Droid burn reward failed.");

    clearPendingBurnClaim(claim);
    setOwnedTokenIds((tokenIds) => tokenIds.filter((tokenId) => tokenId !== claim.tokenId));
    setTokenCards((cards) => cards.filter((card) => card.tokenId !== claim.tokenId));
    if (selectedTokenIdRef.current === claim.tokenId) {
      selectedTokenIdRef.current = "";
      setSelectedTokenId("");
      setMetadata(null);
    }
    setBurnConfirmText("");
    await Promise.all([loadEnergy(), loadBurnedGallery()]);
    setStatus(`D.Y.O.O.R #${claim.tokenId} burned. ${(data.rewardEnergy || droidBurnRewardEnergy).toLocaleString()} Energy credited.`);
  }

  async function claimPendingDroidBurnReward() {
    if (!pendingBurnClaim) return;
    setActionLoading("burn-claim");
    setError("");
    setStatus("Verifying confirmed burn and retrying Energy reward.");
    try {
      await submitDroidBurnRewardClaim(pendingBurnClaim);
    } catch (err) {
      setError(`${traitLabErrorMessage(err, "Droid burn reward claim failed.")} The NFT is already burned; use Claim / Retry after a minute, do not burn again.`);
    } finally {
      setActionLoading("");
    }
  }

  async function activeProviderWallet() {
    const provider = await wallet.getProvider();
    const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []) as string[];
    return normalizeAddress(accounts?.[0]);
  }

  async function previewChange(traitType: S2TraitLabTrait, action: S2TraitLabAction) {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!selectedTokenId) return;

    const effectiveMode: S2TraitLabPaymentMode = "energy";
    const key = `${action}:${traitType}`;
    setActionLoading(key);
    setPreview(null);
    setError("");
    setStatus(action === "recycle"
      ? "Sign to authorize the trait recycle preview."
      : action === "rerollAll"
        ? "Sign to authorize Reroll All. This signature is gasless."
      : "Sign to authorize the roll. This signature is gasless.");
    try {
      const authorizationTimestamp = String(Date.now());
      const authorizationNonce = crypto.randomUUID();
      const authorizationSignature = await wallet.signMessage(traitLabPreviewAuthorizationMessage({
        wallet: walletAddress,
        tokenId: selectedTokenId,
        traitType,
        action: canonicalTraitLabPreviewAction(action),
        timestamp: authorizationTimestamp,
        nonce: authorizationNonce,
      }));
      setStatus(action === "recycle"
        ? "Preparing trait recycle preview."
        : action === "rerollAll"
          ? "Settling Energy instantly and generating a Reroll All bundle."
          : "Settling Energy instantly and generating roll.");
      const response = await fetch("/api/s2/trait-lab/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          tokenId: selectedTokenId,
          traitType,
          action,
          paymentMode: effectiveMode,
          authorizationTimestamp,
          authorizationNonce,
          authorizationSignature,
        }),
      });
      const data = await response.json().catch(() => ({})) as PreviewResponse;
      if (!response.ok || data.ok === false) {
        if (data.recoveryRequired && data.recoveryPreview?.rollId) {
          setPreview(data.recoveryPreview);
          savePendingTraitLabOperation(data.recoveryPreview);
          setStatus(`Restored D.Y.O.O.R #${data.recoveryPreview.tokenId || selectedTokenId}'s current result. Accept it to finish recovery.`);
          const restoredTrait = String(data.recoveryPreview.traitType || "earlier");
          throw new Error(
            `Your ${traitType} roll was not created or charged. The panel below is the saved ${restoredTrait} result that must be finished first.`,
          );
        }
        throw new Error(data.error || "Preview failed.");
      }
      setPreview(data);
      savePendingTraitLabOperation(data);
      setStatus(action === "unlock"
        ? "Unlock roll ready. Energy settled instantly with no blockchain transaction."
        : action === "remove"
          ? "Remove trait preview ready."
        : action === "recycle"
            ? "Recycle preview ready."
            : action === "rerollAll"
              ? "Reroll All ready. Energy settled instantly with no blockchain transaction."
            : "Reroll ready. Energy settled instantly with no blockchain transaction.");
      if (data.paymentMode === "energy") await loadEnergy();
    } catch (err) {
      setError(traitLabErrorMessage(err, "Preview failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function confirmChange() {
    if (!preview?.previewId || !preview.rollId || !walletAddress || !selectedTokenId) return;
    setActionLoading("confirm");
    setError("");
    try {
      // Confirmation challenges must be fresh at the moment of the wallet action.
      // eslint-disable-next-line react-hooks/purity
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const message = traitLabConfirmationAuthorizationMessage({
        wallet: walletAddress,
        tokenId: selectedTokenId,
        traitType: String(preview.traitType || ""),
        action: String(preview.action || ""),
        paymentMode: String(preview.paymentMode || ""),
        proposedValue: String(preview.proposedValue || ""),
        costLabel: String(preview.costLabel || ""),
        costRaw: String(preview.costRaw || ""),
        rewardLabel: preview.rewardLabel,
        rewardRaw: preview.rewardRaw,
        previewId: preview.previewId,
        timestamp,
        nonce,
      });
      const signature = await wallet.signMessage(message);
      const response = await fetch("/api/s2/trait-lab/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          tokenId: selectedTokenId,
          traitType: preview.traitType,
          action: preview.action,
          paymentMode: preview.paymentMode,
          previewId: preview.previewId,
          timestamp,
          nonce,
          signature,
        }),
      });
      const data = await response.json().catch(() => ({})) as PreviewResponse & { metadata?: MetadataJson };
      if (!response.ok || data.ok === false) throw new Error(data.error || "Confirm failed.");
      await refreshConfirmedToken(selectedTokenId, data.metadata || preview.proposedMetadata || metadata);
      clearPendingTraitLabOperation(preview.rollId);
      setPreview(null);
      await loadEnergy();
      if (traitLabConfig?.leaderboardEnabled) await loadLeaderboard();
      if (traitLabConfig?.bountyEnabled) await loadTraitBounties();
      const openSeaStatus = data.openSeaMetadataRefresh?.status;
      scheduleOpenSeaRefreshProcessor(data.openSeaMetadataRefresh);
      const immediateOpenSeaStatus = data.openSeaMetadataRefresh?.immediate?.status;
      const openSeaSuffix = openSeaStatus === "scheduled" && immediateOpenSeaStatus === "queued"
        ? " OpenSea refresh fired; follow-up refresh scheduled."
        : openSeaStatus === "scheduled"
          ? " OpenSea follow-up refresh scheduled."
        : openSeaStatus === "queued"
          ? " OpenSea refresh queued."
        : openSeaStatus === "failed"
          ? " OpenSea refresh needs a retry."
          : "";
      const bountyWins = (data.bountySettlements || []).filter((item) => (
        item.status === "settled" || item.status === "deduped"
      ));
      const bountyPending = (data.bountySettlements || []).some((item) => item.status === "pending");
      const bountySuffix = bountyWins.length
        ? ` Bounty won: ${bountyWins.map((item) => `${item.bountyLabel || item.traitValue} (+${item.rewardEnergy || "0"} Energy)`).join(", ")}.`
        : bountyPending
          ? " Matching bounty payout is queued for automatic retry."
          : "";
      setStatus(`${data.action === "recycle" ? "Trait recycled. Energy reward credited." : "Metadata Version updated. Trait supply updated."}${bountySuffix}${openSeaSuffix}`);
    } catch (err) {
      setError(traitLabErrorMessage(err, "Confirm failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function leaveCurrentResult() {
    if (!preview?.previewId || !preview.rollId || !walletAddress) return;
    const tokenId = String(preview.tokenId || selectedTokenId);
    setActionLoading("forfeit");
    setError("");
    setStatus(`Sign to leave D.Y.O.O.R #${tokenId}'s current result behind. This cannot be undone.`);
    try {
      // Leave-result authorizations must be fresh at the moment of the wallet action.
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const signature = await wallet.signMessage(traitLabForfeitAuthorizationMessage({
        wallet: walletAddress,
        tokenId,
        rollId: preview.rollId,
        previewId: preview.previewId,
        timestamp,
        nonce,
      }));
      const response = await fetch("/api/s2/trait-lab/forfeit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          tokenId,
          rollId: preview.rollId,
          previewId: preview.previewId,
          timestamp,
          nonce,
          signature,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        status?: string;
        error?: string;
      };
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not leave this result.");
      clearPendingTraitLabOperation(preview.rollId);
      setPreview(null);
      setStatus(`Result left behind for D.Y.O.O.R #${tokenId}. Its current metadata was not changed.`);
    } catch (err) {
      setError(traitLabErrorMessage(err, "Could not leave this result."));
    } finally {
      setActionLoading("");
    }
  }

  function scheduleOpenSeaRefreshProcessor(refresh?: PreviewResponse["openSeaMetadataRefresh"]) {
    if (!refresh || refresh.status !== "scheduled") return;
    const runAtMs = refresh.runAt ? Date.parse(refresh.runAt) : 0;
    const delayMs = refresh.runAt && Number.isFinite(runAtMs)
      // This scheduler runs only after a confirmed user action.
      // eslint-disable-next-line react-hooks/purity
      ? Math.max(5_000, runAtMs - Date.now() + 2_500)
      : Math.max(5_000, Number(refresh.delayMs || 120_000) + 2_500);
    window.setTimeout(() => {
      void fetch("/api/s2/trait-lab/opensea-refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "trait-lab-client" }),
      }).catch(() => undefined);
    }, Math.min(delayMs, 10 * 60_000));
  }

  async function burnSelectedDroid() {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!selectedTokenId || !metadata) {
      setError("Select a Droid before burning.");
      return;
    }
    if (!traitLabConfig?.contractAddress) {
      setError("Season 2 contract address is not configured.");
      return;
    }
    if (burnConfirmText.trim() !== burnConfirmationPhrase) {
      setError(`Type ${burnConfirmationPhrase} to confirm this permanent burn.`);
      return;
    }

    const tokenIdBeingBurned = selectedTokenId;
    let savedClaim: PendingBurnClaim | null = null;
    setActionLoading("burn-droid");
    setPreview(null);
    setError("");
    try {
      await switchToTraitLabChain();
      const activeWallet = await activeProviderWallet();
      if (!activeWallet) {
        throw new Error("Wallet provider did not return an active account. Reconnect wallet and try again.");
      }
      if (activeWallet !== walletAddress) {
        throw new Error(`Wallet account changed. Switch wallet to ${shortAddress(walletAddress)} before burning. Active wallet is ${shortAddress(activeWallet)}.`);
      }

      setStatus(`Confirm permanent burn for D.Y.O.O.R #${tokenIdBeingBurned}. This cannot be undone.`);
      const burnTxHash = await wallet.sendTransaction({
        from: walletAddress,
        to: traitLabConfig.contractAddress,
        value: "0x0",
        data: encodeFunctionData({
          abi: S2_DROID_BURN_ABI,
          functionName: "burn",
          args: [BigInt(tokenIdBeingBurned)],
        }),
      });
      savedClaim = {
        wallet: walletAddress,
        tokenId: tokenIdBeingBurned,
        burnTxHash,
        createdAt: new Date().toISOString(),
      };
      savePendingBurnClaim(savedClaim);
      setStatus("Droid burn sent. Waiting for on-chain confirmation.");
      await waitForTransactionReceipt(burnTxHash);

      setStatus(`Burn confirmed. Crediting ${droidBurnRewardEnergy.toLocaleString()} Energy.`);
      if (!savedClaim) throw new Error("Burn transaction was not saved for reward claim.");
      const confirmedClaim = {
        ...savedClaim,
        confirmedAt: new Date().toISOString(),
      };
      savedClaim = confirmedClaim;
      savePendingBurnClaim(confirmedClaim);
      await submitDroidBurnRewardClaim(confirmedClaim);
    } catch (err) {
      const message = traitLabErrorMessage(err, "Droid burn failed.");
      setError(savedClaim
        ? `${message} The burn transaction is saved below for retry. Do not burn again.`
        : message);
    } finally {
      setActionLoading("");
    }
  }

  const alertTone = error ? "danger" : actionLoading || ownedLoading || metadataLoading ? "busy" : status.includes("updated") ? "success" : "idle";

  return (
    <PageShell size="wide" className="space-y-7">
      <SectionHeader
        eyebrow="Season 2 Dynamic Metadata"
        title="D.Y.O.O.R Trait Lab"
        copy="Reroll filled traits, upgrade base droids by unlocking empty trait slots, and spend Energy through server-verified ownership."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {traitLabConfig?.leaderboardEnabled ? (
              <a
                className="btn-secondary inline-flex min-h-11 items-center justify-center px-4 text-xs"
                href="#trait-lab-leaderboard"
              >
                View Leaderboard
              </a>
            ) : null}
            <WalletButton />
          </div>
        )}
      />

      <Alert tone={alertTone}>{error || status}</Alert>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Wallet Connect Status" value={walletAddress ? shortAddress(walletAddress) : "Disconnected"} />
        <StatCard label="Energy Balance" value={energyLoading ? "Loading" : energy?.spendableEnergy || "-"} />
        <StatCard label="Spent Energy" value={energyLoading ? "Loading" : energy?.spentEnergy || "-"} />
        <StatCard label="Owned Droids" value={ownedLoading ? "Loading" : ownedTokenIds.length.toString()} />
        <StatCard label="Metadata Version" value={metadataLoading ? "Loading" : metadata ? metadataVersion(metadata) : "-"} />
      </section>

      {energy?.energyBankSyncPending ? (
        <Alert tone="danger">
          Energy Bank sync is pending for this wallet. Indexed spendable Energy is {energy.ledgerSpendableEnergy || "-"}, but only {energy.spendableEnergy || "0"} Energy is currently spendable for rerolls. Missing spendable Energy: {energy.missingSpendableEnergy || "0"}.
        </Alert>
      ) : null}

      {pendingTraitLabOperations.length ? (
        <Card className="border-dyoor-cyan/25 bg-dyoor-cyan/[0.07] p-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="eyebrow text-dyoor-cyan">Interrupted Roll Recovery</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">
                {pendingTraitLabOperations.length === 1 ? "Restore Current Result" : "Restore Current Results"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/62">
                This is crash protection, not roll history. Only the latest result for each Droid remains valid; accepting, leaving, or rolling again permanently closes the previous result.
              </p>
            </div>
            <span className="w-fit rounded-full border border-dyoor-cyan/30 bg-black/30 px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-dyoor-cyan">
              Latest Result Only
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {pendingTraitLabOperations.map((item) => (
              <div
                key={item.rollId}
                className="grid gap-3 rounded border border-yellow-200/20 bg-black/25 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black uppercase text-white">
                    D.Y.O.O.R #{item.tokenId} · {item.preview.action === "rerollAll" ? "Reroll All" : item.preview.action || "Trait Change"}
                    {item.preview.traitType && item.preview.action !== "rerollAll" ? ` · ${item.preview.traitType}` : ""}
                  </p>
                  <p className="mt-1 truncate text-xs font-bold text-white/45">
                    Current result · {item.rollId.slice(0, 10)}…{item.rollId.slice(-8)} · Saved {new Date(item.savedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.preview.paymentTxHash ? (
                    <a
                      className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-dyoor-cyan"
                      href={`${traitLabConfig?.explorerUrl || "https://monadscan.com"}/tx/${item.preview.paymentTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Energy Tx
                    </a>
                  ) : null}
                  <Button
                    variant="primary"
                    disabled={Boolean(operationRecoveryLoading || actionLoading)}
                    onClick={() => void recoverPendingTraitLabOperation(item)}
                  >
                    {operationRecoveryLoading === item.rollId ? "Checking" : "Restore Current Result"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <section className="grid scroll-mt-24 gap-5 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.55fr)]" id="trait-workbench">
        <Card className="p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Owned Tokens</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Select a D.Y.O.O.R Droid</h2>
            </div>
            <Button variant="secondary" disabled={!walletAddress || ownedLoading} onClick={() => void loadOwnedTokens()}>
              Refresh
            </Button>
          </div>

          <div className="mt-5">
            {!walletAddress ? (
              <EmptyState
                title="Wallet Required"
                copy="Connect wallet to verify Season 2 token ownership."
                action={<Button variant="primary" onClick={() => void connectWallet()}>Connect Wallet</Button>}
              />
            ) : ownedLoading ? (
              <LoadingSkeleton lines={8} />
            ) : tokenCards.length ? (
              <div className="grid max-h-[42rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {tokenCards.map((token) => {
                  const active = token.tokenId === selectedTokenId;
                  return (
                    <button
                      key={token.tokenId}
                      type="button"
                      className={`overflow-hidden rounded border text-left transition ${
                        active
                          ? "border-dyoor-cyan bg-dyoor-cyan/10 shadow-[0_0_24px_rgba(57,255,226,.16)]"
                          : "border-white/10 bg-white/[0.035] hover:border-dyoor-purple/45"
                      }`}
                      onClick={() => void selectToken(token.tokenId)}
                    >
                      <div className="aspect-square bg-black/45">
                        {token.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={token.name} className="h-full w-full object-cover" src={token.image} />
                        ) : (
                          <div className="grid h-full place-items-center text-xs font-black uppercase tracking-[0.16em] text-white/35">No Image</div>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="truncate text-sm font-black text-white">{token.name}</p>
                        <p className="mt-1 text-xs font-bold text-white/45">#{token.tokenId}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No Droids Found" copy="Server-side ownership check found no Season 2 droids for this wallet." />
            )}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card strong className="overflow-hidden">
            <div className="grid gap-4 p-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
              <div className="overflow-hidden rounded border border-dyoor-cyan/20 bg-black/45 xl:self-start">
                <div className="aspect-square">
                  {metadataLoading ? (
                    <div className="grid h-full place-items-center p-4"><LoadingSkeleton lines={4} /></div>
                  ) : selectedImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={metadata?.name || "D.Y.O.O.R Droid"} className="h-full w-full object-cover" src={selectedImage} />
                  ) : (
                    <div className="grid h-full place-items-center text-sm font-black uppercase tracking-[0.18em] text-white/35">No Droid Selected</div>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                  <div>
                    <p className="eyebrow">Live Metadata</p>
                    <h2 className="mt-1 break-words text-2xl font-black uppercase leading-tight text-white">{metadata?.name || "D.Y.O.O.R Droid"}</h2>
                    <p className="mt-1 text-sm font-semibold text-white/52">Metadata Version <span className="text-dyoor-cyan">{metadata ? metadataVersion(metadata) : "-"}</span></p>
                  </div>
                  {baseDroidDetected ? (
                    <span className="rounded border border-yellow-300/35 bg-yellow-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-yellow-100">
                      Base Droid Detected
                    </span>
                  ) : null}
                </div>

                <Alert tone="idle" className="mt-3 py-3">Locked traits cannot be changed.</Alert>
                <p className="mt-2 text-xs font-semibold leading-5 text-dyoor-cyan/75">
                  MetaMask will show a <span className="font-black text-dyoor-cyan">Signature request</span> to authorize a roll or accept a result.
                  It is not a blockchain transaction: there is no gas fee, MON charge, or contract confirmation.
                </p>

                <div className="mt-3 rounded border border-dyoor-cyan/20 bg-black/30 p-3">
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Selected Slot</p>
                      <div className="min-h-11 rounded border border-white/10 bg-white/[0.035] px-3 py-2.5">
                        <p className="truncate text-sm font-black text-white">{selectedTrait}: {displayTraitValue(selectedTraitValue)}</p>
                        <p className={`mt-1 break-words text-[0.62rem] font-black uppercase leading-4 tracking-[0.1em] ${selectedTraitIsEmpty ? "text-yellow-100" : "text-dyoor-cyan"}`}>
                          {selectedTraitGuaranteedEmpty ? "Guaranteed trait" : selectedTraitActions.length ? "Choose Reroll, Unlock, or Recycle" : "Unavailable"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                      {rerollAllTraits.length ? (
                        <Button
                          className="w-full px-3 py-2.5 text-[0.7rem] leading-tight"
                          disabled={!metadata || Boolean(actionLoading) || previewIsFinalizing}
                          variant="secondary"
                          onClick={() => {
                            setSelectedAction("rerollAll");
                            void previewChange(rerollAllTraitAnchor, "rerollAll");
                          }}
                        >
                          {actionLoading === `rerollAll:${rerollAllTraitAnchor}`
                            ? "Rerolling All"
                            : `Reroll All Filled (${rerollAllTraits.length}) · ${rerollAllCostEnergy} Energy`}
                        </Button>
                      ) : null}
                      {selectedTraitActions.length ? selectedTraitActions.map((action) => {
                        const loading = actionLoading === `${action}:${selectedTrait}`;
                        const actionCost = action === "recycle" && selectedTraitReward
                          ? `Earn ${selectedTraitReward} Energy`
                          : costFor(selectedTrait, action);
                        return (
                          <Button
                            key={action}
                            className="w-full px-3 py-2.5 text-[0.7rem] leading-tight"
                            disabled={!metadata || Boolean(actionLoading) || previewIsFinalizing}
                            variant={action === "unlock" ? "primary" : "secondary"}
                            onClick={() => {
                              setSelectedAction(action);
                              void previewChange(selectedTrait, action);
                            }}
                          >
                            {loading ? actionVerb(action) : `${actionLabel(action)} · ${actionCost || "-"}`}
                          </Button>
                        );
                      }) : (
                        <Button className="w-full px-3 py-2.5 text-[0.7rem] leading-tight" disabled variant="secondary">
                          {selectedTraitGuaranteedEmpty ? "Guaranteed" : "Unavailable"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/45">
                    {selectedTraitGuaranteedEmpty
                        ? "Eyes and Mouth are guaranteed mint traits, so empty values are not unlockable in Trait Lab."
                        : selectedTraitIsEmpty
                          ? "Rolling spends the selected payment method and creates one approved unlock result."
                          : selectedTraitAction === "recycle"
                            ? "Recycling burns this optional trait, clears the slot to None, and awards Energy after Accept Result."
                          : selectedTraitAction === "remove"
                            ? "Removing spends the selected payment method and clears this optional trait to None."
                            : "Rolling spends Energy and creates one compatible reroll result."}
                    {rerollAllTraits.length ? " Reroll All only includes filled mutable slots; empty Stickers/Body art stays excluded until unlocked." : ""}
                  </p>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                  {S2_REQUIRED_TRAITS.map((trait) => {
                    const value = selectedTraits[trait];
                    const locked = lockedTraits.has(trait);
                    const guaranteed = guaranteedTraits.has(trait);
                    const empty = isEmptyTraitValue(value);
                    const action = actionForTrait(trait, value);
                    const selected = trait === selectedTrait;
                    const selectable = !locked && Boolean(action);
                    return (
                      <button
                        key={trait}
                        type="button"
                        disabled={!selectable || Boolean(actionLoading)}
                        className={`min-w-0 rounded border p-3 text-left transition ${
                          selected
                            ? "border-dyoor-cyan bg-dyoor-cyan/12 shadow-[0_0_18px_rgba(57,255,226,.12)]"
                            : locked
                              ? "border-dyoor-cyan/18 bg-black/25"
                              : "border-white/10 bg-white/[0.035] hover:border-dyoor-cyan/35"
                        } disabled:cursor-not-allowed`}
                        onClick={() => {
                          if (!selectable) return;
                          const nextTrait = trait as S2TraitLabTrait;
                          setSelectedTrait(nextTrait);
                          setSelectedAction(actionForTrait(nextTrait, value));
                          setPreview(null);
                        }}
                      >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <p className="truncate text-xs font-black uppercase tracking-[0.16em] text-white/52">{trait}</p>
                          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.56rem] font-black uppercase tracking-[0.1em] ${
                            locked
                              ? "border-dyoor-cyan/25 text-dyoor-cyan"
                              : guaranteed && empty
                                ? "border-white/20 text-white/45"
                              : empty
                                ? "border-yellow-300/25 text-yellow-100"
                                : "border-emerald-300/25 text-emerald-100"
                          }`}>
                            {locked ? "Locked" : guaranteed && empty ? "Guaranteed" : empty ? "Empty" : "Filled"}
                          </span>
                        </div>
                        <p className={`mt-2 truncate text-sm font-black ${empty ? "text-yellow-100" : "text-white"}`}>
                          {displayTraitValue(value)}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {droidBurnEnabled ? (
                  <div className="mt-4 rounded border border-red-400/35 bg-red-500/10 p-4">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,0.6fr)] xl:items-end">
                      <div>
                        <p className="eyebrow text-red-100">Permanent Burn</p>
                        <h3 className="mt-2 text-xl font-black uppercase text-white">Burn Droid for Energy</h3>
                        <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
                          Burning sends the selected NFT to the zero address, removes it from your wallet, and cannot be undone. OpenSea supply and media refresh can take a few minutes after confirmation.
                        </p>
                        <div className="mt-3 inline-flex rounded border border-dyoor-cyan/30 bg-dyoor-cyan/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-dyoor-cyan">
                          Reward: {droidBurnRewardEnergy.toLocaleString()} Energy
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <label className="grid gap-2">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Type To Confirm</span>
                          <input
                            className="field-control min-h-11 py-2.5 text-sm font-black uppercase"
                            disabled={!selectedTokenId || Boolean(actionLoading)}
                            placeholder={burnConfirmationPhrase || "Select a Droid first"}
                            value={burnConfirmText}
                            onChange={(event) => setBurnConfirmText(event.target.value)}
                          />
                        </label>
                        <Button
                          className="w-full py-2.5"
                          disabled={!burnReady || Boolean(actionLoading)}
                          variant="secondary"
                          onClick={() => void burnSelectedDroid()}
                        >
                          {burnLoading ? "Burning" : `Burn Droid + ${droidBurnRewardEnergy.toLocaleString()} Energy`}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <p className="eyebrow">Before / After</p>
                <h2 className="mt-2 text-2xl font-black uppercase text-white">Metadata Preview</h2>
              </div>
              {preview ? (
                <div className="rounded border border-dyoor-cyan/30 bg-dyoor-cyan/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-dyoor-cyan">
                  {preview.action === "recycle"
                    ? `Energy Reward: ${preview.rewardLabel || preview.costLabel || "Pending"}`
                    : `Spend Energy: ${preview.costLabel || `${preview.costEnergy || 0} Energy`}`}
                </div>
              ) : null}
            </div>

            {rollLoading && !preview ? (
              <RollProgress
                action={rollingAction}
                traitType={rollingTraitType || selectedTrait}
              />
            ) : !preview ? (
              <EmptyState className="mt-5" title="No Roll Active" copy="Select Reroll, Unlock Slot, or Recycle Trait on an eligible slot." />
            ) : (
              <div className="mt-5 grid gap-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-white/42">Trait</p>
                    <p className="mt-2 text-xl font-black text-white">{preview.action === "rerollAll" ? "All Filled Traits" : preview.traitType}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-white/42">Before</p>
                    <p className="mt-2 text-xl font-black text-white">{preview.previousValue}</p>
                  </div>
                  <div className="rounded border border-dyoor-cyan/30 bg-dyoor-cyan/10 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-dyoor-cyan">After</p>
                    <p className="mt-2 text-xl font-black text-white">{preview.proposedValue}</p>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded border border-white/10 bg-black/25">
                    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-white/45">Current Image</p>
                      <span className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/35">V{metadataVersion(previewCurrentMetadata)}</span>
                    </div>
                    <LayerPreview fallbackImage={previewBeforeImage} metadata={previewCurrentMetadata} title="Current D.Y.O.O.R preview" />
                  </div>

                  <div className="overflow-hidden rounded border border-dyoor-magenta/25 bg-dyoor-magenta/10">
                    <div className="flex items-center justify-between gap-3 border-b border-dyoor-magenta/20 px-3 py-2">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-dyoor-magenta">Proposed Image</p>
                      <span className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-yellow-100">
                        {previewImageChanged ? "Full Render Updated" : "Metadata Only"}
                      </span>
                    </div>
                    <LayerPreview fallbackImage={previewProposedImage} metadata={previewProposedMetadata} title="Proposed D.Y.O.O.R preview" />
                    <div className="grid gap-3 border-t border-dyoor-magenta/20 p-3 xl:grid-cols-[11rem_minmax(0,1fr)]">
                      <div className="grid content-start gap-2">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">Rarity</p>
                        <p className="text-lg font-black text-white">{preview.proposedAsset?.rarity || "Unlisted"}</p>
                        {preview.action === "recycle" && preview.rewardLabel ? (
                          <div className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/10 px-3 py-2">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-dyoor-cyan">Recycle Reward</p>
                            <p className="mt-1 text-lg font-black text-white">{preview.rewardLabel}</p>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-2 gap-2 text-xs font-bold text-white/58">
                          <span>Initial</span>
                          <span className="text-right text-white">{preview.proposedAsset?.initialSupply || "-"}</span>
                          <span>Max Active</span>
                          <span className="text-right text-white">{preview.proposedAsset?.maxActiveSupply || "-"}</span>
                          <span>Weight</span>
                          <span className="text-right text-white">{preview.proposedAsset?.weight || "-"}</span>
                        </div>
                        {previewTraitAssetImage ? (
                          <a className="mt-2 truncate text-xs font-black uppercase tracking-[0.12em] text-dyoor-magenta underline-offset-4 hover:underline" href={previewTraitAssetImage} target="_blank" rel="noreferrer">
                            Trait Asset
                          </a>
                        ) : null}
                        {preview.paymentTxHash ? (
                          <a
                            className="truncate text-xs font-black uppercase tracking-[0.12em] text-dyoor-cyan underline-offset-4 hover:underline"
                            href={`${traitLabConfig?.explorerUrl || "https://monadscan.com"}/tx/${preview.paymentTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {preview.action === "recycle" ? "Reward Tx" : "Roll Tx"}
                          </a>
                        ) : null}
                        {preview.paymentBurnTxHash ? (
                          <a
                            className="truncate text-xs font-black uppercase tracking-[0.12em] text-yellow-100 underline-offset-4 hover:underline"
                            href={`${traitLabConfig?.explorerUrl || "https://monadscan.com"}/tx/${preview.paymentBurnTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Burn Tx
                          </a>
                        ) : null}
                      </div>
                      <div className="grid content-start gap-3">
                        {preview.supplyDeltas?.length ? (
                          <div className="rounded border border-white/10 bg-black/20 p-3">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">Pending Supply Impact</p>
                            <p className="mt-1 text-[0.68rem] font-bold leading-4 text-white/42">
                              Trait supply changes are recorded only after Accept Result.
                            </p>
                            <div className="mt-2 grid gap-1">
                              {preview.supplyDeltas.map((delta) => (
                                <div key={`${delta.reason}:${delta.traitType}:${delta.value}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 text-xs font-bold">
                                  <span className={delta.reason === "burn" ? "text-yellow-100" : "text-dyoor-cyan"}>{supplyDeltaLabel(delta)}</span>
                                  <span className="truncate text-white/72">{delta.traitType}: {delta.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {!previewIsFinalizing && preview.traitType && preview.action && preview.action !== "remove" && preview.action !== "recycle" ? (
                          <div className="rounded border border-yellow-300/20 bg-yellow-300/[0.06] p-3">
                            <p className="text-[0.65rem] font-bold leading-5 text-yellow-50/62">
                              Rolling again spends Energy and permanently replaces this result. You cannot come back to it.
                            </p>
                            <Button
                              className="mt-3 w-full py-2 text-xs"
                              disabled={Boolean(actionLoading)}
                              variant="secondary"
                              onClick={() => void previewChange(preview.traitType as S2TraitLabTrait, preview.action as S2TraitLabAction)}
                            >
                              {actionLoading === `${preview.action}:${preview.traitType}`
                                ? "Rolling"
                              : preview.action === "rerollAll" ? `Leave + Reroll All · ${preview.costLabel || "Cost"}` : preview.action === "reroll" ? `Leave + Reroll · ${preview.costLabel || "Cost"}` : `Leave + Roll Again · ${preview.costLabel || "Cost"}`}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded border border-white/10">
                  {rows.map((row) => (
                    <div key={row.trait} className={`grid gap-2 border-b border-white/10 p-3 text-sm last:border-b-0 md:grid-cols-[9rem_1fr_1fr] ${row.changed ? "bg-dyoor-cyan/10" : "bg-black/20"}`}>
                      <p className="font-black uppercase tracking-[0.12em] text-white/48">{row.trait}</p>
                      <p className="break-words font-bold text-white/68">{row.before}</p>
                      <p className={`break-words font-bold ${row.changed ? "text-dyoor-cyan" : "text-white/68"}`}>{row.after}</p>
                    </div>
                  ))}
                </div>

                <details className="rounded border border-white/10 bg-black/30">
                  <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/58">
                    Metadata JSON
                  </summary>
                  <div className="grid gap-3 border-t border-white/10 p-3 lg:grid-cols-2">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/40">Before</p>
                      <pre className="max-h-80 overflow-auto rounded border border-white/10 bg-black/45 p-3 text-xs leading-5 text-white/62">{metadataJson(previewCurrentMetadata)}</pre>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-dyoor-cyan">After</p>
                      <pre className="max-h-80 overflow-auto rounded border border-dyoor-cyan/20 bg-dyoor-cyan/10 p-3 text-xs leading-5 text-white/72">{metadataJson(previewProposedMetadata)}</pre>
                    </div>
                  </div>
                </details>

                <div className="rounded border border-dyoor-cyan/20 bg-dyoor-cyan/[0.055] p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-dyoor-cyan">One live result · no roll history</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/48">
                    {previewIsFinalizing
                      ? "This result was already accepted and is finishing its saved metadata operation. Retry Accept Result to complete recovery; it can no longer be left or replaced."
                      : "Accept this result, leave it permanently, or pay to roll again. Once left or replaced, this result cannot be restored."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="primary" disabled={Boolean(actionLoading)} onClick={() => void confirmChange()}>
                      {actionLoading === "confirm" ? "Accepting" : preview.action === "recycle" ? "Accept Recycle" : preview.action === "rerollAll" ? "Accept Reroll All" : "Accept Result"}
                    </Button>
                    {!previewIsFinalizing ? (
                      <Button variant="secondary" disabled={Boolean(actionLoading)} onClick={() => void leaveCurrentResult()}>
                        {actionLoading === "forfeit" ? "Leaving" : "Leave Result"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </section>

      <Card className="scroll-mt-24 p-5" id="trait-bounties">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">Verified Rewards + Encrypted Signals</p>
            <h2 className="mt-2 text-2xl font-black uppercase text-white">Trait Bounties</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/58">
              Signals tease catalog traits that have not appeared in issued metadata. A signal is intelligence only; Energy is payable only when a campaign card is marked active and the on-chain payout engine verifies the completed reveal.
            </p>
          </div>
          {traitLabConfig?.bountyEnabled ? (
            <Button variant="secondary" disabled={traitBountyLoading} onClick={() => void loadTraitBounties()}>
              {traitBountyLoading ? "Loading" : "Refresh"}
            </Button>
          ) : null}
        </div>

        <div className="bounty-signal-shell mt-5 overflow-hidden rounded-2xl border border-dyoor-purple/35 bg-[#050611]">
          <div className="relative z-[2] flex flex-col justify-between gap-3 border-b border-white/10 bg-black/30 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dyoor-cyan opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-dyoor-cyan shadow-[0_0_16px_rgba(57,255,226,.95)]" />
              </span>
              <div>
                <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-dyoor-cyan">Encrypted Discovery Feed</p>
                <p className="mt-1 text-sm font-black uppercase tracking-[0.08em] text-white">
                  {traitRevealAudit.unrevealed.length} Classified {traitRevealAudit.unrevealed.length === 1 ? "Signal Detected" : "Signals Detected"}
                </p>
              </div>
            </div>
            <p className="text-[0.62rem] font-black uppercase leading-5 tracking-[0.14em] text-white/40 sm:text-right">
              {traitRevealAudit.scanned.successful.toLocaleString()} metadata nodes scanned · {traitRevealAudit.scanned.failed} failures
              <span className="block text-white/25">Audit locked {traitRevealAudit.displayDate}</span>
            </p>
          </div>

          <div className="relative z-[2] p-3 sm:p-5">
            {traitRevealAudit.unrevealed.map((signal, index) => {
              const teaserImage = bountyTeaserImages[signal.imageAsset];
              const activeSignalBounty = traitBounties.find((bounty) => (
                bounty.status === "active"
                && bounty.traitType === signal.traitType
                && bounty.traitValue === signal.traitValue
              ));
              return (
                <article className="bounty-signal-card group overflow-hidden rounded-xl border border-dyoor-cyan/30" key={signal.id}>
                  <div className="relative grid min-h-[31rem] overflow-hidden bg-[#070818] lg:grid-cols-[minmax(0,1.16fr)_minmax(23rem,0.84fr)]">
                    <div className="relative min-h-[24rem] overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_52%_46%,rgba(57,255,226,.28),transparent_28%),radial-gradient(circle_at_78%_22%,rgba(255,79,227,.26),transparent_31%),linear-gradient(145deg,#15103c,#070818_64%)] lg:min-h-[31rem] lg:border-b-0 lg:border-r">
                      <div aria-hidden="true" className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-dyoor-purple/25 blur-3xl" />
                      <div aria-hidden="true" className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-dyoor-magenta/15 blur-3xl" />
                      {teaserImage ? (
                        <Image
                          alt="Holographic preview of an undiscovered orange headwear trait."
                          className="bounty-signal-art object-cover object-center brightness-[0.9] saturate-[1.12] drop-shadow-[0_0_32px_rgba(57,255,226,.18)] transition duration-700 group-hover:scale-[1.035] group-hover:brightness-105"
                          fill
                          priority
                          sizes="(min-width: 1024px) 52vw, 94vw"
                          src={teaserImage}
                        />
                      ) : null}

                      <div aria-hidden="true" className="bounty-signal-grid absolute inset-0 opacity-45" />
                      <div aria-hidden="true" className="bounty-signal-scan absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-dyoor-cyan/20 to-transparent blur-sm" />
                      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,8,24,.76),transparent_22%,transparent_74%,rgba(7,8,24,.64)),linear-gradient(0deg,rgba(7,8,24,.86),transparent_40%)]" />

                      <span aria-hidden="true" className="absolute left-4 top-4 h-9 w-9 border-l-2 border-t-2 border-dyoor-cyan/75" />
                      <span aria-hidden="true" className="absolute right-4 top-4 h-9 w-9 border-r-2 border-t-2 border-dyoor-magenta/70" />
                      <span aria-hidden="true" className="absolute bottom-4 left-4 h-9 w-9 border-b-2 border-l-2 border-dyoor-magenta/70" />
                      <span aria-hidden="true" className="absolute bottom-4 right-4 h-9 w-9 border-b-2 border-r-2 border-dyoor-cyan/75" />

                      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-6">
                        <span className="rounded-full border border-dyoor-cyan/40 bg-black/60 px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan shadow-[0_0_22px_rgba(57,255,226,.14)] backdrop-blur">
                          Signal {String(index + 1).padStart(2, "0")} · Visual Fragment
                        </span>
                        <span className="rounded-full border border-dyoor-magenta/40 bg-dyoor-magenta/10 px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.18em] text-pink-100 shadow-[0_0_22px_rgba(255,79,227,.14)] backdrop-blur">
                          {signal.rarity}
                        </span>
                      </div>

                      <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                        <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-dyoor-cyan/80">Identity Encryption Active</p>
                        <p className="mt-2 bg-gradient-to-r from-white via-dyoor-cyan to-dyoor-magenta bg-clip-text text-4xl font-black uppercase tracking-[0.08em] text-transparent drop-shadow-[0_0_28px_rgba(57,255,226,.2)] sm:text-5xl">
                          {signal.maskedLabel}
                        </p>
                      </div>
                    </div>

                    <div className="relative flex flex-col justify-center overflow-hidden p-6 sm:p-8 lg:p-10">
                      <div aria-hidden="true" className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-dyoor-purple/20 blur-3xl" />
                      <div aria-hidden="true" className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-dyoor-cyan/10 blur-3xl" />
                      <div className="relative">
                        <p className="text-[0.62rem] font-black uppercase tracking-[0.24em] text-dyoor-magenta">First Finder Protocol</p>
                        <h3 className="mt-3 text-3xl font-black uppercase leading-[0.95] text-white sm:text-4xl">
                          The first reveal writes collection history.
                        </h3>
                        <p className="mt-5 text-sm font-bold leading-7 text-white/62">{signal.hint}</p>

                        <div className="mt-6 grid grid-cols-3 gap-2">
                          {[
                            ["Discoveries", "0"],
                            ["Pool Weight", String(signal.weight)],
                            ["Rarity", signal.rarity],
                          ].map(([label, value]) => (
                            <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]" key={label}>
                              <p className="text-[0.55rem] font-black uppercase leading-4 tracking-[0.14em] text-white/34">{label}</p>
                              <p className="mt-2 truncate text-lg font-black text-white">{value}</p>
                            </div>
                          ))}
                        </div>

                        <div className={`mt-6 rounded-lg border p-4 ${activeSignalBounty ? "border-dyoor-cyan/40 bg-dyoor-cyan/10" : "border-yellow-300/25 bg-yellow-300/[0.07]"}`}>
                          <p className={`text-[0.62rem] font-black uppercase tracking-[0.18em] ${activeSignalBounty ? "text-dyoor-cyan" : "text-yellow-100"}`}>
                            {activeSignalBounty ? `Bounty Live · +${activeSignalBounty.rewardEnergy} Energy` : "Signal Only · Bounty Not Armed"}
                          </p>
                          <p className="mt-2 text-xs font-semibold leading-5 text-white/48">
                            {activeSignalBounty
                              ? "Land the matching trait through an eligible completed operation to enter on-chain settlement."
                              : "Hunt the signal now. Energy becomes payable only if the owner activates a matching on-chain campaign."}
                          </p>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center gap-3">
                          <a className="btn-primary bounty-signal-cta min-w-44" href="#trait-workbench">
                            Enter The Hunt
                          </a>
                          <span className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-white/28">Trait Lab · Monad Mainnet</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="relative z-[2] overflow-hidden border-t border-white/10 bg-black/55 py-2">
            <div className="bounty-signal-ticker flex w-max items-center gap-10 whitespace-nowrap text-[0.58rem] font-black uppercase tracking-[0.2em] text-white/34">
              {[0, 1].map((copy) => (
                <div className="flex items-center gap-10" aria-hidden={copy === 1} key={copy}>
                  <span className="text-dyoor-cyan">Signal 01 Online</span>
                  <span>Mythic Frequency Detected</span>
                  <span className="text-dyoor-magenta">0 Confirmed Discoveries</span>
                  <span>Next Transmission Locked</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {traitLabConfig?.bountyEnabled ? (
          <>
            <div className="mt-6 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-dyoor-cyan">On-Chain Campaigns</p>
                <h3 className="mt-1 text-lg font-black uppercase text-white">Live Reveal Rewards</h3>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {traitBountyLoading && !traitBounties.length ? (
                <div className="md:col-span-2 xl:col-span-3"><LoadingSkeleton lines={4} /></div>
              ) : traitBounties.filter((bounty) => (
                bounty.status === "active" || bounty.status === "upcoming"
              )).length ? traitBounties.filter((bounty) => (
                bounty.status === "active" || bounty.status === "upcoming"
              )).map((bounty) => (
                <div className="rounded border border-dyoor-purple/25 bg-black/30 p-4" key={bounty.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">{bounty.label}</p>
                      <h3 className="mt-2 text-lg font-black text-dyoor-cyan">{bounty.traitType}: {bounty.traitValue}</h3>
                    </div>
                    <span className={`rounded border px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] ${bounty.status === "active" ? "border-dyoor-cyan/35 bg-dyoor-cyan/10 text-dyoor-cyan" : "border-yellow-300/25 bg-yellow-300/10 text-yellow-100"}`}>
                      {bounty.status}
                    </span>
                  </div>
                  <p className="mt-4 text-3xl font-black text-white">+{bounty.rewardEnergy} <span className="text-sm uppercase text-white/45">Energy</span></p>
                  <div className="mt-4 grid gap-2 text-xs font-bold text-white/55 sm:grid-cols-2">
                    <span>Remaining: <strong className="text-white">{bounty.remainingClaims}/{bounty.maxClaims}</strong></span>
                    <span>Wallet cap: <strong className="text-white">{bounty.perWalletLimit}</strong></span>
                    <span>Droid cap: <strong className="text-white">{bounty.perTokenLimit}</strong></span>
                    <span>Actions: <strong className="text-white">{bounty.actions.join(", ")}</strong></span>
                  </div>
                  <div className="mt-3 border-t border-white/10 pt-3 text-[0.68rem] font-semibold leading-5 text-white/38">
                    {bounty.status === "upcoming" && bounty.startsAt ? <p>Starts {new Date(bounty.startsAt).toLocaleString()}</p> : null}
                    <p>{bounty.endsAt ? `Ends ${new Date(bounty.endsAt).toLocaleString()}` : "No scheduled end"}</p>
                  </div>
                </div>
              )) : (
                <div className="md:col-span-2 xl:col-span-3">
                  <EmptyState title="No Active Bounties" copy="The owner can publish a new immutable campaign from the Admin Command Center." />
                </div>
              )}
            </div>

            {traitBountyWinners.length ? (
              <div className="mt-6 overflow-x-auto rounded border border-white/10">
                <div className="grid min-w-[46rem] grid-cols-[minmax(9rem,1fr)_8rem_5rem_minmax(12rem,1.4fr)_7rem] gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2 text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/40">
                  <span>Campaign</span>
                  <span>Wallet</span>
                  <span>Droid</span>
                  <span>Reveal</span>
                  <span>Reward</span>
                </div>
                {traitBountyWinners.slice(0, 15).map((winner) => (
                  <div
                    className="grid min-w-[46rem] grid-cols-[minmax(9rem,1fr)_8rem_5rem_minmax(12rem,1.4fr)_7rem] gap-2 border-b border-white/10 px-3 py-3 text-sm font-bold text-white/65 last:border-b-0"
                    key={winner.settlementKey}
                  >
                    <span className="font-black text-white">{winner.bountyLabel}</span>
                    <span>{shortAddress(winner.wallet)}</span>
                    <span>#{winner.tokenId}</span>
                    <span className="text-dyoor-cyan">{winner.traitType}: {winner.traitValue}</span>
                    <span className="font-black text-white">+{winner.rewardEnergy}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <Alert className="mt-5" tone="idle">
            <strong className="text-white">No live payout campaign.</strong> The signal above is a preview, not a promise of Energy, until the owner publishes and activates an on-chain bounty.
          </Alert>
        )}
      </Card>

      {traitLabConfig?.leaderboardEnabled ? (
        <Card className="scroll-mt-24 p-5" id="trait-lab-leaderboard">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="eyebrow">Completed Operations Only</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Trait Lab Leaderboard</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/58">
                Rankings count durable completed Trait Lab records. Paid previews, failed confirmations, and recovery-pending operations never contribute.
              </p>
            </div>
            <Button variant="secondary" disabled={leaderboardLoading} onClick={() => void loadLeaderboard()}>
              {leaderboardLoading ? "Loading" : "Refresh"}
            </Button>
          </div>
          <div className="mt-5">
            {leaderboardLoading && !leaderboardRows.length ? (
              <LoadingSkeleton lines={5} />
            ) : leaderboardRows.length ? (
              <div className="overflow-x-auto rounded border border-white/10">
                <div className="grid min-w-[46rem] grid-cols-[4rem_minmax(10rem,1fr)_7rem_6rem_6rem_6rem] gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2 text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/40">
                  <span>Rank</span>
                  <span>Wallet</span>
                  <span>Completed</span>
                  <span>Rerolls</span>
                  <span>Unlocks</span>
                  <span>Recycles</span>
                </div>
                {leaderboardRows.map((row) => (
                  <div
                    key={row.wallet}
                    className="grid min-w-[46rem] grid-cols-[4rem_minmax(10rem,1fr)_7rem_6rem_6rem_6rem] gap-2 border-b border-white/10 px-3 py-3 text-sm font-bold text-white/68 last:border-b-0"
                  >
                    <span className="font-black text-dyoor-cyan">#{row.rank}</span>
                    <span>{shortAddress(row.wallet)}</span>
                    <span className="text-white">{row.completedOperations}</span>
                    <span>{row.rerolls + row.rerollAlls}</span>
                    <span>{row.unlocks}</span>
                    <span>{row.recycles}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No Completed Operations" copy="The leaderboard will populate after completed Trait Lab changes are recorded." />
            )}
          </div>
        </Card>
      ) : null}

      {pendingBurnClaim ? (
        <Card className="border-yellow-300/30 bg-yellow-400/10 p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <p className="eyebrow text-yellow-100">Burn Reward Recovery</p>
              <h2 className="mt-2 text-2xl font-black uppercase text-white">Claim Pending Burn Energy</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/62">
                D.Y.O.O.R #{pendingBurnClaim.tokenId} has a saved burn transaction. If the first reward step failed because of RPC indexing or a refresh, retry the verified reward claim here. Do not burn another Droid for this claim.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em]">
                <span className="rounded border border-yellow-200/25 bg-yellow-200/10 px-3 py-2 text-yellow-100">Reward: {droidBurnRewardEnergy.toLocaleString()} Energy</span>
                <a
                  className="rounded border border-dyoor-cyan/25 bg-dyoor-cyan/10 px-3 py-2 text-dyoor-cyan underline-offset-4 hover:underline"
                  href={`${traitLabConfig?.explorerUrl || "https://monadscan.com"}/tx/${pendingBurnClaim.burnTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Burn Tx
                </a>
              </div>
            </div>
            <Button className="w-full lg:w-auto" disabled={burnClaimLoading} variant="primary" onClick={() => void claimPendingDroidBurnReward()}>
              {burnClaimLoading ? "Claiming" : `Claim / Retry ${droidBurnRewardEnergy.toLocaleString()} Energy`}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="eyebrow text-red-100">Burn Archive</p>
            <h2 className="mt-2 text-2xl font-black uppercase text-white">Burned Gallery</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/58">
              Permanently burned D.Y.O.O.R Season 2 NFTs appear here after the burn transaction is verified and the Energy reward is credited.
            </p>
          </div>
          <Button variant="secondary" disabled={burnedGalleryLoading} onClick={() => void loadBurnedGallery()}>
            {burnedGalleryLoading ? "Loading" : "Refresh Gallery"}
          </Button>
        </div>

        <div className="mt-5">
          {burnedGalleryLoading && !burnedGallery.length ? (
            <LoadingSkeleton lines={4} />
          ) : burnedGallery.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {burnedGallery.map((item) => (
                <a
                  key={`${item.tokenId}:${item.burnTxHash}`}
                  className="group overflow-hidden rounded border border-red-300/20 bg-red-500/10 transition hover:border-red-300/45"
                  href={`${traitLabConfig?.explorerUrl || "https://monadscan.com"}/tx/${item.burnTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="relative aspect-square bg-black/50">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={item.name || `Burned D.Y.O.O.R #${item.tokenId}`} className="h-full w-full object-cover grayscale" src={mediaUrl(item.image)} />
                    ) : (
                      <div className="grid h-full place-items-center text-xs font-black uppercase tracking-[0.16em] text-white/35">No Image</div>
                    )}
                    <div className="absolute inset-0 bg-black/35" />
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 -rotate-6 border-y border-red-300/45 bg-red-600/70 py-2 text-center text-2xl font-black uppercase tracking-[0.18em] text-red-50 shadow-[0_0_24px_rgba(248,113,113,.35)]">
                      Wasted
                    </div>
                  </div>
                  <div className="grid gap-1 p-3">
                    <p className="truncate text-sm font-black text-white">{item.name || `D.Y.O.O.R #${item.tokenId}`}</p>
                    <p className="text-xs font-bold text-white/45">#{item.tokenId} · {item.rewardLabel || `${droidBurnRewardEnergy.toLocaleString()} Energy`}</p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState title="No Burned Droids Yet" copy="Burned Droids will appear here after verified burn reward claims." />
          )}
        </div>
      </Card>
    </PageShell>
  );
}
