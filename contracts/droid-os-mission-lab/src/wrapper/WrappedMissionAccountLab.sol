// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DroidMissionAccountCoreLab} from "../DroidMissionAccountCoreLab.sol";
import {MissionMintLab} from "../MissionFixtures.sol";

interface IWrapperControlLab {
    function controlOf(uint256 id) external view returns (address owner, uint256 epoch, bool wrapped);
    function accountFactory() external view returns (address);
}

/// @dev Local-only child of the explicitly selected wrapper; not a final V2 deposit address.
contract WrappedMissionAccountLab is DroidMissionAccountCoreLab {
    IWrapperControlLab public immutable wrapper;
    bytes32 public immutable wrapperCodeHash;

    constructor(IWrapperControlLab wrapper_, uint256 id, MissionMintLab minter_)
        DroidMissionAccountCoreLab(id, minter_)
    {
        if (address(wrapper_).code.length == 0 || wrapper_.accountFactory() != msg.sender) revert InvalidIdentity();
        wrapper = wrapper_;
        wrapperCodeHash = address(wrapper_).codehash;
    }

    function _control() private view returns (address owner, uint256 epoch, bool wrapped) {
        _checkLocalTarget();
        if (address(wrapper).codehash != wrapperCodeHash) revert InvalidIdentity();
        (owner, epoch, wrapped) = wrapper.controlOf(tokenId);
        if (owner == address(0) || owner == address(this) || owner == address(wrapper) || epoch == 0) {
            revert InvalidIdentity();
        }
    }

    function _identity() internal view override returns (address owner, uint256 epoch) {
        (owner, epoch,) = _control();
    }

    function _requireMissionAuthority() internal view override {
        (,, bool wrapped) = _control();
        if (!wrapped) revert Denied();
    }
}
