// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@droid-oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@droid-oz/token/ERC20/utils/SafeERC20.sol";

interface IKuruCanaryRouter {
    function anyToAnySwap(address[] calldata, bool[] calldata, bool[] calldata, address, address, uint256, uint256)
        external
        payable
        returns (uint256);
}

/// @notice One owner-signed buy and one owner-signed sell. Not an autonomous wallet,
/// not a migration destination, not an audited production protocol release.
abstract contract OwnerSwapCanaryCore {
    struct Route {
        address router;
        address market;
        address usdc;
    }
    using SafeERC20 for IERC20;
    uint256 public constant MAX_NATIVE_INPUT = 0.001 ether;
    uint256 public constant PROTECTED_RESERVE = 0.0001 ether;
    uint256 public constant MAX_TOKEN_UNITS = 1000; // USDC has six decimals.
    uint256 public actionNonce;
    uint256 public purchasedUnits;
    uint64 public expiresAt;
    uint8 public phase; // 0 fresh, 1 bought, 2 sold, 3 closed. Never resets.
    bool private entered;

    error Denied();
    error InvalidEffects();
    event Funded(address indexed sender, uint256 amount);
    event SwapExecuted(
        uint256 indexed nonce,
        address indexed owner,
        uint8 direction,
        uint256 input,
        uint256 output,
        bytes32 evidenceHash
    );
    event Recovered(uint256 indexed nonce, address indexed owner, address indexed asset, uint256 amount);

    constructor() {
        expiresAt = uint64(block.timestamp + 1 days);
    }
    function currentOwner() public view virtual returns (address);
    function venue() public view virtual returns (address router, address market, address usdc);
    function _checkVenue() internal view virtual;

    modifier ownerLocked() {
        if (entered) revert Denied();
        address owner = currentOwner();
        if (msg.sender != owner) revert Denied();
        entered = true;
        _;
        if (currentOwner() != owner) revert Denied();
        entered = false;
    }

    receive() external payable {
        (address router,,) = venue();
        // Router payouts/refunds are not owner funding and cannot authorize actions.
        if (
            msg.sender != router
                && (msg.sender != currentOwner()
                    || phase != 0
                    || block.timestamp >= expiresAt
                    || msg.value == 0
                    || address(this).balance > MAX_NATIVE_INPUT + PROTECTED_RESERVE)
        ) revert Denied();
        emit Funded(msg.sender, msg.value);
    }

    function _preparation(uint256 nonce, uint64 deadline) private view {
        if (nonce != actionNonce || deadline <= block.timestamp || deadline > block.timestamp + 120) revert Denied();
    }

    /// @dev Simulation hash is audit correlation, not proof or signing authority.
    function buy(uint256 amountIn, uint256 minimumOut, uint256 nonce, uint64 deadline, bytes32 evidenceHash)
        external
        ownerLocked
        returns (uint256 received)
    {
        _preparation(nonce, deadline);
        if (
            phase != 0 || block.timestamp >= expiresAt || evidenceHash == bytes32(0) || amountIn == 0
                || amountIn > MAX_NATIVE_INPUT || minimumOut == 0
        ) revert Denied();
        phase = 1;
        actionNonce++;
        received = _swap(false, amountIn, minimumOut);
        if (received > MAX_TOKEN_UNITS) revert InvalidEffects();
        purchasedUnits = received;
        emit SwapExecuted(nonce, msg.sender, 0, amountIn, received, evidenceHash);
    }

    function sell(uint256 minimumOut, uint256 nonce, uint64 deadline, bytes32 evidenceHash)
        external
        ownerLocked
        returns (uint256 received)
    {
        _preparation(nonce, deadline);
        if (
            phase != 1 || block.timestamp >= expiresAt || evidenceHash == bytes32(0) || purchasedUnits == 0
                || purchasedUnits > MAX_TOKEN_UNITS || minimumOut == 0
        ) revert Denied();
        phase = 2;
        actionNonce++;
        received = _swap(true, purchasedUnits, minimumOut);
        emit SwapExecuted(nonce, msg.sender, 1, purchasedUnits, received, evidenceHash);
    }

    function _swap(bool tokenInput, uint256 amount, uint256 minimumOut) private returns (uint256 output) {
        _checkVenue();
        (address router,, address usdc) = venue();
        IERC20 token = IERC20(usdc);
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = token.balanceOf(address(this));
        if (nativeBefore < PROTECTED_RESERVE || token.allowance(address(this), router) != 0) revert Denied();
        if (tokenInput) {
            if (tokenBefore < amount) revert Denied();
            token.safeApprove(router, amount);
        } else if (amount > nativeBefore - PROTECTED_RESERVE) {
            revert Denied();
        }
        output = _route(tokenInput, amount, minimumOut);
        if (tokenInput) token.safeApprove(router, 0);
        _checkVenue();
        uint256 nativeAfter = address(this).balance;
        uint256 tokenAfter = token.balanceOf(address(this));
        if (output < minimumOut || token.allowance(address(this), router) != 0 || nativeAfter < PROTECTED_RESERVE) {
            revert InvalidEffects();
        }
        if (tokenInput) {
            if (
                tokenAfter >= tokenBefore || tokenBefore - tokenAfter > amount || nativeAfter < nativeBefore
                    || nativeAfter - nativeBefore != output
            ) revert InvalidEffects();
        } else {
            if (
                nativeAfter >= nativeBefore || nativeBefore - nativeAfter > amount || tokenAfter < tokenBefore
                    || tokenAfter - tokenBefore != output
            ) revert InvalidEffects();
        }
    }

    function _route(bool tokenInput, uint256 amount, uint256 minimumOut) private returns (uint256) {
        Route memory v;
        (v.router, v.market, v.usdc) = venue();
        address[] memory markets = new address[](1);
        markets[0] = v.market;
        bool[] memory buys = new bool[](1);
        buys[0] = tokenInput;
        bool[] memory nativeSends = new bool[](1);
        nativeSends[0] = !tokenInput;
        return IKuruCanaryRouter(v.router).anyToAnySwap{value: tokenInput ? 0 : amount}(
            markets,
            buys,
            nativeSends,
            tokenInput ? v.usdc : address(0),
            tokenInput ? address(0) : v.usdc,
            amount,
            minimumOut
        );
    }

    // Recovery remains usable after test expiry and independently of router health.
    // Separate native recovery means USDC pause/blacklist cannot trap native funds.
    // Recovery closes trading permanently. Only the current owner receives assets.
    function recoverNative(uint256 nonce, uint64 deadline) external ownerLocked {
        _preparation(nonce, deadline);
        phase = 3;
        actionNonce++;
        uint256 amount = address(this).balance;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert Denied();
        emit Recovered(nonce, msg.sender, address(0), amount);
    }

    function recoverUSDC(uint256 nonce, uint64 deadline) external ownerLocked {
        _preparation(nonce, deadline);
        phase = 3;
        actionNonce++;
        (,, address usdc) = venue();
        uint256 amount = IERC20(usdc).balanceOf(address(this));
        IERC20(usdc).safeTransfer(msg.sender, amount);
        emit Recovered(nonce, msg.sender, usdc, amount);
    }
    // No NFT receiver, arbitrary transfer/call/approve, fallback, runner or upgrade path.
}
