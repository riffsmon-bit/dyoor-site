// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Local fixture only, NOT Season 2 or a production ERC-721 replacement.
/// Every transfer, including A -> B -> A, advances the authority epoch.
contract LabCollection {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint256) public ownershipEpoch;

    constructor(address initialOwner) {
        require(block.chainid == 31337 && initialOwner != address(0), "LOCAL_ONLY");
        ownerOf[11] = initialOwner;
        ownershipEpoch[11] = 1;
    }

    function transfer(uint256 tokenId, address to) external {
        require(msg.sender == ownerOf[tokenId] && to != address(0), "OWNER_ONLY");
        ownerOf[tokenId] = to;
        ownershipEpoch[tokenId]++;
    }
}
