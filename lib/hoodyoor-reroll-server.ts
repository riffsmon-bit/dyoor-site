import "server-only";

import { ethers } from "ethers";
import {
  generateHoodYoorRerollCandidate,
  hoodYoorCatalogSummary,
  hoodYoorTraitSnapshot,
  unpackHoodYoorTraits,
} from "@/lib/hoodyoor-reroll-catalog.js";
import {
  hoodYoorPreviewRequestMessage,
  hoodYoorPaymentCode,
  hoodYoorRerollTypedData,
  HOODYOOR_ACTION_ALL,
  HOODYOOR_ACTION_SINGLE,
  HOODYOOR_ALL_LAYERS,
  HOODYOOR_LAYER_COSTS,
  HOODYOOR_LAYERS,
  HOODYOOR_MAX_SUPPLY,
  HOODYOOR_MUTABLE_LAYERS,
  HOODYOOR_PREVIEW_TTL_MS,
  HOODYOOR_PAYMENT_ENERGY,
  HOODYOOR_REROLL_ALL_COST,
  HOODYOOR_REROLL_TYPES,
  normalizeHoodYoorWallet,
  parseHoodYoorTokenId,
  type HoodYoorRerollAction,
  type HoodYoorRerollAuthorization,
  type HoodYoorRerollPayment,
} from "@/lib/hoodyoor-reroll";
import { createJsonStore } from "@/src/lib/storage/fileStore";

const COLLECTION_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenTraits(uint256 tokenId) view returns (uint256)",
  "function rerollController() view returns (address)",
  "function rerollControllerFrozen() view returns (bool)",
  "function initialTraitsFrozen() view returns (bool)",
  "function rendererFrozen() view returns (bool)",
  "function revealed() view returns (bool)",
] as const;

const CONTROLLER_ABI = [
  "function collection() view returns (address)",
  "function energyBank() view returns (address)",
  "function traitRules() view returns (address)",
  "function resultSigner() view returns (address)",
  "function usdg() view returns (address)",
  "function treasury() view returns (address)",
  "function paused() view returns (bool)",
  "function paymentConfigurationFrozen() view returns (bool)",
  "function weiPerEnergy() view returns (uint256)",
  "function usdgUnitsPerEnergy() view returns (uint256)",
  "function tokenNonces(uint256 tokenId) view returns (uint256)",
  "function quoteEnergy(uint256 tokenId,uint8 layer,uint16 nextTraitId) view returns (uint256)",
  "function quoteRerollAll(uint256 tokenId,uint256 nextTraits) view returns (uint256)",
  "function quotePayment(uint256 energyUnits,uint8 paymentMethod) view returns (address paymentToken,uint256 paymentAmount)",
  "function rerollDigest((uint256 tokenId,address tokenOwner,uint256 expectedTraits,uint256 nextTraits,uint8 action,uint8 layer,uint8 paymentMethod,address paymentToken,uint256 paymentAmount,uint256 nonce,uint256 deadline) authorization) view returns (bytes32)",
  "function confirmRerollEnergy((uint256 tokenId,address tokenOwner,uint256 expectedTraits,uint256 nextTraits,uint8 action,uint8 layer,uint8 paymentMethod,address paymentToken,uint256 paymentAmount,uint256 nonce,uint256 deadline) authorization,bytes ownerSignature,bytes resultSignature)",
] as const;

const ENERGY_BANK_ABI = [
  "function energyBalance(address user) view returns (uint256)",
  "function SPENDER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
] as const;

const TRAIT_RULES_ABI = [
  "function frozen() view returns (bool)",
  "function pairCount() view returns (uint16)",
  "function rulesHash() view returns (bytes32)",
] as const;

const ERC1271_ABI = [
  "function isValidSignature(bytes32 digest,bytes signature) view returns (bytes4)",
] as const;

const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const STORE_NAME = "dyoor-hoodyoor-rerolls";
const ACTIVE_PREFIX = "active/";
const PREVIEW_PREFIX = "previews/";
const PREVIEW_REQUEST_CLOCK_SKEW_MS = 30_000;
const ALLOWED_CHAIN_IDS = new Set([4_663, 46_630]);
const ROBINHOOD_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const store = createJsonStore(STORE_NAME);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const tokenLocks = new Map<string, Promise<void>>();

type HoodYoorServerError = Error & {
  status?: number;
  code?: string;
};

type HoodYoorRuntime = {
  chainId: number;
  chainName: string;
  collectionAddress: string;
  controllerAddress: string;
  energyBankAddress: string;
  explorerUrl: string;
  provider: ethers.JsonRpcProvider;
  relayer: ethers.Wallet;
  resultSigner: ethers.Wallet;
};

type StoredPreviewStatus = "active" | "submitting" | "submitted" | "confirmed" | "expired" | "stale";

type StoredHoodYoorPreview = {
  version: 2;
  id: string;
  status: StoredPreviewStatus;
  wallet: string;
  tokenId: number;
  action: HoodYoorRerollAction;
  layer: number;
  payment: HoodYoorRerollPayment;
  energyUnits: string;
  createdAt: string;
  expiresAt: string;
  authorization: HoodYoorRerollAuthorization;
  resultSignature: string;
  energyBalanceAtPreview: string;
  beforeTraits: ReturnType<typeof hoodYoorTraitSnapshot>;
  afterTraits: ReturnType<typeof hoodYoorTraitSnapshot>;
  transactionHash?: string;
  confirmedAt?: string;
};

