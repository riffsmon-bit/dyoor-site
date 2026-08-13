// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORSeaDrop } from "../src/HoodYOORSeaDrop.sol";
import { HoodYOOREnergyBank } from "../src/HoodYOOREnergyBank.sol";
import { IHoodYOORRenderer } from "../src/interfaces/IHoodYOORRenderer.sol";
import { IERC721Receiver } from "../src/interfaces/TokenInterfaces.sol";
import { PublicDrop } from "../src/seadrop/SeaDropStructs.sol";

interface SeaDropForkVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
}

interface ICanonicalSeaDrop {
    function mintPublic(
        address nftContract,
        address feeRecipient,
        address minterIfNotPayer,
        uint256 quantity
    ) external payable;
}

contract ForkFrozenRenderer is IHoodYOORRenderer {
    function tokenURI(uint256, uint256) external pure override returns (string memory) {
        return "data:application/json;base64,e30=";
    }

    function validateTraits(uint256 packedTraits) external pure override returns (bool) {
        return packedTraits != 0;
    }

    function isFrozen() external pure override returns (bool) {
        return true;
    }
}

contract ForkRerollController {
    function applyTraits(HoodYOORSeaDrop collection, uint256 tokenId, uint256 nextTraits)
        external
    {
        collection.applyReroll(tokenId, nextTraits);
    }
}

/// @notice Run with Robinhood mainnet fork state to exercise the real SeaDrop 1.0 bytecode:
///         forge test --fork-url https://rpc.mainnet.chain.robinhood.com \
///           --match-contract HoodYOORSeaDropForkTest -vv
contract HoodYOORSeaDropForkTest is IERC721Receiver {
    SeaDropForkVm private constant VM =
        SeaDropForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SEADROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant TREASURY = address(0xBEEF);
    address private constant FEE_RECIPIENT = address(0xFEE);
    address private constant MINTER = address(0xA11CE);
    uint256 private constant PRICE = 0.0025 ether;

    function testCanonicalSeaDropPublicMintCallbackAndTenPercentSplit() public {
        // The ordinary offline suite intentionally skips this fork-only assertion.
        if (SEADROP.code.length == 0) return;

        ForkFrozenRenderer renderer = new ForkFrozenRenderer();
        address[] memory allowedSeaDrop = new address[](1);
        allowedSeaDrop[0] = SEADROP;
        HoodYOORSeaDrop collection = new HoodYOORSeaDrop(
            address(this), TREASURY, address(renderer), allowedSeaDrop
        );
        HoodYOOREnergyBank energyBank = new HoodYOOREnergyBank(address(this));
        energyBank.grantRole(energyBank.CREDIT_ROLE(), address(collection));
        collection.setEnergyConfiguration(address(energyBank), 1_000);
        collection.freezeEnergyConfiguration();

        ForkRerollController rerollController = new ForkRerollController();
        collection.setRerollController(address(rerollController));
        collection.freezeRerollController();
        collection.setContractURI("data:application/json;base64,e30=");
        collection.freezeContractMetadata();
        collection.freezeAllowedSeaDrop();
        _loadAndFreezeAllAssignments(collection);

        collection.updateCreatorPayoutAddress(SEADROP, TREASURY);
        collection.updateAllowedFeeRecipient(SEADROP, FEE_RECIPIENT, true);
        collection.updatePublicDrop(
            SEADROP,
            PublicDrop({
                mintPrice: uint80(PRICE),
                startTime: uint48(block.timestamp),
                endTime: uint48(block.timestamp + 1 days),
                maxTotalMintableByWallet: 3,
                feeBps: 1_000,
                restrictFeeRecipients: true
            })
        );
        collection.mintOwnerReserve();

        uint256 treasuryBefore = TREASURY.balance;
        uint256 feeBefore = FEE_RECIPIENT.balance;
        VM.deal(MINTER, PRICE);
        VM.prank(MINTER);
        ICanonicalSeaDrop(SEADROP).mintPublic{ value: PRICE }(
            address(collection), FEE_RECIPIENT, address(0), 1
        );

        require(collection.ownerOf(151) == MINTER, "canonical SeaDrop callback owner");
        require(collection.totalSupply() == 151, "shared reserve and paid supply");
        require(collection.paidMinted() == 1, "paid supply");
        require(energyBank.energyBalance(MINTER) == 1_000, "paid mint Energy");
        require(FEE_RECIPIENT.balance - feeBefore == PRICE / 10, "10% OpenSea fee");
        require(TREASURY.balance - treasuryBefore == PRICE * 9 / 10, "90% treasury payout");
    }

    function _loadAndFreezeAllAssignments(HoodYOORSeaDrop collection) private {
        uint256[] memory tokenIds = new uint256[](3_333);
        uint256[] memory packedTraits = new uint256[](3_333);
        for (uint256 i; i < 3_333; ++i) {
            uint256 tokenId = i + 1;
            tokenIds[i] = tokenId;
            uint16 background = tokenId <= 10
                ? collection.oneOfOneBackgroundIdAt(uint8(tokenId - 1))
                : collection.INDAHOOD_BACKGROUND_ID();
            packedTraits[i] = uint256(background) | (uint256(201) << 16)
                | (uint256(3_001) << 48) | (uint256(4_001) << 64)
                | (uint256(5_001) << 80) | (uint256(6_001) << 96);
        }
        collection.setInitialTraitsBatch(tokenIds, packedTraits);
        collection.freezeInitialTraits(
            keccak256("fork assignments"), keccak256("fork reveal commitment")
        );
        collection.freezeRenderer();
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
