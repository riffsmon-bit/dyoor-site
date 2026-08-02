import crypto from "node:crypto";
import { ethers } from "ethers";
import {
  S2_TRAIT_MARKETPLACE_ENERGY_PRICES,
  S2_TRAIT_MARKETPLACE_QUOTE_TTL_MS,
  S2_TRAIT_MARKETPLACE_RARITIES,
  S2_TRAIT_MARKETPLACE_SLOTS,
  isS2TraitMarketplacePaymentMode,
  isS2TraitMarketplaceRarity,
  isS2TraitMarketplaceSlot,
  traitMarketplaceListingId,
  traitMarketplacePrice,
  type S2TraitMarketplacePaymentMode,
  type S2TraitMarketplaceRarity,
  type S2TraitMarketplaceSlot,
} from "@/lib/s2-trait-marketplace-config";
import {
  traitMarketplacePurchaseAuthorizationMessage,
  traitMarketplaceQuoteAuthorizationMessage,
} from "@/lib/s2-trait-marketplace-auth";
import {
  assertSupplyDeltasAvailable,
  assertTokenCooldownComplete,
  isEmptyTraitValue,
  metadataVersion,
  normalizeWallet,
  prepareTraitMarketplaceSelection,
  renderTraitLabImageRuntime,
  supplyDeltasForPatch,
  traitLabPublicConfig,
  traitMapFromMetadata,
  traitRegistry,
  verifyS2TokenOwner,
  type TraitOption,
} from "@/lib/s2-trait-lab";
import {
  buildTokenMetadataAsync,
  getRuntimeMetadataConfig,
  getRuntimeTraitOverrides,
  mergeMetadata,
  parseTokenId,
  saveRuntimeTraitOverride,
} from "@/lib/dyoor-s2-metadata.js";
import { energyBankContract } from "@/lib/contracts/addresses";
import { MONAD_CHAIN_ID } from "@/lib/monad";
import { processDueOpenSeaMetadataRefreshes, refreshOpenSeaTokenMetadataNowAndLater } from "@/lib/opensea-metadata-refresh";
import { assertMonadMainnet, energyRpcProvider } from "@/src/lib/energy/chain";
import {
  applyTraitSupplyDeltas,
  claimTraitLabEnergyDebit,
  deleteTraitSupplyReservation,
  extendTraitSupplyReservation,
  getTraitLabEnergyDebit,
  getTraitSupplyAvailabilityLedger,
  getTraitSupplyEvent,
  getTraitSupplyLedger,
  saveTraitSupplyReservation,
  type TraitSupplyDelta,
} from "@/src/lib/storage/s2TraitLabStore";
import {
  claimTraitMarketplaceMonPayment,
  getTraitMarketplaceQuote,
  saveTraitMarketplaceQuote,
  type TraitMarketplaceQuoteRecord,
} from "@/src/lib/storage/s2TraitMarketplaceStore";

