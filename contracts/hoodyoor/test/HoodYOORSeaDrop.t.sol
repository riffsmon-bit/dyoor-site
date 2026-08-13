// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORSeaDrop } from "../src/HoodYOORSeaDrop.sol";
import { HoodYOOREnergyBank } from "../src/HoodYOOREnergyBank.sol";
import { IHoodYOORRenderer } from "../src/interfaces/IHoodYOORRenderer.sol";
import { IERC721Receiver } from "../src/interfaces/TokenInterfaces.sol";
import { ISeaDrop } from "../src/seadrop/ISeaDrop.sol";
import { INonFungibleSeaDropToken } from "../src/seadrop/INonFungibleSeaDropToken.sol";
import {
    ISeaDropTokenContractMetadata
} from "../src/seadrop/ISeaDropTokenContractMetadata.sol";
import {
    AllowListData,
    PublicDrop,
    TokenGatedDropStage,
    SignedMintValidationParams
} from "../src/seadrop/SeaDropStructs.sol";

interface SeaDropVm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function roll(uint256 newHeight) external;
    function setBlockhash(uint256 blockNumber, bytes32 blockHash) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockFrozenRenderer is IHoodYOORRenderer {
    function tokenURI(uint256 tokenId, uint256 packedTraits)
        external
        pure
        override
        returns (string memory)
    {
        return string(abi.encodePacked("data:mock/", tokenId, "/", packedTraits));
    }

    function validateTraits(uint256 packedTraits) external pure override returns (bool) {
        return packedTraits != 0;
    }

    function isFrozen() external pure override returns (bool) {
        return true;
    }
}

contract MockSeaDropV1 is ISeaDrop {
    address public lastCaller;
    bytes32 public lastConfigHash;
    uint256 public updateCalls;

    function mint(address collection, address minter, uint256 quantity) external {
        INonFungibleSeaDropToken(collection).mintSeaDrop(minter, quantity);
    }

    function updatePublicDrop(PublicDrop calldata publicDrop) external override {
        _record(keccak256(abi.encode("public", publicDrop)));
    }

    function updateAllowList(AllowListData calldata allowListData) external override {
        _record(keccak256(abi.encode("allowlist", allowListData)));
    }

    function updateTokenGatedDrop(
        address allowedNftToken,
        TokenGatedDropStage calldata dropStage
    ) external override {
        _record(keccak256(abi.encode("token-gated", allowedNftToken, dropStage)));
    }

    function updateDropURI(string calldata dropURI) external override {
        _record(keccak256(abi.encode("drop-uri", dropURI)));
    }

    function updateCreatorPayoutAddress(address payoutAddress) external override {
        _record(keccak256(abi.encode("payout", payoutAddress)));
    }

    function updateAllowedFeeRecipient(address feeRecipient, bool allowed) external override {
        _record(keccak256(abi.encode("fee-recipient", feeRecipient, allowed)));
    }

    function updateSignedMintValidationParams(
        address signer,
        SignedMintValidationParams calldata signedMintValidationParams
    ) external override {
        _record(keccak256(abi.encode("signed-mint", signer, signedMintValidationParams)));
    }

    function updatePayer(address payer, bool allowed) external override {
        _record(keccak256(abi.encode("payer", payer, allowed)));
    }

    function _record(bytes32 configHash) private {
        lastCaller = msg.sender;
        lastConfigHash = configHash;
        updateCalls += 1;
    }
}

contract MockSeaDropRerollController {
    HoodYOORSeaDrop private immutable _collection;

    constructor(HoodYOORSeaDrop collection_) {
        _collection = collection_;
    }

    function applyTraits(uint256 tokenId, uint256 nextTraits) external {
        _collection.applyReroll(tokenId, nextTraits);
    }
}

