"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
import {
  S2_EDITABLE_TRAITS,
  S2_GUARANTEED_TRAITS,
  S2_LOCKED_TRAITS,
  S2_REQUIRED_TRAITS,
  S2_TRAIT_LAB_COSTS,
  S2_TRAIT_LAB_MON_COSTS,
  S2_UNLOCKABLE_TRAITS,
  type S2EditableTrait,
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
  traitType?: S2EditableTrait;
  action?: S2TraitLabAction;
  paymentMode?: S2TraitLabPaymentMode;
  costEnergy?: number;
  costRaw?: string;
  costMon?: string;
  costLabel?: string;
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
  };
  error?: string;
};

type TraitLabConfigResponse = {
  ok?: boolean;
  treasuryWallet?: string;
  monTestMode?: boolean;
  chainId?: number;
  chainHex?: string;
  chainName?: string;
  rpcUrl?: string;
  explorerUrl?: string;
  energyPerMon?: number;
  flatUnlockCostEnergy?: number;
  specialMaxActiveSupply?: number;
  guaranteedTraits?: readonly string[];
  unlockableTraits?: readonly string[];
  monCosts?: Record<S2TraitLabAction, Record<string, string>>;
  error?: string;
};

const editableTraits = new Set<string>(S2_EDITABLE_TRAITS);
const lockedTraits = new Set<string>(S2_LOCKED_TRAITS);
const guaranteedTraits = new Set<string>(S2_GUARANTEED_TRAITS);
const unlockableTraits = new Set<string>(S2_UNLOCKABLE_TRAITS);
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

function actionForTrait(traitType: string, value: unknown): S2TraitLabAction | "" {
  if (!editableTraits.has(traitType)) return "";
  if (isEmptyTraitValue(value)) return unlockableTraits.has(traitType) ? "unlock" : "";
  return "reroll";
}

function costFor(traitType: string, action: S2TraitLabAction | "", paymentMode: S2TraitLabPaymentMode) {
  if (!action || !editableTraits.has(traitType)) return null;
  if (paymentMode === "mon") return `${S2_TRAIT_LAB_MON_COSTS[action][traitType as S2EditableTrait]} MON`;
  return `${S2_TRAIT_LAB_COSTS[action][traitType as S2EditableTrait]} Energy`;
}

