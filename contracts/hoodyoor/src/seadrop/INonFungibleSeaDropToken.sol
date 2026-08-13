// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ISeaDropTokenContractMetadata } from "./ISeaDropTokenContractMetadata.sol";
import {
    AllowListData,
    PublicDrop,
    TokenGatedDropStage,
    SignedMintValidationParams
} from "./SeaDropStructs.sol";

/// @notice NFT callback and configuration interface required by SeaDrop 1.0.
/// @dev Function selectors match ProjectOpenSea/seadrop at commit
///      6ab8b2ce1da7a750301fa34eb60a2bb8b26aebc1.
interface INonFungibleSeaDropToken is ISeaDropTokenContractMetadata {
    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop) external;
    function mintSeaDrop(address minter, uint256 quantity) external;

    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply);

    function updatePublicDrop(address seaDropImpl, PublicDrop calldata publicDrop) external;
    function updateAllowList(address seaDropImpl, AllowListData calldata allowListData) external;

    function updateTokenGatedDrop(
        address seaDropImpl,
        address allowedNftToken,
        TokenGatedDropStage calldata dropStage
    ) external;

    function updateDropURI(address seaDropImpl, string calldata dropURI) external;

    function updateCreatorPayoutAddress(address seaDropImpl, address payoutAddress) external;

    function updateAllowedFeeRecipient(
        address seaDropImpl,
        address feeRecipient,
        bool allowed
    ) external;

    function updateSignedMintValidationParams(
        address seaDropImpl,
        address signer,
        SignedMintValidationParams memory signedMintValidationParams
    ) external;

    function updatePayer(address seaDropImpl, address payer, bool allowed) external;
}
