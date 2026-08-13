// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYOORRenderer {
    function tokenURI(uint256 tokenId, uint256 packedTraits) external view returns (string memory);

    function validateTraits(uint256 packedTraits) external view returns (bool);
    function isFrozen() external view returns (bool);
}
