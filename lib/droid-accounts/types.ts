export type DroidAssetKind = "native" | "erc20" | "erc721" | "energy";

export type DroidConfiguredToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  prominent: boolean;
};

export type DroidConfiguredNftCollection = {
  address: string;
  name: string;
  startBlock: number;
  equipment: boolean;
  imageUriTemplate: string;
  seedTokenIds: string[];
};

export type DroidProtocolConfig = {
  configured: boolean;
  activationEnabled: boolean;
  activationMode: "off" | "allowlist" | "general";
  activationTokenIds: number[];
  setupIssue: string;
  chainId: number;
  chainName: string;
  nativeCurrencyName: string;
  nativeCurrencySymbol: string;
  rpcUrl: string;
  explorerUrl: string;
  canonicalRegistryAddress: string;
  registryAddress: string;
  implementationAddress: string;
  ownerTradingAddress: string;
  accountSalt: string;
  accountStartBlock: number;
  activityStartBlock: number;
  collectionAddress: string;
  collectionStartBlock: number;
  collectionName: string;
  maxSupply: number;
  imageUrlTemplate: string;
  controllerPolicy: "DIRECT_ERC721_OWNER";
  parentTokenBurnable: boolean;
  energyBankAddress: string;
  energyDecimals: number;
  tokens: DroidConfiguredToken[];
  nftCollections: DroidConfiguredNftCollection[];
};

export type DroidTokenBalance = DroidConfiguredToken & {
  rawBalance: string;
  formattedBalance: string;
  valueStatus: "unavailable";
  fiatValue: null;
};

export type DroidNftInventoryItem = {
  collectionAddress: string;
  collectionName: string;
  tokenId: string;
  equipment: boolean;
  imageUrls: string[];
};

export type DroidActivityKind =
  | "activated"
  | "native-received"
  | "executed"
  | "traded"
  | "nft-received"
  | "owner-changed";

export type DroidActivityItem = {
  id: string;
  kind: DroidActivityKind;
  label: string;
  chainId: number;
  tokenId: number;
  droidAccount: string;
  controller: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: number | null;
  trade?: {
    tokenIn: "native";
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    router: string;
    market: string;
  };
};

export type DroidActivityHealth = {
  status: "synced" | "syncing" | "partial";
  startBlock: number;
  indexedThroughBlock: number;
  latestBlock: number;
  blocksBehind: number;
  lastSuccessfulSync: string;
  lastError: string;
  provider: string;
  retryState:
    | "idle"
    | "retrying"
    | "reduced-range"
    | "fallback"
    | "budget-exhausted"
    | "failed";
  checkpointed: boolean;
};

export type DroidAccountSnapshot = {
  tokenId: number;
  owner: string;
  ownedByRequestedWallet: boolean;
  imageUrl: string;
  accountAddress: string;
  accountCodeHash: string;
  active: boolean;
  activationAllowed: boolean;
  nativeBalance: string;
  nativeFormatted: string;
  nativeFiatValue: null;
  tokens: DroidTokenBalance[];
  nfts: DroidNftInventoryItem[];
  energyBalance: string;
  commanderEnergyBalance: string;
  portfolioValue: null;
  portfolioValueStatus: "unavailable";
  directive: "MANUAL";
  agent: "OFFLINE";
  activeSessionKeys: 0;
  activity: DroidActivityItem[];
  activityHealth: DroidActivityHealth;
  partialErrors: string[];
};

export type DroidSquadItem = Pick<
  DroidAccountSnapshot,
  | "tokenId"
  | "owner"
  | "imageUrl"
  | "accountAddress"
  | "active"
  | "nativeFormatted"
  | "energyBalance"
  | "portfolioValue"
  | "portfolioValueStatus"
  | "directive"
>;

export type DroidAccountApiResponse = {
  ok: boolean;
  config: DroidProtocolConfig;
  droid?: DroidAccountSnapshot;
  squad?: DroidSquadItem[];
  error?: string;
};

export type EquipmentSlot =
  | "HEAD"
  | "EYES"
  | "WEAPON"
  | "CORE"
  | "ARMOR"
  | "ACCESSORY"
  | "SPECIAL";

export type DroidEquipmentRecord = {
  collectionAddress: string;
  tokenId: string;
  slot: EquipmentSlot;
  equipmentType: string;
  compatibleCollection: string;
  enabled: boolean;
  metadataUri: string;
};

export type DroidProgression = {
  xp: string;
  score: string | null;
  achievements: string[];
};

export type DroidScoreCategory =
  | "AGE"
  | "ACTIVITY"
  | "ACHIEVEMENTS"
  | "MISSIONS"
  | "ENERGY"
  | "REPUTATION"
  | "EQUIPMENT";

export type DroidTokenLimit = {
  asset: string;
  maxPerTransaction: string;
  maxPerPeriod: string;
  minimumReserve: string;
  periodSeconds: number;
};

export type DroidCapabilityPolicy = {
  authorizingOwner: string;
  ownerEpoch: string;
  sessionKey: string;
  allowedTargets: readonly string[];
  allowedSelectors: readonly `0x${string}`[];
  allowedAssets: readonly string[];
  tokenLimits: readonly DroidTokenLimit[];
  expiresAt: number;
  enabled: boolean;
};

export type DroidDirectivePreview = {
  mode: "MANUAL";
  agentAuthority: "ZERO";
  allowedTargets: readonly [];
  allowedSelectors: readonly [];
  expiresAt: null;
};

export type DroidAgentGatewayPreview = {
  deployed: false;
  executionEnabled: false;
  activePolicies: readonly [];
  emergencyAgentPause: "NOT_APPLICABLE";
  ownerExecution: "AVAILABLE_AFTER_ACTIVATION";
};

export type DroidMissionPreview = {
  id: string;
  name: string;
  status: "DEFERRED";
  onchainExecutionEnabled: false;
};
