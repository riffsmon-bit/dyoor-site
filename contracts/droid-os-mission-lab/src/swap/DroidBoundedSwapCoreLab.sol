// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidMissionAccountCoreLab} from "../DroidMissionAccountCoreLab.sol";
import {MissionMintLab} from "../MissionFixtures.sol";
import {KuruMonUsdcAdapterLab as Adapter} from "./KuruMonUsdcAdapterLab.sol";

/// @dev LOCAL owner-approved swap capability. Inherits the SAME authority, nonce
/// and lock as mint/withdrawal. No runner swap authority, new custody or delegatecall.
abstract contract DroidBoundedSwapCoreLab is DroidMissionAccountCoreLab {
    struct SwapRequest {
        Adapter.Direction direction;
        uint256 amountIn;
        uint256 minimumOut;
        uint256 expectedNonce;
        uint256 expectedEpoch;
        uint64 deadline;
        bytes32 simulationReference;
    }
    uint256 public swapReserveWei;
    uint256 public swapPolicyEpoch;
    address public swapPolicyOwner;
    mapping(uint256 => uint256) public dailySwapActions;
    mapping(uint256 => uint256) public dailyNativeInput;
    mapping(uint256 => uint256) public dailyTokenInput;

    event SwapPolicyConfigured(address indexed owner, uint256 epoch, uint256 reserveWei, uint256 nonce);
    event SwapExecuted(
        address indexed owner,
        uint256 indexed nonce,
        uint256 epoch,
        Adapter.Direction direction,
        uint256 requestedInput,
        uint256 spent,
        uint256 received,
        bytes32 simulationReference
    );

    constructor(uint256 id, MissionMintLab minter_) DroidMissionAccountCoreLab(id, minter_) {}

    function _swapVenue() internal view virtual returns (Adapter.Venue memory);

    function configureSwapPolicy(uint256 reserve, uint256 expectedNonce, uint256 expectedEpoch)
        external
        locked
        currentOwner
    {
        _requireMissionAuthority();
        Adapter.check(_swapVenue());
        (, uint256 epoch) = _identity();
        if (expectedEpoch != epoch || expectedNonce != actionNonce || address(this).balance < reserve) revert Denied();
        swapPolicyOwner = msg.sender;
        swapPolicyEpoch = epoch;
        swapReserveWei = reserve;
        emit SwapPolicyConfigured(msg.sender, epoch, reserve, actionNonce++);
        // Daily counters NEVER reset on policy changes, transfers or rewrapping.
    }

    function swap(SwapRequest calldata request) external locked currentOwner returns (uint256 spent, uint256 received) {
        _requireMissionAuthority();
        (, uint256 epoch) = _identity();
        uint256 day = block.timestamp / 1 days;
        if (
            swapPolicyOwner != msg.sender || swapPolicyEpoch != epoch || request.expectedEpoch != epoch
                || request.expectedNonce != actionNonce || request.deadline <= block.timestamp
                || request.deadline > block.timestamp + 120 || request.simulationReference == bytes32(0)
                || request.minimumOut == 0 || request.amountIn == 0 || dailySwapActions[day] >= 3
        ) revert Denied();
        if (request.direction == Adapter.Direction.MON_TO_USDC) {
            if (request.amountIn > 0.001 ether || dailyNativeInput[day] + request.amountIn > 0.003 ether) {
                revert Denied();
            }
            dailyNativeInput[day] += request.amountIn;
        } else {
            if (request.amountIn > 1000 || dailyTokenInput[day] + request.amountIn > 3000) revert Denied();
            dailyTokenInput[day] += request.amountIn;
        }
        dailySwapActions[day]++;
        uint256 usedNonce = actionNonce++;
        uint256 reserve = swapReserveWei;
        // A lower swap setting cannot spend the reserve of a live mint mission.
        // Owner withdrawal/exit are separate, explicit owner authority, never grants.
        if (
            !grant.cancelled && grant.authorizer == msg.sender && grant.ownershipEpoch == epoch
                && block.timestamp < grant.limits.expiresAt && grant.limits.protectedReserveWei > reserve
        ) {
            reserve = grant.limits.protectedReserveWei;
        }
        (spent, received) = Adapter.swap(_swapVenue(), request.direction, request.amountIn, request.minimumOut, reserve);
        _recordSwap(request, usedNonce, spent, received);
    }

    function _recordSwap(SwapRequest calldata request, uint256 usedNonce, uint256 spent, uint256 received) private {
        emit SwapExecuted(
            msg.sender,
            usedNonce,
            request.expectedEpoch,
            request.direction,
            request.amountIn,
            spent,
            received,
            request.simulationReference
        );
    }

    function _cancelSwapPolicy() internal {
        swapPolicyOwner = address(0);
        swapPolicyEpoch = 0;
        swapReserveWei = 0;
    }
}
