// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Test } from "forge-std/Test.sol";
import { DYOORSeason2SeaDrop } from "../contracts/DYOORSeason2SeaDrop.sol";
import { IERC721Receiver } from "openzeppelin-contracts/token/ERC721/IERC721Receiver.sol";

contract DYOORSeason2SeaDropTest is Test {
    DYOORSeason2SeaDrop internal token;

    address internal owner = address(this);
    address internal seaDrop = address(0x5EA0);
    address internal user = address(0xA11CE);
    address internal otherUser = address(0xB0B);
    address internal treasury = address(0x7E45);
    address internal royaltyReceiver = address(0xA77);

    uint64 internal constant TEAM_START = 100;
    uint64 internal constant WL_START = 200;
    uint64 internal constant GTD_START = 300;
    uint64 internal constant PUBLIC_START = 400;

    function setUp() public {
        address[] memory seaDrops = new address[](1);
        seaDrops[0] = seaDrop;

        token = new DYOORSeason2SeaDrop("D.Y.O.O.R", "DYOOR2", seaDrops);
        token.setPhaseStartTimes(TEAM_START, WL_START, GTD_START, PUBLIC_START);
        token.updateMerkleRoots(
            token.allowlistLeaf(user), token.allowlistLeaf(user), token.allowlistLeaf(user)
        );

        vm.deal(user, 10_000 ether);
        vm.deal(otherUser, 10_000 ether);
    }

    function testDeploymentDefaults() public view {
        assertEq(token.name(), "D.Y.O.O.R");
        assertEq(token.symbol(), "DYOOR2");
        assertEq(token.maxSupply(), 5_555);
        assertEq(token.treasury(), owner);
        assertEq(token.royaltyAddress(), owner);
        assertEq(token.royaltyBasisPoints(), 500);
        assertEq(token.DOCUMENTED_SEADROP_1_0(), 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5);
    }

    function testTimestampProgression() public {
        vm.warp(TEAM_START - 1);
        assertEq(uint256(token.activePhase()), uint256(DYOORSeason2SeaDrop.MintPhase.None));

        vm.warp(TEAM_START);
        assertEq(uint256(token.activePhase()), uint256(DYOORSeason2SeaDrop.MintPhase.Team));

        vm.warp(WL_START);
        assertEq(uint256(token.activePhase()), uint256(DYOORSeason2SeaDrop.MintPhase.Whitelist));

        vm.warp(GTD_START);
        assertEq(uint256(token.activePhase()), uint256(DYOORSeason2SeaDrop.MintPhase.GTD));

        vm.warp(PUBLIC_START);
        assertEq(uint256(token.activePhase()), uint256(DYOORSeason2SeaDrop.MintPhase.Public));
    }

    function testTeamMintIsFreeAndAllowlisted() public {
        vm.warp(TEAM_START);

        vm.prank(user);
        token.teamMint(10, _emptyProof());

        assertEq(token.balanceOf(user), 10);
        assertEq(token.totalMinted(), 10);
        assertEq(token.directMintedByPhase(DYOORSeason2SeaDrop.MintPhase.Team, user), 10);
    }

    function testTeamMintRejectsNonAllowlistedWallet() public {
        vm.warp(TEAM_START);

        vm.prank(otherUser);
        vm.expectRevert(DYOORSeason2SeaDrop.AllowlistProofInvalid.selector);
        token.teamMint(1, _emptyProof());
    }

    function testWhitelistMintRequiresExactPaymentAndLimit() public {
        vm.warp(WL_START);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                DYOORSeason2SeaDrop.IncorrectPayment.selector, 333 ether, 332 ether
            )
        );
        token.whitelistMint{ value: 332 ether }(1, _emptyProof());

        vm.prank(user);
        token.whitelistMint{ value: 999 ether }(3, _emptyProof());

        assertEq(token.balanceOf(user), 3);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(DYOORSeason2SeaDrop.WalletLimitExceeded.selector, 4, 3)
        );
        token.whitelistMint{ value: 333 ether }(1, _emptyProof());
    }

    function testGTDMintLimitIsTwo() public {
        vm.warp(GTD_START);

        vm.prank(user);
        token.gtdMint{ value: 666 ether }(2, _emptyProof());

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(DYOORSeason2SeaDrop.WalletLimitExceeded.selector, 3, 2)
        );
        token.gtdMint{ value: 333 ether }(1, _emptyProof());
    }

    function testPublicMintUsesRemainingSupplyWithoutAllowlist() public {
        vm.warp(PUBLIC_START);

        vm.prank(otherUser);
        token.publicMint{ value: 1_665 ether }(5);

        assertEq(token.balanceOf(otherUser), 5);
        assertEq(token.totalMinted(), 5);
    }

    function testMintDirectUsesActivePhase() public {
        vm.warp(WL_START);

        vm.prank(user);
        token.mintDirect{ value: 333 ether }(1, _emptyProof());

        assertEq(token.ownerOf(1), user);
        assertEq(token.directMintedByPhase(DYOORSeason2SeaDrop.MintPhase.Whitelist, user), 1);
    }

    function testPhaseSpecificMintRevertsOutsideItsWindow() public {
        vm.warp(WL_START);

        vm.prank(user);
        vm.expectRevert(DYOORSeason2SeaDrop.MintInactive.selector);
        token.teamMint(1, _emptyProof());
    }

    function testSeaDropMintOnlyAllowedAddress() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 2);

        assertEq(token.balanceOf(user), 2);
        assertEq(token.totalMinted(), 2);

        vm.expectRevert();
        token.mintSeaDrop(user, 1);
    }

    function testDirectAndSeaDropShareSupplyAndMintStats() public {
        vm.warp(WL_START);

        vm.prank(user);
        token.whitelistMint{ value: 333 ether }(1, _emptyProof());

        vm.prank(seaDrop);
        token.mintSeaDrop(user, 2);

        (uint256 minterMinted, uint256 totalSupply, uint256 maxSupply) = token.getMintStats(user);

        assertEq(minterMinted, 3);
        assertEq(totalSupply, 3);
        assertEq(maxSupply, 5_555);
    }

    function testDirectMintLimitIncludesSeaDropMints() public {
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 9);

        vm.warp(TEAM_START);
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(DYOORSeason2SeaDrop.WalletLimitExceeded.selector, 11, 10)
        );
        token.teamMint(2, _emptyProof());
    }

    function testPauseBlocksDirectAndSeaDropMint() public {
        token.pauseMint();

        vm.warp(PUBLIC_START);
        vm.prank(user);
        vm.expectRevert(DYOORSeason2SeaDrop.MintPaused.selector);
        token.publicMint{ value: 333 ether }(1);

        vm.prank(seaDrop);
        vm.expectRevert(DYOORSeason2SeaDrop.MintPaused.selector);
        token.mintSeaDrop(user, 1);

        token.unpauseMint();
        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);
        assertEq(token.balanceOf(user), 1);
    }

    function testMaxSupplyCannotBeChangedAndCannotBeExceeded() public {
        vm.expectRevert(
            abi.encodeWithSelector(DYOORSeason2SeaDrop.MaxSupplyLocked.selector, 5_556, 5_555)
        );
        token.setMaxSupply(5_556);

        token.setMaxSupply(5_555);

        vm.prank(seaDrop);
        token.mintSeaDrop(user, 5_555);

        vm.prank(seaDrop);
        vm.expectRevert();
        token.mintSeaDrop(user, 1);
    }

    function testMetadataBaseContractURIAndFreeze() public {
        token.setBaseURI("ipfs://base/");
        token.setContractURI("ipfs://contract.json");

        vm.prank(seaDrop);
        token.mintSeaDrop(user, 1);

        assertEq(token.tokenURI(1), "ipfs://base/1");
        assertEq(token.contractURI(), "ipfs://contract.json");

        token.freezeMetadata();

        vm.expectRevert(DYOORSeason2SeaDrop.MetadataIsFrozen.selector);
        token.setBaseURI("ipfs://new/");

        vm.expectRevert(DYOORSeason2SeaDrop.MetadataIsFrozen.selector);
        token.setContractURI("ipfs://new-contract.json");
    }

    function testRoyaltyUpdates() public {
        token.updateRoyaltyReceiver(royaltyReceiver);
        token.updateRoyaltyPercentage(750);

        (address receiver, uint256 amount) = token.royaltyInfo(1, 10 ether);
        assertEq(receiver, royaltyReceiver);
        assertEq(amount, 0.75 ether);

        vm.expectRevert();
        token.updateRoyaltyPercentage(10_001);
    }

    function testWithdrawTreasury() public {
        token.setTreasury(treasury);

        vm.warp(PUBLIC_START);
        vm.prank(user);
        token.publicMint{ value: 666 ether }(2);

        uint256 beforeBalance = treasury.balance;
        uint256 withdrawn = token.withdrawTreasury();

        assertEq(withdrawn, 666 ether);
        assertEq(treasury.balance - beforeBalance, 666 ether);
        assertEq(address(token).balance, 0);
    }

    function testInvalidScheduleReverts() public {
        vm.expectRevert(DYOORSeason2SeaDrop.InvalidSchedule.selector);
        token.setPhaseStartTimes(300, 200, 400, 500);
    }

    function testReentrantReceiverCannotMintAgainInCallback() public {
        ReentrantPublicMinter attacker = new ReentrantPublicMinter(token);
        vm.deal(address(attacker), 1_000 ether);

        vm.warp(PUBLIC_START);
        vm.expectRevert();
        attacker.attack{ value: 666 ether }();
    }

    function testFutureSystemHookCanBeRegistered() public {
        bytes32 systemId = keccak256("DYOOR_BLUEPRINT_SYSTEM");
        token.setExternalSystem(systemId, address(0xB10E));

        assertEq(token.externalSystems(systemId), address(0xB10E));
    }

    function _emptyProof() private pure returns (bytes32[] memory proof) {
        proof = new bytes32[](0);
    }
}

contract ReentrantPublicMinter is IERC721Receiver {
    DYOORSeason2SeaDrop internal immutable TOKEN;
    bool internal reentered;

    constructor(DYOORSeason2SeaDrop token_) {
        TOKEN = token_;
    }

    function attack() external payable {
        TOKEN.publicMint{ value: 333 ether }(1);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        override
        returns (bytes4)
    {
        if (!reentered) {
            reentered = true;
            TOKEN.publicMint{ value: 333 ether }(1);
        }

        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable { }
}
