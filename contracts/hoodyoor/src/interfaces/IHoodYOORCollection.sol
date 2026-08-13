// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYOORCollection {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenTraits(uint256 tokenId) external view returns (uint256);
    function applyReroll(uint256 tokenId, uint256 nextTraits) external;
}