type MetadataJson = {
  name?: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

export type TraitMarketplaceListing = {
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

type MarketplaceRegistryListing = {
  listingId: string;
  traitId: number;
  traitType: S2TraitMarketplaceSlot;
  value: string;
  rarity: S2TraitMarketplaceRarity;
  image: string;
  initialSupply: number;
  maxActiveSupply: number;
  option: TraitOption;
};

const ENERGY_BANK_ABI = ["function spendableEnergy(address user) view returns (uint256)"];
const QUOTE_AUTH_WINDOW_MS = 5 * 60 * 1000;
const RESERVATION_SETTLE_MS = 75;

function positiveInteger(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function supplyKey(traitType: string, value: string) {
  return `${traitType}::${value}`.toLowerCase();
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

function valuesMatch(left: unknown, right: unknown) {
  if (isEmptyTraitValue(left) && isEmptyTraitValue(right)) return true;
  return normalizeComparable(left) === normalizeComparable(right);
}

function marketplaceRegistryListings(): MarketplaceRegistryListing[] {
  const registry = traitRegistry();
  return S2_TRAIT_MARKETPLACE_SLOTS.flatMap((traitType) => (
    (registry[traitType] || []).flatMap((option) => {
      const traitId = Number(option.traitId);
      if (!Number.isSafeInteger(traitId) || traitId <= 0 || !isS2TraitMarketplaceRarity(option.rarity)) return [];
      const initialSupply = positiveInteger(option.initialSupply);
      const maxActiveSupply = positiveInteger(option.maxActiveSupply);
      if (!maxActiveSupply) return [];
      return [{
        listingId: traitMarketplaceListingId(traitType, traitId),
        traitId,
        traitType,
        value: option.value,
        rarity: option.rarity,
        image: option.assetUri,
        initialSupply,
        maxActiveSupply,
        option,
      }];
    })
  ));
}

function marketplaceListing(listingIdInput: unknown) {
  const listingId = String(listingIdInput || "").trim();
  const listing = marketplaceRegistryListings().find((candidate) => candidate.listingId === listingId);
  if (!listing) throw Object.assign(new Error("Marketplace listing was not found."), { status: 404 });
  return listing;
}

function listingWithAvailability(
  listing: MarketplaceRegistryListing,
  committed: Awaited<ReturnType<typeof getTraitSupplyLedger>>,
  available: Awaited<ReturnType<typeof getTraitSupplyAvailabilityLedger>>,
): TraitMarketplaceListing {
  const key = supplyKey(listing.traitType, listing.value);
  const committedItem = committed.items[key];
  const availabilityItem = available.items[key];
  const activeSupply = positiveInteger(committedItem?.activeSupply ?? listing.initialSupply);
  const reservedActiveSupply = positiveInteger(availabilityItem?.activeSupply ?? activeSupply);
  const reservedSupply = Math.max(0, reservedActiveSupply - activeSupply);
  const availableSupply = Math.max(0, listing.maxActiveSupply - reservedActiveSupply);
  const price = traitMarketplacePrice(listing.rarity);
  return {
    listingId: listing.listingId,
    traitId: listing.traitId,
    traitType: listing.traitType,
    value: listing.value,
    rarity: listing.rarity,
    image: listing.image,
    initialSupply: listing.initialSupply,
    activeSupply,
    burnedSupply: positiveInteger(committedItem?.burnedSupply),
    reservedSupply,
    maxActiveSupply: listing.maxActiveSupply,
    availableSupply,
    soldOut: availableSupply <= 0,
    priceEnergy: price.energy,
    priceEnergyRaw: price.energyRaw,
    priceMon: price.mon,
    priceMonRaw: price.monRaw,
  };
}

export async function getTraitMarketplaceCatalog() {
  const [committed, available] = await Promise.all([
    getTraitSupplyLedger(),
    getTraitSupplyAvailabilityLedger(),
  ]);
  const rarityIndex = new Map(S2_TRAIT_MARKETPLACE_RARITIES.map((rarity, index) => [rarity, index]));
  const listings = marketplaceRegistryListings()
    .map((listing) => listingWithAvailability(listing, committed, available))
    .sort((left, right) => (
      (rarityIndex.get(left.rarity) || 0) - (rarityIndex.get(right.rarity) || 0)
      || left.traitType.localeCompare(right.traitType)
      || left.value.localeCompare(right.value)
    ));
  const labConfig = traitLabPublicConfig();

  return {
    ok: true,
    chainId: labConfig.chainId,
    chainHex: labConfig.chainHex,
    chainName: labConfig.chainName,
    rpcUrl: labConfig.rpcUrl,
    explorerUrl: labConfig.explorerUrl,
    treasuryWallet: labConfig.treasuryWallet,
    contractAddress: labConfig.contractAddress,
    slots: S2_TRAIT_MARKETPLACE_SLOTS,
    rarities: S2_TRAIT_MARKETPLACE_RARITIES,
    priceTiers: S2_TRAIT_MARKETPLACE_RARITIES.map((rarity) => ({
      rarity,
      energy: S2_TRAIT_MARKETPLACE_ENERGY_PRICES[rarity],
      mon: traitMarketplacePrice(rarity).mon,
    })),
    listings,
    listingCount: listings.length,
    availableListingCount: listings.filter((listing) => !listing.soldOut).length,
    updatedAt: available.updatedAt || committed.updatedAt || new Date().toISOString(),
  };
}

function parseMarketplacePaymentMode(value: unknown): S2TraitMarketplacePaymentMode {
  const mode = String(value || "energy").trim().toLowerCase();
  if (!isS2TraitMarketplacePaymentMode(mode)) {
    throw Object.assign(new Error("Marketplace payment must be Energy or MON."), { status: 400 });
  }
  return mode;
}

function parseMarketplaceTokenId(value: unknown, maxSupply: number) {
  const parsed = parseTokenId(value, maxSupply);
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: parsed.status });
  return Number(parsed.tokenId);
}

function requireSignature(value: unknown) {
  const signature = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw Object.assign(new Error("Missing or invalid wallet signature."), { status: 400 });
  }
  return signature;
}

function recoverSignedWallet(message: string, signature: string, errorMessage: string) {
  try {
    return normalizeWallet(ethers.verifyMessage(message, signature));
  } catch {
    throw Object.assign(new Error(errorMessage), { status: 401 });
  }
}

function verifyQuoteAuthorization(
  input: Record<string, unknown>,
  wallet: string,
  tokenId: number,
  listing: MarketplaceRegistryListing,
  paymentMode: S2TraitMarketplacePaymentMode,
) {
  const timestamp = String(input.timestamp || "");
  const nonce = String(input.nonce || "").trim();
  const signature = requireSignature(input.signature);
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > QUOTE_AUTH_WINDOW_MS) {
    throw Object.assign(new Error("Marketplace quote authorization expired. Sign a fresh request."), { status: 401 });
  }
  if (!nonce || nonce.length > 160) throw Object.assign(new Error("Invalid marketplace quote nonce."), { status: 400 });

  const message = traitMarketplaceQuoteAuthorizationMessage({
    wallet,
    tokenId,
    listingId: listing.listingId,
    traitType: listing.traitType,
    traitValue: listing.value,
    paymentMode,
    timestamp,
    nonce,
  });
  const recovered = recoverSignedWallet(message, signature, "Marketplace quote signature is invalid.");
  if (recovered !== wallet) throw Object.assign(new Error("Marketplace quote signature does not match the connected wallet."), { status: 401 });

  return {
    quoteId: ethers.keccak256(ethers.concat([ethers.toUtf8Bytes(message), ethers.getBytes(signature)])),
    message,
  };
}