type WiringSnapshot = {
  checkedAt: number;
  collectionFrozen: boolean;
  relayerAddress: string;
  resultSignerAddress: string;
  rulesAddress: string;
  usdgAddress: string;
  treasuryAddress: string;
  weiPerEnergy: string;
  usdgUnitsPerEnergy: string;
  energyRelayerReady: boolean;
};

let runtimeCache: { key: string; value: HoodYoorRuntime } | null = null;
let wiringCache: { key: string; value: WiringSnapshot } | null = null;

function routeError(message: string, status = 500, code = "HOODYOOR_ERROR") {
  return Object.assign(new Error(message), { status, code }) as HoodYoorServerError;
}

function readEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function enabledFlag(value: string) {
  return /^(1|true|yes|on)$/i.test(value);
}

function normalizedPrivateKey(value: string) {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(candidate) ? candidate : "";
}

function requiredAddress(name: string) {
  const value = readEnv(name);
  try {
    return ethers.getAddress(value);
  } catch {
    throw routeError("HoodYØØR Trait Lab contract configuration is incomplete.", 503, "NOT_CONFIGURED");
  }
}

function explorerTransactionUrl(runtime: HoodYoorRuntime, transactionHash: string) {
  return runtime.explorerUrl && transactionHash
    ? `${runtime.explorerUrl}/tx/${transactionHash}`
    : "";
}

function hoodYoorTraitImageUrl(packedTraits: string) {
  return `/api/robinhood/trait-lab/image?traits=${encodeURIComponent(packedTraits)}`;
}

function activeKey(tokenId: number) {
  return `${ACTIVE_PREFIX}${tokenId}.json`;
}

function previewKey(previewId: string) {
  return `${PREVIEW_PREFIX}${previewId}.json`;
}

function validPreviewId(value: unknown) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-f0-9-]{32,64}$/.test(id) ? id : "";
}

function validRequestNonce(value: string) {
  return /^[a-zA-Z0-9-]{16,96}$/.test(value);
}

function validSignature(value: string) {
  return /^0x(?:[a-fA-F0-9]{2})+$/.test(value);
}

function parseAction(value: unknown): HoodYoorRerollAction {
  if (value === "single" || value === "all") return value;
  throw routeError("Choose a HoodYØØR reroll option.", 400, "INVALID_ACTION");
}

function parsePayment(value: unknown): HoodYoorRerollPayment {
  if (value === "energy" || value === "eth" || value === "usdg") return value;
  throw routeError("Choose Energy, ETH, or USDG for this reroll.", 400, "INVALID_PAYMENT");
}

function parseLayer(action: HoodYoorRerollAction, value: unknown) {
  if (action === "all") return HOODYOOR_ALL_LAYERS;
  const layer = Number(value);
  if (!Number.isInteger(layer) || !HOODYOOR_MUTABLE_LAYERS.includes(layer as 2 | 3 | 4 | 5 | 6 | 7 | 8)) {
    throw routeError("Choose a mutable HoodYØØR trait layer.", 400, "INVALID_LAYER");
  }
  return layer;
}

function deterministicRerollRandomInt({
  runtime,
  tokenId,
  packedTraits,
  nonce,
  action,
  layer,
}: {
  runtime: HoodYoorRuntime;
  tokenId: number;
  packedTraits: string;
  nonce: string;
  action: HoodYoorRerollAction;
  layer: number;
}) {
  const seedDigest = ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "uint256", "uint256", "uint256", "uint8", "uint8"],
    [
      "HOODYOOR_REROLL_RANDOM_V1",
      runtime.chainId,
      runtime.controllerAddress,
      tokenId,
      packedTraits,
      nonce,
      action === "single" ? HOODYOOR_ACTION_SINGLE : HOODYOOR_ACTION_ALL,
      layer,
    ],
  );
  const signedSeed = runtime.resultSigner.signingKey.sign(seedDigest).serialized;
  let cursor = 0n;
  return (maxExclusive: number) => {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw routeError("The HoodYØØR trait catalog has an invalid random range.", 500, "INVALID_RANDOM_RANGE");
    }
    const roll = ethers.solidityPackedKeccak256(
      ["bytes", "uint256"],
      [signedSeed, cursor],
    );
    cursor += 1n;
    return Number(BigInt(roll) % BigInt(maxExclusive));
  };
}

