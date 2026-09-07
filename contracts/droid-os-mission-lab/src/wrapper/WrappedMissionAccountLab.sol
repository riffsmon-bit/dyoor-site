// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DroidMissionAccountCoreLab} from "../DroidMissionAccountCoreLab.sol";
import {MissionMintLab} from "../MissionFixtures.sol";
import {IERC20} from "@droid-oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@droid-oz/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@droid-oz/token/ERC721/IERC721.sol";

interface IWrapperControlLab {
    function controlOf(uint256 id) external view returns (address owner, uint256 epoch, bool wrapped);
    function accountFactory() external view returns (address);
    function completeAccountExit(uint256 id, address owner, uint256 expectedEpoch) external;
}

/// @dev Local-only child of the explicitly selected wrapper; not a final V2 deposit address.
contract WrappedMissionAccountLab is DroidMissionAccountCoreLab {
    using SafeERC20 for IERC20;
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

    /// @notice Explicit owner recovery, never a runner capability. Fixed transfer
    /// selectors only; no approval, delegatecall, arbitrary calldata or admin path.
    /// Unsupported/reverting tokens can still be unrecoverable.
    function recoverERC20(address asset, address recipient, uint256 amount) external locked currentOwner {
        _recoveryTarget(asset, recipient);
        actionNonce++;
        IERC20(asset).safeTransfer(recipient, amount);
        emit Withdrawn(msg.sender, recipient, asset, amount);
    }

    function recoverERC721(address asset, address recipient, uint256 id) external locked currentOwner {
        _recoveryTarget(asset, recipient);
        actionNonce++;
        IERC721(asset).safeTransferFrom(address(this), recipient, id);
        if (IERC721(asset).ownerOf(id) != recipient) revert Denied();
        emit Withdrawn(msg.sender, recipient, asset, id);
    }

    function _recoveryTarget(address asset, address recipient) private view {
        if (
            asset.code.length == 0 || asset == address(this) || asset == address(wrapper) || recipient == address(0)
                || recipient == address(this) || recipient == address(wrapper)
        ) revert Denied();
    }

    /// @notice Sweep supported NFTs and ALL native balance, then return the original
    /// in one owner transaction. A front-run dust deposit is swept too. Other assets
    /// are not enumerated: recover them explicitly first. No arbitrary recipient.
    function exitToOwner(uint256[] calldata mintIds, uint256 expectedNonce, uint256 expectedEpoch) external locked {
        (address owner, uint256 epoch, bool wrapped) = _control();
        if (
            msg.sender != owner || !wrapped || expectedEpoch != epoch || expectedNonce != actionNonce
                || mintIds.length > 100
        ) revert Denied();
        grant.cancelled = true;
        actionNonce++;
        emit MissionCancelled(missionId, owner);
        for (uint256 i; i < mintIds.length; ++i) {
            minter.safeTransferFrom(address(this), owner, mintIds[i]);
            if (minter.ownerOf(mintIds[i]) != owner) revert Denied();
            emit Withdrawn(owner, owner, address(minter), mintIds[i]);
        }
        uint256 amount = address(this).balance;
        if (amount != 0) {
            (bool ok,) = payable(owner).call{value: amount}("");
            if (!ok) revert Denied();
            emit Withdrawn(owner, owner, address(0), amount);
        }
        // The wrapper revalidates owner/epoch and supported balances, then burns
        // the receipt. Unlike currentOwner, this path EXPECTS exactly one epoch bump.
        wrapper.completeAccountExit(tokenId, owner, epoch);
        (address afterOwner, uint256 afterEpoch, bool afterWrapped) = _control();
        if (afterOwner != owner || afterEpoch != epoch + 1 || afterWrapped) revert Denied();
    }
}