function quoteCostRaw(quote: TraitMarketplaceQuoteRecord) {
  return quote.paymentMode === "mon" ? quote.costMonRaw : quote.costEnergyRaw;
}

function purchaseAuthorization(quote: TraitMarketplaceQuoteRecord) {
  const message = traitMarketplacePurchaseAuthorizationMessage({
    wallet: quote.wallet,
    tokenId: quote.tokenId,
    quoteId: quote.quoteId,
    listingId: quote.listingId,
    traitType: quote.traitType,
    traitValue: quote.traitValue,
    paymentMode: quote.paymentMode,
    costLabel: quote.costLabel,
    costRaw: quoteCostRaw(quote),
    expiresAt: quote.expiresAt,
    nonce: quote.purchaseNonce,
  });
  return { message };
}

export function traitMarketplaceMonPaymentData(quoteId: string) {
  return ethers.hexlify(ethers.toUtf8Bytes(`DYOOR Trait Marketplace:${quoteId.toLowerCase()}`));
}

function quoteResponse(quote: TraitMarketplaceQuoteRecord, previewDataUrl = "") {
  const config = traitLabPublicConfig();
  return {
    ok: true,
    quoteId: quote.quoteId,
    wallet: quote.wallet,
    tokenId: Number(quote.tokenId),
    listingId: quote.listingId,
    traitId: quote.traitId,
    traitType: quote.traitType,
    traitValue: quote.traitValue,
    rarity: quote.rarity,
    traitImage: quote.image,
    paymentMode: quote.paymentMode,
    costEnergy: quote.costEnergy,
    costEnergyRaw: quote.costEnergyRaw,
    costMon: quote.costMon,
    costMonRaw: quote.costMonRaw,
    costLabel: quote.costLabel,
    previousValue: quote.previousValue,
    proposedAttributes: quote.proposedAttributes,
    currentMetadata: quote.currentMetadata,
    proposedMetadata: quote.proposedMetadata,
    previewImageUrl: quote.previewImageUrl,
    previewDataUrl,
    status: quote.status,
    expiresAt: quote.expiresAt,
    paymentTxHash: quote.monPaymentTxHash || "",
    purchaseAuthorization: purchaseAuthorization(quote),
    monPaymentRequest: quote.paymentMode === "mon" ? {
      chainId: config.chainId,
      from: quote.wallet,
      to: config.treasuryWallet,
      value: quote.costMonRaw,
      data: traitMarketplaceMonPaymentData(quote.quoteId),
    } : null,
  };
}

