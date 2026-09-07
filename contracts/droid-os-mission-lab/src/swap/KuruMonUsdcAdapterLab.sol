// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@droid-oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@droid-oz/token/ERC20/utils/SafeERC20.sol";

interface IKuruSwapLab {
    function anyToAnySwap(
        address[] calldata markets,
        bool[] calldata buys,
        bool[] calldata nativeSends,
        address debit,
        address credit,
        uint256 amount,
        uint256 minimumOut
    ) external payable returns (uint256);
}

/// @dev Internal library: calls originate from the account, never a pooled adapter
/// wallet. LOCAL ONLY. Proxy runtime hashes do NOT attest implementation slots.
library KuruMonUsdcAdapterLab {
    using SafeERC20 for IERC20;
    enum Direction {
        MON_TO_USDC,
        USDC_TO_MON
    }

    struct Venue {
        address router;
        address market;
        address usdc;
        bytes32 routerHash;
        bytes32 marketHash;
        bytes32 usdcHash;
    }
    error InvalidVenue();
    error UnexpectedEffects();

    function check(Venue memory venue) internal view {
        if (
            block.chainid != 31337 || venue.router.code.length == 0 || venue.market.code.length == 0
                || venue.usdc.code.length == 0 || venue.router.codehash != venue.routerHash
                || venue.market.codehash != venue.marketHash || venue.usdc.codehash != venue.usdcHash
        ) revert InvalidVenue();
    }

    function swap(Venue memory venue, Direction direction, uint256 amount, uint256 minOut, uint256 reserve)
        internal
        returns (uint256 spent, uint256 received)
    {
        check(venue);
        IERC20 token = IERC20(venue.usdc);
        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = token.balanceOf(address(this));
        if (amount == 0 || minOut == 0 || nativeBefore < reserve || token.allowance(address(this), venue.router) != 0) {
            revert UnexpectedEffects();
        }
        bool buy = direction == Direction.USDC_TO_MON;
        if (buy) {
            if (tokenBefore < amount) revert UnexpectedEffects();
            token.safeApprove(venue.router, amount);
        } else if (amount > nativeBefore - reserve) {
            revert UnexpectedEffects();
        }
        received = _callRouter(venue, buy, amount, minOut);
        // Clear even partial/unconsumed allowances in the SAME transaction.
        if (buy) token.safeApprove(venue.router, 0);
        check(venue);
        uint256 nativeAfter = address(this).balance;
        uint256 tokenAfter = token.balanceOf(address(this));
        if (token.allowance(address(this), venue.router) != 0 || nativeAfter < reserve || received < minOut) {
            revert UnexpectedEffects();
        }
        if (buy) {
            if (tokenAfter >= tokenBefore || nativeAfter < nativeBefore || nativeAfter - nativeBefore != received) {
                revert UnexpectedEffects();
            }
            spent = tokenBefore - tokenAfter;
        } else {
            if (nativeAfter >= nativeBefore || tokenAfter < tokenBefore || tokenAfter - tokenBefore != received) {
                revert UnexpectedEffects();
            }
            spent = nativeBefore - nativeAfter;
        }
        // Kuru can refund unfilled input/rounding dust. Never credit it as profit or
        // allow debit beyond the reviewed amount. Unrelated assets are not enumerated.
        if (spent > amount) revert UnexpectedEffects();
    }

    function _callRouter(Venue memory venue, bool buy, uint256 amount, uint256 minOut) private returns (uint256) {
        address[] memory markets = new address[](1);
        markets[0] = venue.market;
        bool[] memory buys = new bool[](1);
        buys[0] = buy;
        bool[] memory nativeSends = new bool[](1);
        // This flag describes the INPUT leg, not whether the output is native.
        nativeSends[0] = !buy;
        return IKuruSwapLab(venue.router).anyToAnySwap{value: buy ? 0 : amount}(
            markets, buys, nativeSends, buy ? venue.usdc : address(0), buy ? address(0) : venue.usdc, amount, minOut
        );
    }
}
