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
};

export type DroidProtocolConfig = {
  configured: boolean;
  activationEnabled: boolean;
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
  accountSalt: string;
  accountStartBlock: number;
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
};

export type DroidActivityKind =
  | "activated"
  | "native-received"
  | "executed"
  | "nft-received"
  | "owner-changed";

export type DroidActivityItem = {
  id: string;
  kind: DroidActivityKind;
  label: string;
  blockNumber: number;
  transactionHash: string;
};

export type DroidAccountSnapshot = {
  tokenId: number;
  owner: string;
  ownedByRequestedWallet: boolean;
  imageUrl: string;
  accountAddress: string;
  active: boolean;
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