export async function createTraitMarketplaceLivePreview(input: Record<string, unknown>) {
  const wallet = normalizeWallet(input.wallet);
  if (!wallet) throw Object.assign(new Error("wallet must be a valid address."), { status: 400 });
  const listing = marketplaceListing(input.listingId);
  const config = await getRuntimeMetadataConfig();
  const tokenId = parseMarketplaceTokenId(input.tokenId, config.maxSupply);

  await verifyS2TokenOwner(tokenId, wallet, config.maxSupply);
  const { metadata } = await buildTokenMetadataAsync(tokenId, config);
  const currentMetadata = metadata as MetadataJson;
  const currentTraits = traitMapFromMetadata(currentMetadata);
  const selection = prepareTraitMarketplaceSelection(currentTraits, listing.traitType, listing.value);
  if (selection.option.traitId !== listing.traitId) {
    throw Object.assign(new Error("Marketplace listing no longer matches the approved trait registry."), { status: 409 });
  }

  const supplyDeltas = supplyDeltasForPatch(currentTraits, selection.proposedAttributes);
  await assertSupplyDeltasAvailable(supplyDeltas);
  const proposedMetadata = mergeMetadata(currentMetadata, {
    version: metadataVersion(currentMetadata) + 1,
    attributes: selection.proposedAttributes,
  }, tokenId, config) as MetadataJson;
  const previewImage = await renderTraitLabImageRuntime(tokenId, proposedMetadata, String(input.origin || ""), {
    dryRun: true,
    includeDataUrl: true,
  });
  if (!previewImage.rendered || !previewImage.previewDataUrl) {
    throw Object.assign(new Error("Live marketplace preview could not be composed for this Droid."), { status: 503 });
  }

  return {
    ok: true,
    wallet,
    tokenId,
    listingId: listing.listingId,
    traitId: listing.traitId,
    traitType: listing.traitType,
    traitValue: listing.value,
    rarity: listing.rarity,
    previousValue: currentTraits[listing.traitType] || "None",
    proposedAttributes: selection.proposedAttributes,
    currentMetadata,
    previewDataUrl: previewImage.previewDataUrl,
    rendererVersion: previewImage.rendererVersion,
    generatedAt: new Date().toISOString(),
  };
}

export async function createTraitMarketplaceQuote(input: Record<string, unknown>) {
  const wallet = normalizeWallet(input.wallet);
  if (!wallet) throw Object.assign(new Error("wallet must be a valid address."), { status: 400 });
  const listing = marketplaceListing(input.listingId);
  const paymentMode = parseMarketplacePaymentMode(input.paymentMode);
  const config = await getRuntimeMetadataConfig();
  const tokenId = parseMarketplaceTokenId(input.tokenId, config.maxSupply);
  const authorization = verifyQuoteAuthorization(input, wallet, tokenId, listing, paymentMode);
  const existing = await getTraitMarketplaceQuote(authorization.quoteId);
  if (existing) {
    if (existing.wallet !== wallet || existing.tokenId !== String(tokenId) || existing.listingId !== listing.listingId) {
      throw Object.assign(new Error("Marketplace quote authorization conflicts with an existing quote."), { status: 409 });
    }
    if (existing.status === "expired" || (Date.parse(existing.expiresAt) <= Date.now() && existing.status === "quoted")) {
      throw Object.assign(new Error("This marketplace quote expired. Sign a fresh quote request."), { status: 410 });
    }
    return quoteResponse(existing);
  }

  await verifyS2TokenOwner(tokenId, wallet, config.maxSupply);
  const [{ metadata }, currentOverride] = await Promise.all([
    buildTokenMetadataAsync(tokenId, config),
    getRuntimeTraitOverrides(tokenId),
  ]);
  assertTokenCooldownComplete(currentOverride);
  if (currentOverride?.frozen) throw Object.assign(new Error("Token metadata is frozen."), { status: 409 });

  const currentMetadata = metadata as MetadataJson;
  const currentTraits = traitMapFromMetadata(currentMetadata);
  const selection = prepareTraitMarketplaceSelection(currentTraits, listing.traitType, listing.value);
  if (selection.option.traitId !== listing.traitId) {
    throw Object.assign(new Error("Marketplace listing no longer matches the approved trait registry."), { status: 409 });
  }
  const nextMetadataVersion = metadataVersion(currentMetadata) + 1;
  const supplyDeltas = supplyDeltasForPatch(currentTraits, selection.proposedAttributes);
  await assertSupplyDeltasAvailable(supplyDeltas);

  const proposedMetadata = mergeMetadata(currentMetadata, {
    version: nextMetadataVersion,
    attributes: selection.proposedAttributes,
  }, tokenId, config) as MetadataJson;
  const previewImage = await renderTraitLabImageRuntime(tokenId, proposedMetadata, String(input.origin || ""), {
    includeDataUrl: true,
  });
  if (!previewImage.rendered || !previewImage.storage?.persisted || !previewImage.storage?.readable) {
    throw Object.assign(new Error("Marketplace preview image could not be safely persisted. No payment was requested."), { status: 503 });
  }

  const expiresAt = new Date(Date.now() + S2_TRAIT_MARKETPLACE_QUOTE_TTL_MS).toISOString();
  const createdAt = new Date().toISOString();
  const price = traitMarketplacePrice(listing.rarity);
  const costLabel = paymentMode === "mon" ? `${price.mon} MON` : `${price.energy} Energy`;
  const proposedPublicMetadata: MetadataJson = {
    ...proposedMetadata,
    image: previewImage.imageUrl,
    properties: {
      ...(proposedMetadata.properties || {}),
      files: [{ uri: previewImage.imageUrl, type: "image/png" }],
      category: proposedMetadata.properties?.category || "image",
    },
  };
  const record: TraitMarketplaceQuoteRecord = {
    version: 1,
    quoteId: authorization.quoteId,
    wallet,
    tokenId: String(tokenId),
    listingId: listing.listingId,
    traitId: listing.traitId,
    traitType: listing.traitType,
    traitValue: listing.value,
    rarity: listing.rarity,
    image: listing.image,
    paymentMode,
    costEnergy: price.energy,
    costEnergyRaw: price.energyRaw,
    costMon: price.mon,
    costMonRaw: price.monRaw,
    costLabel,
    previousValue: currentTraits[listing.traitType] || "None",
    previousAttributes: currentTraits,
    proposedAttributes: selection.proposedAttributes,
    metadataVersion: nextMetadataVersion,
    supplyDeltas,
    currentMetadata: currentMetadata as Record<string, unknown>,
    proposedMetadata: proposedPublicMetadata as Record<string, unknown>,
    previewImageUrl: previewImage.imageUrl,
    purchaseNonce: crypto.randomUUID(),
    status: "quoted",
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  };

  await saveTraitSupplyReservation({
    version: 1,
    rollId: record.quoteId,
    wallet,
    tokenId: String(tokenId),
    action: "marketplace-buy",
    traitType: listing.traitType,
    deltas: supplyDeltas,
    createdAt,
    expiresAt,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, RESERVATION_SETTLE_MS));
    await assertSupplyDeltasAvailable(supplyDeltas, record.quoteId);
    const saved = await saveTraitMarketplaceQuote(record);
    return quoteResponse(saved, previewImage.previewDataUrl || "");
  } catch (error) {
    await deleteTraitSupplyReservation(record.quoteId).catch(() => undefined);
    throw error;
  }
}

