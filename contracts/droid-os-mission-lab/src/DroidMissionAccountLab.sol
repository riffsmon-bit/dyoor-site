// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DroidMissionAccountCoreLab} from "./DroidMissionAccountCoreLab.sol";
import {EpochParentLab, MissionMintLab} from "./MissionFixtures.sol";

/// @notice Original local epoch-fixture account; no wrapper or production authority.
contract DroidMissionAccountLab is DroidMissionAccountCoreLab {
    EpochParentLab public immutable parent;

    constructor(EpochParentLab parent_, uint256 tokenId_, MissionMintLab minter_)
        DroidMissionAccountCoreLab(tokenId_, minter_)
    {
        parent = parent_;
        _identity();
    }

    function _identity() internal view override returns (address owner, uint256 epoch) {
        _checkLocalTarget();
        if (address(parent).codehash != keccak256(type(EpochParentLab).runtimeCode)) revert InvalidIdentity();
        owner = parent.ownerOf(tokenId);
        epoch = parent.ownershipEpoch(tokenId);
        if (owner == address(0) || owner == address(this) || epoch == 0) revert InvalidIdentity();
    }
}