function tokenTitle(tokenId: string, metadata?: MetadataJson | null) {
  return metadata?.name || `D.Y.O.O.R #${tokenId}`;
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

function hexQuantity(value: bigint) {
  return `0x${value.toString(16)}`;
}

function parseMonRaw(value: string) {
  const raw = String(value || "0").trim();
  if (!/^\d+(\.\d{0,18})?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
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
    ipfsUrl(fullLayerCid, ["layers", folder, `${rawName}.png`]),
    ipfsUrl(fullLayerCid, ["layers", folder, `${rawName}.PNG`]),
    ipfsUrl(fullLayerCid, [folder, `${rawName}.png`]),
    ipfsUrl(fullLayerCid, [folder, `${rawName}.PNG`]),
    ipfsUrl(traitItemImageCid, [slug]),
    localLayerUrl(traitType, value),
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
  return (
    <div className="aspect-square bg-black/45">
      {fallbackImage || layers.length ? (
        <div className="relative h-full w-full overflow-hidden bg-black/35">
          {fallbackImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={title} className="absolute inset-0 h-full w-full object-cover" src={fallbackImage} />
          ) : null}
          {layers.map((layer, index) => (
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
          ))}
        </div>
      ) : (
        <div className="grid h-full place-items-center text-xs font-black uppercase tracking-[0.16em] text-white/35">No Image</div>
      )}
    </div>
  );
}

function RollProgress({
  action,
  paymentMode,
  traitType,
}: {
  action?: string;
  paymentMode?: S2TraitLabPaymentMode;
  traitType?: string;
}) {
  const actionLabel = action === "unlock" ? "Rolling unlock" : "Rolling reroll";
  const paymentLabel = paymentMode === "mon" ? "MON transaction" : "Energy spend";

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
            Generating a compatible {traitType || "trait"} result and preserving the current metadata view.
          </p>
          <div className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/56 sm:grid-cols-2">
            <div className="rounded border border-white/10 bg-black/30 px-3 py-2">
              <span className="text-white/35">Trait</span>
              <span className="ml-2 text-white">{traitType || "-"}</span>
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
  const [paymentMode, setPaymentMode] = useState<S2TraitLabPaymentMode>("energy");
  const [selectedTrait, setSelectedTrait] = useState<S2EditableTrait>("Eyes");
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
  const monPaymentVisible = true;
  const selectedTraitValue = selectedTraits[selectedTrait];
  const selectedTraitAction = actionForTrait(selectedTrait, selectedTraitValue) as S2TraitLabAction;
  const selectedTraitMonCost = selectedTraitAction
    ? traitLabConfig?.monCosts?.[selectedTraitAction]?.[selectedTrait] ?? S2_TRAIT_LAB_MON_COSTS[selectedTraitAction][selectedTrait]
    : "0";
  const selectedTraitCost = paymentMode === "mon" && selectedTraitAction ? `${selectedTraitMonCost} MON` : costFor(selectedTrait, selectedTraitAction, paymentMode);
  const selectedTraitIsEmpty = isEmptyTraitValue(selectedTraitValue);
  const selectedTraitGuaranteedEmpty = selectedTraitIsEmpty && guaranteedTraits.has(selectedTrait);
  const selectedTraitLoading = actionLoading === `${selectedTraitAction}:${selectedTrait}`;
  const rollLoading = Boolean(actionLoading && actionLoading !== "confirm");
  const [rollingAction, rollingTraitType] = rollLoading ? actionLoading.split(":") : ["", ""];
  const previewCurrentMetadata = preview?.currentMetadata || null;
  const previewProposedMetadata = preview?.proposedMetadata || null;
  const previewBeforeImage = mediaUrl(previewCurrentMetadata?.image || metadata?.image);
  const previewTraitAssetImage = mediaUrl(preview?.proposedAsset?.uri);
  const previewImageChanged = normalizeTraitValue(previewCurrentMetadata?.image) !== normalizeTraitValue(previewProposedMetadata?.image);
  const paymentOptions = monPaymentVisible
    ? [
      { value: "energy" as const, label: "Spend Energy" },
      { value: "mon" as const, label: "Spend MON" },
    ]
    : [{ value: "energy" as const, label: "Spend Energy" }];

  useEffect(() => {
    selectedTokenIdRef.current = selectedTokenId;
  }, [selectedTokenId]);

  useEffect(() => {
    if (monPaymentVisible || paymentMode !== "mon") return;
    const timer = window.setTimeout(() => setPaymentMode("energy"), 0);
    return () => window.clearTimeout(timer);
  }, [monPaymentVisible, paymentMode]);

  useEffect(() => {
    if (!metadata || selectedTraitAction) return;
    const nextTrait = S2_EDITABLE_TRAITS.find((trait) => actionForTrait(trait, selectedTraits[trait]));
    if (nextTrait && nextTrait !== selectedTrait) {
      const timer = window.setTimeout(() => {
        setSelectedTrait(nextTrait);
        setPreview(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [metadata, selectedTrait, selectedTraitAction, selectedTraits]);

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

      const cards = await Promise.all(tokenIds.slice(0, 36).map(async (tokenId) => {
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
      }));
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

  async function sendTraitLabMonPayment(traitType: S2EditableTrait, action: S2TraitLabAction) {
    const treasuryWallet = normalizeAddress(traitLabConfig?.treasuryWallet);
    if (!treasuryWallet) throw new Error("Trait Lab treasury wallet is not configured.");
    await switchToTraitLabChain();

    const monCost = traitLabConfig?.monCosts?.[action]?.[traitType] ?? S2_TRAIT_LAB_MON_COSTS[action][traitType];
    const amountRaw = parseMonRaw(monCost);
    setStatus(`Confirm wallet transaction for this ${action} roll.`);
    const txHash = await wallet.sendTransaction({
      from: walletAddress,
      to: treasuryWallet,
      value: hexQuantity(amountRaw),
    });
    setStatus("Roll transaction sent. Waiting for confirmation.");
    await waitForTransactionReceipt(txHash);
    return txHash;
  }

  async function previewChange(traitType: S2EditableTrait, action: S2TraitLabAction, mode: S2TraitLabPaymentMode = paymentMode) {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!selectedTokenId) return;

    const key = `${action}:${traitType}`;
    setActionLoading(key);
    setPreview(null);
    setError("");
    setStatus(mode === "mon" ? "Preparing MON roll transaction." : "Spending Energy and generating roll.");
    try {
      const paymentTxHash = mode === "mon" ? await sendTraitLabMonPayment(traitType, action) : "";
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
            paymentMode: mode,
            ...(paymentTxHash ? { paymentTxHash } : {}),
          }),
        });
        data = await response.json().catch(() => ({})) as PreviewResponse;
        if (!(response.status === 409 && paymentTxHash)) break;
        setStatus("Waiting for roll transaction to index.");
        await sleep(1500);
      }
      if (!response) throw new Error("Preview failed.");
      if (!response.ok || data.ok === false) throw new Error(data.error || "Preview failed.");
      setPreview(data);
      setStatus(action === "unlock" ? "Unlock roll ready." : "Reroll ready.");
      if (data.paymentMode === "energy") await loadEnergy();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
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
      setStatus("Metadata Version updated. Trait supply updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed.");
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

                <div className="mt-3 hidden gap-2 rounded border border-white/10 bg-white/[0.035] p-2 sm:grid sm:grid-cols-2">
                  <button
                    type="button"
                    className={`rounded border px-3 py-2.5 text-xs font-black uppercase tracking-[0.12em] transition ${
                      paymentMode === "energy"
                        ? "border-dyoor-cyan bg-dyoor-cyan text-black"
                        : "border-white/10 bg-black/30 text-white/60 hover:border-dyoor-cyan/40 hover:text-dyoor-cyan"
                    }`}
                    onClick={() => setPaymentMode("energy")}
                  >
                    Spend Energy
                  </button>
                  {monPaymentVisible ? (
                    <button
                      type="button"
                      className={`rounded border px-3 py-2.5 text-xs font-black uppercase tracking-[0.12em] transition ${
                        paymentMode === "mon"
                          ? "border-dyoor-magenta bg-dyoor-magenta text-black"
                          : "border-white/10 bg-black/30 text-white/60 hover:border-dyoor-magenta/60 hover:text-dyoor-magenta"
                      }`}
                      onClick={() => setPaymentMode("mon")}
                    >
                      Spend MON
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 rounded border border-dyoor-cyan/20 bg-black/30 p-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,0.72fr)_minmax(0,1fr)_auto] lg:items-end">
                    <label className="grid gap-2">
                      <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Trait</span>
                      <select
                        className="field-control min-h-11 py-2.5 text-sm font-black uppercase"
                        value={selectedTrait}
                        onChange={(event) => {
                          setSelectedTrait(event.target.value as S2EditableTrait);
                          setPreview(null);
                        }}
                      >
                        {S2_EDITABLE_TRAITS.map((trait) => (
                          <option key={trait} value={trait}>{trait}</option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2">
                      <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Payment</span>
                      <select
                        className="field-control min-h-11 py-2.5 text-sm font-black uppercase"
                        value={paymentMode}
                        onChange={(event) => {
                          setPaymentMode(event.target.value as S2TraitLabPaymentMode);
                          setPreview(null);
                        }}
                      >
                        {paymentOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <div className="grid gap-2">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Selected Slot</p>
                      <div className="min-h-11 rounded border border-white/10 bg-white/[0.035] px-3 py-2.5">
                        <p className="truncate text-sm font-black text-white">{displayTraitValue(selectedTraitValue)}</p>
                        <p className={`mt-1 text-[0.65rem] font-black uppercase tracking-[0.14em] ${selectedTraitIsEmpty ? "text-yellow-100" : "text-dyoor-cyan"}`}>
                          {selectedTraitGuaranteedEmpty ? "Guaranteed trait" : selectedTraitIsEmpty ? "Unlock Trait Slot" : "Reroll Available"} / {selectedTraitCost || "-"} per roll
                        </p>
                      </div>
                    </div>

                    <Button
                      className="w-full min-w-[11rem] py-2.5 lg:w-auto"
                      disabled={!metadata || !selectedTraitAction || Boolean(actionLoading)}
                      variant={selectedTraitIsEmpty ? "primary" : "secondary"}
                      onClick={() => void previewChange(selectedTrait, selectedTraitAction)}
                    >
                      {selectedTraitLoading ? "Rolling" : selectedTraitGuaranteedEmpty ? "Guaranteed" : selectedTraitIsEmpty ? "Roll Unlock" : "Roll Reroll"}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-white/45">
                    {selectedTraitGuaranteedEmpty
                      ? "Eyes and Mouth are guaranteed mint traits, so empty values are not unlockable in Trait Lab."
                      : selectedTraitIsEmpty
                      ? "Rolling spends the selected payment method and creates one approved unlock result."
                      : "Rolling spends the selected payment method and creates one compatible reroll result."}
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
                          setSelectedTrait(trait as S2EditableTrait);
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
                  {preview.paymentMode === "mon" ? "MON Transaction" : "Spend Energy"}: {preview.costLabel || `${preview.costEnergy || 0} Energy`}
                </div>
              ) : null}
            </div>

            {rollLoading && !preview ? (
              <RollProgress
                action={rollingAction}
                paymentMode={paymentMode}
                traitType={rollingTraitType || selectedTrait}
              />
            ) : !preview ? (
              <EmptyState className="mt-5" title="No Roll Active" copy="Select Roll Reroll or Roll Unlock on an editable trait." />
            ) : (
              <div className="mt-5 grid gap-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-white/42">Trait</p>
                    <p className="mt-2 text-xl font-black text-white">{preview.traitType}</p>
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
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-dyoor-magenta">Proposed Render + Layer</p>
                      <span className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-yellow-100">
                        {previewImageChanged ? "Composed Image Updated" : "Layer Overlay Preview"}
                      </span>
                    </div>
                    <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_12rem]">
                      <LayerPreview fallbackImage={previewBeforeImage} metadata={previewProposedMetadata} title="Proposed D.Y.O.O.R preview" />
                      <div className="grid content-start gap-2 border-t border-dyoor-magenta/20 p-3 md:border-l md:border-t-0">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">Rarity</p>
                        <p className="text-lg font-black text-white">{preview.proposedAsset?.rarity || "Unlisted"}</p>
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
                            Roll Tx
                          </a>
                        ) : null}
                        {preview.supplyDeltas?.length ? (
                          <div className="mt-2 border-t border-white/10 pt-2">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">Supply Impact</p>
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
                        {preview.traitType && preview.action ? (
                          <Button
                            className="mt-2 w-full py-2 text-xs"
                            disabled={Boolean(actionLoading)}
                            variant="secondary"
                            onClick={() => void previewChange(preview.traitType as S2EditableTrait, preview.action as S2TraitLabAction, preview.paymentMode || paymentMode)}
                          >
                            {actionLoading === `${preview.action}:${preview.traitType}`
                              ? "Rolling"
                              : preview.action === "reroll" ? `Reroll Again · ${preview.costLabel || "Cost"}` : `Roll Again · ${preview.costLabel || "Cost"}`}
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
                    {actionLoading === "confirm" ? "Confirming" : "Confirm Change"}
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
    </PageShell>
  );
}
