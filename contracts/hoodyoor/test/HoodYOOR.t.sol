// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOOR } from "../src/HoodYOOR.sol";
import { HoodYOOREnergyBank } from "../src/HoodYOOREnergyBank.sol";
import { HoodYOORRenderer } from "../src/HoodYOORRenderer.sol";
import { HoodYOORTraitStore } from "../src/HoodYOORTraitStore.sol";
import { HoodYOORPrototypeSVG } from "../src/prototype/HoodYOORPrototypeSVG.sol";
import { IERC721Receiver } from "../src/interfaces/TokenInterfaces.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function roll(uint256 newHeight) external;
    function setBlockhash(uint256 blockNumber, bytes32 blockHash) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockRerollController {
    HoodYOOR private immutable _collection;

    constructor(HoodYOOR collection) {
        _collection = collection;
    }

    function applyTraits(uint256 tokenId, uint256 nextTraits) external {
        _collection.applyReroll(tokenId, nextTraits);
    }
}

contract HoodYOORHarness is HoodYOOR {
    constructor(address initialOwner, address treasury_, address renderer_)
        HoodYOOR(initialOwner, treasury_, renderer_)
    { }

    function setTotalSupplyForTest(uint256 supply) external {
        totalSupply = supply;
    }
}

contract HoodYOORTest is IERC721Receiver {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant TREASURY = address(0xBEEF);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    bytes32 private constant REVEAL_SECRET = keccak256("hoodyoor-local-reveal-secret");

    HoodYOORTraitStore private store;
    HoodYOORRenderer private renderer;
    HoodYOORHarness private collection;
    HoodYOOREnergyBank private energyBank;
    MockRerollController private controller;

    function setUp() public {
        store = new HoodYOORTraitStore(address(this));
        _seedPrototypeStore();
        store.freeze();

        renderer = new HoodYOORRenderer(address(store));
        collection = new HoodYOORHarness(address(this), TREASURY, address(renderer));
        energyBank = new HoodYOOREnergyBank(address(this));
        energyBank.grantRole(energyBank.CREDIT_ROLE(), address(collection));
        collection.setEnergyConfiguration(address(energyBank), 1_000);
        collection.freezeEnergyConfiguration();
        controller = new MockRerollController(collection);
        collection.setRerollController(address(controller));
        collection.freezeRerollController();
    }

    function testFixedCollectionEconomicsAndRoyalty() public view {
        _assertEq(collection.MAX_SUPPLY(), 3_333, "max supply");
        _assertEq(collection.OWNER_RESERVE_ALLOCATION(), 150, "owner reserve");
        _assertEq(collection.PAID_ALLOCATION(), 3_183, "paid allocation");
        _assertEq(collection.SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY(), 1_667, "50 percent unlock");
        _assertEq(collection.MINT_PRICE(), 0.0025 ether, "mint price");
        _assertEq(collection.DEFAULT_MINT_ENERGY_REWARD(), 1_000, "default mint Energy");
        _assertEq(collection.mintEnergyReward(), 1_000, "configured mint Energy");
        _assertEq(address(collection.energyBank()), address(energyBank), "Energy Bank");
        require(collection.energyConfigurationFrozen(), "Energy configuration frozen");
        require(!collection.secondaryTradingEnabled(), "secondary initially locked");

        (address receiver, uint256 amount) = collection.royaltyInfo(1, 1 ether);
        _assertEq(receiver, TREASURY, "royalty receiver");
        _assertEq(amount, 0.03 ether, "three percent royalty");
    }

    function testRendererReturnsSVGAndDataURIMetadata() public view {
        uint256 packed = _prototypeTraits(122);
        string memory svg = renderer.renderSVG(packed);
        string memory attributes = renderer.attributesJSON(packed);
        string memory metadata = renderer.tokenURI(42, packed);

        _assertContains(svg, "<svg", "svg root");
        _assertContains(svg, "#c8ff00", "INDAHOOD color");
        _assertContains(svg, "</svg>", "svg close");
        _assertContains(attributes, "INDAHOOD", "background metadata");
        _assertContains(attributes, "Robinhood Feather Cap", "hat metadata");
        _assertStartsWith(metadata, "data:application/json;base64,", "metadata data URI");
    }

    function testOneOfOneBackgroundCannotBeAssignedTwice() public {
        collection.setInitialTraits(1, _prototypeTraits(101));
        vm.expectRevert(
            abi.encodeWithSelector(HoodYOOR.DuplicateOneOfOneBackground.selector, uint16(101))
        );
        collection.setInitialTraits(2, _prototypeTraits(101));
    }

    function testLaunchConfigurationRejectsEOAContractsAndEmptyProvenance() public {
        vm.expectRevert(HoodYOOR.InvalidRenderer.selector);
        new HoodYOOR(address(this), TREASURY, ALICE);

        HoodYOORTraitStore mutableStore = new HoodYOORTraitStore(address(this));
        HoodYOORRenderer mutableRenderer = new HoodYOORRenderer(address(mutableStore));
        HoodYOOR candidate = new HoodYOOR(address(this), TREASURY, address(mutableRenderer));
        vm.expectRevert(HoodYOOR.TraitStoreNotFrozen.selector);
        candidate.freezeRenderer();

        candidate.setRerollController(ALICE);
        vm.expectRevert(HoodYOOR.InvalidRerollController.selector);
        candidate.freezeRerollController();

        vm.expectRevert(HoodYOOR.InvalidEnergyBank.selector);
        candidate.setEnergyConfiguration(ALICE, 1_000);
        vm.expectRevert(HoodYOOR.EnergyConfigurationFrozen.selector);
        collection.setEnergyConfiguration(address(energyBank), 2_000);

        vm.expectRevert(HoodYOOR.EmptyProvenanceHash.selector);
        collection.freezeInitialTraits(bytes32(0), _revealCommitment());

        vm.expectRevert(HoodYOOR.EmptyRevealCommitment.selector);
        collection.freezeInitialTraits(keccak256("provenance"), bytes32(0));
    }

    function testLaunchGtdMintAndRerollGuard() public {
        _loadAndFreezeAllAssignments();

        vm.expectRevert(HoodYOOR.OwnerReserveNotMinted.selector);
        collection.setSaleState(false, true);
        vm.expectRevert(HoodYOOR.MissingGTDMerkleRoot.selector);
        collection.setSaleState(true, false);

        bytes32 root = collection.gtdLeaf(ALICE, 2);
        collection.setGTDMerkleRoot(root);
        collection.setSaleState(true, false);
        require(collection.ownerReserveMinted(), "owner reserve minted");
        _assertEq(collection.balanceOf(address(this)), 150, "owner reserve balance");
        _assertEq(collection.totalSupply(), 150, "owner reserve supply");
        _assertEq(collection.paidMinted(), 0, "reserve is not paid");
        _assertEq(energyBank.energyBalance(address(this)), 0, "reserve earns no Energy");
        _assertEq(
            collection.SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY() - collection.totalSupply(),
            1_517,
            "paid mints remaining before unlock"
        );
        require(!collection.secondaryTradingEnabled(), "reserve remains below unlock");
        collection.setSaleState(false, false);
        collection.setSaleState(true, false);
        _assertEq(collection.totalSupply(), 150, "owner reserve only mints once");

        bytes32[] memory proof = new bytes32[](0);
        vm.deal(ALICE, 1 ether);
        vm.startPrank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(HoodYOOR.IncorrectPayment.selector, 0.005 ether, 1 wei)
        );
        collection.mintGTD{ value: 1 wei }(2, 2, proof);
        collection.mintGTD{ value: 0.005 ether }(2, 2, proof);
        vm.stopPrank();

        _assertEq(collection.balanceOf(ALICE), 2, "GTD balance");
        _assertEq(collection.paidMinted(), 2, "paid mint counter");
        _assertEq(energyBank.energyBalance(ALICE), 2_000, "GTD mint Energy reward");
        _assertStartsWith(
            collection.tokenURI(151), "data:application/json;base64,", "unrevealed tokenURI"
        );
        vm.expectRevert(HoodYOOR.TraitsNotRevealed.selector);
        collection.tokenTraits(151);
        vm.expectRevert(HoodYOOR.TraitsNotRevealed.selector);
        controller.applyTraits(151, _prototypeTraits(122));

        vm.expectRevert(HoodYOOR.InvalidRevealSecret.selector);
        collection.finalizeMintingAndRequestReveal(keccak256("wrong-secret"));
        collection.finalizeMintingAndRequestReveal(REVEAL_SECRET);
        vm.expectRevert(HoodYOOR.MintingAlreadyFinalized.selector);
        collection.setSaleState(false, true);

        uint256 firstRevealBlock = collection.revealBlock();
        vm.expectRevert(
            abi.encodeWithSelector(HoodYOOR.RevealNotReady.selector, firstRevealBlock + 1)
        );
        collection.completeReveal();

        vm.roll(firstRevealBlock + collection.REVEAL_HASH_WINDOW() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(HoodYOOR.RevealBlockExpired.selector, firstRevealBlock)
        );
        collection.completeReveal();
        collection.refreshRevealBlock();

        uint256 finalRevealBlock = collection.revealBlock();
        vm.roll(finalRevealBlock + 1);
        vm.setBlockhash(finalRevealBlock, keccak256("fixed-local-reveal-block"));
        collection.completeReveal();

        require(collection.revealed(), "revealed state");
        require(collection.revealSeed() != bytes32(0), "reveal seed");
        _assertStartsWith(
            collection.tokenURI(1), "data:application/json;base64,", "revealed tokenURI"
        );

        bool[] memory seenAssignments = new bool[](3_334);
        bool assignmentMoved;
        for (uint256 tokenId = 1; tokenId <= 3_333; ++tokenId) {
            uint256 assignmentId = collection.assignmentIdForToken(tokenId);
            require(assignmentId != 0 && assignmentId <= 3_333, "assignment range");
            require(!seenAssignments[assignmentId], "assignment collision");
            seenAssignments[assignmentId] = true;
            if (assignmentId != tokenId) assignmentMoved = true;
        }
        require(assignmentMoved, "non-identity permutation");

        uint256 previousTraits = collection.tokenTraits(151);
        uint16 previousBackground = collection.traitIdAt(previousTraits, 0);
        uint16 changedBackgroundId = previousBackground == 101 ? 102 : 101;
        uint256 changedBackground =
            (previousTraits & ~uint256(0xffff)) | uint256(changedBackgroundId);
        vm.expectRevert(HoodYOOR.LockedLayerChange.selector);
        controller.applyTraits(151, changedBackground);

        uint256 clothesMask = uint256(0xffff) << 48;
        uint256 noClothes = previousTraits & ~clothesMask;
        controller.applyTraits(151, noClothes);
        _assertEq(collection.tokenTraits(151), noClothes, "mutable layer reroll");
    }

    function testOwnerCanPermanentlyUnlockSecondaryTradingEarly() public {
        _loadAndFreezeAllAssignments();
        collection.setGTDMerkleRoot(collection.gtdLeaf(ALICE, 1));
        collection.setSaleState(true, false);
        vm.deal(ALICE, 1 ether);
        vm.startPrank(ALICE);
        collection.mintGTD{ value: 0.0025 ether }(1, 1, new bytes32[](0));
        vm.expectRevert(HoodYOOR.SecondaryTradingLocked.selector);
        collection.approve(BOB, 151);
        vm.expectRevert(HoodYOOR.SecondaryTradingLocked.selector);
        collection.setApprovalForAll(BOB, true);
        vm.expectRevert(HoodYOOR.SecondaryTradingLocked.selector);
        collection.transferFrom(ALICE, BOB, 151);
        vm.stopPrank();

        collection.unlockSecondaryTrading();
        require(collection.secondaryTradingEnabled(), "manual secondary unlock");
        vm.expectRevert(HoodYOOR.SecondaryTradingAlreadyUnlocked.selector);
        collection.unlockSecondaryTrading();

        vm.startPrank(ALICE);
        collection.approve(BOB, 151);
        collection.transferFrom(ALICE, BOB, 151);
        vm.stopPrank();
        _assertEq(collection.ownerOf(151), BOB, "manual-unlock transfer");
    }

    function testSecondaryTradingAutomaticallyOpensAtHalfMinted() public {
        _loadAndFreezeAllAssignments();
        collection.setGTDMerkleRoot(collection.gtdLeaf(ALICE, 1));
        collection.setSaleState(true, false);
        collection.setSaleState(false, true);
        vm.deal(ALICE, 1 ether);
        vm.startPrank(ALICE);
        collection.mintPublic{ value: 0.0025 ether }(1);
        vm.stopPrank();

        collection.setTotalSupplyForTest(1_666);
        require(!collection.secondaryTradingEnabled(), "below-half secondary lock");
        vm.deal(BOB, 1 ether);
        vm.startPrank(BOB);
        collection.mintPublic{ value: 0.0025 ether }(1);
        vm.stopPrank();
        require(collection.secondaryTradingUnlocked(), "automatic unlock persisted");
        require(collection.secondaryTradingEnabled(), "half-minted secondary unlock");

        vm.startPrank(ALICE);
        collection.transferFrom(ALICE, BOB, 151);
        vm.stopPrank();
        _assertEq(collection.ownerOf(151), BOB, "automatic-unlock transfer");
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
            packedTraits[i] = _prototypeTraits(
                tokenId <= 10
                    ? collection.oneOfOneBackgroundIdAt(uint8(tokenId - 1))
                    : collection.INDAHOOD_BACKGROUND_ID()
            );
        }
        collection.setInitialTraitsBatch(tokenIds, packedTraits);
        collection.freezeInitialTraits(
            keccak256("hoodyoor-prototype-assignments"), _revealCommitment()
        );
        collection.freezeRenderer();
    }

    function _seedPrototypeStore() private {
        string memory backgroundSVG = HoodYOORPrototypeSVG.background();
        for (uint8 index; index < 10; ++index) {
            store.setTrait(0, _oneOfOneBackgroundIdAt(index), "Prototype 1/1", backgroundSVG);
        }
        store.setTrait(0, 122, "INDAHOOD", backgroundSVG);
        store.setTrait(1, 1, "Teal Droid", HoodYOORPrototypeSVG.droid());
        store.setTrait(3, 1, "Robinhood Green Tee", HoodYOORPrototypeSVG.clothes());
        store.setTrait(4, 1, "Gold Grill", HoodYOORPrototypeSVG.mouth());
        store.setTrait(5, 1, "Robinhood Green Shades", HoodYOORPrototypeSVG.eyes());
        store.setTrait(6, 1, "Robinhood Feather Cap", HoodYOORPrototypeSVG.hat());
    }

    function _prototypeTraits(uint16 backgroundId) private pure returns (uint256 packed) {
        packed |= uint256(backgroundId);
        packed |= uint256(1) << 16; // Droid
        packed |= uint256(1) << 48; // Clothes
        packed |= uint256(1) << 64; // Mouth
        packed |= uint256(1) << 80; // Eyes
        packed |= uint256(1) << 96; // Hat
    }

    function _revealCommitment() private pure returns (bytes32) {
        return keccak256(abi.encodePacked(REVEAL_SECRET));
    }

    function _oneOfOneBackgroundIdAt(uint8 index) private pure returns (uint16) {
        if (index == 0) return 101;
        if (index == 1) return 102;
        if (index == 2) return 103;
        if (index == 3) return 105;
        if (index == 4) return 112;
        if (index == 5) return 115;
        if (index == 6) return 116;
        if (index == 7) return 117;
        if (index == 8) return 119;
        return 120;
    }

    function _assertEq(uint256 actual, uint256 expected, string memory reason) private pure {
        require(actual == expected, reason);
    }

    function _assertEq(address actual, address expected, string memory reason) private pure {
        require(actual == expected, reason);
    }

    function _assertStartsWith(string memory value, string memory prefix, string memory reason)
        private
        pure
    {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        require(valueBytes.length >= prefixBytes.length, reason);
        for (uint256 i; i < prefixBytes.length; ++i) {
            require(valueBytes[i] == prefixBytes[i], reason);
        }
    }

    function _assertContains(string memory value, string memory needle, string memory reason)
        private
        pure
    {
        bytes memory haystack = bytes(value);
        bytes memory sought = bytes(needle);
        require(sought.length != 0 && haystack.length >= sought.length, reason);

        for (uint256 i; i <= haystack.length - sought.length; ++i) {
            bool matchFound = true;
            for (uint256 j; j < sought.length; ++j) {
                if (haystack[i + j] != sought[j]) {
                    matchFound = false;
                    break;
                }
            }
            if (matchFound) return;
        }
        revert(reason);
    }
}
