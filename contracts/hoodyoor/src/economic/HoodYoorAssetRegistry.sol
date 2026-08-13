// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IHoodYoorAssetRegistry } from "./interfaces/IHoodYoorAssetRegistry.sol";

/// @title HoodYoorAssetRegistry
/// @notice Local-chain allowlist for real assets shown or used by HoodYØØR economic modules.
contract HoodYoorAssetRegistry is AccessControlDefaultAdminRules, Pausable, IHoodYoorAssetRegistry {
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;
    uint8 public constant NATIVE_DECIMALS = 18;

    enum AssetType {
        NATIVE,
        ERC20
    }

    struct AssetConfig {
        bool registered;
        bool enabled;
        bool strategyEligible;
        bool routerSupported;
        AssetType assetType;
        uint8 decimals;
        string symbol;
        string name;
        string metadataURI;
    }

    mapping(address asset => AssetConfig config) private _assets;

    error InvalidContract(address target);
    error InvalidDecimals(uint8 supplied, uint8 actual);
    error InvalidNativeConfiguration();
    error InvalidAssetMetadata();
    error AssetNotRegistered(address asset);

    event AssetConfigured(
        uint256 indexed chainId,
        address indexed asset,
        AssetType indexed assetType,
        uint8 decimals,
        string symbol,
        string name,
        bool enabled,
        bool strategyEligible,
        bool routerSupported,
        string metadataURI
    );
    event AssetStatusUpdated(address indexed asset, bool enabled);

    constructor(address initialAdmin)
        AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, initialAdmin)
    {
        _grantRole(ASSET_MANAGER_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    /// @notice Adds or updates display/eligibility metadata for an asset.
    /// @dev Existing balances are unaffected. Disabling an asset prevents new economic actions.
    function configureAsset(
        address asset,
        AssetType assetType,
        uint8 decimals,
        string calldata symbol,
        string calldata name,
        bool enabled,
        bool strategyEligible,
        bool routerSupported,
        string calldata metadataURI
    ) external onlyRole(ASSET_MANAGER_ROLE) {
        if (bytes(symbol).length == 0 || bytes(symbol).length > 16 || bytes(name).length == 0) {
            revert InvalidAssetMetadata();
        }
        if (assetType == AssetType.NATIVE) {
            if (asset != address(0) || decimals != NATIVE_DECIMALS) {
                revert InvalidNativeConfiguration();
            }
        } else {
            if (asset == address(0) || asset.code.length == 0) revert InvalidContract(asset);
            uint8 actualDecimals = IERC20Metadata(asset).decimals();
            if (decimals > 36 || actualDecimals != decimals) {
                revert InvalidDecimals(decimals, actualDecimals);
            }
        }

        _assets[asset] = AssetConfig({
            registered: true,
            enabled: enabled,
            strategyEligible: strategyEligible,
            routerSupported: routerSupported,
            assetType: assetType,
            decimals: decimals,
            symbol: symbol,
            name: name,
            metadataURI: metadataURI
        });
        emit AssetConfigured(
            block.chainid,
            asset,
            assetType,
            decimals,
            symbol,
            name,
            enabled,
            strategyEligible,
            routerSupported,
            metadataURI
        );
    }

    function setAssetEnabled(address asset, bool enabled) external onlyRole(ASSET_MANAGER_ROLE) {
        AssetConfig storage config = _assets[asset];
        if (!config.registered) revert AssetNotRegistered(asset);
        config.enabled = enabled;
        emit AssetStatusUpdated(asset, enabled);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function assetKey(address asset) external view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, asset));
    }

    function assetConfig(address asset) external view returns (AssetConfig memory) {
        return _assets[asset];
    }

    function isAssetEnabled(address asset) public view override returns (bool) {
        AssetConfig storage config = _assets[asset];
        return !paused() && config.registered && config.enabled;
    }

    function isStrategyEligible(address asset) external view override returns (bool) {
        AssetConfig storage config = _assets[asset];
        return !paused() && config.registered && config.enabled && config.strategyEligible;
    }

    function isRouterSupported(address asset) external view override returns (bool) {
        AssetConfig storage config = _assets[asset];
        return !paused() && config.registered && config.enabled && config.routerSupported;
    }
}
