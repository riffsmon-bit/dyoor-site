// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC6551Registry } from "./interfaces/IERC6551Registry.sol";
import { IERC721Owner } from "./interfaces/IDroidAccount.sol";

/// @title DroidAccountRegistry
/// @notice Immutable official HoodYØØR activation facade over the canonical ERC-6551 registry.
/// @dev This contract owns no accounts or funds and has no administrator.
contract DroidAccountRegistry {
    uint256 public constant IMPLEMENTATION_VERSION = 1;

    IERC6551Registry public immutable canonicalRegistry;
    address public immutable implementation;
    address public immutable tokenContract;
    uint256 public immutable tokenChainId;
    bytes32 public immutable accountSalt;

    error ZeroAddress();
    error InvalidContract(address account);
    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error InvalidConfiguration();
    error TokenDoesNotExist(uint256 tokenId);
    error NotTokenOwner(address caller, address currentOwner);
    error AccountCreationMismatch(address expected, address returnedAddress);
    error AccountCodeMissing(address accountAddress);

    event DroidAccountActivated(
        address indexed account,
        address indexed tokenContract,
        uint256 indexed tokenId,
        address owner,
        address implementation,
        uint256 implementationVersion
    );

    constructor(
        address canonicalRegistry_,
        address tokenContract_,
        address implementation_,
        uint256 tokenChainId_,
        bytes32 accountSalt_
    ) {
        if (
            canonicalRegistry_ == address(0) || tokenContract_ == address(0)
                || implementation_ == address(0)
        ) revert ZeroAddress();
        if (canonicalRegistry_.code.length == 0) revert InvalidContract(canonicalRegistry_);
        if (tokenContract_.code.length == 0) revert InvalidContract(tokenContract_);
        if (implementation_.code.length == 0) revert InvalidContract(implementation_);
        if (tokenChainId_ != block.chainid) {
            revert WrongDeploymentChain(tokenChainId_, block.chainid);
        }

        canonicalRegistry = IERC6551Registry(canonicalRegistry_);
        tokenContract = tokenContract_;
        implementation = implementation_;
        tokenChainId = tokenChainId_;
        accountSalt = accountSalt_;
    }

    /// @notice Returns the official deterministic Droid Account for a token ID.
    function account(uint256 tokenId) public view returns (address accountAddress) {
        accountAddress = canonicalRegistry.account(
            implementation, accountSalt, tokenChainId, tokenContract, tokenId
        );
    }

    /// @notice ERC-6551-shaped read that fails unless the exact official V1 configuration is used.
    function account(
        address implementation_,
        bytes32 salt_,
        uint256 chainId_,
        address tokenContract_,
        uint256 tokenId
    ) external view returns (address accountAddress) {
        _validateConfiguration(implementation_, salt_, chainId_, tokenContract_);
        accountAddress = account(tokenId);
    }

    function isAccountCreated(uint256 tokenId) external view returns (bool) {
        return account(tokenId).code.length != 0;
    }

    /// @notice Lazily activates the current owner's official Droid Account.
    function createAccount(uint256 tokenId) public returns (address accountAddress) {
        address currentOwner = _ownerOf(tokenId);
        if (msg.sender != currentOwner) revert NotTokenOwner(msg.sender, currentOwner);

        address expected = account(tokenId);
        if (expected.code.length != 0) return expected;

        accountAddress = canonicalRegistry.createAccount(
            implementation, accountSalt, tokenChainId, tokenContract, tokenId
        );
        if (accountAddress != expected) {
            revert AccountCreationMismatch(expected, accountAddress);
        }
        if (accountAddress.code.length == 0) revert AccountCodeMissing(accountAddress);

        emit DroidAccountActivated(
            accountAddress,
            tokenContract,
            tokenId,
            currentOwner,
            implementation,
            IMPLEMENTATION_VERSION
        );
    }

    /// @notice ERC-6551-shaped activation that accepts only the exact official V1 configuration.
    function createAccount(
        address implementation_,
        bytes32 salt_,
        uint256 chainId_,
        address tokenContract_,
        uint256 tokenId
    ) external returns (address accountAddress) {
        _validateConfiguration(implementation_, salt_, chainId_, tokenContract_);
        accountAddress = createAccount(tokenId);
    }

    function _ownerOf(uint256 tokenId) private view returns (address currentOwner) {
        try IERC721Owner(tokenContract).ownerOf(tokenId) returns (address tokenOwner) {
            if (tokenOwner == address(0)) revert TokenDoesNotExist(tokenId);
            currentOwner = tokenOwner;
        } catch {
            revert TokenDoesNotExist(tokenId);
        }
    }

    function _validateConfiguration(
        address implementation_,
        bytes32 salt_,
        uint256 chainId_,
        address tokenContract_
    ) private view {
        if (
            implementation_ != implementation || salt_ != accountSalt || chainId_ != tokenChainId
                || tokenContract_ != tokenContract
        ) revert InvalidConfiguration();
    }
}