function publicConfig(runtime?: HoodYoorRuntime, wiring?: WiringSnapshot) {
  const configuredChainId = Number(readEnv("HOODYOOR_CHAIN_ID"));
  const chainId = runtime?.chainId || (ALLOWED_CHAIN_IDS.has(configuredChainId) ? configuredChainId : 46_630);
  return {
    collection: "HoodYØØR",
    chainId,
    chainHex: `0x${chainId.toString(16)}`,
    chainName: runtime?.chainName || (chainId === 46_630 ? "Robinhood Chain Testnet" : "Robinhood Chain"),
    rpcUrl: chainId === 46_630
      ? "https://rpc.testnet.chain.robinhood.com"
      : "https://rpc.mainnet.chain.robinhood.com",
    explorerUrl: runtime?.explorerUrl || "",
    collectionAddress: runtime?.collectionAddress || "",
    controllerAddress: runtime?.controllerAddress || "",
    maxSupply: HOODYOOR_MAX_SUPPLY,
    previewTtlMs: HOODYOOR_PREVIEW_TTL_MS,
    rerollAllCost: HOODYOOR_REROLL_ALL_COST,
    layerCosts: HOODYOOR_LAYER_COSTS,
    layers: HOODYOOR_LAYERS.map((name, layer) => ({
      layer,
      name,
      mutable: HOODYOOR_MUTABLE_LAYERS.includes(layer as 2 | 3 | 4 | 5 | 6 | 7 | 8),
      energyCost: HOODYOOR_LAYER_COSTS[layer] || 0,
    })),
    catalog: hoodYoorCatalogSummary,
    settlement: "holder-choice",
    usdgAddress: wiring?.usdgAddress || "",
    treasuryAddress: wiring?.treasuryAddress || "",
    weiPerEnergy: wiring?.weiPerEnergy || "",
    usdgUnitsPerEnergy: wiring?.usdgUnitsPerEnergy || "",
    energyRelayerReady: wiring?.energyRelayerReady || false,
    paymentMethods: [
      { id: "energy", code: 1, label: "Energy", gasless: true },
      { id: "eth", code: 2, label: "ETH", gasless: false },
      { id: "usdg", code: 3, label: "USDG", gasless: false, decimals: 6 },
    ],
  };
}

function loadRuntime() {
  if (!enabledFlag(readEnv("HOODYOOR_TRAIT_LAB_ENABLED"))) {
    throw routeError("HoodYØØR Trait Lab is not enabled yet.", 503, "DISABLED");
  }

  const rpcUrl = readEnv("HOODYOOR_RPC_URL");
  const chainId = Number(readEnv("HOODYOOR_CHAIN_ID"));
  const resultSignerPrivateKey = normalizedPrivateKey(readEnv("HOODYOOR_RESULT_SIGNER_PRIVATE_KEY"));
  const relayerPrivateKey = normalizedPrivateKey(
    readEnv("HOODYOOR_RELAYER_PRIVATE_KEY") || readEnv("HOODYOOR_RESULT_SIGNER_PRIVATE_KEY"),
  );
  if (!rpcUrl || !ALLOWED_CHAIN_IDS.has(chainId) || !resultSignerPrivateKey || !relayerPrivateKey) {
    throw routeError("HoodYØØR Trait Lab server configuration is incomplete.", 503, "NOT_CONFIGURED");
  }
  if (chainId === 4_663 && !enabledFlag(readEnv("ALLOW_HOODYOOR_MAINNET"))) {
    throw routeError("HoodYØØR mainnet rerolls require an explicit launch flag.", 503, "MAINNET_LOCKED");
  }

  const collectionAddress = requiredAddress("HOODYOOR_COLLECTION_ADDRESS");
  const energyBankAddress = requiredAddress("HOODYOOR_ENERGY_BANK_ADDRESS");
  const controllerAddress = requiredAddress("HOODYOOR_REROLL_CONTROLLER_ADDRESS");
  const cacheKey = [
    rpcUrl,
    chainId,
    collectionAddress,
    energyBankAddress,
    controllerAddress,
    resultSignerPrivateKey,
    relayerPrivateKey,
  ].join(":");
  if (runtimeCache?.key === cacheKey) return runtimeCache.value;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const resultSigner = new ethers.Wallet(resultSignerPrivateKey, provider);
  const relayer = new ethers.Wallet(relayerPrivateKey, provider);
  const explorerUrl = readEnv("HOODYOOR_EXPLORER_URL").replace(/\/+$/, "");
  const value: HoodYoorRuntime = {
    chainId,
    chainName: readEnv("HOODYOOR_CHAIN_NAME") || (chainId === 46_630 ? "Robinhood Chain Testnet" : "Robinhood Chain"),
    collectionAddress,
    controllerAddress,
    energyBankAddress,
    explorerUrl,
    provider,
    relayer,
    resultSigner,
  };
  runtimeCache = { key: cacheKey, value };
  wiringCache = null;
  return value;
}

