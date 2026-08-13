// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHoodYoorAssetRegistry } from "./interfaces/IHoodYoorAssetRegistry.sol";

/// @title HoodYoorRevenueVault
/// @notice Accounts approved ecosystem revenue separately for treasury, funded Droid rewards,
/// and one governance-approved chain-local allocation.
/// @dev It has no authority over any Droid Account and cannot withdraw user assets.
contract HoodYoorRevenueVault is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SOURCE_MANAGER_ROLE = keccak256("SOURCE_MANAGER_ROLE");
    bytes32 public constant ALLOCATION_MANAGER_ROLE = keccak256("ALLOCATION_MANAGER_ROLE");
    bytes32 public constant RELEASE_MANAGER_ROLE = keccak256("RELEASE_MANAGER_ROLE");
    bytes32 public constant DESTINATION_MANAGER_ROLE = keccak256("DESTINATION_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint48 public constant DESTINATION_CHANGE_DELAY = 2 days;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    struct PendingDestinations {
        address treasury;
        address rewardDistributor;
        address otherDestination;
        uint48 validAfter;
    }

    IHoodYoorAssetRegistry public immutable assetRegistry;
    address public treasury;
    address public rewardDistributor;
    address public otherDestination;
    uint16 public treasuryBps;
    uint16 public rewardBps;
    uint16 public otherBps;
    PendingDestinations public pendingDestinations;

    mapping(address source => bool approved) public approvedRevenueSources;
    mapping(bytes32 revenueId => bool used) public usedRevenueIds;
    mapping(address asset => uint256 amount) public treasuryAccrued;
    mapping(address asset => uint256 amount) public rewardsAccrued;
    mapping(address asset => uint256 amount) public otherAccrued;
    mapping(address asset => uint256 amount) public lifetimeRevenue;
    mapping(address asset => uint256 amount) public lifetimeTreasuryReleased;
    mapping(address asset => uint256 amount) public lifetimeRewardsReleased;
    mapping(address asset => uint256 amount) public lifetimeOtherReleased;

    error ZeroAddress();
    error InvalidContract(address target);
    error InvalidAllocation(uint256 totalBps);
    error UnauthorizedRevenueSource(address source);
    error InvalidRevenueId();
    error RevenueIdAlreadyUsed(bytes32 revenueId);
    error AssetNotEnabled(address asset);
    error ZeroAmount();
    error ExactTransferRequired(uint256 requested, uint256 received);
    error InsufficientAccrued(uint256 available, uint256 requested);
    error NativeTransferFailed(address recipient, uint256 amount);
    error DirectNativeTransferDisabled();
    error DestinationChangeNotReady(uint48 validAfter);
    error NoPendingDestinationChange();
    error NoExcessBalance();

    event RevenueSourceStatusUpdated(address indexed source, bool approved);
    event AllocationUpdated(uint16 treasuryBps, uint16 rewardsBps, uint16 otherBps);
    event RevenueDeposited(
        bytes32 indexed revenueId,
        address indexed source,
        address indexed asset,
        uint256 received,
        uint256 treasuryAmount,
        uint256 rewardsAmount,
        uint256 otherAmount
    );
    event TreasuryReleased(address indexed asset, address indexed treasury, uint256 amount);
    event RewardsReleased(address indexed asset, address indexed rewardDistributor, uint256 amount);
    event OtherAllocationReleased(
        address indexed asset, address indexed otherDestination, uint256 amount
    );
    event DestinationChangeScheduled(
        address indexed treasury,
        address indexed rewardDistributor,
        address indexed otherDestination,
        uint48 validAfter
    );
    event DestinationChangeCancelled();
    event DestinationsUpdated(
        address indexed treasury,
        address indexed rewardDistributor,
        address indexed otherDestination
    );
    event ExcessRecovered(address indexed asset, address indexed treasury, uint256 amount);

    constructor(
        address initialAdmin,
        address assetRegistry_,
        address treasury_,
        address rewardDistributor_,
        address otherDestination_,
        uint16 treasuryBps_,
        uint16 rewardBps_,
        uint16 otherBps_
    ) AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, initialAdmin) {
        if (
            assetRegistry_ == address(0) || treasury_ == address(0)
                || rewardDistributor_ == address(0) || otherDestination_ == address(0)
        ) revert ZeroAddress();
        if (assetRegistry_.code.length == 0) revert InvalidContract(assetRegistry_);
        if (rewardDistributor_.code.length == 0) revert InvalidContract(rewardDistributor_);
        _validateAllocation(treasuryBps_, rewardBps_, otherBps_);

        assetRegistry = IHoodYoorAssetRegistry(assetRegistry_);
        treasury = treasury_;
        rewardDistributor = rewardDistributor_;
        otherDestination = otherDestination_;
        treasuryBps = treasuryBps_;
        rewardBps = rewardBps_;
        otherBps = otherBps_;
        _grantRole(SOURCE_MANAGER_ROLE, initialAdmin);
        _grantRole(ALLOCATION_MANAGER_ROLE, initialAdmin);
        _grantRole(RELEASE_MANAGER_ROLE, initialAdmin);
        _grantRole(DESTINATION_MANAGER_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
        emit AllocationUpdated(treasuryBps_, rewardBps_, otherBps_);
        emit DestinationsUpdated(treasury_, rewardDistributor_, otherDestination_);
    }

    receive() external payable {
        revert DirectNativeTransferDisabled();
    }

    function setRevenueSource(address source, bool approved)
        external
        onlyRole(SOURCE_MANAGER_ROLE)
    {
        if (source == address(0)) revert ZeroAddress();
        approvedRevenueSources[source] = approved;
        emit RevenueSourceStatusUpdated(source, approved);
    }

    function setAllocationBps(uint16 nextTreasuryBps, uint16 nextRewardBps, uint16 nextOtherBps)
        external
        onlyRole(ALLOCATION_MANAGER_ROLE)
    {
        _validateAllocation(nextTreasuryBps, nextRewardBps, nextOtherBps);
        treasuryBps = nextTreasuryBps;
        rewardBps = nextRewardBps;
        otherBps = nextOtherBps;
        emit AllocationUpdated(nextTreasuryBps, nextRewardBps, nextOtherBps);
    }

    function depositNative(bytes32 revenueId) external payable whenNotPaused nonReentrant {
        _requireApprovedSource();
        if (!assetRegistry.isAssetEnabled(address(0))) revert AssetNotEnabled(address(0));
        if (msg.value == 0) revert ZeroAmount();
        _accountDeposit(revenueId, msg.sender, address(0), msg.value);
    }

    function depositToken(bytes32 revenueId, address asset, uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        _requireApprovedSource();
        if (!assetRegistry.isAssetEnabled(asset)) revert AssetNotEnabled(asset);
        if (asset == address(0)) revert AssetNotEnabled(asset);
        if (amount == 0) revert ZeroAmount();

        IERC20 token = IERC20(asset);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert ExactTransferRequired(amount, received);
        _accountDeposit(revenueId, msg.sender, asset, received);
    }

    function releaseTreasury(address asset, uint256 amount)
        external
        onlyRole(RELEASE_MANAGER_ROLE)
        whenNotPaused
        nonReentrant
    {
        uint256 available = treasuryAccrued[asset];
        if (amount == 0) revert ZeroAmount();
        if (amount > available) revert InsufficientAccrued(available, amount);
        treasuryAccrued[asset] = available - amount;
        lifetimeTreasuryReleased[asset] += amount;
        _transferAsset(asset, treasury, amount);
        emit TreasuryReleased(asset, treasury, amount);
    }

    function releaseRewards(address asset, uint256 amount)
        external
        onlyRole(RELEASE_MANAGER_ROLE)
        whenNotPaused
        nonReentrant
    {
        uint256 available = rewardsAccrued[asset];
        if (amount == 0) revert ZeroAmount();
        if (amount > available) revert InsufficientAccrued(available, amount);
        rewardsAccrued[asset] = available - amount;
        lifetimeRewardsReleased[asset] += amount;
        _transferAsset(asset, rewardDistributor, amount);
        emit RewardsReleased(asset, rewardDistributor, amount);
    }

    function releaseOtherAllocation(address asset, uint256 amount)
        external
        onlyRole(RELEASE_MANAGER_ROLE)
        whenNotPaused
        nonReentrant
    {
        uint256 available = otherAccrued[asset];
        if (amount == 0) revert ZeroAmount();
        if (amount > available) revert InsufficientAccrued(available, amount);
        otherAccrued[asset] = available - amount;
        lifetimeOtherReleased[asset] += amount;
        _transferAsset(asset, otherDestination, amount);
        emit OtherAllocationReleased(asset, otherDestination, amount);
    }

    function scheduleDestinations(
        address nextTreasury,
        address nextRewardDistributor,
        address nextOtherDestination
    ) external onlyRole(DESTINATION_MANAGER_ROLE) {
        if (
            nextTreasury == address(0) || nextRewardDistributor == address(0)
                || nextOtherDestination == address(0)
        ) {
            revert ZeroAddress();
        }
        if (nextRewardDistributor.code.length == 0) {
            revert InvalidContract(nextRewardDistributor);
        }
        uint48 validAfter = uint48(block.timestamp + DESTINATION_CHANGE_DELAY);
        pendingDestinations = PendingDestinations({
            treasury: nextTreasury,
            rewardDistributor: nextRewardDistributor,
            otherDestination: nextOtherDestination,
            validAfter: validAfter
        });
        emit DestinationChangeScheduled(
            nextTreasury, nextRewardDistributor, nextOtherDestination, validAfter
        );
    }

    function applyDestinations() external onlyRole(DESTINATION_MANAGER_ROLE) {
        PendingDestinations memory pending = pendingDestinations;
        if (pending.validAfter == 0) revert NoPendingDestinationChange();
        if (block.timestamp < pending.validAfter) {
            revert DestinationChangeNotReady(pending.validAfter);
        }
        treasury = pending.treasury;
        rewardDistributor = pending.rewardDistributor;
        otherDestination = pending.otherDestination;
        delete pendingDestinations;
        emit DestinationsUpdated(treasury, rewardDistributor, otherDestination);
    }

    function cancelDestinationChange() external onlyRole(DESTINATION_MANAGER_ROLE) {
        if (pendingDestinations.validAfter == 0) revert NoPendingDestinationChange();
        delete pendingDestinations;
        emit DestinationChangeCancelled();
    }

    /// @notice Recovers only funds not represented by project/reward/other accounting.
    /// @dev Recovery is available only while paused and always pays the configured treasury.
    function recoverExcess(address asset)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenPaused
        nonReentrant
        returns (uint256 excess)
    {
        uint256 accounted =
            treasuryAccrued[asset] + rewardsAccrued[asset] + otherAccrued[asset];
        uint256 balance = _balanceOf(asset);
        if (balance <= accounted) revert NoExcessBalance();
        excess = balance - accounted;
        _transferAsset(asset, treasury, excess);
        emit ExcessRecovered(asset, treasury, excess);
    }

    function accountedBalance(address asset) external view returns (uint256) {
        return treasuryAccrued[asset] + rewardsAccrued[asset] + otherAccrued[asset];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _accountDeposit(bytes32 revenueId, address source, address asset, uint256 amount)
        private
    {
        if (revenueId == bytes32(0)) revert InvalidRevenueId();
        if (usedRevenueIds[revenueId]) revert RevenueIdAlreadyUsed(revenueId);
        usedRevenueIds[revenueId] = true;
        uint256 rewardAmount = Math.mulDiv(amount, rewardBps, BPS_DENOMINATOR);
        uint256 otherAmount = Math.mulDiv(amount, otherBps, BPS_DENOMINATOR);
        // Any indivisible remainder is conservatively assigned to the project treasury.
        uint256 treasuryAmount = amount - rewardAmount - otherAmount;
        treasuryAccrued[asset] += treasuryAmount;
        rewardsAccrued[asset] += rewardAmount;
        otherAccrued[asset] += otherAmount;
        lifetimeRevenue[asset] += amount;
        emit RevenueDeposited(
            revenueId, source, asset, amount, treasuryAmount, rewardAmount, otherAmount
        );
    }

    function _validateAllocation(uint16 treasuryBps_, uint16 rewardBps_, uint16 otherBps_)
        private
        pure
    {
        uint256 totalBps = uint256(treasuryBps_) + rewardBps_ + otherBps_;
        if (totalBps != BPS_DENOMINATOR) revert InvalidAllocation(totalBps);
    }

    function _requireApprovedSource() private view {
        if (!approvedRevenueSources[msg.sender]) {
            revert UnauthorizedRevenueSource(msg.sender);
        }
    }

    function _balanceOf(address asset) private view returns (uint256) {
        return asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
    }

    function _transferAsset(address asset, address recipient, uint256 amount) private {
        if (asset == address(0)) {
            (bool success,) = recipient.call{ value: amount }("");
            if (!success) revert NativeTransferFailed(recipient, amount);
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }
}
