export const ECONOMY_REWARDS_ABI = [
  "event RewardEpochCreated(bytes32 indexed epochId,address indexed asset,bytes32 indexed merkleRoot,uint256 totalAllocated,uint48 startsAt,uint48 endsAt,bytes32 manifestHash,string metadataURI)",
  "function claimed(bytes32 epochId,bytes32 droidKey) view returns (bool)",
  "function lifetimeRewards(bytes32 droidKey,address asset) view returns (uint256)",
  "function epoch(bytes32 epochId) view returns (bool exists,bool closed,address asset,bytes32 merkleRoot,bytes32 manifestHash,uint128 totalAllocated,uint128 totalClaimed,uint48 startsAt,uint48 endsAt,string metadataURI)",
  "function claim(bytes32 epochId,address collection,uint256 tokenId,uint32 accountVersion,bytes32 strategyId,uint256 rewardWeight,uint256 amount,bytes32[] merkleProof) returns (address droidAccount)",
] as const;

export const ECONOMY_STRATEGY_ABI = [
  "function selections(bytes32 droidKey) view returns (bytes32 strategyId,uint32 strategyVersion,uint48 selectedAt)",
  "function strategies(bytes32 strategyId) view returns (bool exists,bool enabled,uint32 currentVersion)",
  "function strategyVersion(bytes32 strategyId,uint32 version) view returns (address executionAdapter,string metadataURI,string riskMetadataURI,address[] assets,uint16[] targetBps)",
  "function selectStrategy(address collection,uint256 tokenId,bytes32 strategyId)",
  "function clearStrategy(address collection,uint256 tokenId)",
] as const;

export const ECONOMY_DROID_REGISTRY_ABI = [
  "function droidKey(address collection,uint256 tokenId) view returns (bytes32)",
  "function accountOf(address collection,uint256 tokenId,uint32 accountVersion) view returns (address)",
  "function ownerOf(address collection,uint256 tokenId) view returns (address)",
] as const;

export const EXISTING_DROID_RESOLVER_ABI = [
  "function account(uint256 tokenId) view returns (address)",
] as const;
