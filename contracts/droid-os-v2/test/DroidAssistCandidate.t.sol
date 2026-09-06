// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidAssistAccountCandidate} from "../src/DroidAssistAccountCandidate.sol";
import {DroidAssistBadge} from "../src/DroidAssistBadge.sol";
import {DroidCustodyCandidate} from "../src/DroidCustodyCandidate.sol";
import {ParentFixture, Vm} from "./DroidCustodyCandidate.t.sol";

contract DroidAssistCandidateTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    bytes32 private constant EVIDENCE = keccak256("TEST_EVIDENCE_NOT_REAL_SIMULATION_PROOF");
    ParentFixture private parent;
    DroidAssistBadge private badge;
    DroidAssistAccountCandidate private account;

    function setUp() public {
        vm.chainId(143);
        parent = new ParentFixture(); parent.setOwner(11, A);
        badge = new DroidAssistBadge();
        account = new DroidAssistAccountCandidate(143, address(parent), 11, badge);
        vm.deal(address(account), 1 ether);
    }

    function _mint(address caller, uint256 nonce) private returns (uint256) {
        vm.prank(caller);
        return account.mintCanary(nonce, uint64(block.timestamp + 120), EVIDENCE);
    }

    function testOwnerMintIntoDroidWithNoNativeSpendOrApprovals() public {
        uint256 id = _mint(A, 0);
        require(badge.ownerOf(id) == address(account));
        require(badge.balanceOf(address(account)) == 1 && address(account).balance == 1 ether);
        require(account.actionNonce() == 1 && badge.getApproved(id) == address(0));
        require(!badge.isApprovedForAll(address(account), A));
    }

    function testOwnerCanWithdrawBadge() public {
        uint256 id = _mint(A, 0);
        vm.prank(A); account.withdrawERC721(address(badge), A, id);
        require(badge.ownerOf(id) == A && account.actionNonce() == 2);
    }

    function testNonOwnerCannotMint() public {
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector); _mint(B, 0);
    }

    function testReplayDenied() public {
        _mint(A, 0);
        vm.expectRevert(DroidAssistAccountCandidate.InvalidPreparation.selector); _mint(A, 0);
    }

    function testOneBadgePerAccountEvenAfterWithdrawal() public {
        uint256 id = _mint(A, 0);
        vm.prank(A); account.withdrawERC721(address(badge), A, id);
        vm.expectRevert(DroidAssistBadge.AlreadyMinted.selector); _mint(A, 2);
        require(account.actionNonce() == 2);
    }

    function testWithdrawalInvalidatesPreparedNonce() public {
        vm.prank(A); account.withdrawNative(payable(A), 1);
        vm.expectRevert(DroidAssistAccountCandidate.InvalidPreparation.selector); _mint(A, 0);
    }

    function testDeadlineAndMissingEvidenceRejected() public {
        vm.prank(A); vm.expectRevert(DroidAssistAccountCandidate.InvalidPreparation.selector);
        account.mintCanary(0, uint64(block.timestamp), EVIDENCE);
        vm.prank(A); vm.expectRevert(DroidAssistAccountCandidate.InvalidPreparation.selector);
        account.mintCanary(0, uint64(block.timestamp + 301), EVIDENCE);
        vm.prank(A); vm.expectRevert(DroidAssistAccountCandidate.InvalidPreparation.selector);
        account.mintCanary(0, uint64(block.timestamp + 120), bytes32(0));
    }

    function testTransferBetweenPreparationAndExecutionRejectsOldOwner() public {
        parent.setOwner(11, B);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector); _mint(A, 0);
        require(badge.ownerOf(_mint(B, 0)) == address(account));
    }

    function testTransferKeepsBadgeAndChangesWithdrawalAuthority() public {
        uint256 id = _mint(A, 0);
        parent.setOwner(11, B);
        vm.prank(A); vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.withdrawERC721(address(badge), A, id);
        vm.prank(B); account.withdrawERC721(address(badge), B, id);
        require(badge.ownerOf(id) == B);
    }

    function testUnknownOrChangedMintContractRejected() public {
        vm.expectRevert(DroidAssistAccountCandidate.InvalidCanary.selector);
        new DroidAssistAccountCandidate(143, address(parent), 11, DroidAssistBadge(address(parent)));
        vm.etch(address(badge), hex"60006000fd");
        vm.expectRevert(DroidAssistAccountCandidate.InvalidCanary.selector); _mint(A, 0);
    }

    function testMintRejectsAttachedMonAndUnknownCalldata() public {
        vm.deal(A, 1);
        vm.prank(A);
        (bool paid,) = address(account).call{value: 1}(
            abi.encodeCall(account.mintCanary, (0, uint64(block.timestamp + 120), EVIDENCE))
        );
        vm.prank(A);
        (bool arbitrary,) = address(account).call(abi.encodeWithSignature("execute(address,bytes)", B, hex""));
        require(!paid && !arbitrary && account.actionNonce() == 0);
    }

    function testWrongChainAndUnknownOwnerDenyMint() public {
        vm.chainId(1);
        vm.expectRevert(DroidCustodyCandidate.InvalidIdentity.selector); _mint(A, 0);
        vm.chainId(143); parent.setOwner(11, address(0));
        vm.expectRevert(); _mint(A, 0);
    }

    function testFuzzMintPreservesNativeReserve(uint96 reserve) public {
        vm.deal(address(account), reserve);
        _mint(A, 0);
        require(address(account).balance == reserve);
    }
}
