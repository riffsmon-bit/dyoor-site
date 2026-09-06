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
  ownerTradingEnabled: boolean;
  autonomousTradingEnabled: false;
  robinhoodDroidsEnabled: boolean;
  sharedTreasuryEnabled: boolean;
  secondaryRevenueDistributionEnabled: false;
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

export type RevenueSourceKind =
  | "SECONDARY_MARKET_REVENUE"
  | "DYOOR_BUILD"
  | "PLATFORM_FEES"
  | "PARTNER_REVENUE"
  | "OTHER_APPROVED";

export type RevenueSplitPolicy = {
  status: "PROPOSED_STAGED" | "ACTIVE";
  projectTreasuryBps: number;
  droidRewardsBps: number;
  otherApprovedBps: number;
  totalBps: 10_000;
};

export type RevenueAssetAmount = {
  asset: string;
  symbol: string;
  decimals: number;
  rawAmount: string;
};

export type RevenueReceipt = {
  schemaVersion: 1;
  revenueId: string;
  chainId: number;
  collectionAddress: string;
  receiverAddress: string;
  sourceKind: RevenueSourceKind;
  sourceAddress: string;
  marketplace: string;
  attributionStatus: "VERIFIED" | "UNDETERMINED";
  transactionHash: string;
  transferIndex: number;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  grossAmount: string;
  blockNumber: number;
  receivedAt: string;
  verificationMethod: "DIRECT_NATIVE_TRANSFER" | "ERC20_TRANSFER_EVENT" | "REVENUE_VAULT_EVENT";
  accountingStatus: "VERIFIED_RECEIVED" | "ALLOCATED";
  rewardEligible: boolean;
  indexedAt: string;
};

export type RevenueSourceView = {
  sourceKind: RevenueSourceKind;
  name: string;
  chainId: number;
  receiver: string;
  asset: string;
  assetSymbol: string;
  verified: boolean;
  active: boolean;
  rewardEligible: boolean;
  totalReceived: RevenueAssetAmount[] | null;
  notes: string;
};

export type DroidRewardPoolView = {
  status: "STAGED" | "ACTIVE";
  currentFundedPool: RevenueAssetAmount[] | null;
  pendingAccountedRevenue: RevenueAssetAmount[] | null;
  distributedRewards: RevenueAssetAmount[] | null;
  nextEpoch: string | null;
  claimsStatus: "OFF" | "ON";
};

export type EcosystemRevenueSnapshot = {
  chainId: number;
  chainName: string;
  collectionAddress: string;
  accountingStatus: "STAGED" | "ACTIVE";
  receiptCoverage: "PARTIAL_MANUAL_VERIFICATION" | "INDEXED";
  verifiedReceiptCount: number;
  totalVerifiedRevenueReceived: RevenueAssetAmount[];
  secondaryMarketRevenueReceived: RevenueAssetAmount[];
  otherRevenueReceived: RevenueAssetAmount[];
  sources: RevenueSourceView[];
  policy: RevenueSplitPolicy;
  rewardPool: DroidRewardPoolView;
  simulation: {
    label: "SIMULATION_ONLY";
    assetSymbol: string;
    assetDecimals: number;
    grossAmount: string;
    projectTreasuryAmount: string;
    droidRewardsAmount: string;
    otherApprovedAmount: string;
  };
  warnings: string[];
};

export type EcosystemRevenueApiResponse = {
  ok: boolean;
  snapshot?: EcosystemRevenueSnapshot;
  error?: string;
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
  rewardPool: DroidRewardPoolView;
  potentialEligibilityInputs: string[];
  partialErrors: string[];
};

export type DroidEconomyApiResponse = {
  ok: boolean;
  snapshot?: DroidEconomySnapshot;
  error?: string;
};
