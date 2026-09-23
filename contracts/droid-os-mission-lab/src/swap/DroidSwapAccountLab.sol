// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {KuruMonUsdcAdapterLab as Adapter} from "./KuruMonUsdcAdapterLab.sol";
import {IWrapperControlLab} from "../wrapper/WrappedMissionAccountLab.sol";
import {IERC20} from "@droid-oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@droid-oz/token/ERC20/utils/SafeERC20.sol";

/// @notice Separate LOCAL integration harness, NOT the wrapper's canonical wallet.
/// No factory/public activation, upgrades, runner grants, arbitrary calls or AI signer.
contract DroidSwapAccountLab {
    using SafeERC20 for IERC20;

    struct Request {
        Adapter.Direction direction;
        uint256 amountIn;
        uint256 minimumOut;
        uint256 expectedNonce;
        uint256 expectedEpoch;
        uint64 deadline;
        bytes32 simulationReference;
    }
    IWrapperControlLab public immutable control;
    bytes32 public immutable controlHash;
    uint256 public immutable tokenId;
    Adapter.Venue public venue;
    uint256 public nonce;
    uint256 public reserveWei;
    uint256 public policyEpoch;
    address public policyOwner;
    mapping(uint256 => uint256) public dailyActions;
    mapping(uint256 => uint256) public dailyNativeInput;
    mapping(uint256 => uint256) public dailyTokenInput;
    bool private entered;
    error Denied();
    event PolicyConfigured(address indexed owner, uint256 epoch, uint256 reserveWei, uint256 nonce);
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
    event Recovered(address indexed owner, address indexed asset, address recipient, uint256 amount, uint256 nonce);

    constructor(IWrapperControlLab control_, uint256 id, address router, address market, address usdc) {
        if (
            block.chainid != 31337 || address(control_).code.length == 0 || router == market || router == usdc
                || market == usdc
        ) revert Denied();
        control = control_;
        controlHash = address(control_).codehash;
        tokenId = id;
        venue = Adapter.Venue(router, market, usdc, router.codehash, market.codehash, usdc.codehash);
        Adapter.check(venue);
        _identity();
    }
    receive() external payable {}

    function _identity() private view returns (address owner, uint256 epoch, bool wrapped) {
        if (block.chainid != 31337 || address(control).codehash != controlHash) revert Denied();
        (owner, epoch, wrapped) = control.controlOf(tokenId);
        if (owner == address(0) || owner == address(this) || owner == address(control) || epoch == 0) revert Denied();
    }
    modifier ownerLocked() {
        if (entered) revert Denied();
        (address owner, uint256 epoch,) = _identity();
        if (owner != msg.sender) revert Denied();
        entered = true;
        _;
        (address afterOwner, uint256 afterEpoch,) = _identity();
        if (afterOwner != owner || afterEpoch != epoch) revert Denied();
        entered = false;
    }

    function configurePolicy(uint256 reserve, uint256 expectedNonce, uint256 expectedEpoch) external ownerLocked {
        (, uint256 epoch, bool wrapped) = _identity();
        if (!wrapped || expectedEpoch != epoch || expectedNonce != nonce || address(this).balance < reserve) {
            revert Denied();
        }
        policyOwner = msg.sender;
        policyEpoch = epoch;
        reserveWei = reserve;
        emit PolicyConfigured(msg.sender, epoch, reserve, nonce++);
        // Reconfiguration/transfer does NOT reset per-account daily caps.
    }

    function swap(Request calldata request) external ownerLocked returns (uint256 spent, uint256 received) {
        (, uint256 epoch, bool wrapped) = _identity();
        bool nativeInput = request.direction == Adapter.Direction.MON_TO_USDC;
        uint256 day = block.timestamp / 1 days;
        if (
            !wrapped || policyOwner != msg.sender || policyEpoch != epoch || request.expectedEpoch != epoch
                || request.expectedNonce != nonce || request.deadline <= block.timestamp
                || request.deadline > block.timestamp + 120 || request.simulationReference == bytes32(0)
                || request.minimumOut == 0 || request.amountIn == 0 || dailyActions[day] >= 3
        ) revert Denied();
        if (nativeInput) {
            if (request.amountIn > 0.001 ether || dailyNativeInput[day] + request.amountIn > 0.003 ether) {
                revert Denied();
            }
            dailyNativeInput[day] += request.amountIn;
        } else {
            if (request.amountIn > 1000 || dailyTokenInput[day] + request.amountIn > 3000) revert Denied();
            dailyTokenInput[day] += request.amountIn;
        }
        dailyActions[day]++;
        uint256 usedNonce = nonce++;
        (spent, received) = Adapter.swap(venue, request.direction, request.amountIn, request.minimumOut, reserveWei);
        _recordSwap(request, usedNonce, spent, received);
    }

    function _recordSwap(Request calldata request, uint256 usedNonce, uint256 spent, uint256 received) private {
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

    function recover(bool nativeAsset, address payable recipient, uint256 amount) external ownerLocked {
        if (recipient == address(0) || recipient == address(this) || recipient == address(control)) revert Denied();
        uint256 usedNonce = nonce++;
        if (nativeAsset) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert Denied();
        } else {
            IERC20(venue.usdc).safeTransfer(recipient, amount);
        }
        emit Recovered(msg.sender, nativeAsset ? address(0) : venue.usdc, recipient, amount, usedNonce);
    }
}
