// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidCustodyCandidate} from "./DroidCustodyCandidate.sol";
import {DroidAssistBadge} from "./DroidAssistBadge.sol";

/// @notice Undeployed owner-transaction-only ASSIST canary. Not upgradeable to autonomy.
/// No delegate executor, arbitrary calls, signature relay, token approvals or spending.
contract DroidAssistAccountCandidate is DroidCustodyCandidate {
    DroidAssistBadge public immutable badge;
    bytes32 public immutable badgeCodeHash;

    error InvalidCanary();
    error InvalidPreparation();
    error UnexpectedMint();

    event AssistMintExecuted(
        uint256 indexed nonce,
        address indexed owner,
        bytes32 indexed evidenceHash,
        address target,
        uint256 mintedTokenId,
        uint64 deadline
    );

    constructor(uint256 chainId_, address collection_, uint256 tokenId_, DroidAssistBadge badge_)
        DroidCustodyCandidate(chainId_, collection_, tokenId_)
    {
        // Only the exact source-controlled test minter; no user/AI-selected contract.
        if (address(badge_).codehash != keccak256(type(DroidAssistBadge).runtimeCode)) revert InvalidCanary();
        badge = badge_;
        badgeCodeHash = address(badge_).codehash;
    }

    /// @dev The evidence hash is an audit commitment, NOT on-chain proof a simulation ran.
    /// Owner is authenticated by msg.sender at execution; no persistent off-chain grant exists.
    function mintCanary(uint256 expectedNonce, uint64 deadline, bytes32 evidenceHash)
        external
        onlyCurrentOwner
        returns (uint256 mintedTokenId)
    {
        if (
            expectedNonce != actionNonce || evidenceHash == bytes32(0) || deadline <= block.timestamp
                || deadline > block.timestamp + 5 minutes
        ) revert InvalidPreparation();
        if (address(badge).codehash != badgeCodeHash) revert InvalidCanary();
        uint256 nativeBefore = address(this).balance;
        uint256 countBefore = badge.balanceOf(address(this));
        actionNonce++;
        mintedTokenId = badge.mintCanary();
        if (
            badge.ownerOf(mintedTokenId) != address(this) || badge.balanceOf(address(this)) != countBefore + 1
                || address(this).balance != nativeBefore
        ) revert UnexpectedMint();
        emit AssistMintExecuted(expectedNonce, msg.sender, evidenceHash, address(badge), mintedTokenId, deadline);
    }
}
