// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DroidIdentity
/// @notice Collision-safe identity helpers shared by every chain-local economic module.
library DroidIdentity {
    error InvalidChainId();
    error InvalidCollection();

    /// @notice Returns the canonical identity for a native-chain Droid.
    /// @dev Token IDs are intentionally allowed to be zero for ERC-721 compatibility.
    function key(uint256 chainId, address collection, uint256 tokenId)
        internal
        pure
        returns (bytes32)
    {
        if (chainId == 0) revert InvalidChainId();
        if (collection == address(0)) revert InvalidCollection();
        return keccak256(abi.encode(chainId, collection, tokenId));
    }
}
