// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHoodYOORRerollControllerV2 {
    struct RerollAuthorization {
        uint256 tokenId;
        address tokenOwner;
        uint256 expectedTraits;
        uint256 nextTraits;
        uint8 action;
        uint8 layer;
        uint8 paymentMethod;
        address paymentToken;
        uint256 paymentAmount;
        uint256 nonce;
        uint256 deadline;
    }

    function quoteEnergy(uint256 tokenId, uint8 layer, uint16 nextTraitId)
        external
        view
        returns (uint256);

    function quoteRerollAll(uint256 tokenId, uint256 nextTraits) external view returns (uint256);

    function quotePayment(uint256 energyUnits, uint8 paymentMethod)
        external
        view
        returns (address paymentToken, uint256 paymentAmount);

    function rerollDigest(RerollAuthorization calldata authorization)
        external
        view
        returns (bytes32);

    function confirmRerollEnergy(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external;

    function confirmRerollETH(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external payable;

    function confirmRerollUSDG(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external;
}
