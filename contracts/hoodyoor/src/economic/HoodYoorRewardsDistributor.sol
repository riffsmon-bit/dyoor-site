// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { IHoodYoorAssetRegistry } from "./interfaces/IHoodYoorAssetRegistry.sol";
import { IHoodYoorDroidRegistry } from "./interfaces/IHoodYoorDroidRegistry.sol";

/// @title HoodYoorRewardsDistributor
/// @notice Funded Merkle reward epochs claimable only into active Droid Accounts.
/// @dev Weights are transparent snapshot inputs; they are not Energy balances or monetary prices.
contract HoodYoorRewardsDistributor is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant EPOCH_MANAGER_ROLE = keccak256("EPOCH_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint48 public constant MIN_EPOCH_DURATION = 1 hours;

    struct RewardEpoch {
        bool exists;
        bool closed;
        address asset;
        bytes32 merkleRoot;
        bytes32 manifestHash;
        uint128 totalAllocated;
        uint128 totalClaimed;
        uint48 startsAt;
        uint48 endsAt;
        string metadataURI;
    }

    struct ClaimRequest {
        bytes32 epochId;
        address collection;
        uint256 tokenId;
        uint32 accountVersion;
        bytes32 strategyId;
        uint256 rewardWeight;
        uint256 amount;
    }

    IHoodYoorDroidRegistry public immutable droidRegistry;
    IHoodYoorAssetRegistry public immutable assetRegistry;
    address public fundingVault;

    mapping(bytes32 epochId => RewardEpoch epoch) private _epochs;
    mapping(bytes32 epochId => mapping(bytes32 droidKey => bool claimed)) public claimed;
    mapping(address asset => uint256 amount) public reservedByAsset;
    mapping(bytes32 droidKey => mapping(address asset => uint256 amount)) public lifetimeRewards;

    error ZeroAddress();
    error InvalidContract(address target);
    error FundingVaultAlreadyConfigured(address currentVault);
    error FundingVaultNotConfigured();
    error UnauthorizedNativeFunding(address sender);
    error InvalidEpochId();
    error EpochAlreadyExists(bytes32 epochId);
    error EpochNotFound(bytes32 epochId);
    error InvalidMerkleRoot();
    error InvalidEpochWindow(uint48 startsAt, uint48 endsAt);
    error InvalidAllocation();
    error AllocationTooLarge(uint256 supplied);
    error AssetNotEnabled(address asset);
    error InsufficientBacking(uint256 available, uint256 required);
    error EpochNotOpen(bytes32 epochId);
    error EpochAlreadyClosed(bytes32 epochId);
    error EpochAlreadyStarted(bytes32 epochId);
    error EpochNotExpired(bytes32 epochId);
    error AlreadyClaimed(bytes32 epochId, bytes32 droidKey);
    error NotCurrentDroidOwner(address caller, address currentOwner);
    error DroidAccountNotActive(address account);
    error InvalidRewardProof();
    error ClaimExceedsRemainingAllocation(uint256 remaining, uint256 requested);
    error NativeTransferFailed(address recipient, uint256 amount);

    event FundingVaultConfigured(address indexed fundingVault);
    event RewardEpochCreated(
        bytes32 indexed epochId,
        address indexed asset,
        bytes32 indexed merkleRoot,
        uint256 totalAllocated,
        uint48 startsAt,
        uint48 endsAt,
        bytes32 manifestHash,
        string metadataURI
    );
    event RewardClaimed(
        bytes32 indexed epochId,
        bytes32 indexed droidKey,
        address indexed droidAccount,
        address owner,
        address collection,
        uint256 tokenId,
        uint32 accountVersion,
        bytes32 strategyId,
        uint256 rewardWeight,
        address asset,
        uint256 amount
    );
    event RewardEpochCancelled(bytes32 indexed epochId, uint256 amountReleased);
    event RewardEpochClosed(bytes32 indexed epochId, uint256 unclaimedReleased);

    constructor(address initialAdmin, address droidRegistry_, address assetRegistry_)
        AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, initialAdmin)
    {
        if (droidRegistry_ == address(0) || assetRegistry_ == address(0)) revert ZeroAddress();
        if (droidRegistry_.code.length == 0) revert InvalidContract(droidRegistry_);
        if (assetRegistry_.code.length == 0) revert InvalidContract(assetRegistry_);
        droidRegistry = IHoodYoorDroidRegistry(droidRegistry_);
        assetRegistry = IHoodYoorAssetRegistry(assetRegistry_);
        _grantRole(EPOCH_MANAGER_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    receive() external payable {
        if (fundingVault == address(0)) revert FundingVaultNotConfigured();
        if (msg.sender != fundingVault) revert UnauthorizedNativeFunding(msg.sender);
    }

    /// @notice Permanently binds excess-return operations and native funding to the revenue vault.
    function configureFundingVault(address fundingVault_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (fundingVault != address(0)) revert FundingVaultAlreadyConfigured(fundingVault);
        if (fundingVault_ == address(0)) revert ZeroAddress();
        if (fundingVault_.code.length == 0) revert InvalidContract(fundingVault_);
        fundingVault = fundingVault_;
        emit FundingVaultConfigured(fundingVault_);
    }

    function createEpoch(
        bytes32 epochId,
        address asset,
        bytes32 merkleRoot,
        uint256 totalAllocated,
        uint48 startsAt,
        uint48 endsAt,
        bytes32 manifestHash,
        string calldata metadataURI
    ) external onlyRole(EPOCH_MANAGER_ROLE) whenNotPaused {
        if (fundingVault == address(0)) {
            revert FundingVaultNotConfigured();
        }
        if (epochId == bytes32(0)) revert InvalidEpochId();
        if (_epochs[epochId].exists) revert EpochAlreadyExists(epochId);
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalAllocated == 0) revert InvalidAllocation();
        if (totalAllocated > type(uint128).max) revert AllocationTooLarge(totalAllocated);
        if (endsAt <= startsAt || endsAt - startsAt < MIN_EPOCH_DURATION) {
            revert InvalidEpochWindow(startsAt, endsAt);
        }
        if (!assetRegistry.isAssetEnabled(asset)) revert AssetNotEnabled(asset);

        uint256 available = unreservedBalance(asset);
        if (available < totalAllocated) {
            revert InsufficientBacking(available, totalAllocated);
        }
        reservedByAsset[asset] += totalAllocated;
        _epochs[epochId] = RewardEpoch({
            exists: true,
            closed: false,
            asset: asset,
            merkleRoot: merkleRoot,
            manifestHash: manifestHash,
            totalAllocated: uint128(totalAllocated),
            totalClaimed: 0,
            startsAt: startsAt,
            endsAt: endsAt,
            metadataURI: metadataURI
        });
        emit RewardEpochCreated(
            epochId, asset, merkleRoot, totalAllocated, startsAt, endsAt, manifestHash, metadataURI
        );
    }

    /// @notice Claims one published allocation to the controlling NFT's active account.
    function claim(
        bytes32 epochId,
        address collection,
        uint256 tokenId,
        uint32 accountVersion,
        bytes32 strategyId,
        uint256 rewardWeight,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external whenNotPaused nonReentrant returns (address droidAccount) {
        ClaimRequest memory request;
        request.epochId = epochId;
        request.collection = collection;
        request.tokenId = tokenId;
        request.accountVersion = accountVersion;
        request.strategyId = strategyId;
        request.rewardWeight = rewardWeight;
        request.amount = amount;
        return _claim(request, merkleProof);
    }

    function _claim(ClaimRequest memory request, bytes32[] calldata merkleProof)
        private
        returns (address droidAccount)
    {
        RewardEpoch storage epochState = _epochs[request.epochId];
        if (!epochState.exists) revert EpochNotFound(request.epochId);
        if (
            epochState.closed || block.timestamp < epochState.startsAt
                || block.timestamp > epochState.endsAt
        ) revert EpochNotOpen(request.epochId);
        if (request.amount == 0) revert InvalidAllocation();
        if (request.amount > type(uint128).max) revert AllocationTooLarge(request.amount);

        bytes32 key = droidRegistry.droidKey(request.collection, request.tokenId);
        if (claimed[request.epochId][key]) revert AlreadyClaimed(request.epochId, key);
        address currentOwner = droidRegistry.ownerOf(request.collection, request.tokenId);
        if (msg.sender != currentOwner) {
            revert NotCurrentDroidOwner(msg.sender, currentOwner);
        }
        droidAccount =
            droidRegistry.accountOf(request.collection, request.tokenId, request.accountVersion);
        if (droidAccount.code.length == 0) revert DroidAccountNotActive(droidAccount);

        bytes32 leaf = rewardLeaf(
            request.epochId,
            request.collection,
            request.tokenId,
            request.accountVersion,
            droidAccount,
            request.strategyId,
            request.rewardWeight,
            request.amount
        );
        if (!MerkleProof.verifyCalldata(merkleProof, epochState.merkleRoot, leaf)) {
            revert InvalidRewardProof();
        }

        uint256 remaining = uint256(epochState.totalAllocated) - uint256(epochState.totalClaimed);
        if (request.amount > remaining) {
            revert ClaimExceedsRemainingAllocation(remaining, request.amount);
        }

        claimed[request.epochId][key] = true;
        epochState.totalClaimed += uint128(request.amount);
        reservedByAsset[epochState.asset] -= request.amount;
        lifetimeRewards[key][epochState.asset] += request.amount;
        _transferAsset(epochState.asset, droidAccount, request.amount);
        _emitRewardClaimed(request, key, droidAccount, currentOwner, epochState.asset);
    }

    /// @notice StandardMerkleTree-compatible double-hashed allocation leaf.
    function rewardLeaf(
        bytes32 epochId,
        address collection,
        uint256 tokenId,
        uint32 accountVersion,
        address droidAccount,
        bytes32 strategyId,
        uint256 rewardWeight,
        uint256 amount
    ) public view returns (bytes32) {
        bytes32 inner = keccak256(
            abi.encode(
                epochId,
                block.chainid,
                collection,
                tokenId,
                accountVersion,
                droidAccount,
                strategyId,
                rewardWeight,
                amount
            )
        );
        return keccak256(abi.encodePacked(inner));
    }

    function cancelEpoch(bytes32 epochId) external onlyRole(EPOCH_MANAGER_ROLE) {
        RewardEpoch storage epochState = _requireEpoch(epochId);
        if (epochState.closed) revert EpochAlreadyClosed(epochId);
        if (block.timestamp >= epochState.startsAt || epochState.totalClaimed != 0) {
            revert EpochAlreadyStarted(epochId);
        }
        epochState.closed = true;
        reservedByAsset[epochState.asset] -= epochState.totalAllocated;
        emit RewardEpochCancelled(epochId, epochState.totalAllocated);
    }

    function closeExpiredEpoch(bytes32 epochId) external {
        RewardEpoch storage epochState = _requireEpoch(epochId);
        if (epochState.closed) revert EpochAlreadyClosed(epochId);
        if (block.timestamp <= epochState.endsAt) revert EpochNotExpired(epochId);
        epochState.closed = true;
        uint256 unclaimed = uint256(epochState.totalAllocated) - uint256(epochState.totalClaimed);
        reservedByAsset[epochState.asset] -= unclaimed;
        emit RewardEpochClosed(epochId, unclaimed);
    }

    function epoch(bytes32 epochId) external view returns (RewardEpoch memory) {
        return _epochs[epochId];
    }

    function unreservedBalance(address asset) public view returns (uint256) {
        uint256 balance =
            asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 reserved = reservedByAsset[asset];
        return balance > reserved ? balance - reserved : 0;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _requireEpoch(bytes32 epochId) private view returns (RewardEpoch storage epochConfig) {
        epochConfig = _epochs[epochId];
        if (!epochConfig.exists) revert EpochNotFound(epochId);
    }

    function _transferAsset(address asset, address recipient, uint256 amount) private {
        if (asset == address(0)) {
            (bool success,) = recipient.call{ value: amount }("");
            if (!success) revert NativeTransferFailed(recipient, amount);
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }

    function _emitRewardClaimed(
        ClaimRequest memory request,
        bytes32 key,
        address droidAccount,
        address currentOwner,
        address asset
    ) private {
        emit RewardClaimed(
            request.epochId,
            key,
            droidAccount,
            currentOwner,
            request.collection,
            request.tokenId,
            request.accountVersion,
            request.strategyId,
            request.rewardWeight,
            asset,
            request.amount
        );
    }
}
