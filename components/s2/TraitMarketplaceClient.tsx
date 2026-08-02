/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Card, EmptyState, LoadingSkeleton, PageShell, SectionHeader, StatCard } from "@/components/ui/DyoorUi";
import { WalletButton } from "@/components/wallet/WalletButton";
import {
  S2_TRAIT_MARKETPLACE_RARITIES,
  S2_TRAIT_MARKETPLACE_SLOTS,
  type S2TraitMarketplacePaymentMode,
  type S2TraitMarketplaceRarity,
  type S2TraitMarketplaceSlot,
} from "@/lib/s2-trait-marketplace-config";
import { traitMarketplaceQuoteAuthorizationMessage } from "@/lib/s2-trait-marketplace-auth";
import { getStorageItem, removeStorageItem, setStorageJson } from "@/lib/browser-storage";
import { describeEvmChain, isMonadMainnetChain, MONAD_MAINNET_CHAIN_ID } from "@/lib/monad";
import { useWalletService } from "@/providers/WalletServiceProvider";

type MetadataJson = {
  name?: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
  [key: string]: unknown;
};

type MarketplaceListing = {
  listingId: string;
  traitId: number;
  traitType: S2TraitMarketplaceSlot;
  value: string;
  rarity: S2TraitMarketplaceRarity;
  image: string;
  initialSupply: number;
  activeSupply: number;
  burnedSupply: number;
  reservedSupply: number;
  maxActiveSupply: number;
  availableSupply: number;
  soldOut: boolean;
  priceEnergy: number;
  priceEnergyRaw: string;
  priceMon: string;
  priceMonRaw: string;
};

type MarketplaceCatalog = {
  ok?: boolean;
  chainId?: number;
  chainHex?: string;
  chainName?: string;
  rpcUrl?: string;
  explorerUrl?: string;
  treasuryWallet?: string;
  contractAddress?: string;
  slots?: readonly S2TraitMarketplaceSlot[];
  rarities?: readonly S2TraitMarketplaceRarity[];
  priceTiers?: Array<{ rarity: S2TraitMarketplaceRarity; energy: number; mon: string }>;
  listings?: MarketplaceListing[];
  listingCount?: number;
  availableListingCount?: number;
  updatedAt?: string;
  error?: string;
};

type EnergyResponse = {
  ok?: boolean;
  spendableEnergy?: string;
  spendableRaw?: string;
  error?: string;
};

type OwnedResponse = {
  ok?: boolean;
  tokenIds?: string[];
  error?: string;
};

type MarketplaceQuote = {
  ok?: boolean;
  quoteId: string;
  wallet: string;
  tokenId: number;
  listingId: string;
  traitId: number;
  traitType: S2TraitMarketplaceSlot;
  traitValue: string;
  rarity: S2TraitMarketplaceRarity;
  traitImage?: string;
  paymentMode: S2TraitMarketplacePaymentMode;
  costEnergy: number;
  costEnergyRaw: string;
  costMon: string;
  costMonRaw: string;
  costLabel: string;
  previousValue: string;
  proposedAttributes: Record<string, string>;
  currentMetadata?: MetadataJson;
  proposedMetadata?: MetadataJson;
  previewImageUrl?: string;
  previewDataUrl?: string;
  status: string;
  expiresAt: string;
  paymentTxHash?: string;
  purchaseAuthorization: { message: string };
  monPaymentRequest?: {
    chainId: number;
    from: string;
    to: string;
    value: string;
    data: string;
  } | null;
  error?: string;
  recoveryRequired?: boolean;
};

type MarketplaceLivePreview = {
  ok?: boolean;
  wallet: string;
  tokenId: number;
  listingId: string;
  traitId: number;
  traitType: S2TraitMarketplaceSlot;
  traitValue: string;
  rarity: S2TraitMarketplaceRarity;
  previousValue: string;
  proposedAttributes: Record<string, string>;
  currentMetadata?: MetadataJson;
  previewDataUrl?: string;
  rendererVersion?: string;
  generatedAt?: string;
  error?: string;
};

type PurchaseResponse = {
  ok?: boolean;
  quoteId?: string;
  metadata?: MetadataJson;
  paymentTxHash?: string;
  recoveryRequired?: boolean;
  error?: string;
};

type PendingMarketplacePurchase = {
  wallet: string;
  quoteId: string;
  listingId: string;
  tokenId: string;
  paymentMode: S2TraitMarketplacePaymentMode;
  paymentTxHash?: string;
  savedAt: string;
};

const rarityStyles: Record<S2TraitMarketplaceRarity, string> = {
  Common: "border-white/20 bg-white/[0.07] text-white/75",
  Uncommon: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  Rare: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  "Super Rare": "border-violet-300/35 bg-violet-300/10 text-violet-200",
  Legendary: "border-amber-300/35 bg-amber-300/10 text-amber-200",
  Mythic: "border-fuchsia-300/35 bg-fuchsia-300/10 text-fuchsia-200",
};

function normalizeAddress(value?: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "")) ? String(value).toLowerCase() : "";
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

function traitMap(metadata?: MetadataJson | null) {
  const result: Record<string, string> = {};
  for (const attribute of Array.isArray(metadata?.attributes) ? metadata.attributes : []) {
    const traitType = String(attribute?.trait_type || "").trim();
    if (traitType) result[traitType] = String(attribute?.value ?? "").trim() || "None";
  }
  return result;
}

