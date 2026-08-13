// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYOORTraitStore {
    function frozen() external view returns (bool);
    function traitExists(uint8 layer, uint16 traitId) external view returns (bool);
    function traitName(uint8 layer, uint16 traitId) external view returns (string memory);
    function traitSVG(uint8 layer, uint16 traitId) external view returns (string memory);
    function layerName(uint8 layer) external pure returns (string memory);
}
