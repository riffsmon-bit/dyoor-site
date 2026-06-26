// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDyoorDroids {
    function ownerOf(uint256 tokenId) external view returns (address);
    function updateDynamicTrait(uint256 tokenId, uint8 slot, uint256 traitId) external;
}

interface IDyoorTraits {
    struct TraitInfo {
        uint8 slot;
        uint8 rarity;
        bool exists;
        uint256 maxSupply;
        uint256 mintedSupply;
    }

    function balanceOf(address account, uint256 id) external view returns (uint256);
    function burnFromManager(address from, uint256 traitId, uint256 amount) external;
    function getTraitInfo(uint256 traitId) external view returns (TraitInfo memory);
}

/// @title DyoorTraitManager
/// @notice Burns ERC1155 trait items and equips their trait IDs onto D.Y.O.O.R Droids.
contract DyoorTraitManager is Ownable, Pausable, ReentrancyGuard {
    IDyoorDroids public immutable droids;
    IDyoorTraits public immutable traits;

    event TraitEquipped(address indexed user, uint256 indexed tokenId, uint8 indexed slot, uint256 traitId);

    error ZeroAddress();
    error NotDroidOwner();
    error TraitDoesNotExist();
    error InsufficientTraitBalance();

    constructor(address initialOwner, address droidsAddress, address traitsAddress) Ownable(initialOwner) {
        if (droidsAddress == address(0) || traitsAddress == address(0)) revert ZeroAddress();

        droids = IDyoorDroids(droidsAddress);
        traits = IDyoorTraits(traitsAddress);
    }

    function equipTrait(uint256 tokenId, uint256 traitId) external whenNotPaused nonReentrant {
        _equipTrait(msg.sender, tokenId, traitId);
    }

    function batchEquipTraits(uint256 tokenId, uint256[] calldata traitIds) external whenNotPaused nonReentrant {
        for (uint256 i = 0; i < traitIds.length; ) {
            _equipTrait(msg.sender, tokenId, traitIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _equipTrait(address user, uint256 tokenId, uint256 traitId) internal {
        if (droids.ownerOf(tokenId) != user) revert NotDroidOwner();

        IDyoorTraits.TraitInfo memory info = traits.getTraitInfo(traitId);
        if (!info.exists) revert TraitDoesNotExist();
        if (traits.balanceOf(user, traitId) < 1) revert InsufficientTraitBalance();

        traits.burnFromManager(user, traitId, 1);
        droids.updateDynamicTrait(tokenId, info.slot, traitId);

        emit TraitEquipped(user, tokenId, info.slot, traitId);
    }
}
