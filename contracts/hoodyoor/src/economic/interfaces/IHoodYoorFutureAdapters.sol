// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface only. No production router is enabled by this release.
interface IHoodYoorAssetRouter {
    function routeReward(
        address settlementAsset,
        uint256 settlementAmount,
        address outputAsset,
        uint256 minimumOutput,
        uint256 deadline,
        address droidAccount,
        bytes calldata adapterData
    ) external returns (uint256 outputAmount);
}

/// @notice Interface only. Automatic cross-chain movement remains disabled.
interface IHoodYoorBridgeAdapter {
    function bridge(
        uint256 destinationChainId,
        address asset,
        uint256 amount,
        address destinationDroidAccount,
        bytes calldata adapterData
    ) external payable returns (bytes32 transferId);
}

/// @notice Interface only. It does not grant a session key any authority.
interface IHoodYoorAgentPolicy {
    function isPermitted(
        bytes32 droidKey,
        address sessionKey,
        address target,
        bytes4 selector,
        address asset,
        uint256 amount
    ) external view returns (bool);
}
