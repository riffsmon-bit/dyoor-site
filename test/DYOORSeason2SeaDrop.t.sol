// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Test } from "forge-std/Test.sol";
import { DYOORSeason2SeaDrop } from "../contracts/DYOORSeason2SeaDrop.sol";
import {
    ISeaDropTokenContractMetadata
} from "seadrop/src/interfaces/ISeaDropTokenContractMetadata.sol";

contract DYOORSeason2SeaDropTest is Test {
    DYOORSeason2SeaDrop internal token;

    address internal owner = address(this);
    address internal seaDrop = address(0x5EA0);
    address internal oldSeaDrop = address(0x05EA);
    address internal user = address(0xA11CE);
    address internal otherUser = address(0xB0B);
    address internal metadataManager = address(0xBEEF);
    address internal treasury = address(0x7E45);
    address internal royaltyReceiver = address(0xA77);

    event AirdropBatchExecuted(
        bytes32 indexed batchId,
        uint256 indexed batchIndex,
        uint256 recipientCount,
        uint256 quantityMinted,
        uint256 firstTokenId,
        uint256 lastTokenId
    );
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event MetadataManagerUpdated(address indexed previousManager, address indexed newManager);

    function setUp() public {
        address[] memory seaDrops = new address[](1);
        seaDrops[0] = seaDrop;

        token = new DYOORSeason2SeaDrop("D.Y.O.O.R", "DYOOR", seaDrops);
        vm.deal(address(token), 3 ether);
        vm.deal(user, 1_000_000 ether);
        vm.deal(otherUser, 1_000_000 ether);
    }

    function testConstructorValues() public view {
        assertEq(token.name(), "D.Y.O.O.R");
        assertEq(token.symbol(), "DYOOR");
        assertEq(token.MAX_SUPPLY(), 3_333);
        assertEq(token.AIRDROP_RESERVE(), 610);
        assertEq(token.SEADROP_MAX_SUPPLY(), 2_723);
        assertEq(token.maxSupply(), 3_333);
        assertEq(token.totalMinted(), 0);
        assertEq(token.totalSupply(), 0);
        assertEq(token.totalSeaDropMinted(), 0);
        assertEq(token.totalAirdropped(), 0);
        assertEq(token.treasury(), owner);
        assertEq(token.royaltyAddress(), owner);
        assertEq(token.royaltyBasisPoints(), 500);
        assertEq(token.pendingOwner(), address(0));
        assertFalse(token.paused());
        assertFalse(token.airdropPaused());
        assertTrue(token.allowedSeaDrop(seaDrop));
        assertEq(token.allowedSeaDrops().length, 1);
    }

    function testAuthorizedSeaDropCanMint() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 2);

        assertEq(token.balanceOf(user), 2);
        assertEq(token.ownerOf(1), user);
        assertEq(token.ownerOf(2), user);
        assertEq(token.totalSupply(), 2);
        assertEq(token.totalMinted(), 2);
        assertEq(token.totalSeaDropMinted(), 2);
        assertEq(token.remainingSeaDropSupply(), token.SEADROP_MAX_SUPPLY() - 2);
    }

    function testUnauthorizedSeaDropCannotMint() public {
        vm.expectRevert(DYOORSeason2SeaDrop.UnauthorizedSeaDrop.selector);
        token.mintSeaDrop(user, 1);
    }

    function testSeaDropRejectsInvalidMintInputs() public {
        vm.prank(seaDrop);
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidRecipient.selector);
        token.mintSeaDrop(address(0), 1);

        vm.prank(seaDrop);
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidQuantity.selector);
        token.mintSeaDrop(user, 0);
    }

    function testSeaDropCannotExceedPaidMintAllocation() public {
        uint256 seaDropMaxSupply = token.SEADROP_MAX_SUPPLY();

        vm.prank(seaDrop);
        token.mintSeaDrop(user, seaDropMaxSupply);

        vm.prank(seaDrop);
        vm.expectRevert(
            abi.encodeWithSelector(
                DYOORSeason2SeaDrop.SeaDropMintCapExceeded.selector,
                seaDropMaxSupply + 1,
                seaDropMaxSupply
            )
        );
        token.mintSeaDrop(otherUser, 1);
    }

    function testSeaDropCannotConsumeReservedSupply() public {
        uint256 seaDropMaxSupply = token.SEADROP_MAX_SUPPLY();
        uint256 airdropReserve = token.AIRDROP_RESERVE();

        vm.prank(seaDrop);
        token.mintSeaDrop(user, seaDropMaxSupply);

        assertEq(token.totalSupply(), seaDropMaxSupply);
        assertEq(token.maxSupply() - token.totalSupply(), airdropReserve);
    }

    function testAirdropCanMintReservedAllocation() public {
        address[] memory recipients = new address[](2);
        recipients[0] = user;
        recipients[1] = otherUser;
        uint256[] memory quantities = new uint256[](2);
        quantities[0] = 300;
        quantities[1] = 310;
        bytes32 batchId = keccak256("reserved-airdrop");

        vm.expectEmit(true, true, false, true);
        emit AirdropBatchExecuted(batchId, 7, 2, 610, 1, 610);
        token.airdropBatch(batchId, 7, recipients, quantities);

        assertEq(token.balanceOf(user), 300);
        assertEq(token.balanceOf(otherUser), 310);
        assertEq(token.totalAirdropped(), 610);
        assertEq(token.remainingAirdropReserve(), 0);
        assertTrue(token.airdropBatchExecuted(batchId));
    }

    function testAirdropCannotExceedReservedAllocation() public {
        address[] memory recipients = new address[](1);
        recipients[0] = user;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = 611;

        vm.expectRevert(
            abi.encodeWithSelector(DYOORSeason2SeaDrop.AirdropReserveExceeded.selector, 611, 610)
        );
        token.airdrop(recipients, quantities, keccak256("too-many"));
    }

    function testCombinedRoutesCannotExceedMaxSupply() public {
        uint256 seaDropMaxSupply = token.SEADROP_MAX_SUPPLY();
        uint256 airdropReserve = token.AIRDROP_RESERVE();

        vm.prank(seaDrop);
        token.mintSeaDrop(user, seaDropMaxSupply);

        address[] memory recipients = new address[](1);
        recipients[0] = otherUser;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = airdropReserve;
        token.airdrop(recipients, quantities, keccak256("reserve"));

        assertEq(token.totalSupply(), token.MAX_SUPPLY());

        address[] memory moreRecipients = new address[](1);
        moreRecipients[0] = address(0xCAFE);
        uint256[] memory moreQuantities = new uint256[](1);
        moreQuantities[0] = 1;

        vm.expectRevert(
            abi.encodeWithSelector(
                DYOORSeason2SeaDrop.AirdropReserveExceeded.selector,
                airdropReserve + 1,
                airdropReserve
            )
        );
        token.airdrop(moreRecipients, moreQuantities, keccak256("overflow"));
    }

    function testTokenIdsRemainSequentialAcrossRoutes() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 2);

        address[] memory recipients = new address[](2);
        recipients[0] = user;
        recipients[1] = otherUser;
        uint256[] memory quantities = new uint256[](2);
        quantities[0] = 1;
        quantities[1] = 2;
        token.airdrop(recipients, quantities, keccak256("batch"));

        assertEq(token.ownerOf(1), user);
        assertEq(token.ownerOf(2), user);
        assertEq(token.ownerOf(3), user);
        assertEq(token.ownerOf(4), otherUser);
        assertEq(token.ownerOf(5), otherUser);
    }

    function testDuplicateBatchIdFails() public {
        address[] memory recipients = new address[](1);
        recipients[0] = user;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = 1;
        bytes32 batchId = keccak256("same-batch");

        token.airdrop(recipients, quantities, batchId);

        vm.expectRevert(
            abi.encodeWithSelector(
                DYOORSeason2SeaDrop.AirdropBatchAlreadyExecuted.selector, batchId
            )
        );
        token.airdrop(recipients, quantities, batchId);
    }

    function testSameRecipientCanReceiveDifferentBatches() public {
        address[] memory recipients = new address[](1);
        recipients[0] = user;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = 2;

        token.airdrop(recipients, quantities, keccak256("batch-a"));
        token.airdrop(recipients, quantities, keccak256("batch-b"));

        assertEq(token.balanceOf(user), 4);
        assertEq(token.totalAirdropped(), 4);
    }

    function testNonOwnerAirdropFails() public {
        address[] memory recipients = new address[](1);
        recipients[0] = user;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = 1;

        vm.prank(user);
        vm.expectRevert();
        token.airdrop(recipients, quantities, keccak256("not-owner"));
    }

    function testAirdropValidation() public {
        address[] memory recipients = new address[](0);
        uint256[] memory quantities = new uint256[](0);
        vm.expectRevert(DYOORSeason2SeaDrop.EmptyAirdropBatch.selector);
        token.airdrop(recipients, quantities, keccak256("empty"));

        recipients = new address[](1);
        recipients[0] = user;
        quantities = new uint256[](2);
        quantities[0] = 1;
        quantities[1] = 1;
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidArrayLength.selector);
        token.airdrop(recipients, quantities, keccak256("mismatch"));

        recipients = new address[](1);
        recipients[0] = address(0);
        quantities = new uint256[](1);
        quantities[0] = 1;
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidRecipient.selector);
        token.airdrop(recipients, quantities, keccak256("zero-recipient"));

        recipients[0] = user;
        quantities[0] = 0;
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidQuantity.selector);
        token.airdrop(recipients, quantities, keccak256("zero-quantity"));

        quantities[0] = 1;
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidBatchId.selector);
        token.airdrop(recipients, quantities, bytes32(0));
    }

    function testPauseBlocksMintCreationButNotTransfers() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);

        token.pause();

        vm.prank(seaDrop);
        vm.expectRevert(DYOORSeason2SeaDrop.MintPaused.selector);
        token.mintSeaDrop(user, 1);

        address[] memory recipients = new address[](1);
        recipients[0] = user;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = 1;
        vm.expectRevert(DYOORSeason2SeaDrop.AirdropPaused.selector);
        token.airdrop(recipients, quantities, keccak256("paused-airdrop"));

        vm.prank(user);
        token.transferFrom(user, otherUser, 1);

        assertEq(token.ownerOf(1), otherUser);
    }

    function testAirdropPauseBlocksOnlyAirdrop() public {
        token.setAirdropPaused(true);

        address[] memory recipients = new address[](1);
        recipients[0] = user;
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = 1;
        vm.expectRevert(DYOORSeason2SeaDrop.AirdropPaused.selector);
        token.airdrop(recipients, quantities, keccak256("airdrop-paused"));

        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);
        assertEq(token.ownerOf(1), user);
    }

    function testMetadataManagerPermissions() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);

        vm.expectEmit(true, true, false, true);
        emit MetadataManagerUpdated(address(0), metadataManager);
        token.setMetadataManager(metadataManager);

        vm.prank(metadataManager);
        vm.expectEmit(false, false, false, true);
        emit MetadataUpdate(1);
        token.emitMetadataUpdate(1);

        vm.prank(metadataManager);
        vm.expectEmit(false, false, false, true);
        emit BatchMetadataUpdate(1, 1);
        token.emitBatchMetadataUpdate(1, 1);

        vm.prank(metadataManager);
        vm.expectRevert();
        token.setTreasury(metadataManager);

        vm.prank(metadataManager);
        vm.expectRevert();
        token.airdrop(_singleRecipient(user), _singleQuantity(1), keccak256("manager-airdrop"));
    }

    function testMetadataRangeValidation() public {
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidMetadataRange.selector);
        token.emitMetadataUpdate(1);

        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);

        vm.expectRevert(DYOORSeason2SeaDrop.InvalidMetadataRange.selector);
        token.emitBatchMetadataUpdate(2, 1);
    }

    function testBaseUriTokenUriAndContractUri() public {
        token.setBaseURI("https://dyoor.xyz/api/metadata/");
        token.setContractURI("https://dyoor.xyz/api/collection/dyoor-s2.json");

        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);

        assertEq(token.tokenURI(1), "https://dyoor.xyz/api/metadata/1");
        assertEq(token.contractURI(), "https://dyoor.xyz/api/collection/dyoor-s2.json");
    }

    function testSetBaseUriEmitsBatchMetadataUpdateAfterMint() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 2);

        vm.expectEmit(false, false, false, true);
        emit BatchMetadataUpdate(1, 2);
        token.setBaseURI("https://dyoor.xyz/api/metadata/");
    }

    function testRoyaltyAndTreasuryControls() public {
        token.setTreasury(treasury);
        token.setRoyaltyInfo(
            ISeaDropTokenContractMetadata.RoyaltyInfo({
                royaltyAddress: royaltyReceiver, royaltyBps: 750
            })
        );

        (address receiver, uint256 amount) = token.royaltyInfo(1, 10 ether);
        assertEq(receiver, royaltyReceiver);
        assertEq(amount, 0.75 ether);

        uint256 beforeBalance = treasury.balance;
        uint256 withdrawn = token.withdrawTreasury();
        assertEq(withdrawn, 3 ether);
        assertEq(treasury.balance, beforeBalance + 3 ether);
    }

    function testUnauthorizedRoyaltyAndTreasuryUpdatesFail() public {
        vm.prank(user);
        vm.expectRevert();
        token.updateRoyaltyReceiver(user);

        vm.prank(user);
        vm.expectRevert();
        token.setTreasury(user);

        vm.expectRevert();
        token.setTreasury(address(0));

        vm.expectRevert();
        token.updateRoyaltyReceiver(address(0));

        vm.expectRevert();
        token.updateRoyaltyPercentage(10_001);
    }

    function testAllowedSeaDropCanBeUpdated() public {
        address[] memory seaDrops = new address[](2);
        seaDrops[0] = seaDrop;
        seaDrops[1] = oldSeaDrop;
        token.updateAllowedSeaDrop(seaDrops);

        vm.prank(oldSeaDrop);
        token.mintSeaDrop(user, 1);

        address[] memory nextSeaDrops = new address[](1);
        nextSeaDrops[0] = seaDrop;
        token.updateAllowedSeaDrop(nextSeaDrops);

        vm.prank(oldSeaDrop);
        vm.expectRevert(DYOORSeason2SeaDrop.UnauthorizedSeaDrop.selector);
        token.mintSeaDrop(user, 1);
    }

    function testInvalidSeaDropConfigurationFails() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidSeaDropAddress.selector);
        new DYOORSeason2SeaDrop("D.Y.O.O.R", "DYOOR", empty);

        address[] memory invalid = new address[](1);
        invalid[0] = address(0);
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidSeaDropAddress.selector);
        token.updateAllowedSeaDrop(invalid);
    }

    function testOwnershipTransferAndRenounceBlocked() public {
        token.transferOwnership(user);
        assertEq(token.pendingOwner(), user);

        vm.prank(user);
        token.acceptOwnership();
        assertEq(token.owner(), user);

        vm.prank(user);
        token.transferOwnership(otherUser);
        assertEq(token.pendingOwner(), otherUser);

        vm.prank(user);
        token.cancelOwnershipTransfer();
        assertEq(token.pendingOwner(), address(0));

        vm.prank(user);
        vm.expectRevert(DYOORSeason2SeaDrop.RenounceOwnershipDisabled.selector);
        token.renounceOwnership();
    }

    function testMaxSupplyIsLocked() public {
        uint256 maxSupply = token.MAX_SUPPLY();
        token.setMaxSupply(maxSupply);

        vm.expectRevert(
            abi.encodeWithSelector(
                DYOORSeason2SeaDrop.MaxSupplyLocked.selector, maxSupply + 1, maxSupply
            )
        );
        token.setMaxSupply(maxSupply + 1);
    }

    function testFreezeMetadataRequiresExplicitConfirmation() public {
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidMetadataFreezeConfirmation.selector);
        token.freezeMetadata();

        vm.expectRevert(DYOORSeason2SeaDrop.InvalidMetadataFreezeConfirmation.selector);
        token.freezeMetadata("wrong");
    }

    function testSupportsInterfaces() public view {
        assertTrue(token.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(token.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertTrue(token.supportsInterface(0x2a55205a)); // ERC2981
        assertTrue(token.supportsInterface(0x49064906)); // ERC4906
    }

    function testBurnDoesNotReopenSupply() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);

        vm.prank(user);
        token.burn(1);

        assertEq(token.totalSupply(), 0);
        assertEq(token.totalMinted(), 1);
        assertEq(token.totalSeaDropMinted(), 1);
    }

    function testRemovedDirectMintRoutesAreAbsent() public {
        _assertFunctionMissing(
            "mintDirect(uint256,bytes32[])", abi.encode(uint256(1), new bytes32[](0))
        );
        _assertFunctionMissing(
            "teamMint(uint256,bytes32[])", abi.encode(uint256(1), new bytes32[](0))
        );
        _assertFunctionMissing(
            "ascensionMint(uint256,bytes32[])", abi.encode(uint256(1), new bytes32[](0))
        );
        _assertFunctionMissing(
            "gtdMint(uint256,bytes32[])", abi.encode(uint256(1), new bytes32[](0))
        );
        _assertFunctionMissing("publicMint(uint256)", abi.encode(uint256(1)));
        _assertFunctionMissing(
            "setPhaseStartTimes(uint64,uint64,uint64,uint64,uint64)",
            abi.encode(uint64(1), uint64(2), uint64(3), uint64(4), uint64(5))
        );
        _assertFunctionMissing(
            "updateMerkleRoots(bytes32,bytes32,bytes32,bytes32)",
            abi.encode(bytes32(0), bytes32(0), bytes32(0), bytes32(0))
        );
    }

    function testFuzzSeaDropQuantity(uint16 quantity) public {
        quantity = uint16(bound(quantity, 1, token.SEADROP_MAX_SUPPLY()));

        vm.prank(seaDrop);
        token.mintSeaDrop(user, quantity);

        assertEq(token.totalSeaDropMinted(), quantity);
        assertEq(token.totalSupply(), quantity);
    }

    function testFuzzAirdropQuantity(uint16 quantity) public {
        quantity = uint16(bound(quantity, 1, token.AIRDROP_RESERVE()));

        token.airdrop(_singleRecipient(user), _singleQuantity(quantity), keccak256("fuzz-airdrop"));

        assertEq(token.totalAirdropped(), quantity);
        assertEq(token.totalSupply(), quantity);
    }

    function _singleRecipient(address recipient)
        internal
        pure
        returns (address[] memory recipients)
    {
        recipients = new address[](1);
        recipients[0] = recipient;
    }

    function _singleQuantity(uint256 quantity) internal pure returns (uint256[] memory quantities) {
        quantities = new uint256[](1);
        quantities[0] = quantity;
    }

    function _assertFunctionMissing(string memory signature, bytes memory args) internal {
        (bool ok,) =
            address(token).call(abi.encodePacked(bytes4(keccak256(bytes(signature))), args));
        assertFalse(ok);
    }
}