async function assertDeploymentReady(runtime: HoodYoorRuntime) {
  const cacheKey = [
    runtime.chainId,
    runtime.collectionAddress,
    runtime.energyBankAddress,
    runtime.controllerAddress,
    runtime.resultSigner.address,
    runtime.relayer.address,
  ].join(":");
  if (wiringCache?.key === cacheKey && Date.now() - wiringCache.value.checkedAt < 15_000) {
    return wiringCache.value;
  }

  try {
    const network = await runtime.provider.getNetwork();
    if (Number(network.chainId) !== runtime.chainId) {
      throw routeError("The HoodYØØR RPC is connected to the wrong chain.", 503, "WRONG_RPC_CHAIN");
    }
    const [collectionCode, energyCode, controllerCode] = await Promise.all([
      runtime.provider.getCode(runtime.collectionAddress),
      runtime.provider.getCode(runtime.energyBankAddress),
      runtime.provider.getCode(runtime.controllerAddress),
    ]);
    if (collectionCode === "0x" || energyCode === "0x" || controllerCode === "0x") {
      throw routeError("A configured HoodYØØR contract is not deployed on this chain.", 503, "MISSING_CONTRACT");
    }

    const controller = new ethers.Contract(runtime.controllerAddress, CONTROLLER_ABI, runtime.provider);
    const [
      wiredCollection,
      wiredEnergyBank,
      rulesAddressRaw,
      resultSigner,
      usdgAddressRaw,
      treasuryAddressRaw,
      paused,
      paymentConfigurationFrozen,
      weiPerEnergy,
      usdgUnitsPerEnergy,
    ] = await Promise.all([
      controller.collection(),
      controller.energyBank(),
      controller.traitRules(),
      controller.resultSigner(),
      controller.usdg(),
      controller.treasury(),
      controller.paused(),
      controller.paymentConfigurationFrozen(),
      controller.weiPerEnergy(),
      controller.usdgUnitsPerEnergy(),
    ]);
    const rulesAddress = ethers.getAddress(rulesAddressRaw);
    const usdgAddress = ethers.getAddress(usdgAddressRaw);
    const treasuryAddress = ethers.getAddress(treasuryAddressRaw);
    if (ethers.getAddress(wiredCollection) !== runtime.collectionAddress) {
      throw routeError("The reroll controller is wired to a different collection.", 503, "BAD_COLLECTION_WIRING");
    }
    if (ethers.getAddress(wiredEnergyBank) !== runtime.energyBankAddress) {
      throw routeError("The reroll controller is wired to a different Energy Bank.", 503, "BAD_ENERGY_WIRING");
    }
    if (ethers.getAddress(resultSigner) !== runtime.resultSigner.address) {
      throw routeError("The configured result signer does not match the reroll controller.", 503, "BAD_RESULT_SIGNER");
    }
    if (paused) throw routeError("HoodYØØR rerolls are temporarily paused.", 503, "PAUSED");
    if (!paymentConfigurationFrozen || weiPerEnergy === 0n || usdgUnitsPerEnergy === 0n) {
      throw routeError("The HoodYØØR reroll prices are not permanently frozen.", 503, "PAYMENTS_NOT_FROZEN");
    }
    if (runtime.chainId === 4_663 && usdgAddress !== ethers.getAddress(ROBINHOOD_USDG)) {
      throw routeError("The reroll controller is not wired to canonical Robinhood USDG.", 503, "BAD_USDG_WIRING");
    }
    if (await runtime.provider.getCode(rulesAddress) === "0x") {
      throw routeError("The HoodYØØR trait rule registry is missing.", 503, "MISSING_RULES");
    }
    if (await runtime.provider.getCode(usdgAddress) === "0x") {
      throw routeError("The configured USDG contract is missing.", 503, "MISSING_USDG");
    }

    const collection = new ethers.Contract(runtime.collectionAddress, COLLECTION_ABI, runtime.provider);
    const rules = new ethers.Contract(rulesAddress, TRAIT_RULES_ABI, runtime.provider);
    const energyBank = new ethers.Contract(runtime.energyBankAddress, ENERGY_BANK_ABI, runtime.provider);
    const [
      wiredController,
      rerollControllerFrozen,
      initialTraitsFrozen,
      rendererFrozen,
      collectionRevealed,
      rulesFrozen,
      rulesHash,
      pairCount,
      spenderRole,
      relayerBalance,
    ] = await Promise.all([
      collection.rerollController(),
      collection.rerollControllerFrozen(),
      collection.initialTraitsFrozen(),
      collection.rendererFrozen(),
      collection.revealed(),
      rules.frozen(),
      rules.rulesHash(),
      rules.pairCount(),
      energyBank.SPENDER_ROLE(),
      runtime.provider.getBalance(runtime.relayer.address),
    ]);
    if (ethers.getAddress(wiredController) !== runtime.controllerAddress) {
      throw routeError("The collection is not wired to the reroll controller.", 503, "BAD_CONTROLLER_WIRING");
    }
    if (!rerollControllerFrozen || !initialTraitsFrozen || !rendererFrozen) {
      throw routeError("The HoodYØØR collection launch configuration is not frozen.", 503, "COLLECTION_NOT_FROZEN");
    }
    if (!collectionRevealed) {
      throw routeError("HoodYØØR rerolls unlock after the collection reveal.", 503, "COLLECTION_UNREVEALED");
    }
    if (!rulesFrozen || String(rulesHash).toLowerCase() !== hoodYoorCatalogSummary.rulesHash.toLowerCase()) {
      throw routeError("The onchain compatibility rules do not match the reviewed catalog.", 503, "BAD_RULES_HASH");
    }
    if (Number(pairCount) !== hoodYoorCatalogSummary.expectedPairCount) {
      throw routeError("The onchain compatibility rule count is incomplete.", 503, "BAD_RULE_COUNT");
    }
    if (!await energyBank.hasRole(spenderRole, runtime.controllerAddress)) {
      throw routeError("The reroll controller cannot spend Energy yet.", 503, "MISSING_SPENDER_ROLE");
    }
    const value: WiringSnapshot = {
      checkedAt: Date.now(),
      collectionFrozen: true,
      relayerAddress: runtime.relayer.address,
      resultSignerAddress: runtime.resultSigner.address,
      rulesAddress,
      usdgAddress,
      treasuryAddress,
      weiPerEnergy: weiPerEnergy.toString(),
      usdgUnitsPerEnergy: usdgUnitsPerEnergy.toString(),
      energyRelayerReady: relayerBalance > 0n,
    };
    wiringCache = { key: cacheKey, value };
    return value;
  } catch (error) {
    if ((error as HoodYoorServerError)?.status) throw error;
    throw routeError("The HoodYØØR testnet contracts could not be verified.", 503, "RPC_UNAVAILABLE");
  }
}