function normalizeTrait(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hexQuantity(raw: string) {
  return `0x${BigInt(raw || "0").toString(16)}`;
}

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function supplyPercent(listing: MarketplaceListing) {
  if (!listing.maxActiveSupply) return 0;
  return Math.min(100, Math.max(0, ((listing.activeSupply + listing.reservedSupply) / listing.maxActiveSupply) * 100));
}

function quoteCanRecover(status: string) {
  return ["charged", "committing", "metadata_committed", "recovery_required"].includes(status);
}

async function responseJson<T>(response: Response) {
  return await response.json().catch(() => ({})) as T;
}

export function TraitMarketplaceClient() {
  const wallet = useWalletService();
  const walletAddress = normalizeAddress(wallet.address);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [ownedTokenIds, setOwnedTokenIds] = useState<string[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [metadata, setMetadata] = useState<MetadataJson | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [energy, setEnergy] = useState<EnergyResponse | null>(null);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [paymentMode, setPaymentMode] = useState<S2TraitMarketplacePaymentMode>("energy");
  const [slotFilter, setSlotFilter] = useState<"all" | S2TraitMarketplaceSlot>("all");
  const [rarityFilter, setRarityFilter] = useState<"all" | S2TraitMarketplaceRarity>("all");
  const [search, setSearch] = useState("");
  const [hideSoldOut, setHideSoldOut] = useState(true);
  const [previewListing, setPreviewListing] = useState<MarketplaceListing | null>(null);
  const [checkoutListing, setCheckoutListing] = useState<MarketplaceListing | null>(null);
  const [quote, setQuote] = useState<MarketplaceQuote | null>(null);
  const [livePreview, setLivePreview] = useState<MarketplaceLivePreview | null>(null);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  const [livePreviewError, setLivePreviewError] = useState("");
  const [pending, setPending] = useState<PendingMarketplacePurchase | null>(null);
  const [actionLoading, setActionLoading] = useState("");
  const [status, setStatus] = useState("Select an owned Droid, then choose a trait.");
  const [error, setError] = useState("");
  const metadataRequestRef = useRef(0);
  const livePreviewRequestRef = useRef(0);

  const listings = useMemo(() => catalog?.listings || [], [catalog?.listings]);
  const selectedTraits = useMemo(() => traitMap(metadata), [metadata]);
  const pendingStorageKey = walletAddress ? `dyoor:s2:trait-marketplace:${walletAddress}` : "";
  const filteredListings = useMemo(() => {
    const query = normalizeTrait(search);
    return listings.filter((listing) => {
      if (slotFilter !== "all" && listing.traitType !== slotFilter) return false;
      if (rarityFilter !== "all" && listing.rarity !== rarityFilter) return false;
      if (hideSoldOut && listing.soldOut) return false;
      if (query && !normalizeTrait(`${listing.value} ${listing.traitType} ${listing.rarity}`).includes(query)) return false;
      return true;
    });
  }, [hideSoldOut, listings, rarityFilter, search, slotFilter]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const response = await fetch("/api/s2/trait-marketplace/catalog", { cache: "no-store" });
      const data = await responseJson<MarketplaceCatalog>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load marketplace catalog.");
      setCatalog(data);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load marketplace catalog.");
      return null;
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadEnergy = useCallback(async () => {
    if (!walletAddress) {
      setEnergy(null);
      return;
    }
    setEnergyLoading(true);
    try {
      const response = await fetch(`/api/energy/${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const data = await responseJson<EnergyResponse>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load Energy balance.");
      setEnergy(data);
    } catch (caught) {
      setEnergy({ ok: false, error: caught instanceof Error ? caught.message : "Could not load Energy balance." });
    } finally {
      setEnergyLoading(false);
    }
  }, [walletAddress]);

  const loadOwnedTokens = useCallback(async () => {
    if (!walletAddress) {
      setOwnedTokenIds([]);
      setSelectedTokenId("");
      return;
    }
    setOwnedLoading(true);
    try {
      const response = await fetch(`/api/s2/owned-tokens?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const data = await responseJson<OwnedResponse>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load owned Droids.");
      const tokenIds = Array.from(new Set(data.tokenIds || [])).sort((left, right) => Number(left) - Number(right));
      setOwnedTokenIds(tokenIds);
      setSelectedTokenId((current) => tokenIds.includes(current) ? current : tokenIds[0] || "");
      setStatus(tokenIds.length ? "Choose a trait from the live marketplace." : "This wallet does not hold a Season 2 Droid.");
    } catch (caught) {
      setOwnedTokenIds([]);
      setSelectedTokenId("");
      setError(caught instanceof Error ? caught.message : "Could not load owned Droids.");
    } finally {
      setOwnedLoading(false);
    }
  }, [walletAddress]);

  const loadMetadata = useCallback(async (tokenId: string) => {
    const requestId = metadataRequestRef.current + 1;
    metadataRequestRef.current = requestId;
    if (!tokenId) {
      setMetadata(null);
      return;
    }
    setMetadataLoading(true);
    try {
      const response = await fetch(`/api/metadata/${encodeURIComponent(tokenId)}`, { cache: "no-store" });
      const data = await responseJson<MetadataJson & { error?: string }>(response);
      if (!response.ok || data.error) throw new Error(data.error || "Could not load Droid metadata.");
      if (metadataRequestRef.current === requestId) setMetadata(data);
    } catch (caught) {
      if (metadataRequestRef.current === requestId) {
        setMetadata(null);
        setError(caught instanceof Error ? caught.message : "Could not load Droid metadata.");
      }
    } finally {
      if (metadataRequestRef.current === requestId) setMetadataLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => void Promise.all([loadOwnedTokens(), loadEnergy()]), 0);
    return () => window.clearTimeout(timer);
  }, [loadEnergy, loadOwnedTokens]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMetadata(selectedTokenId), 0);
    return () => window.clearTimeout(timer);
  }, [loadMetadata, selectedTokenId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!pendingStorageKey) {
        setPending(null);
        return;
      }
      const raw = getStorageItem(browserStorage(), pendingStorageKey);
      try {
        const parsed = raw ? JSON.parse(raw) as PendingMarketplacePurchase : null;
        setPending(parsed?.wallet === walletAddress && parsed.quoteId ? parsed : null);
      } catch {
        setPending(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingStorageKey, walletAddress]);

  useEffect(() => {
    if (!checkoutListing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionLoading) setCheckoutListing(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [actionLoading, checkoutListing]);

  function persistPending(next: PendingMarketplacePurchase | null) {
    setPending(next);
    if (!pendingStorageKey) return;
    if (next) setStorageJson(browserStorage(), pendingStorageKey, next);
    else removeStorageItem(browserStorage(), pendingStorageKey);
  }

  async function connectWallet() {
    setError("");
    try {
      await wallet.connect();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet connection failed.");
    }
  }

  function openCheckout(listing: MarketplaceListing) {
    const previewIsCurrent = Boolean(
      livePreview
      && livePreview.wallet === walletAddress
      && String(livePreview.tokenId) === selectedTokenId
      && livePreview.listingId === listing.listingId,
    );
    setPreviewListing(listing);
    setCheckoutListing(listing);
    setQuote(null);
    setLivePreviewError("");
    setError("");
    if (!previewIsCurrent) {
      setLivePreview(null);
      if (walletAddress && selectedTokenId) void loadLivePreview(listing);
    }
  }

  function selectLivePreview(listing: MarketplaceListing) {
    setPreviewListing(listing);
    setQuote(null);
    setLivePreview(null);
    setLivePreviewError("");
    setError("");
    if (walletAddress && selectedTokenId) void loadLivePreview(listing);
  }

  async function loadLivePreview(listing: MarketplaceListing) {
    if (!walletAddress || !selectedTokenId) return;
    const requestId = livePreviewRequestRef.current + 1;
    livePreviewRequestRef.current = requestId;
    setLivePreviewLoading(true);
    setLivePreviewError("");
    try {
      const response = await fetch("/api/s2/trait-marketplace/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          tokenId: selectedTokenId,
          listingId: listing.listingId,
        }),
      });
      const data = await responseJson<MarketplaceLivePreview>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not generate the live Droid preview.");
      if (livePreviewRequestRef.current === requestId) setLivePreview(data);
    } catch (caught) {
      if (livePreviewRequestRef.current === requestId) {
        setLivePreview(null);
        setLivePreviewError(caught instanceof Error ? caught.message : "Could not generate the live Droid preview.");
      }
    } finally {
      if (livePreviewRequestRef.current === requestId) setLivePreviewLoading(false);
    }
  }

  async function createQuote() {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!selectedTokenId || !checkoutListing) return;
    setActionLoading("quote");
    setError("");
    setStatus("Sign the quote request. This signature does not spend Energy or MON.");
    try {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const message = traitMarketplaceQuoteAuthorizationMessage({
        wallet: walletAddress,
        tokenId: selectedTokenId,
        listingId: checkoutListing.listingId,
        traitType: checkoutListing.traitType,
        traitValue: checkoutListing.value,
        paymentMode,
        timestamp,
        nonce,
      });
      const signature = await wallet.signMessage(message);
      setStatus("Checking ownership, compatibility, and live supply.");
      const response = await fetch("/api/s2/trait-marketplace/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          tokenId: selectedTokenId,
          listingId: checkoutListing.listingId,
          paymentMode,
          timestamp,
          nonce,
          signature,
        }),
      });
      const data = await responseJson<MarketplaceQuote>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not create marketplace quote.");
      setQuote(data);
      persistPending({
        wallet: walletAddress,
        quoteId: data.quoteId,
        listingId: data.listingId,
        tokenId: String(data.tokenId),
        paymentMode: data.paymentMode,
        savedAt: new Date().toISOString(),
      });
      setStatus("Secure quote ready. Review the exact Droid preview before purchasing.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create marketplace quote.");
    } finally {
      setActionLoading("");
    }
  }

  async function waitForReceipt(txHash: string) {
    const provider = await wallet.getProvider();
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] }).catch(() => null) as { status?: string } | null;
      if (receipt) {
        if (String(receipt.status || "").toLowerCase() === "0x0") throw new Error("MON marketplace payment failed on-chain.");
        return receipt;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error("MON payment is still pending. Use Restore Purchase after it confirms.");
  }

  async function completePurchase(targetQuote: MarketplaceQuote, existingTxHash = "") {
    if (!walletAddress) return;
    setActionLoading("purchase");
    setError("");
    let paymentTxHash = existingTxHash || targetQuote.paymentTxHash || pending?.paymentTxHash || "";
    try {
      setStatus("Sign the exact marketplace purchase authorization.");
      const signature = await wallet.signMessage(targetQuote.purchaseAuthorization.message);
      if (targetQuote.paymentMode === "mon" && !paymentTxHash && !quoteCanRecover(targetQuote.status)) {
        const payment = targetQuote.monPaymentRequest;
        if (!payment?.to || !payment.value || !payment.data) throw new Error("MON payment request is incomplete.");
        setStatus(`Switching to Monad mainnet (chain ${MONAD_MAINNET_CHAIN_ID}) for the MON payment.`);
        await wallet.switchChain();
        const provider = await wallet.getProvider();
        const activeChain = await provider.request({ method: "eth_chainId" }).catch(() => "");
        if (!isMonadMainnetChain(activeChain)) {
          throw new Error(`Wallet is still on ${describeEvmChain(activeChain)}. MON purchases require Monad mainnet (chain ${MONAD_MAINNET_CHAIN_ID}).`);
        }
        const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []) as string[];
        const activeWallet = normalizeAddress(accounts?.[0]);
        if (activeWallet !== walletAddress) {
          throw new Error(`Active wallet ${shortAddress(activeWallet)} does not match quote wallet ${shortAddress(walletAddress)}.`);
        }
        setStatus(`Confirm the exact ${targetQuote.costMon} MON payment in your wallet.`);
        paymentTxHash = await wallet.sendTransaction({
          from: walletAddress,
          to: payment.to,
          value: hexQuantity(payment.value),
          data: payment.data,
        });
        persistPending({
          wallet: walletAddress,
          quoteId: targetQuote.quoteId,
          listingId: targetQuote.listingId,
          tokenId: String(targetQuote.tokenId),
          paymentMode: targetQuote.paymentMode,
          paymentTxHash,
          savedAt: new Date().toISOString(),
        });
        setStatus("MON payment sent. Waiting for confirmation.");
        await waitForReceipt(paymentTxHash);
      }

      setStatus("Applying the purchased trait and refreshing metadata.");
      let response: Response | null = null;
      let data = {} as PurchaseResponse;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        response = await fetch("/api/s2/trait-marketplace/purchase", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            wallet: walletAddress,
            quoteId: targetQuote.quoteId,
            signature,
            ...(paymentTxHash ? { paymentTxHash } : {}),
          }),
        });
        data = await responseJson<PurchaseResponse>(response);
        if (!(response.status === 409 && paymentTxHash && attempt < 3)) break;
        setStatus("Payment is confirmed but still indexing. Retrying safely.");
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (!response || !response.ok || data.ok === false) {
        if (data.recoveryRequired) setStatus("Payment is safe. Restore this purchase to finish metadata settlement.");
        throw new Error(data.error || "Marketplace purchase could not be completed.");
      }

      if (data.metadata) setMetadata(data.metadata);
      persistPending(null);
      setQuote(null);
      setPreviewListing(null);
      setLivePreview(null);
      setCheckoutListing(null);
      setStatus(`${targetQuote.traitValue} is now equipped on D.Y.O.O.R #${targetQuote.tokenId}.`);
      await Promise.all([loadEnergy(), loadCatalog(), loadMetadata(String(targetQuote.tokenId))]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Marketplace purchase failed.");
    } finally {
      setActionLoading("");
    }
  }

  async function restorePendingPurchase() {
    if (!pending || !walletAddress) return;
    setActionLoading("restore");
    setError("");
    setStatus("Restoring the saved marketplace quote.");
    try {
      const response = await fetch(
        `/api/s2/trait-marketplace/quotes/${encodeURIComponent(pending.quoteId)}?wallet=${encodeURIComponent(walletAddress)}`,
        { cache: "no-store" },
      );
      const data = await responseJson<MarketplaceQuote>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not restore marketplace quote.");
      if (data.status === "completed") {
        persistPending(null);
        setStatus("This marketplace purchase was already completed.");
        await Promise.all([loadCatalog(), loadEnergy(), loadMetadata(pending.tokenId)]);
        return;
      }
      if (data.status === "expired") {
        persistPending(null);
        throw new Error("Saved marketplace quote expired before payment. Create a fresh quote.");
      }
      let listing = listings.find((candidate) => candidate.listingId === data.listingId) || null;
      if (!listing) {
        const refreshedCatalog = await loadCatalog();
        listing = refreshedCatalog?.listings?.find((candidate) => candidate.listingId === data.listingId) || null;
      }
      if (!listing) throw new Error("The saved marketplace listing is no longer available.");
      setPaymentMode(data.paymentMode);
      setSelectedTokenId(String(data.tokenId));
      setPreviewListing(listing);
      setCheckoutListing(listing);
      setLivePreview(null);
      setLivePreviewError("");
      setQuote(data);
      setStatus(quoteCanRecover(data.status)
        ? "Charged purchase restored. Sign once more to finish settlement."
        : "Marketplace quote restored. Review it before purchasing.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore marketplace purchase.");
    } finally {
      setActionLoading("");
    }
  }

  const checkoutCurrentValue = checkoutListing ? selectedTraits[checkoutListing.traitType] || "None" : "None";
  const checkoutAlreadyEquipped = Boolean(checkoutListing && normalizeTrait(checkoutCurrentValue) === normalizeTrait(checkoutListing.value));
  const activePreview = quote || livePreview;
  const previewBeforeImage = mediaUrl(activePreview?.currentMetadata?.image || metadata?.image);
  const previewAfterImage = mediaUrl(quote?.previewDataUrl || quote?.proposedMetadata?.image || quote?.previewImageUrl || livePreview?.previewDataUrl);
  const previewPreviousTraits = traitMap(activePreview?.currentMetadata);
  const inlinePreviewIsCurrent = Boolean(
    livePreview
    && livePreview.wallet === walletAddress
    && String(livePreview.tokenId) === selectedTokenId
    && livePreview.listingId === previewListing?.listingId,
  );
  const targetDroidImage = mediaUrl(inlinePreviewIsCurrent ? livePreview?.previewDataUrl : metadata?.image);

  return (
    <PageShell size="wide" className="pb-20">
      <SectionHeader
        eyebrow="Season 2 · Live Supply"
        title="Trait Marketplace"
        copy="Choose an exact approved wearable, preview it on an owned Droid, and pay with Energy or MON. Purchases equip immediately; replaced traits are permanently burned from active supply."
        actions={!walletAddress ? <WalletButton /> : (
          <Link className="btn-secondary" href="/reroll">Open Trait Lab</Link>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Live Listings" value={catalogLoading ? "—" : (catalog?.listingCount || 0).toLocaleString()} />
        <StatCard label="In Stock" value={catalogLoading ? "—" : (catalog?.availableListingCount || 0).toLocaleString()} />
        <StatCard label="Spendable Energy" value={energyLoading ? "—" : energy?.spendableEnergy || (walletAddress ? "Unavailable" : "Connect")} />
        <StatCard label="Owned Droids" value={ownedLoading ? "—" : walletAddress ? ownedTokenIds.length : "Connect"} />
      </div>

      {pending && (
        <Alert tone="warning" className="mt-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <span>A saved {pending.paymentMode === "mon" ? "MON" : "Energy"} purchase for Droid #{pending.tokenId} is waiting. Restore it instead of creating another quote.</span>
          <Button className="shrink-0" disabled={Boolean(actionLoading)} onClick={() => void restorePendingPurchase()}>
            {actionLoading === "restore" ? "Restoring" : "Restore Purchase"}
          </Button>
        </Alert>
      )}
      {error && <Alert tone="danger" className="mt-5">{error}</Alert>}
      {status && !error && <Alert tone={actionLoading ? "busy" : "idle"} className="mt-5">{status}</Alert>}

      <Card strong className="mt-6 p-5 md:p-6">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="eyebrow">Fixed Tier Pricing</p>
            <h2 className="mt-2 text-2xl font-black uppercase text-white">Common → Mythic</h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/55">
              Energy and MON use separate fixed rarity tiers. Direct selection costs more than a random Trait Lab roll.
            </p>
          </div>
          <div className="inline-flex rounded border border-dyoor-purple/30 bg-black/35 p-1" aria-label="Payment method">
            {(["energy", "mon"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`min-h-11 rounded px-5 text-xs font-black uppercase tracking-[0.14em] transition ${paymentMode === mode ? "bg-dyoor-cyan text-black" : "text-white/55 hover:text-white"}`}
                onClick={() => {
                  setPaymentMode(mode);
                  setQuote(null);
                }}
              >
                {mode === "energy" ? "Pay Energy" : "Pay MON"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {(catalog?.priceTiers || S2_TRAIT_MARKETPLACE_RARITIES.map((rarity) => ({ rarity, energy: 0, mon: "—" }))).map((tier) => (
            <div key={tier.rarity} className={`rounded border p-3 ${rarityStyles[tier.rarity]}`}>
              <p className="text-[0.66rem] font-black uppercase tracking-[0.14em]">{tier.rarity}</p>
              <p className="mt-2 text-lg font-black text-white">
                {paymentMode === "energy" ? `${tier.energy.toLocaleString()} E` : `${tier.mon} MON`}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card strong className="overflow-hidden">
            <div className="border-b border-white/10 p-5">
              <p className="eyebrow">Target Droid</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">
                {selectedTokenId ? metadata?.name || `D.Y.O.O.R #${selectedTokenId}` : "Select a Droid"}
              </h2>
            </div>
            {walletAddress ? (
              <div className="p-5">
                {ownedLoading ? <LoadingSkeleton lines={3} /> : ownedTokenIds.length ? (
                  <>
                    <label className="text-xs font-black uppercase tracking-[0.14em] text-white/45" htmlFor="marketplace-droid">Owned Droid</label>
                    <select
                      id="marketplace-droid"
                      className="field-control mt-2"
                      value={selectedTokenId}
                      onChange={(event) => {
                        livePreviewRequestRef.current += 1;
                        setSelectedTokenId(event.target.value);
                        setPreviewListing(null);
                        setLivePreview(null);
                        setLivePreviewLoading(false);
                        setLivePreviewError("");
                        setQuote(null);
                      }}
                    >
                      {ownedTokenIds.map((tokenId) => <option value={tokenId} key={tokenId}>D.Y.O.O.R #{tokenId}</option>)}
                    </select>
                    <div className={`relative mt-4 aspect-square overflow-hidden rounded border bg-black/45 transition ${inlinePreviewIsCurrent ? "border-dyoor-cyan/70 shadow-[0_0_28px_rgba(57,255,226,.18)]" : "border-dyoor-purple/25"}`}>
                      {metadataLoading ? <div className="grid h-full place-items-center"><span className="text-xs font-black uppercase tracking-[0.15em] text-dyoor-cyan">Loading Droid</span></div> : targetDroidImage ? (
                        <img className="h-full w-full object-cover" src={targetDroidImage} alt={inlinePreviewIsCurrent ? `${metadata?.name || `D.Y.O.O.R #${selectedTokenId}`} preview with ${previewListing?.value}` : metadata?.name || `D.Y.O.O.R #${selectedTokenId}`} />
                      ) : <div className="grid h-full place-items-center text-sm font-bold text-white/35">No image</div>}
                      {livePreviewLoading && previewListing && (
                        <div className="absolute inset-0 grid place-items-center bg-black/62 backdrop-blur-[2px]">
                          <div className="text-center">
                            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-dyoor-cyan/20 border-t-dyoor-cyan" />
                            <p className="mt-3 text-[0.65rem] font-black uppercase tracking-[0.14em] text-dyoor-cyan">Previewing {previewListing.value}</p>
                          </div>
                        </div>
                      )}
                      {inlinePreviewIsCurrent && previewListing && (
                        <span className="absolute bottom-3 left-3 rounded border border-dyoor-cyan/45 bg-black/75 px-2 py-1 text-[0.6rem] font-black uppercase tracking-[0.12em] text-dyoor-cyan">Live · {previewListing.value}</span>
                      )}
                    </div>
                    {previewListing && livePreviewError ? (
                      <Alert tone="danger" className="mt-3 text-xs">
                        <p>{livePreviewError}</p>
                        <Button variant="ghost" className="mt-2 w-full" disabled={livePreviewLoading} onClick={() => void loadLivePreview(previewListing)}>Retry Preview</Button>
                      </Alert>
                    ) : previewListing ? (
                      <div className="mt-3 rounded border border-dyoor-cyan/20 bg-dyoor-cyan/[0.06] p-3">
                        <p className="text-[0.62rem] font-black uppercase tracking-[0.13em] text-dyoor-cyan">{livePreviewLoading ? "Generating Preview" : "Selected Trait"}</p>
                        <p className="mt-1 truncate text-sm font-black text-white">{previewListing.value}</p>
                        {inlinePreviewIsCurrent && (
                          <Button variant="primary" className="mt-3 w-full" onClick={() => openCheckout(previewListing)}>Review &amp; Buy</Button>
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 text-xs font-semibold leading-5 text-white/50">
                        Click any available trait to render it on this Droid. Live previews do not change metadata or reserve supply.
                      </p>
                    )}
                  </>
                ) : <EmptyState title="No S2 Droids" copy="Connect a wallet that owns a Season 2 Droid to equip marketplace traits." />}
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm font-semibold leading-6 text-white/55">Connect the wallet that holds your Season 2 Droid.</p>
                <Button variant="primary" className="mt-4 w-full" onClick={() => void connectWallet()}>Connect Wallet</Button>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">Payment</p>
            <p className="mt-2 text-2xl font-black text-white">{paymentMode === "energy" ? "Energy" : "MON"}</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-white/48">
              {paymentMode === "energy"
                ? "Gasless server-settled debit after your signed approval."
                : "Exact Monad transaction to the D.Y.O.O.R treasury, bound to one quote."}
            </p>
          </Card>
        </aside>

        <section className="min-w-0">
          <Card className="p-4 md:p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_13rem_11rem_auto]">
              <label>
                <span className="sr-only">Search traits</span>
                <input className="field-control" placeholder="Search trait name…" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <label>
                <span className="sr-only">Filter by slot</span>
                <select className="field-control" value={slotFilter} onChange={(event) => setSlotFilter(event.target.value as typeof slotFilter)}>
                  <option value="all">All slots</option>
                  {S2_TRAIT_MARKETPLACE_SLOTS.map((slot) => <option value={slot} key={slot}>{slot}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Filter by rarity</span>
                <select className="field-control" value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value as typeof rarityFilter)}>
                  <option value="all">All rarities</option>
                  {S2_TRAIT_MARKETPLACE_RARITIES.map((rarity) => <option value={rarity} key={rarity}>{rarity}</option>)}
                </select>
              </label>
              <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded border border-white/10 bg-black/30 px-3 text-xs font-black uppercase tracking-[0.09em] text-white/60">
                <input type="checkbox" checked={hideSoldOut} onChange={(event) => setHideSoldOut(event.target.checked)} />
                In stock only
              </label>
            </div>
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-white/38">{filteredListings.length} matching traits</p>
            <button className="text-xs font-black uppercase tracking-[0.12em] text-dyoor-cyan hover:text-white" type="button" onClick={() => void loadCatalog()}>Refresh supply</button>
          </div>

          {catalogLoading ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><LoadingSkeleton lines={8} /><LoadingSkeleton lines={8} /><LoadingSkeleton lines={8} /></div>
          ) : filteredListings.length ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filteredListings.map((listing) => {
                const equipped = normalizeTrait(selectedTraits[listing.traitType]) === normalizeTrait(listing.value);
                const selectedForPreview = previewListing?.listingId === listing.listingId;
                return (
                  <article key={listing.listingId} className={`group overflow-hidden rounded border bg-white/[0.04] transition hover:-translate-y-0.5 hover:border-dyoor-cyan/45 hover:shadow-[0_18px_45px_rgba(57,255,226,.10)] ${selectedForPreview ? "border-dyoor-cyan/70 shadow-[0_0_30px_rgba(57,255,226,.13)]" : "border-dyoor-purple/25"}`}>
                    <button className="block w-full text-left" type="button" onClick={() => selectLivePreview(listing)} disabled={listing.soldOut || equipped} aria-label={`Preview ${listing.value} on selected Droid`}>
                      <div className="relative aspect-square overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(131,110,249,.26),transparent_55%),#070716] p-5">
                        <img className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]" src={mediaUrl(listing.image)} alt={`${listing.value} ${listing.traitType} trait`} loading="lazy" />
                        <span className={`absolute left-3 top-3 rounded border px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] ${rarityStyles[listing.rarity]}`}>{listing.rarity}</span>
                        {selectedForPreview && !listing.soldOut && <span className="absolute right-3 top-3 rounded border border-dyoor-cyan/45 bg-black/75 px-2 py-1 text-[0.6rem] font-black uppercase tracking-[0.12em] text-dyoor-cyan">Selected</span>}
                        {listing.soldOut && <span className="absolute inset-0 grid place-items-center bg-black/72 text-sm font-black uppercase tracking-[0.16em] text-red-200">Sold Out</span>}
                      </div>
                      <div className="p-4">
                        <p className="text-[0.64rem] font-black uppercase tracking-[0.15em] text-dyoor-cyan/75">{listing.traitType}</p>
                        <h3 className="mt-1 min-h-12 text-lg font-black leading-tight text-white">{listing.value}</h3>
                        <div className="mt-3 flex items-end justify-between gap-2">
                          <div>
                            <p className="text-[0.62rem] font-black uppercase tracking-[0.1em] text-white/35">Price</p>
                            <p className="mt-1 text-base font-black text-white">{paymentMode === "energy" ? `${listing.priceEnergy.toLocaleString()} Energy` : `${listing.priceMon} MON`}</p>
                          </div>
                          <span className="text-[0.65rem] font-black uppercase tracking-[0.08em] text-white/40">#{listing.traitId}</span>
                        </div>
                        <div className="mt-4">
                          <div className="flex justify-between text-[0.64rem] font-bold text-white/42">
                            <span>{listing.activeSupply.toLocaleString()} active</span>
                            <span>{listing.availableSupply.toLocaleString()} available</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/8">
                            <div className="h-full rounded bg-gradient-to-r from-dyoor-cyan to-dyoor-purple" style={{ width: `${supplyPercent(listing)}%` }} />
                          </div>
                          <p className="mt-2 text-[0.62rem] font-semibold text-white/30">Cap {listing.maxActiveSupply.toLocaleString()}{listing.reservedSupply ? ` · ${listing.reservedSupply} reserved` : ""}</p>
                        </div>
                      </div>
                    </button>
                    <div className="px-4 pb-4">
                      <Button variant={equipped ? "ghost" : "primary"} className="w-full" disabled={listing.soldOut || equipped} onClick={() => openCheckout(listing)}>
                        {equipped ? "Equipped" : listing.soldOut ? "Sold Out" : selectedForPreview && inlinePreviewIsCurrent ? "Review & Buy" : "Preview & Buy"}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState className="mt-4" title="No Matching Traits" copy="Adjust the slot, rarity, stock, or search filters." />
          )}
        </section>
      </div>

      {typeof document !== "undefined" && checkoutListing && createPortal(
        <div className="fixed inset-0 z-[120] grid items-end bg-black/78 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={`Buy ${checkoutListing.value}`}>
          <div className="mx-auto max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-t border border-dyoor-purple/40 bg-[#080817] shadow-[0_0_80px_rgba(131,110,249,.28)] sm:rounded">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#080817]/95 px-5 py-4 backdrop-blur-xl">
              <div>
                <p className="text-[0.64rem] font-black uppercase tracking-[0.16em] text-dyoor-cyan">{checkoutListing.traitType} · {checkoutListing.rarity}</p>
                <h2 className="mt-1 text-xl font-black text-white">{checkoutListing.value}</h2>
              </div>
              <button className="grid h-11 w-11 place-items-center rounded border border-white/12 text-xl text-white/55 hover:border-dyoor-cyan/45 hover:text-white" type="button" aria-label="Close checkout" disabled={Boolean(actionLoading)} onClick={() => setCheckoutListing(null)}>×</button>
            </div>

            <div className="grid gap-6 p-5 md:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
              <div>
                {activePreview || livePreviewLoading || livePreviewError ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <figure>
                        <div className="aspect-square overflow-hidden rounded border border-white/12 bg-black/40">
                          {previewBeforeImage ? <img className="h-full w-full object-cover" src={previewBeforeImage} alt="Droid before purchase" /> : null}
                        </div>
                        <figcaption className="mt-2 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/35">Before</figcaption>
                      </figure>
                      <figure>
                        <div className="aspect-square overflow-hidden rounded border border-dyoor-cyan/35 bg-black/40 shadow-[0_0_28px_rgba(57,255,226,.12)]">
                          {livePreviewLoading && !quote ? (
                            <div className="grid h-full place-items-center px-5 text-center">
                              <div>
                                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-dyoor-cyan/20 border-t-dyoor-cyan" />
                                <p className="mt-3 text-[0.68rem] font-black uppercase tracking-[0.14em] text-dyoor-cyan">Composing Droid</p>
                              </div>
                            </div>
                          ) : previewAfterImage ? (
                            <img className="h-full w-full object-cover" src={previewAfterImage} alt="Droid after purchase" />
                          ) : (
                            <div className="grid h-full place-items-center px-5 text-center text-xs font-bold text-white/35">Preview unavailable</div>
                          )}
                        </div>
                        <figcaption className="mt-2 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-dyoor-cyan">
                          {livePreviewLoading && !quote ? "Generating" : "After"}
                        </figcaption>
                      </figure>
                    </div>
                    {livePreviewError && !activePreview && (
                      <Alert tone="danger" className="mt-4 text-xs">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                          <span>{livePreviewError}</span>
                          <Button variant="ghost" disabled={livePreviewLoading} onClick={() => void loadLivePreview(checkoutListing)}>Retry Preview</Button>
                        </div>
                      </Alert>
                    )}
                    {activePreview && (
                      <div className="mt-5 rounded border border-white/10 bg-black/28 p-4">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-white/42">Exact metadata changes</p>
                        <div className="mt-3 space-y-2">
                          {Object.entries(activePreview.proposedAttributes).map(([traitType, nextValue]) => (
                            <div className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs" key={traitType}>
                              <span className="truncate font-black text-white/48">{traitType}</span>
                              <span className="truncate font-semibold text-white/55">{previewPreviousTraits[traitType] || "None"}</span>
                              <span className="text-dyoor-cyan">→</span>
                              <span className="truncate font-black text-white">{nextValue}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-[minmax(13rem,.7fr)_minmax(0,1fr)] sm:items-center">
                    <div className="aspect-square overflow-hidden rounded border border-dyoor-purple/30 bg-[radial-gradient(circle,rgba(131,110,249,.25),transparent_60%),#070716] p-6">
                      <img className="h-full w-full object-contain" src={mediaUrl(checkoutListing.image)} alt={`${checkoutListing.value} trait`} />
                    </div>
                    <div>
                      <span className={`inline-flex rounded border px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.12em] ${rarityStyles[checkoutListing.rarity]}`}>{checkoutListing.rarity}</span>
                      <h3 className="mt-3 text-3xl font-black text-white">{checkoutListing.value}</h3>
                      <p className="mt-2 text-sm font-semibold text-white/50">Approved {checkoutListing.traitType} listing #{checkoutListing.traitId}</p>
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded border border-white/10 bg-black/25 p-3">
                          <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-white/35">Available</p>
                          <p className="mt-1 text-xl font-black text-white">{checkoutListing.availableSupply.toLocaleString()}</p>
                        </div>
                        <div className="rounded border border-white/10 bg-black/25 p-3">
                          <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-white/35">Active / Cap</p>
                          <p className="mt-1 text-xl font-black text-white">{checkoutListing.activeSupply.toLocaleString()} / {checkoutListing.maxActiveSupply.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded border border-dyoor-purple/28 bg-black/28 p-5">
                <p className="eyebrow">Checkout</p>
                <div className="mt-4 space-y-3 border-b border-white/10 pb-4 text-sm">
                  <div className="flex justify-between gap-3"><span className="font-semibold text-white/45">Droid</span><span className="font-black text-white">#{selectedTokenId || "—"}</span></div>
                  <div className="flex justify-between gap-3"><span className="font-semibold text-white/45">Current</span><span className="max-w-[12rem] truncate font-black text-white">{checkoutCurrentValue}</span></div>
                  <div className="flex justify-between gap-3"><span className="font-semibold text-white/45">New trait</span><span className="max-w-[12rem] truncate font-black text-dyoor-cyan">{checkoutListing.value}</span></div>
                  <div className="flex justify-between gap-3"><span className="font-semibold text-white/45">Payment</span><span className="font-black uppercase text-white">{quote?.paymentMode || paymentMode}</span></div>
                </div>
                <div className="flex items-end justify-between gap-3 py-5">
                  <div>
                    <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/35">Total</p>
                    <p className="mt-1 text-3xl font-black text-white">{quote?.costLabel || (paymentMode === "energy" ? `${checkoutListing.priceEnergy.toLocaleString()} Energy` : `${checkoutListing.priceMon} MON`)}</p>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[0.62rem] font-black uppercase ${rarityStyles[checkoutListing.rarity]}`}>{checkoutListing.rarity}</span>
                </div>

                <Alert tone="warning" className="mb-4 text-xs">
                  Equipping is immediate. The current {checkoutListing.traitType} trait is permanently burned. Any compatibility side effects are shown in the preview before payment.
                </Alert>
                {quote && (
                  <p className="mb-4 text-xs font-semibold text-white/42">
                    Quote expires {new Date(quote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Charged purchases remain recoverable.
                  </p>
                )}

                {!walletAddress ? (
                  <Button variant="primary" className="w-full" onClick={() => void connectWallet()}>Connect Wallet</Button>
                ) : !selectedTokenId ? (
                  <Button className="w-full" disabled>Select an Owned Droid</Button>
                ) : checkoutAlreadyEquipped ? (
                  <Button className="w-full" disabled>Already Equipped</Button>
                ) : quote ? (
                  <Button variant="primary" className="w-full" disabled={Boolean(actionLoading)} onClick={() => void completePurchase(quote, pending?.paymentTxHash || "")}>
                    {actionLoading === "purchase" ? "Completing Purchase" : quoteCanRecover(quote.status) ? "Finish Settlement" : `Buy with ${quote.paymentMode === "energy" ? "Energy" : "MON"}`}
                  </Button>
                ) : (
                  <Button variant="primary" className="w-full" disabled={Boolean(actionLoading) || livePreviewLoading || checkoutListing.soldOut} onClick={() => void createQuote()}>
                    {actionLoading === "quote" ? "Creating Secure Quote" : livePreviewLoading ? "Generating Live Preview" : "Reserve & Continue"}
                  </Button>
                )}
                <p className="mt-3 text-center text-[0.68rem] font-semibold leading-5 text-white/32">
                  Live previews are free and read-only. A wallet signature is requested only to reserve supply and continue to payment.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </PageShell>
  );
}
