// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IHoodYoorAssetRegistry } from "./interfaces/IHoodYoorAssetRegistry.sol";
import { IHoodYoorDroidRegistry } from "./interfaces/IHoodYoorDroidRegistry.sol";

/// @title HoodYoorStrategyRegistry
/// @notice Versioned owner preferences for future rewards. This contract never moves assets.
contract HoodYoorStrategyRegistry is AccessControlDefaultAdminRules, Pausable {
    bytes32 public constant STRATEGY_MANAGER_ROLE = keccak256("STRATEGY_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_STRATEGY_ASSETS = 16;

    struct StrategyHeader {
        bool exists;
        bool enabled;
        uint32 currentVersion;
    }

    struct StrategyVersion {
        address executionAdapter;
        string metadataURI;
        string riskMetadataURI;
        address[] assets;
        uint16[] targetBps;
    }

    struct DroidSelection {
        bytes32 strategyId;
        uint32 strategyVersion;
        uint48 selectedAt;
    }

    IHoodYoorDroidRegistry public immutable droidRegistry;
    IHoodYoorAssetRegistry public immutable assetRegistry;

    mapping(bytes32 strategyId => StrategyHeader header) public strategies;
    mapping(bytes32 strategyId => mapping(uint32 version => StrategyVersion config)) private
        _strategyVersions;
    mapping(bytes32 droidKey => DroidSelection selection) public selections;

    error ZeroAddress();
    error InvalidContract(address target);
    error InvalidStrategyId();
    error InvalidAllocationLength();
    error TooManyAssets(uint256 supplied, uint256 maximum);
    error DuplicateAsset(address asset);
    error AssetNotStrategyEligible(address asset);
    error InvalidTotalAllocation(uint256 supplied);
    error StrategyNotFound(bytes32 strategyId);
    error StrategyDisabled(bytes32 strategyId);
    error NotCurrentDroidOwner(address caller, address currentOwner);

    event StrategyVersionConfigured(
        bytes32 indexed strategyId,
        uint32 indexed version,
        address indexed executionAdapter,
        string metadataURI,
        string riskMetadataURI,
        address[] assets,
        uint16[] targetBps
    );
    event StrategyStatusUpdated(bytes32 indexed strategyId, bool enabled);
    event DroidStrategySelected(
        bytes32 indexed droidKey,
        address indexed collection,
        uint256 indexed tokenId,
        bytes32 strategyId,
        uint32 strategyVersion,
        address owner
    );
    event DroidStrategyCleared(
        bytes32 indexed droidKey, address indexed collection, uint256 indexed tokenId, address owner
    );

    constructor(address initialAdmin, address droidRegistry_, address assetRegistry_)
        AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, initialAdmin)
    {
        if (droidRegistry_ == address(0) || assetRegistry_ == address(0)) revert ZeroAddress();
        if (droidRegistry_.code.length == 0) revert InvalidContract(droidRegistry_);
        if (assetRegistry_.code.length == 0) revert InvalidContract(assetRegistry_);
        droidRegistry = IHoodYoorDroidRegistry(droidRegistry_);
        assetRegistry = IHoodYoorAssetRegistry(assetRegistry_);
        _grantRole(STRATEGY_MANAGER_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    function configureStrategyVersion(
        bytes32 strategyId,
        address executionAdapter,
        string calldata metadataURI,
        string calldata riskMetadataURI,
        address[] calldata assets,
        uint16[] calldata targetBps
    ) external onlyRole(STRATEGY_MANAGER_ROLE) returns (uint32 version) {
        if (strategyId == bytes32(0)) revert InvalidStrategyId();
        if (assets.length == 0 || assets.length != targetBps.length) {
            revert InvalidAllocationLength();
        }
        if (assets.length > MAX_STRATEGY_ASSETS) {
            revert TooManyAssets(assets.length, MAX_STRATEGY_ASSETS);
        }
        if (executionAdapter != address(0) && executionAdapter.code.length == 0) {
            revert InvalidContract(executionAdapter);
        }

        uint256 total;
        for (uint256 i; i < assets.length; ++i) {
            if (!assetRegistry.isStrategyEligible(assets[i])) {
                revert AssetNotStrategyEligible(assets[i]);
            }
            for (uint256 j; j < i; ++j) {
                if (assets[j] == assets[i]) revert DuplicateAsset(assets[i]);
            }
            total += targetBps[i];
        }
        if (total != BPS_DENOMINATOR) revert InvalidTotalAllocation(total);

        StrategyHeader storage header = strategies[strategyId];
        version = header.currentVersion + 1;
        header.exists = true;
        header.enabled = true;
        header.currentVersion = version;

        StrategyVersion storage config = _strategyVersions[strategyId][version];
        config.executionAdapter = executionAdapter;
        config.metadataURI = metadataURI;
        config.riskMetadataURI = riskMetadataURI;
        for (uint256 i; i < assets.length; ++i) {
            config.assets.push(assets[i]);
            config.targetBps.push(targetBps[i]);
        }

        emit StrategyVersionConfigured(
            strategyId, version, executionAdapter, metadataURI, riskMetadataURI, assets, targetBps
        );
    }

    function setStrategyEnabled(bytes32 strategyId, bool enabled)
        external
        onlyRole(STRATEGY_MANAGER_ROLE)
    {
        StrategyHeader storage header = strategies[strategyId];
        if (!header.exists) revert StrategyNotFound(strategyId);
        header.enabled = enabled;
        emit StrategyStatusUpdated(strategyId, enabled);
    }

    function selectStrategy(address collection, uint256 tokenId, bytes32 strategyId)
        external
        whenNotPaused
    {
        StrategyHeader storage header = strategies[strategyId];
        if (!header.exists) revert StrategyNotFound(strategyId);
        if (!header.enabled) revert StrategyDisabled(strategyId);
        address currentOwner = droidRegistry.ownerOf(collection, tokenId);
        if (currentOwner != msg.sender) revert NotCurrentDroidOwner(msg.sender, currentOwner);

        bytes32 key = droidRegistry.droidKey(collection, tokenId);
        selections[key] = DroidSelection({
            strategyId: strategyId,
            strategyVersion: header.currentVersion,
            selectedAt: uint48(block.timestamp)
        });
        emit DroidStrategySelected(
            key, collection, tokenId, strategyId, header.currentVersion, currentOwner
        );
    }

    function clearStrategy(address collection, uint256 tokenId) external whenNotPaused {
        address currentOwner = droidRegistry.ownerOf(collection, tokenId);
        if (currentOwner != msg.sender) revert NotCurrentDroidOwner(msg.sender, currentOwner);
        bytes32 key = droidRegistry.droidKey(collection, tokenId);
        delete selections[key];
        emit DroidStrategyCleared(key, collection, tokenId, currentOwner);
    }

    function strategyVersion(bytes32 strategyId, uint32 version)
        external
        view
        returns (
            address executionAdapter,
            string memory metadataURI,
            string memory riskMetadataURI,
            address[] memory assets,
            uint16[] memory targetBps
        )
    {
        StrategyVersion storage config = _strategyVersions[strategyId][version];
        return (
            config.executionAdapter,
            config.metadataURI,
            config.riskMetadataURI,
            config.assets,
            config.targetBps
        );
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