function requireTxHash(value: unknown) {
  const txHash = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    throw Object.assign(new Error("A confirmed MON payment transaction is required."), { status: 400 });
  }
  return txHash;
}

async function verifyTraitMarketplaceMonPayment(quote: TraitMarketplaceQuoteRecord, txHashInput: unknown) {
  const txHash = requireTxHash(txHashInput);
  const config = traitLabPublicConfig();
  const provider = energyRpcProvider();
  await assertMonadMainnet(provider);
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!tx) throw Object.assign(new Error("Marketplace payment is not available yet."), { status: 409 });
  if (!receipt) throw Object.assign(new Error("Marketplace payment is not confirmed yet."), { status: 409 });
  if (receipt.status !== 1) throw Object.assign(new Error("Marketplace payment failed on-chain."), { status: 400 });
  if (Number(tx.chainId) !== MONAD_CHAIN_ID) throw Object.assign(new Error("Marketplace payment used the wrong network."), { status: 400 });
  if (normalizeWallet(tx.from) !== quote.wallet) throw Object.assign(new Error("Marketplace payment sender does not match the quote wallet."), { status: 400 });
  if (normalizeWallet(tx.to) !== normalizeWallet(config.treasuryWallet)) throw Object.assign(new Error("Marketplace payment recipient does not match the treasury."), { status: 400 });
  if (tx.value !== BigInt(quote.costMonRaw)) throw Object.assign(new Error("Marketplace payment amount does not exactly match the quote."), { status: 400 });
  if (String(tx.data || "0x").toLowerCase() !== traitMarketplaceMonPaymentData(quote.quoteId).toLowerCase()) {
    throw Object.assign(new Error("Marketplace payment reference does not match this quote."), { status: 400 });
  }
  return {
    txHash,
    blockNumber: String(receipt.blockNumber || ""),
    treasuryWallet: normalizeWallet(config.treasuryWallet),
  };
}

function verifyPurchaseAuthorization(quote: TraitMarketplaceQuoteRecord, input: Record<string, unknown>) {
  const signature = requireSignature(input.signature);
  const expected = purchaseAuthorization(quote).message;
  const recovered = recoverSignedWallet(expected, signature, "Marketplace purchase signature is invalid.");
  if (recovered !== quote.wallet) {
    throw Object.assign(new Error("Marketplace purchase signature does not match the quote wallet."), { status: 401 });
  }
}

function proposedPatchAlreadyApplied(currentTraits: Record<string, string>, quote: TraitMarketplaceQuoteRecord) {
  return Object.entries(quote.proposedAttributes).every(([traitType, value]) => valuesMatch(currentTraits[traitType], value));
}

