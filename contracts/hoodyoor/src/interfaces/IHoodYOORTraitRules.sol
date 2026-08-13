// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYOORTraitRules {
    function frozen() external view returns (bool);
    function isCompatible(uint256 packedTraits) external view returns (bool);
}