async function withTokenLock<T>(tokenId: number, task: () => Promise<T>) {
  const key = String(tokenId);
  const previous = tokenLocks.get(key) || Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tokenLocks.set(key, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (tokenLocks.get(key) === tail) tokenLocks.delete(key);
  }
}

async function readTokenState(runtime: HoodYoorRuntime, tokenId: number, wallet = "") {
  const collection = new ethers.Contract(runtime.collectionAddress, COLLECTION_ABI, runtime.provider);
  const controller = new ethers.Contract(runtime.controllerAddress, CONTROLLER_ABI, runtime.provider);
  let owner: string;
  let packedTraits: bigint;
  try {
    [owner, packedTraits] = await Promise.all([
      collection.ownerOf(tokenId),
      collection.tokenTraits(tokenId),
    ]);
  } catch {
    throw routeError(`HoodYØØR #${tokenId} is not minted on this chain.`, 404, "TOKEN_NOT_FOUND");
  }
  owner = ethers.getAddress(owner);
  const [nonce, energyBalance] = await Promise.all([
    controller.tokenNonces(tokenId),
    new ethers.Contract(runtime.energyBankAddress, ENERGY_BANK_ABI, runtime.provider).energyBalance(owner),
  ]);
  const packed = packedTraits.toString();
  const traits = hoodYoorTraitSnapshot(packed);
  return {
    tokenId,
    owner,
    ownedByWallet: Boolean(wallet) && normalizeHoodYoorWallet(owner) === wallet,
    packedTraits: packed,
    nonce: nonce.toString(),
    energyBalance: energyBalance.toString(),
    traits,
    imageUrl: hoodYoorTraitImageUrl(packed),
    rerollableLayers: traits.filter((trait) => trait.mutable && trait.traitId !== 0).map((trait) => trait.layer),
  };
}