function assertQuoteStillCurrent(currentTraits: Record<string, string>, currentVersion: number, quote: TraitMarketplaceQuoteRecord) {
  if (currentVersion !== quote.metadataVersion - 1) {
    throw Object.assign(new Error("Droid metadata changed after this quote. Create a fresh marketplace quote."), { status: 409 });
  }
  for (const [traitType, previousValue] of Object.entries(quote.previousAttributes)) {
    if (!valuesMatch(currentTraits[traitType], previousValue)) {
      throw Object.assign(new Error("Droid traits changed after this quote. Create a fresh marketplace quote."), { status: 409 });
    }
  }
  const selection = prepareTraitMarketplaceSelection(currentTraits, quote.traitType as S2TraitMarketplaceSlot, quote.traitValue);
  const expectedEntries = Object.entries(quote.proposedAttributes).sort(([left], [right]) => left.localeCompare(right));
  const actualEntries = Object.entries(selection.proposedAttributes).sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(expectedEntries) !== JSON.stringify(actualEntries)) {
    throw Object.assign(new Error("Marketplace compatibility rules changed after this quote. Create a fresh quote."), { status: 409 });
  }
}

async function chargeTraitMarketplaceQuote(quote: TraitMarketplaceQuoteRecord, input: Record<string, unknown>) {
  if (quote.status === "charged" || quote.status === "committing" || quote.status === "metadata_committed" || quote.status === "recovery_required") {
    return quote;
  }
  const charging = await saveTraitMarketplaceQuote({
    ...quote,
    status: "charging",
  });

  if (quote.paymentMode === "energy") {
    const provider = energyRpcProvider();
    await assertMonadMainnet(provider);
    const bank = new ethers.Contract(energyBankContract, ENERGY_BANK_ABI, provider);
    const availableRaw = BigInt(await bank.spendableEnergy(quote.wallet));
    const debit = await claimTraitLabEnergyDebit({
      rollId: quote.quoteId,
      wallet: quote.wallet,
      tokenId: quote.tokenId,
      action: "marketplace-buy",
      amountRaw: quote.costEnergyRaw,
      availableRaw: availableRaw.toString(),
    });
    const saved = await saveTraitMarketplaceQuote({
      ...charging,
      status: "charged",
      chargedAt: new Date().toISOString(),
      energyDebitId: debit.debit.id,
      energyDebitDeduped: debit.deduped,
    });
    await extendTraitSupplyReservation(quote.quoteId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return saved;
  }

  const payment = await verifyTraitMarketplaceMonPayment(quote, input.paymentTxHash || quote.monPaymentTxHash);
  await saveTraitMarketplaceQuote({
    ...charging,
    monPaymentTxHash: payment.txHash,
    monPaymentBlockNumber: payment.blockNumber,
  });
  const claimed = await claimTraitMarketplaceMonPayment({
    version: 1,
    txHash: payment.txHash,
    quoteId: quote.quoteId,
    wallet: quote.wallet,
    tokenId: quote.tokenId,
    listingId: quote.listingId,
    amountRaw: quote.costMonRaw,
    treasuryWallet: payment.treasuryWallet,
    blockNumber: payment.blockNumber,
    createdAt: new Date().toISOString(),
  });
  const saved = await saveTraitMarketplaceQuote({
    ...charging,
    status: "charged",
    chargedAt: new Date().toISOString(),
    monPaymentTxHash: payment.txHash,
    monPaymentBlockNumber: payment.blockNumber,
    monPaymentDeduped: claimed.deduped,
  });
  await extendTraitSupplyReservation(quote.quoteId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
  return saved;
}

export async function purchaseTraitMarketplaceQuote(input: Record<string, unknown>) {
  const quoteId = String(input.quoteId || "").trim().toLowerCase();
  const quote = await getTraitMarketplaceQuote(quoteId);
  if (!quote) throw Object.assign(new Error("Marketplace quote was not found."), { status: 404 });
  const wallet = normalizeWallet(input.wallet);
  if (!wallet || wallet !== quote.wallet) throw Object.assign(new Error("Marketplace quote wallet does not match the connected wallet."), { status: 403 });
  verifyPurchaseAuthorization(quote, input);
  if (quote.status === "completed" && quote.result) return { ...quote.result, deduped: true };

  const submittedPaymentTxHash = String(input.paymentTxHash || "").trim().toLowerCase();
  const paymentAlreadyCharged = Boolean(
    quote.chargedAt
    || quote.energyDebitId
    || quote.monPaymentTxHash
    || (quote.paymentMode === "mon" && /^0x[a-f0-9]{64}$/.test(submittedPaymentTxHash)),
  );
  if (Date.parse(quote.expiresAt) <= Date.now() && !paymentAlreadyCharged) {
    await saveTraitMarketplaceQuote({ ...quote, status: "expired" });
    await deleteTraitSupplyReservation(quote.quoteId).catch(() => undefined);
    throw Object.assign(new Error("Marketplace quote expired before payment. Create a fresh quote."), { status: 410 });
  }

  let chargedQuote = quote;
  try {
    // A MON transfer has already left the holder's wallet before this endpoint
    // runs. Record it first so every later validation or storage failure remains
    // visible and recoverable. Energy is still charged only after all prechecks.
    if (quote.paymentMode === "mon") {
      chargedQuote = await chargeTraitMarketplaceQuote(quote, input);
    }

    const config = await getRuntimeMetadataConfig();
    const tokenId = parseMarketplaceTokenId(quote.tokenId, config.maxSupply);
    await verifyS2TokenOwner(tokenId, wallet, config.maxSupply);
    let { metadata } = await buildTokenMetadataAsync(tokenId, config);
    let currentMetadata = metadata as MetadataJson;
    let currentTraits = traitMapFromMetadata(currentMetadata);
    let patchAlreadyApplied = proposedPatchAlreadyApplied(currentTraits, quote);
    const currentOverride = await getRuntimeTraitOverrides(tokenId);
    if (currentOverride?.frozen) throw Object.assign(new Error("Token metadata is frozen."), { status: 409 });

    let renderedImage: Awaited<ReturnType<typeof renderTraitLabImageRuntime>> | null = null;
    if (!patchAlreadyApplied) {
      assertQuoteStillCurrent(currentTraits, metadataVersion(currentMetadata), quote);
      await assertSupplyDeltasAvailable(quote.supplyDeltas, quote.quoteId);
      const draftMetadata = mergeMetadata(currentMetadata, {
        ...(currentOverride || {}),
        version: quote.metadataVersion,
        attributes: {
          ...(currentOverride?.attributes || {}),
          ...quote.proposedAttributes,
        },
      }, tokenId, config) as MetadataJson;
      renderedImage = await renderTraitLabImageRuntime(tokenId, draftMetadata, String(input.origin || ""));
      if (!renderedImage.rendered || !renderedImage.storage?.persisted || !renderedImage.storage?.readable) {
        const message = quote.paymentMode === "mon"
          ? "MON payment is recorded, but the marketplace image could not be safely stored. Restore the purchase to retry settlement."
          : "Marketplace image could not be safely stored. Purchase was not charged.";
        throw Object.assign(new Error(message), { status: 503 });
      }
    }

    if (quote.paymentMode === "energy") {
      chargedQuote = await chargeTraitMarketplaceQuote(quote, input);
    }
    await saveTraitMarketplaceQuote({
      ...chargedQuote,
      status: "committing",
      committingAt: new Date().toISOString(),
    });

    // Re-read after charging so a concurrent metadata edit can never be silently overwritten.
    ({ metadata } = await buildTokenMetadataAsync(tokenId, config));
    currentMetadata = metadata as MetadataJson;
    currentTraits = traitMapFromMetadata(currentMetadata);
    patchAlreadyApplied = proposedPatchAlreadyApplied(currentTraits, quote);
    if (!patchAlreadyApplied) {
      assertQuoteStillCurrent(currentTraits, metadataVersion(currentMetadata), quote);
      const latestOverride = await getRuntimeTraitOverrides(tokenId);
      if (latestOverride?.frozen) throw Object.assign(new Error("Token metadata is frozen."), { status: 409 });
      if (!renderedImage?.rendered) {
        const recoveryMetadata = mergeMetadata(currentMetadata, {
          ...(latestOverride || {}),
          version: quote.metadataVersion,
          attributes: {
            ...(latestOverride?.attributes || {}),
            ...quote.proposedAttributes,
          },
        }, tokenId, config) as MetadataJson;
        renderedImage = await renderTraitLabImageRuntime(tokenId, recoveryMetadata, String(input.origin || ""));
      }
      if (!renderedImage?.rendered || !renderedImage.storage?.persisted || !renderedImage.storage?.readable) {
        throw Object.assign(new Error("Marketplace image persistence failed during purchase recovery."), { status: 503 });
      }

      await saveRuntimeTraitOverride(tokenId, {
        ...(latestOverride || {}),
        version: quote.metadataVersion,
        attributes: {
          ...(latestOverride?.attributes || {}),
          ...quote.proposedAttributes,
        },
        image: renderedImage.imageUrl,
        imageRender: {
          imageId: renderedImage.imageId,
          url: renderedImage.imageUrl,
          rendererVersion: renderedImage.rendererVersion,
          renderedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
        updatedBy: wallet,
        notes: `Trait Marketplace purchase ${quote.listingId}.`,
      });
    }

    const metadataCommittedQuote = await saveTraitMarketplaceQuote({
      ...chargedQuote,
      status: "metadata_committed",
      metadataCommittedAt: new Date().toISOString(),
    });
    const supplyEventId = `trait-marketplace:${quote.quoteId}`;
    const existingSupplyEvent = await getTraitSupplyEvent(supplyEventId);
    const supply = existingSupplyEvent
      ? { event: existingSupplyEvent, deduped: true }
      : await applyTraitSupplyDeltas({
        id: supplyEventId,
        rollId: quote.quoteId,
        wallet,
        tokenId: String(tokenId),
        action: "marketplace-buy",
        traitType: quote.traitType,
        deltas: quote.supplyDeltas as TraitSupplyDelta[],
        createdAt: new Date().toISOString(),
      });
    await deleteTraitSupplyReservation(quote.quoteId).catch(() => undefined);

    const updated = await buildTokenMetadataAsync(tokenId, config);
    await processDueOpenSeaMetadataRefreshes().catch(() => undefined);
    const openSeaMetadataRefresh = await refreshOpenSeaTokenMetadataNowAndLater({
      tokenId,
      reason: "trait_marketplace_purchase",
    }).catch((error) => ({
      status: "failed" as const,
      tokenId: String(tokenId),
      error: error instanceof Error ? error.message : "refresh_failed",
    }));
    const completedAt = new Date().toISOString();
    const result = {
      ok: true,
      quoteId: quote.quoteId,
      wallet,
      tokenId,
      listingId: quote.listingId,
      traitId: quote.traitId,
      traitType: quote.traitType,
      traitValue: quote.traitValue,
      rarity: quote.rarity,
      paymentMode: quote.paymentMode,
      costEnergy: quote.costEnergy,
      costEnergyRaw: quote.costEnergyRaw,
      costMon: quote.costMon,
      costMonRaw: quote.costMonRaw,
      costLabel: quote.costLabel,
      paymentTxHash: metadataCommittedQuote.monPaymentTxHash || "",
      paymentBlockNumber: metadataCommittedQuote.monPaymentBlockNumber || "",
      energyDebitId: metadataCommittedQuote.energyDebitId || "",
      paymentDeduped: Boolean(metadataCommittedQuote.energyDebitDeduped || metadataCommittedQuote.monPaymentDeduped),
      supplyEventDeduped: supply.deduped,
      proposedAttributes: quote.proposedAttributes,
      metadata: updated.metadata,
      openSeaMetadataRefresh,
      completedAt,
    };
    await saveTraitMarketplaceQuote({
      ...metadataCommittedQuote,
      status: "completed",
      completedAt,
      result,
    });
    return result;
  } catch (error) {
    const latest = await getTraitMarketplaceQuote(quote.quoteId).catch(() => chargedQuote) || chargedQuote;
    const persistedEnergyDebit = quote.paymentMode === "energy"
      ? await getTraitLabEnergyDebit(quote.wallet, quote.quoteId).catch(() => null)
      : null;
    const charged = Boolean(
      latest.chargedAt
      || latest.energyDebitId
      || latest.monPaymentTxHash
      || persistedEnergyDebit?.status === "charged",
    );
    if (charged) {
      await extendTraitSupplyReservation(quote.quoteId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()).catch(() => undefined);
      await saveTraitMarketplaceQuote({
        ...latest,
        status: "recovery_required",
        failedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "Marketplace purchase requires recovery.",
        energyDebitId: latest.energyDebitId || persistedEnergyDebit?.id,
      }).catch(() => undefined);
    }
    const failure = error instanceof Error ? error : new Error("Marketplace purchase failed.");
    Object.assign(failure, {
      quoteId: quote.quoteId,
      recoveryRequired: charged,
    });
    throw failure;
  }
}

export async function getTraitMarketplaceQuoteStatus(quoteIdInput: unknown, walletInput: unknown) {
  const quoteId = String(quoteIdInput || "").trim().toLowerCase();
  const quote = await getTraitMarketplaceQuote(quoteId);
  if (!quote) throw Object.assign(new Error("Marketplace quote was not found."), { status: 404 });
  const wallet = normalizeWallet(walletInput);
  if (!wallet || wallet !== quote.wallet) throw Object.assign(new Error("Marketplace quote wallet does not match."), { status: 403 });
  if (quote.status === "quoted" && Date.parse(quote.expiresAt) <= Date.now()) {
    const expired = await saveTraitMarketplaceQuote({ ...quote, status: "expired" });
    await deleteTraitSupplyReservation(quote.quoteId).catch(() => undefined);
    return quoteResponse(expired);
  }
  return quoteResponse(quote);
}

export function isMarketplaceTraitType(value: unknown): value is S2TraitMarketplaceSlot {
  return isS2TraitMarketplaceSlot(value);
}
