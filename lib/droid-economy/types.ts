export type ChainQualifiedDroidId = {
  chainId: number;
  collectionAddress: string;
  tokenId: string;
};

export type DroidEconomyFeatureFlags = {
  droidWalletsEnabled: boolean;
  droidPortfoliosEnabled: boolean;
  droidRewardsEnabled: boolean;
  droidStrategiesEnabled: boolean;
  monadDroidsEnabled: boolean;
  robinhoodDroidsEnabled: boolean;
  sharedTreasuryEnabled: boolean;
  crossChainBridgeEnabled: false;
  droidAgentEnabled: false;
};

export type DroidEconomyAddresses = {
  droidRegistry: string;
  assetRegistry: string;
  strategyRegistry: string;
  revenueVault: string;
  rewardsDistributor: string;
  achievementRegistry: string;
};

export type DroidEconomyConfig = {
  chainId: number;
  chainName: string;
  collectionAddress: string;
  defaultAccountVersion: number;
  explorerUrl: string;
  addresses: DroidEconomyAddresses;
  strategyOptions: Array<{
    strategyId: string;
    label: string;
    description: string;
  }>;
  flags: DroidEconomyFeatureFlags;
  contractsConfigured: boolean;
  setupIssue: string;
};

export type RewardManifestAllocationInput = {
  chainId: number;
  collectionAddress: string;
  tokenId: string;
  accountVersion: number;
  droidAccount: string;
  strategyId: string;
  rewardWeight: string;
  amount: string;
};

export type RewardManifestAllocation = RewardManifestAllocationInput & {
  droidKey: string;
  leaf: string;
  proof: string[];
};

export type RewardEpochManifest = {
  schemaVersion: 1;
  epochId: string;
  chainId: number;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  startsAt: number;
  endsAt: number;
  metadataUri: string;
  merkleRoot: string;
  manifestHash: string;
  totalAllocated: string;
  allocationCount: number;
  allocations: RewardManifestAllocation[];
  preparedAt: string;
  deploymentStatus: "prepared" | "onchain";
  transactionHash: string;
};

export type RewardEpochManifestSummary = Pick<
  RewardEpochManifest,
  | "epochId"
  | "chainId"
  | "asset"
  | "assetSymbol"
  | "startsAt"
  | "endsAt"
  | "merkleRoot"
  | "manifestHash"
  | "totalAllocated"
  | "allocationCount"
  | "preparedAt"
  | "deploymentStatus"
  | "transactionHash"
>;

export type DroidRewardAllocationView = RewardManifestAllocation & {
  epochId: string;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  startsAt: number;
  endsAt: number;
  metadataUri: string;
  deploymentStatus: RewardEpochManifest["deploymentStatus"];
  claimed: boolean | null;
  claimStatus:
    | "MODULE_DISABLED"
    | "EPOCH_PREPARED"
    | "NOT_STARTED"
    | "CLAIMABLE"
    | "CLAIMED"
    | "EXPIRED"
    | "VALUE_UNAVAILABLE";
};

export type DroidStrategyView = {
  strategyId: string;
  strategyVersion: number;
  selectedAt: number;
  metadataUri: string;
  riskMetadataUri: string;
  enabled: boolean;
} | null;

export type DroidEconomySnapshot = {
  identity: ChainQualifiedDroidId;
  droidKey: string;
  nativeChain: string;
  config: DroidEconomyConfig;
  strategy: DroidStrategyView;
  rewardWeight: string | null;
  pendingRewards: DroidRewardAllocationView[];
  lifetimeRewards: Array<{
    asset: string;
    symbol: string;
    decimals: number;
    amount: string;
  }>;
  achievements: Array<{
    achievementId: string;
    metadataUri: string;
    rewardModifierBps: number;
  }>;
  partialErrors: string[];
};

export type DroidEconomyApiResponse = {
  ok: boolean;
  snapshot?: DroidEconomySnapshot;
  error?: string;
};
