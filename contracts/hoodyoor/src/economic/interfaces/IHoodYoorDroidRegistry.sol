// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYoorDroidRegistry {
    function droidKey(address collection, uint256 tokenId) external view returns (bytes32);

    function ownerOf(address collection, uint256 tokenId) external view returns (address);

    function accountOf(address collection, uint256 tokenId, uint32 accountVersion)
        external
        view
        returns (address);

    function isAccountActive(address collection, uint256 tokenId, uint32 accountVersion)
        external
        view
        returns (bool);

    function isCollectionEnabled(address collection) external view returns (bool);

    function isAccountVersionEnabled(address collection, uint32 accountVersion)
        external
        view
        returns (bool);
}

interface IHoodYoorAccountResolver {
    function tokenContract() external view returns (address);

    function tokenChainId() external view returns (uint256);

    function account(uint256 tokenId) external view returns (address);
}

interface IERC721CurrentOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}
