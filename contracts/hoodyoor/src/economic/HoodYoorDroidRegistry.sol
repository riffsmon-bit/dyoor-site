// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { DroidIdentity } from "./DroidIdentity.sol";
import {
    IERC721CurrentOwner,
    IHoodYoorAccountResolver,
    IHoodYoorDroidRegistry
} from "./interfaces/IHoodYoorDroidRegistry.sol";

/// @title HoodYoorDroidRegistry
/// @notice Chain-local registry of native NFT collections and immutable account resolver versions.
/// @dev A registered resolver can be disabled but never replaced, preventing silent account redirection.
contract HoodYoorDroidRegistry is AccessControlDefaultAdminRules, IHoodYoorDroidRegistry {
    bytes32 public constant COLLECTION_MANAGER_ROLE = keccak256("COLLECTION_MANAGER_ROLE");
    uint48 public constant ADMIN_TRANSFER_DELAY = 2 days;

    struct Collection {
        bool registered;
        bool enabled;
        uint32 defaultAccountVersion;
        string metadataURI;
    }

    struct AccountVersion {
        address resolver;
        bool enabled;
        string metadataURI;
    }

    mapping(address collection => Collection config) private _collections;
    mapping(address collection => mapping(uint32 version => AccountVersion config)) private
        _accountVersions;

    error ZeroAddress();
    error InvalidContract(address target);
    error InvalidAccountVersion();
    error CollectionAlreadyRegistered(address collection);
    error CollectionNotRegistered(address collection);
    error AccountVersionAlreadyRegistered(address collection, uint32 version);
    error AccountVersionNotRegistered(address collection, uint32 version);
    error ResolverCollectionMismatch(address expected, address actual);
    error ResolverChainMismatch(uint256 expected, uint256 actual);
    error CollectionDisabled(address collection);
    error AccountVersionDisabled(address collection, uint32 version);
    error TokenDoesNotExist(address collection, uint256 tokenId);

    event CollectionRegistered(
        address indexed collection, uint256 indexed chainId, string metadataURI
    );
    event CollectionStatusUpdated(address indexed collection, bool enabled);
    event CollectionMetadataUpdated(address indexed collection, string metadataURI);
    event AccountVersionRegistered(
        address indexed collection,
        uint32 indexed version,
        address indexed resolver,
        string metadataURI
    );
    event AccountVersionStatusUpdated(
        address indexed collection, uint32 indexed version, bool enabled
    );
    event DefaultAccountVersionUpdated(address indexed collection, uint32 indexed version);

    constructor(address initialAdmin)
        AccessControlDefaultAdminRules(ADMIN_TRANSFER_DELAY, initialAdmin)
    {
        _grantRole(COLLECTION_MANAGER_ROLE, initialAdmin);
    }

    function registerCollection(address collection, string calldata metadataURI)
        external
        onlyRole(COLLECTION_MANAGER_ROLE)
    {
        if (collection == address(0)) revert ZeroAddress();
        if (collection.code.length == 0) revert InvalidContract(collection);
        if (_collections[collection].registered) revert CollectionAlreadyRegistered(collection);

        _collections[collection] = Collection({
            registered: true, enabled: true, defaultAccountVersion: 0, metadataURI: metadataURI
        });
        emit CollectionRegistered(collection, block.chainid, metadataURI);
    }

    function setCollectionEnabled(address collection, bool enabled)
        external
        onlyRole(COLLECTION_MANAGER_ROLE)
    {
        Collection storage config = _requireCollection(collection);
        config.enabled = enabled;
        emit CollectionStatusUpdated(collection, enabled);
    }

    function setCollectionMetadata(address collection, string calldata metadataURI)
        external
        onlyRole(COLLECTION_MANAGER_ROLE)
    {
        Collection storage config = _requireCollection(collection);
        config.metadataURI = metadataURI;
        emit CollectionMetadataUpdated(collection, metadataURI);
    }

    function registerAccountVersion(
        address collection,
        uint32 version,
        address resolver,
        string calldata metadataURI
    ) external onlyRole(COLLECTION_MANAGER_ROLE) {
        _requireCollection(collection);
        if (version == 0) revert InvalidAccountVersion();
        if (resolver == address(0)) revert ZeroAddress();
        if (resolver.code.length == 0) revert InvalidContract(resolver);
        if (_accountVersions[collection][version].resolver != address(0)) {
            revert AccountVersionAlreadyRegistered(collection, version);
        }

        address resolverCollection = IHoodYoorAccountResolver(resolver).tokenContract();
        if (resolverCollection != collection) {
            revert ResolverCollectionMismatch(collection, resolverCollection);
        }
        uint256 resolverChainId = IHoodYoorAccountResolver(resolver).tokenChainId();
        if (resolverChainId != block.chainid) {
            revert ResolverChainMismatch(block.chainid, resolverChainId);
        }

        _accountVersions[collection][version] =
            AccountVersion({ resolver: resolver, enabled: true, metadataURI: metadataURI });
        Collection storage collectionState = _collections[collection];
        if (collectionState.defaultAccountVersion == 0) {
            collectionState.defaultAccountVersion = version;
            emit DefaultAccountVersionUpdated(collection, version);
        }
        emit AccountVersionRegistered(collection, version, resolver, metadataURI);
    }

    function setAccountVersionEnabled(address collection, uint32 version, bool enabled)
        external
        onlyRole(COLLECTION_MANAGER_ROLE)
    {
        AccountVersion storage config = _requireAccountVersion(collection, version);
        config.enabled = enabled;
        emit AccountVersionStatusUpdated(collection, version, enabled);
    }

    function setDefaultAccountVersion(address collection, uint32 version)
        external
        onlyRole(COLLECTION_MANAGER_ROLE)
    {
        Collection storage collectionState = _requireCollection(collection);
        AccountVersion storage accountConfig = _requireAccountVersion(collection, version);
        if (!accountConfig.enabled) revert AccountVersionDisabled(collection, version);
        collectionState.defaultAccountVersion = version;
        emit DefaultAccountVersionUpdated(collection, version);
    }

    function droidKey(address collection, uint256 tokenId) public view override returns (bytes32) {
        return DroidIdentity.key(block.chainid, collection, tokenId);
    }

    function ownerOf(address collection, uint256 tokenId)
        public
        view
        override
        returns (address currentOwner)
    {
        Collection storage config = _requireCollection(collection);
        if (!config.enabled) revert CollectionDisabled(collection);
        try IERC721CurrentOwner(collection).ownerOf(tokenId) returns (address tokenOwner) {
            if (tokenOwner == address(0)) revert TokenDoesNotExist(collection, tokenId);
            return tokenOwner;
        } catch {
            revert TokenDoesNotExist(collection, tokenId);
        }
    }

    function accountOf(address collection, uint256 tokenId, uint32 accountVersion)
        public
        view
        override
        returns (address)
    {
        Collection storage collectionState = _requireCollection(collection);
        if (!collectionState.enabled) revert CollectionDisabled(collection);
        AccountVersion storage accountConfig = _requireAccountVersion(collection, accountVersion);
        if (!accountConfig.enabled) revert AccountVersionDisabled(collection, accountVersion);
        return IHoodYoorAccountResolver(accountConfig.resolver).account(tokenId);
    }

    function defaultAccountOf(address collection, uint256 tokenId) external view returns (address) {
        Collection storage collectionState = _requireCollection(collection);
        return accountOf(collection, tokenId, collectionState.defaultAccountVersion);
    }

    function isAccountActive(address collection, uint256 tokenId, uint32 accountVersion)
        external
        view
        override
        returns (bool)
    {
        return accountOf(collection, tokenId, accountVersion).code.length != 0;
    }

    function isCollectionEnabled(address collection) external view override returns (bool) {
        Collection storage config = _collections[collection];
        return config.registered && config.enabled;
    }

    function isAccountVersionEnabled(address collection, uint32 accountVersion)
        external
        view
        override
        returns (bool)
    {
        AccountVersion storage config = _accountVersions[collection][accountVersion];
        return _collections[collection].enabled && config.resolver != address(0) && config.enabled;
    }

    function collectionConfig(address collection) external view returns (Collection memory) {
        return _collections[collection];
    }

    function accountVersionConfig(address collection, uint32 version)
        external
        view
        returns (AccountVersion memory)
    {
        return _accountVersions[collection][version];
    }

    function _requireCollection(address collection)
        private
        view
        returns (Collection storage config)
    {
        config = _collections[collection];
        if (!config.registered) revert CollectionNotRegistered(collection);
    }

    function _requireAccountVersion(address collection, uint32 version)
        private
        view
        returns (AccountVersion storage config)
    {
        config = _accountVersions[collection][version];
        if (config.resolver == address(0)) {
            revert AccountVersionNotRegistered(collection, version);
        }
    }
}
