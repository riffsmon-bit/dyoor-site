// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYoorAssetRegistry {
    function isAssetEnabled(address asset) external view returns (bool);

    function isStrategyEligible(address asset) external view returns (bool);

    function isRouterSupported(address asset) external view returns (bool);
}
