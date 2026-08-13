// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYOOREnergyBank {
    function energyBalance(address user) external view returns (uint256);
    function creditEnergy(address user, uint256 amount, bytes32 creditId) external;
    function spendEnergy(address user, uint256 amount, bytes32 reason) external;
}