contract HoodYOORSeaDropTest is IERC721Receiver {
    SeaDropVm private constant VM =
        SeaDropVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant TREASURY = address(0xBEEF);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    bytes32 private constant REVEAL_SECRET = keccak256("hoodyoor-seadrop-reveal-secret");
    bytes32 private constant PROVENANCE = keccak256("hoodyoor-seadrop-assignments");

    MockFrozenRenderer private renderer;
    MockSeaDropV1 private seaDrop;
    HoodYOORSeaDrop private collection;
    HoodYOOREnergyBank private energyBank;
    MockSeaDropRerollController private rerollController;

    function setUp() public {
        renderer = new MockFrozenRenderer();
        seaDrop = new MockSeaDropV1();
        address[] memory allowed = new address[](1);
        allowed[0] = address(seaDrop);
        collection = new HoodYOORSeaDrop(
            address(this), TREASURY, address(renderer), allowed
        );
        energyBank = new HoodYOOREnergyBank(address(this));
        energyBank.grantRole(energyBank.CREDIT_ROLE(), address(collection));
        collection.setEnergyConfiguration(address(energyBank), 1_000);
        collection.freezeEnergyConfiguration();

        rerollController = new MockSeaDropRerollController(collection);
        collection.setRerollController(address(rerollController));
        collection.freezeRerollController();
        collection.setContractURI("data:application/json;base64,e30=");
        collection.freezeContractMetadata();
        collection.freezeAllowedSeaDrop();
        _loadAndFreezeAllAssignments();
    }

    function testImplementsSeaDropAndFullyOnchainMetadataInterfaces() public view {
        require(
            collection.supportsInterface(type(INonFungibleSeaDropToken).interfaceId),
            "SeaDrop token interface"
        );
        require(
            collection.supportsInterface(type(ISeaDropTokenContractMetadata).interfaceId),
            "SeaDrop metadata interface"
        );
        require(collection.supportsInterface(0x80ac58cd), "ERC721 interface");
        require(collection.supportsInterface(0x2a55205a), "ERC2981 interface");
        require(collection.maxSupply() == 3_333, "max supply");
        require(bytes(collection.baseURI()).length == 0, "no offchain base URI");
        require(collection.provenanceHash() == PROVENANCE, "assignment provenance");
        require(collection.royaltyAddress() == TREASURY, "royalty treasury");
        require(collection.royaltyBasisPoints() == 300, "royalty bps");
    }

    function testReserveMustMintBeforeSeaDropAndCountsTowardSupply() public {
        VM.expectRevert(HoodYOORSeaDrop.OwnerReserveNotMinted.selector);
        seaDrop.mint(address(collection), ALICE, 1);

        collection.mintOwnerReserve();
        require(collection.ownerReserveMinted(), "reserve minted");
        require(collection.balanceOf(address(this)) == 150, "reserve balance");
        require(collection.totalSupply() == 150, "reserve supply");
        require(collection.paidMinted() == 0, "reserve unpaid");
        require(energyBank.energyBalance(address(this)) == 0, "reserve no Energy");

        (uint256 ownerMinted, uint256 supply, uint256 maximum) =
            collection.getMintStats(address(this));
        require(ownerMinted == 150 && supply == 150 && maximum == 3_333, "reserve stats");
    }

    function testSeaDropMintSharesSupplyAndCreditsEnergy() public {
        collection.mintOwnerReserve();
        seaDrop.mint(address(collection), ALICE, 2);

        require(collection.ownerOf(151) == ALICE && collection.ownerOf(152) == ALICE, "owners");
        require(collection.totalSupply() == 152, "total supply");
        require(collection.paidMinted() == 2, "paid supply");
        require(energyBank.energyBalance(ALICE) == 2_000, "mint Energy");

        (uint256 minterMinted, uint256 supply, uint256 maximum) =
            collection.getMintStats(ALICE);
        require(minterMinted == 2 && supply == 152 && maximum == 3_333, "SeaDrop stats");

        VM.prank(ALICE);
        VM.expectRevert(HoodYOORSeaDrop.OnlyAllowedSeaDrop.selector);
        collection.mintSeaDrop(ALICE, 1);
    }

    function testSeaDropConfigurationCallsAreOwnerForwarded() public {
        PublicDrop memory drop = PublicDrop({
            mintPrice: uint80(0.0025 ether),
            startTime: 100,
            endTime: 200,
            maxTotalMintableByWallet: 3,
            feeBps: 1_000,
            restrictFeeRecipients: true
        });
        collection.updatePublicDrop(address(seaDrop), drop);
        require(seaDrop.lastCaller() == address(collection), "token calls SeaDrop");

        string[] memory keys = new string[](0);
        collection.updateAllowList(
            address(seaDrop),
            AllowListData({
                merkleRoot: keccak256("root"), publicKeyURIs: keys, allowListURI: "data:allowlist"
            })
        );
        collection.updateCreatorPayoutAddress(address(seaDrop), TREASURY);
        collection.updateAllowedFeeRecipient(address(seaDrop), BOB, true);
        collection.updateDropURI(address(seaDrop), "data:drop");
        collection.updatePayer(address(seaDrop), BOB, true);
        require(seaDrop.updateCalls() == 6, "all configuration forwarded");

        VM.prank(ALICE);
        VM.expectRevert(HoodYOORSeaDrop.NotOwner.selector);
        collection.updatePublicDrop(address(seaDrop), drop);
    }

    function testSeaDropAddressAndCollectionMetadataArePermanentlyFrozen() public {
        address[] memory replacement = new address[](1);
        replacement[0] = address(seaDrop);
        VM.expectRevert(HoodYOORSeaDrop.AllowedSeaDropIsFrozen.selector);
        collection.updateAllowedSeaDrop(replacement);

        VM.expectRevert(HoodYOORSeaDrop.ContractMetadataIsFrozen.selector);
        collection.setContractURI("data:new");
        VM.expectRevert(HoodYOORSeaDrop.FullyOnchainBaseURI.selector);
        collection.setBaseURI("ipfs://not-used/");
        VM.expectRevert(
            abi.encodeWithSelector(HoodYOORSeaDrop.FixedMaxSupply.selector, uint256(3_334))
        );
        collection.setMaxSupply(3_334);
    }

    function testTradingUnlockIncludesReserveSupply() public {
        collection.mintOwnerReserve();
        seaDrop.mint(address(collection), ALICE, 1_516);
        require(collection.totalSupply() == 1_666, "one below threshold");

        VM.prank(ALICE);
        VM.expectRevert(HoodYOORSeaDrop.SecondaryTradingLocked.selector);
        collection.transferFrom(ALICE, BOB, 151);

        seaDrop.mint(address(collection), BOB, 1);
        require(collection.totalSupply() == 1_667, "threshold supply");
        require(collection.secondaryTradingEnabled(), "automatic unlock");

        VM.prank(ALICE);
        collection.transferFrom(ALICE, BOB, 151);
        require(collection.ownerOf(151) == BOB, "transfer after unlock");
    }

    function testFinalizeRevealAndRerollRemainFullyOnchain() public {
        collection.mintOwnerReserve();
        seaDrop.mint(address(collection), ALICE, 1);
        require(_startsWith(collection.tokenURI(151), "data:application/json;base64,"), "pending");

        collection.finalizeMintingAndRequestReveal(REVEAL_SECRET);
        VM.expectRevert(HoodYOORSeaDrop.MintingAlreadyFinalized.selector);
        seaDrop.mint(address(collection), ALICE, 1);

        uint256 target = collection.revealBlock();
        VM.roll(target + 1);
        VM.setBlockhash(target, keccak256("seadrop-reveal-block"));
        collection.completeReveal();
        require(collection.revealed(), "revealed");
        require(_startsWith(collection.tokenURI(151), "data:mock/"), "renderer URI");

        uint256 beforeTraits = collection.tokenTraits(151);
        uint256 nextTraits = beforeTraits ^ (uint256(1) << 64);
        rerollController.applyTraits(151, nextTraits);
        require(collection.tokenTraits(151) == nextTraits, "reroll applied");
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function _loadAndFreezeAllAssignments() private {
        uint256[] memory tokenIds = new uint256[](3_333);
        uint256[] memory packedTraits = new uint256[](3_333);
        for (uint256 i; i < 3_333; ++i) {
            uint256 tokenId = i + 1;
            tokenIds[i] = tokenId;
            uint16 background = tokenId <= 10
                ? collection.oneOfOneBackgroundIdAt(uint8(tokenId - 1))
                : collection.INDAHOOD_BACKGROUND_ID();
            packedTraits[i] = uint256(background) | (uint256(201) << 16)
                | (uint256(3001) << 48) | (uint256(4001) << 64)
                | (uint256(5001) << 80) | (uint256(6001) << 96);
        }
        collection.setInitialTraitsBatch(tokenIds, packedTraits);
        collection.freezeInitialTraits(PROVENANCE, keccak256(abi.encodePacked(REVEAL_SECRET)));
        collection.freezeRenderer();
    }

    function _startsWith(string memory value, string memory prefix) private pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        if (valueBytes.length < prefixBytes.length) return false;
        for (uint256 i; i < prefixBytes.length; ++i) {
            if (valueBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }
}
