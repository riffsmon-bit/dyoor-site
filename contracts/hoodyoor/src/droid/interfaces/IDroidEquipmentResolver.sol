// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only boundary for a future ownership-derived Equipment system.
/// @dev A resolver may describe assets but must not receive authority over a Droid Account.
interface IDroidEquipmentResolver {
    enum EquipmentSlot {
        NONE,
        HEAD,
        EYES,
        WEAPON,
        CORE,
        ARMOR,
        ACCESSORY,
        SPECIAL
    }

    struct Equipment {
        address equipmentContract;
        uint256 tokenId;
        EquipmentSlot slot;
        bytes32 equipmentType;
        address compatibleCollection;
        bool enabled;
        string metadataURI;
    }

    function equipmentFor(address droidAccount) external view returns (Equipment[] memory equipment);
}