async function personalSignatureMatches(
  provider: ethers.Provider,
  wallet: string,
  message: string,
  signature: string,
) {
  const checksumWallet = ethers.getAddress(wallet);
  if (await provider.getCode(checksumWallet) === "0x") {
    try {
      return ethers.getAddress(ethers.verifyMessage(message, signature)) === checksumWallet;
    } catch {
      return false;
    }
  }
  try {
    const contract = new ethers.Contract(checksumWallet, ERC1271_ABI, provider);
    return String(await contract.isValidSignature(ethers.hashMessage(message), signature)).toLowerCase()
      === ERC1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

function publicPreview(preview: StoredHoodYoorPreview, runtime: HoodYoorRuntime) {
  return {
    id: preview.id,
    status: preview.status,
    tokenId: preview.tokenId,
    wallet: preview.wallet,
    action: preview.action,
    layer: preview.layer,
    payment: preview.payment,
    layerName: preview.action === "all" ? "All filled traits" : HOODYOOR_LAYERS[preview.layer],
    createdAt: preview.createdAt,
    expiresAt: preview.expiresAt,
    energyCost: preview.energyUnits,
    energyBalance: preview.energyBalanceAtPreview,
    paymentToken: preview.authorization.paymentToken,
    paymentAmount: preview.authorization.paymentAmount,
    resultSignature: preview.resultSignature,
    authorization: preview.authorization,
    typedData: hoodYoorRerollTypedData({
      chainId: runtime.chainId,
      controller: runtime.controllerAddress,
      authorization: preview.authorization,
    }),
    before: {
      packedTraits: preview.authorization.expectedTraits,
      traits: preview.beforeTraits,
      imageUrl: hoodYoorTraitImageUrl(preview.authorization.expectedTraits),
    },
    after: {
      packedTraits: preview.authorization.nextTraits,
      traits: preview.afterTraits,
      imageUrl: hoodYoorTraitImageUrl(preview.authorization.nextTraits),
    },
  };
}

function publicConfirmation(preview: StoredHoodYoorPreview, runtime: HoodYoorRuntime, energyBalance = "") {
  const transactionHash = preview.transactionHash || "";
  return {
    previewId: preview.id,
    status: preview.status,
    pending: preview.status === "submitted" || preview.status === "submitting",
    tokenId: preview.tokenId,
    transactionHash,
    transactionUrl: explorerTransactionUrl(runtime, transactionHash),
    energyBalance,
    imageUrl: hoodYoorTraitImageUrl(preview.authorization.nextTraits),
    confirmedAt: preview.confirmedAt || "",
  };
}

async function expireOrInvalidateActivePreview(
  preview: StoredHoodYoorPreview,
  currentTraits: string,
  currentNonce: string,
) {
  const expired = Date.parse(preview.expiresAt) <= Date.now();
  const stale = preview.authorization.expectedTraits !== currentTraits
    || preview.authorization.nonce !== currentNonce;
  if (!expired && !stale && preview.status === "active") return false;
  preview.status = expired ? "expired" : "stale";
  await Promise.all([
    store.setJson(previewKey(preview.id), preview),
    store.deleteJson(activeKey(preview.tokenId)),
  ]);
  return true;
}

export function assertHoodYoorRateLimit(key: string, limit = 12, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw routeError("Too many HoodYØØR Trait Lab requests. Wait a moment and try again.", 429, "RATE_LIMITED");
  }
  bucket.count += 1;
}

export function hoodYoorPublicErrorMessage(error: unknown, fallback: string) {
  const known = error as HoodYoorServerError;
  return known?.status ? known.message : fallback;
}

export async function getHoodYoorTraitLabStatus({
  wallet: walletValue,
  tokenId: tokenIdValue,
}: {
  wallet?: unknown;
  tokenId?: unknown;
} = {}) {
  const enabled = enabledFlag(readEnv("HOODYOOR_TRAIT_LAB_ENABLED"));
  if (!enabled) {
    return {
      ok: true,
      enabled: false,
      ready: false,
      setupIssue: "The contract-connected test is not enabled yet.",
      ...publicConfig(),
    };
  }

  try {
    const runtime = loadRuntime();
    const wiring = await assertDeploymentReady(runtime);
    const suppliedWallet = String(walletValue || "").trim();
    const wallet = normalizeHoodYoorWallet(suppliedWallet);
    if (suppliedWallet && !wallet) throw routeError("Enter a valid EVM wallet address.", 400, "INVALID_WALLET");
    const suppliedToken = String(tokenIdValue ?? "").trim();
    const tokenId = suppliedToken ? parseHoodYoorTokenId(suppliedToken) : 0;
    if (suppliedToken && !tokenId) {
      throw routeError(`Enter a HoodYØØR token ID from 1 to ${HOODYOOR_MAX_SUPPLY}.`, 400, "INVALID_TOKEN");
    }
    const token = tokenId ? await readTokenState(runtime, tokenId, wallet) : null;
    return {
      ok: true,
      enabled: true,
      ready: true,
      collectionFrozen: wiring.collectionFrozen,
      ...publicConfig(runtime, wiring),
      token,
    };
  } catch (error) {
    const known = error as HoodYoorServerError;
    if (known.status && known.status < 500) throw error;
    return {
      ok: true,
      enabled: true,
      ready: false,
      setupIssue: hoodYoorPublicErrorMessage(error, "The HoodYØØR testnet connection is not ready."),
      ...publicConfig(),
    };
  }
}

export async function createHoodYoorRerollPreview(body: Record<string, unknown>) {
  const runtime = loadRuntime();
  const wiring = await assertDeploymentReady(runtime);
  const wallet = normalizeHoodYoorWallet(body.wallet);
  const tokenId = parseHoodYoorTokenId(body.tokenId);
  const action = parseAction(body.action);
  const layer = parseLayer(action, body.layer);
  const payment = parsePayment(body.payment);
  const issuedAt = String(body.issuedAt || "").trim();
  const requestNonce = String(body.nonce || "").trim();
  const message = String(body.message || "");
  const signature = String(body.signature || "").trim();
  if (!wallet) throw routeError("Connect a valid EVM wallet.", 400, "INVALID_WALLET");
  if (!tokenId) {
    throw routeError(`Enter a HoodYØØR token ID from 1 to ${HOODYOOR_MAX_SUPPLY}.`, 400, "INVALID_TOKEN");
  }
  if (!issuedAt || !validRequestNonce(requestNonce) || !message || !validSignature(signature)) {
    throw routeError("The preview authorization is incomplete. Please sign again.", 400, "INVALID_PREVIEW_PROOF");
  }
  const issuedAtMs = Date.parse(issuedAt);
  const now = Date.now();
  if (
    !Number.isFinite(issuedAtMs)
    || issuedAtMs > now + PREVIEW_REQUEST_CLOCK_SKEW_MS
    || now - issuedAtMs > HOODYOOR_PREVIEW_TTL_MS
  ) {
    throw routeError("The preview authorization expired. Please sign again.", 401, "PREVIEW_PROOF_EXPIRED");
  }
  const expectedMessage = hoodYoorPreviewRequestMessage({
    wallet,
    tokenId,
    action,
    layer: action === "all" ? null : layer,
    payment,
    issuedAt,
    nonce: requestNonce,
  });
  if (message !== expectedMessage) {
    throw routeError("The signed preview request does not match this reroll.", 400, "PREVIEW_MESSAGE_MISMATCH");
  }

  return await withTokenLock(tokenId, async () => {
    const token = await readTokenState(runtime, tokenId, wallet);
    if (!token.ownedByWallet) {
      throw routeError(`The connected wallet does not own HoodYØØR #${tokenId}.`, 403, "NOT_TOKEN_OWNER");
    }
    if (!await personalSignatureMatches(runtime.provider, wallet, message, signature)) {
      throw routeError("The preview signature does not match the token owner.", 401, "INVALID_PREVIEW_SIGNATURE");
    }
    if (action === "single" && !token.rerollableLayers.includes(layer)) {
      throw routeError(`${HOODYOOR_LAYERS[layer]} is empty and cannot be rerolled.`, 400, "EMPTY_LAYER");
    }

    const existing = await store.getJsonStrict<StoredHoodYoorPreview>(activeKey(tokenId));
    if (existing && !await expireOrInvalidateActivePreview(existing, token.packedTraits, token.nonce)) {
      if (
        existing.wallet === wallet && existing.action === action && existing.layer === layer
        && existing.payment === payment
      ) {
        return { ok: true, reused: true, preview: publicPreview(existing, runtime) };
      }
      throw routeError(
        `HoodYØØR #${tokenId} already has an active preview. Accept it or wait for it to expire.`,
        409,
        "ACTIVE_PREVIEW",
      );
    }

    const candidate = generateHoodYoorRerollCandidate({
      packedTraits: token.packedTraits,
      action,
      layer,
      randomInt: deterministicRerollRandomInt({
        runtime,
        tokenId,
        packedTraits: token.packedTraits,
        nonce: token.nonce,
        action,
        layer,
      }),
    });
    const controller = new ethers.Contract(runtime.controllerAddress, CONTROLLER_ABI, runtime.provider);
    let energyCost: bigint;
    if (action === "single") {
      const nextTraitId = unpackHoodYoorTraits(candidate.nextTraits)[layer];
      energyCost = await controller.quoteEnergy(tokenId, layer, nextTraitId);
    } else {
      energyCost = await controller.quoteRerollAll(tokenId, candidate.nextTraits);
    }
    if (payment === "energy" && BigInt(token.energyBalance) < energyCost) {
      throw routeError(
        `This wallet needs ${energyCost.toString()} Energy for that reroll.`,
        402,
        "INSUFFICIENT_ENERGY",
      );
    }
    if (payment === "energy" && !wiring.energyRelayerReady) {
      throw routeError(
        "Gasless Energy rerolls are temporarily unavailable; choose ETH or USDG.",
        503,
        "RELAYER_UNFUNDED",
      );
    }
    const paymentMethod = hoodYoorPaymentCode(payment);
    const [paymentToken, paymentAmount] = await controller.quotePayment(
      energyCost,
      paymentMethod,
    );

    const deadline = BigInt(Math.floor((Date.now() + HOODYOOR_PREVIEW_TTL_MS) / 1_000));
    const authorization: HoodYoorRerollAuthorization = {
      tokenId: String(tokenId),
      tokenOwner: ethers.getAddress(token.owner),
      expectedTraits: token.packedTraits,
      nextTraits: candidate.nextTraits,
      action: action === "single" ? HOODYOOR_ACTION_SINGLE : HOODYOOR_ACTION_ALL,
      layer,
      paymentMethod,
      paymentToken: ethers.getAddress(paymentToken),
      paymentAmount: paymentAmount.toString(),
      nonce: token.nonce,
      deadline: deadline.toString(),
    };
    const typedData = hoodYoorRerollTypedData({
      chainId: runtime.chainId,
      controller: runtime.controllerAddress,
      authorization,
    });
    const resultSignature = await runtime.resultSigner.signTypedData(
      typedData.domain,
      HOODYOOR_REROLL_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
      authorization,
    );
    const localDigest = ethers.TypedDataEncoder.hash(
      typedData.domain,
      HOODYOOR_REROLL_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
      authorization,
    );
    const onchainDigest = await controller.rerollDigest(authorization);
    if (String(onchainDigest).toLowerCase() !== localDigest.toLowerCase()) {
      throw routeError("The HoodYØØR signing domain does not match the controller.", 503, "DOMAIN_MISMATCH");
    }

    const preview: StoredHoodYoorPreview = {
      version: 2,
      id: crypto.randomUUID(),
      status: "active",
      wallet,
      tokenId,
      action,
      layer,
      payment,
      energyUnits: energyCost.toString(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Number(deadline) * 1_000).toISOString(),
      authorization,
      resultSignature,
      energyBalanceAtPreview: token.energyBalance,
      beforeTraits: token.traits,
      afterTraits: hoodYoorTraitSnapshot(candidate.nextTraits),
    };
    await store.setJson(previewKey(preview.id), preview);
    await store.setJson(activeKey(tokenId), preview);
    return { ok: true, reused: false, preview: publicPreview(preview, runtime) };
  });
}

async function finalizeConfirmedPreview(
  preview: StoredHoodYoorPreview,
  runtime: HoodYoorRuntime,
  transactionHash: string,
) {
  preview.status = "confirmed";
  preview.transactionHash = transactionHash;
  preview.confirmedAt = new Date().toISOString();
  const energyBank = new ethers.Contract(runtime.energyBankAddress, ENERGY_BANK_ABI, runtime.provider);
  const energyBalance = (await energyBank.energyBalance(preview.wallet)).toString();
  await store.setJson(previewKey(preview.id), preview);
  const active = await store.getJsonStrict<StoredHoodYoorPreview>(activeKey(preview.tokenId));
  if (active?.id === preview.id) await store.deleteJson(activeKey(preview.tokenId));
  return { ok: true, ...publicConfirmation(preview, runtime, energyBalance) };
}

export async function confirmHoodYoorRerollPreview(body: Record<string, unknown>) {
  const runtime = loadRuntime();
  await assertDeploymentReady(runtime);
  const wallet = normalizeHoodYoorWallet(body.wallet);
  const previewId = validPreviewId(body.previewId);
  const ownerSignature = String(body.ownerSignature || "").trim();
  if (!wallet) throw routeError("Connect a valid EVM wallet.", 400, "INVALID_WALLET");
  if (!previewId || !validSignature(ownerSignature)) {
    throw routeError("The signed reroll acceptance is incomplete.", 400, "INVALID_ACCEPTANCE");
  }
  const initial = await store.getJsonStrict<StoredHoodYoorPreview>(previewKey(previewId));
  if (!initial) throw routeError("That HoodYØØR preview was not found.", 404, "PREVIEW_NOT_FOUND");

  return await withTokenLock(initial.tokenId, async () => {
    const preview = await store.getJsonStrict<StoredHoodYoorPreview>(previewKey(previewId));
    if (!preview || preview.wallet !== wallet) {
      throw routeError("That preview does not belong to the connected wallet.", 403, "PREVIEW_OWNER_MISMATCH");
    }
    if (preview.status === "confirmed") {
      return { ok: true, ...publicConfirmation(preview, runtime) };
    }
    if (preview.status === "submitted" && preview.transactionHash) {
      const receipt = await runtime.provider.getTransactionReceipt(preview.transactionHash);
      if (!receipt) return { ok: true, ...publicConfirmation(preview, runtime) };
      if (receipt.status === 1) {
        return await finalizeConfirmedPreview(preview, runtime, receipt.hash);
      }
      preview.status = "stale";
      await store.setJson(previewKey(preview.id), preview);
      throw routeError("The gasless reroll transaction reverted.", 409, "RELAY_REVERTED");
    }
    if (preview.status !== "active" || Date.parse(preview.expiresAt) <= Date.now()) {
      preview.status = "expired";
      await Promise.all([
        store.setJson(previewKey(preview.id), preview),
        store.deleteJson(activeKey(preview.tokenId)),
      ]);
      throw routeError("That HoodYØØR preview expired. Generate a new one.", 410, "PREVIEW_EXPIRED");
    }
    const active = await store.getJsonStrict<StoredHoodYoorPreview>(activeKey(preview.tokenId));
    if (active?.id !== preview.id) {
      throw routeError("That HoodYØØR preview is no longer active.", 409, "PREVIEW_REPLACED");
    }
    if (preview.payment !== "energy" || preview.authorization.paymentMethod !== HOODYOOR_PAYMENT_ENERGY) {
      throw routeError(
        "ETH and USDG rerolls must be submitted directly from the NFT owner wallet.",
        400,
        "DIRECT_PAYMENT_REQUIRED",
      );
    }

    const controller = new ethers.Contract(runtime.controllerAddress, CONTROLLER_ABI, runtime.relayer);
    try {
      await controller.confirmRerollEnergy.staticCall(
        preview.authorization,
        ownerSignature,
        preview.resultSignature,
      );
    } catch {
      throw routeError(
        "The reroll can no longer be accepted. Check ownership, Energy, and the preview deadline.",
        409,
        "PREFLIGHT_FAILED",
      );
    }

    preview.status = "submitting";
    await Promise.all([
      store.setJson(previewKey(preview.id), preview),
      store.setJson(activeKey(preview.tokenId), preview),
    ]);

    let transaction: ethers.ContractTransactionResponse | null = null;
    try {
      transaction = await controller.confirmRerollEnergy(
        preview.authorization,
        ownerSignature,
        preview.resultSignature,
      ) as ethers.ContractTransactionResponse;
      preview.status = "submitted";
      preview.transactionHash = transaction.hash;
      await Promise.all([
        store.setJson(previewKey(preview.id), preview),
        store.setJson(activeKey(preview.tokenId), preview),
      ]);
      const receipt = await transaction.wait(1, 90_000);
      if (!receipt) return { ok: true, ...publicConfirmation(preview, runtime) };
      if (receipt.status !== 1) throw routeError("The gasless reroll transaction reverted.", 409, "RELAY_REVERTED");
      return await finalizeConfirmedPreview(preview, runtime, receipt.hash);
    } catch (error) {
      if (transaction) {
        const receipt = await runtime.provider.getTransactionReceipt(transaction.hash).catch(() => null);
        if (receipt?.status === 1) {
          return await finalizeConfirmedPreview(preview, runtime, receipt.hash);
        }
        if (!receipt) {
          preview.status = "submitted";
          preview.transactionHash = transaction.hash;
          await Promise.all([
            store.setJson(previewKey(preview.id), preview),
            store.setJson(activeKey(preview.tokenId), preview),
          ]);
          return { ok: true, ...publicConfirmation(preview, runtime) };
        }
      }
      preview.status = "active";
      await Promise.all([
        store.setJson(previewKey(preview.id), preview),
        store.setJson(activeKey(preview.tokenId), preview),
      ]);
      if ((error as HoodYoorServerError)?.status) throw error;
      throw routeError("The gasless reroll could not be submitted. Try again.", 503, "RELAY_FAILED");
    }
  });
}
