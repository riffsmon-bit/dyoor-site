"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData } from "viem";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
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
  rollCharged?: boolean;
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
  rerollAllCostEnergy?: number;
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
  const [burnedGalleryLoading, setBurnedGalleryLoading] = useState(false);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [status, setStatus] = useState("Connect wallet to load D.Y.O.O.R Season 2 droids.");
  const [error, setError] = useState("");
  const selectedTokenIdRef = useRef("");

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
        const raw = window.localStorage.getItem(pendingBurnStorageKey);
        const parsed = raw ? JSON.parse(raw) as PendingBurnClaim : null;
        setPendingBurnClaim(parsed?.wallet === walletAddress && parsed.burnTxHash ? parsed : null);
      } catch {
        setPendingBurnClaim(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingBurnStorageKey, walletAddress]);

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

  const loadTokenMetadata = useCallback(async (tokenId: string) => {
    if (!tokenId) {
      setMetadata(null);
      return;
    }
    setMetadataLoading(true);
    setPreview(null);
    try {
      const response = await fetch(`/api/metadata/${encodeURIComponent(tokenId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as MetadataJson & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load token metadata.");
      setMetadata(data);
      setStatus(`Loaded live metadata for D.Y.O.O.R #${tokenId}.`);
      setError("");
    } catch (err) {
      setMetadata(null);
      setError(err instanceof Error ? err.message : "Could not load token metadata.");
    } finally {
      setMetadataLoading(false);
    }
  }, []);

  const loadOwnedTokens = useCallback(async () => {
    if (!walletAddress) {
      setOwnedTokenIds([]);
      setTokenCards([]);
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
      setSelectedTokenId(nextSelected);
      if (nextSelected) await loadTokenMetadata(nextSelected);
    } catch (err) {
      setOwnedTokenIds([]);
      setTokenCards([]);
      setSelectedTokenId("");
      setMetadata(null);
      setError(err instanceof Error ? err.message : "Could not load owned Season 2 tokens.");
    } finally {
      setOwnedLoading(false);
    }
  }, [loadTokenMetadata, walletAddress]);

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

  async function connectWallet() {
    setError("");
    await wallet.connect().catch((err) => setError(err instanceof Error ? err.message : "Wallet connection failed."));
  }

  async function selectToken(tokenId: string) {
    setSelectedTokenId(tokenId);
    await loadTokenMetadata(tokenId);
  }

  async function refreshConfirmedToken(tokenId: string, fallbackMetadata?: MetadataJson | null) {
    let nextMetadata = fallbackMetadata || metadata;
    try {
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

  function savePendingBurnClaim(claim: PendingBurnClaim) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`dyoor:s2:pending-droid-burn:${claim.wallet}`, JSON.stringify(claim));
    }
    setPendingBurnClaim(claim);
  }

  function clearPendingBurnClaim(claim: PendingBurnClaim) {
    if (typeof window !== "undefined") {
      const key = `dyoor:s2:pending-droid-burn:${claim.wallet}`;
      const raw = window.localStorage.getItem(key);
      try {
        const parsed = raw ? JSON.parse(raw) as PendingBurnClaim : null;
        if (!parsed || parsed.burnTxHash === claim.burnTxHash) window.localStorage.removeItem(key);
      } catch {
        window.localStorage.removeItem(key);
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
      ? "Preparing trait recycle preview."
      : action === "rerollAll"
        ? "Spending Energy and generating a Reroll All bundle."
      : "Spending Energy and generating roll.");
    try {
      const payment = {};
      let response: Response | null = null;
      let data = {} as PreviewResponse;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        response = await fetch("/api/s2/trait-lab/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            wallet: walletAddress,
            tokenId: selectedTokenId,
            traitType,
            action,
            paymentMode: effectiveMode,
            ...payment,
          }),
        });
        data = await response.json().catch(() => ({})) as PreviewResponse;
        if (!(response.status === 409 && ("paymentTxHash" in payment))) break;
        setStatus("Waiting for roll transaction to index.");
        await sleep(1500);
      }
      if (!response) throw new Error("Preview failed.");
      if (!response.ok || data.ok === false) throw new Error(data.error || "Preview failed.");
      setPreview(data);
      setStatus(action === "unlock"
        ? "Unlock roll ready."
        : action === "remove"
          ? "Remove trait preview ready."
          : action === "recycle"
            ? "Recycle preview ready."
            : action === "rerollAll"
              ? "Reroll All ready."
            : "Reroll ready.");
      if (data.paymentMode === "energy") await loadEnergy();
    } catch (err) {
      setError(traitLabErrorMessage(err, "Preview failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function confirmChange() {
    if (!preview?.previewId || !preview.confirmation || !walletAddress || !selectedTokenId) return;
    setActionLoading("confirm");
    setError("");
    try {
      const signature = await wallet.signMessage(preview.confirmation.message);
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
          timestamp: preview.confirmation.timestamp,
          nonce: preview.confirmation.nonce,
          signature,
        }),
      });
      const data = await response.json().catch(() => ({})) as PreviewResponse & { metadata?: MetadataJson };
      if (!response.ok || data.ok === false) throw new Error(data.error || "Confirm failed.");
      await refreshConfirmedToken(selectedTokenId, data.metadata || preview.proposedMetadata || metadata);
      setPreview(null);
      await loadEnergy();
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
      setStatus(`${data.action === "recycle" ? "Trait recycled. Energy reward credited." : "Metadata Version updated. Trait supply updated."}${openSeaSuffix}`);
    } catch (err) {
      setError(traitLabErrorMessage(err, "Confirm failed."));
    } finally {
      setActionLoading("");
    }
  }

  function scheduleOpenSeaRefreshProcessor(refresh?: PreviewResponse["openSeaMetadataRefresh"]) {
    if (!refresh || refresh.status !== "scheduled") return;
    const runAtMs = refresh.runAt ? Date.parse(refresh.runAt) : 0;
    const delayMs = refresh.runAt && Number.isFinite(runAtMs)
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
        actions={<WalletButton />}
      />

      <Alert tone={alertTone}>{error || status}</Alert>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Wallet Connect Status" value={walletAddress ? shortAddress(walletAddress) : "Disconnected"} />
        <StatCard label="Energy Balance" value={energyLoading ? "Loading" : energy?.spendableEnergy || "-"} />
        <StatCard label="Owned Droids" value={ownedLoading ? "Loading" : ownedTokenIds.length.toString()} />
        <StatCard label="Metadata Version" value={metadataLoading ? "Loading" : metadata ? metadataVersion(metadata) : "-"} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.55fr)]">
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
                          disabled={!metadata || Boolean(actionLoading)}
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
                            disabled={!metadata || Boolean(actionLoading)}
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
                            ? "Recycling burns this optional trait, clears the slot to None, and awards Energy after Confirm Change."
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
                              Trait supply changes are recorded only after Confirm Change.
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
                        {preview.traitType && preview.action && preview.action !== "remove" && preview.action !== "recycle" ? (
                          <Button
                            className="w-full py-2 text-xs"
                            disabled={Boolean(actionLoading)}
                            variant="secondary"
                            onClick={() => void previewChange(preview.traitType as S2TraitLabTrait, preview.action as S2TraitLabAction)}
                          >
                            {actionLoading === `${preview.action}:${preview.traitType}`
                              ? "Rolling"
                            : preview.action === "rerollAll" ? `Reroll All Again · ${preview.costLabel || "Cost"}` : preview.action === "reroll" ? `Reroll Again · ${preview.costLabel || "Cost"}` : `Roll Again · ${preview.costLabel || "Cost"}`}
                          </Button>
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

                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" disabled={actionLoading === "confirm"} onClick={() => void confirmChange()}>
                    {actionLoading === "confirm" ? "Confirming" : preview.action === "recycle" ? "Confirm Recycle" : preview.action === "rerollAll" ? "Confirm Reroll All" : "Confirm Change"}
                  </Button>
                  <Button variant="secondary" disabled={actionLoading === "confirm"} onClick={() => setPreview(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </section>

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
