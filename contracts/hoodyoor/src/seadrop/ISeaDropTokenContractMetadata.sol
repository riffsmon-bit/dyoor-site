// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC2981 } from "../interfaces/TokenInterfaces.sol";

/// @notice Metadata interface required by SeaDrop 1.0.
/// @dev Function selectors match ProjectOpenSea/seadrop at commit
///      6ab8b2ce1da7a750301fa34eb60a2bb8b26aebc1.
interface ISeaDropTokenContractMetadata is IERC2981 {
    struct RoyaltyInfo {
        address royaltyAddress;
        uint96 royaltyBps;
    }

    function setBaseURI(string calldata tokenURI) external;
    function setContractURI(string calldata newContractURI) external;
    function setMaxSupply(uint256 newMaxSupply) external;
    function setProvenanceHash(bytes32 newProvenanceHash) external;
    function setRoyaltyInfo(RoyaltyInfo calldata newInfo) external;
    function baseURI() external view returns (string memory);
    function contractURI() external view returns (string memory);
    function maxSupply() external view returns (uint256);
    function provenanceHash() external view returns (bytes32);
    function royaltyAddress() external view returns (address);
    function royaltyBasisPoints() external view returns (uint256);
}
