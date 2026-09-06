// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidMintAccountLab} from "../src/DroidMintAccountLab.sol";
import {LabCollection} from "../src/LabCollection.sol";
import {LabMint} from "../src/LabMint.sol";

interface Vm {
    function prank(address) external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function roll(uint256) external;
    function chainId(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function mockCall(address, bytes calldata, bytes calldata) external;
    function etch(address, bytes calldata) external;
}

contract DroidMintAccountLabTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    address private constant EXECUTOR = address(0xE1);
    address private constant REVIEWER = address(0xF1);
    LabCollection private parent;
    LabMint private mint;
    DroidMintAccountLab private account;
    uint256 private nextNonce;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        parent = new LabCollection(A);
        mint = new LabMint(0.01 ether);
        account = new DroidMintAccountLab(parent, 11, mint, EXECUTOR, REVIEWER);
        vm.deal(address(account), 1 ether);
    }

    function grant(address owner, uint256 reserve, uint256 perAction, uint256 daily, uint256 actions) private {
        vm.prank(owner);
        account.setMintGrant(reserve, perAction, daily, actions, uint64(block.timestamp), uint64(block.timestamp + 1 days));
    }

    function approveReview() private {
        nextNonce = account.actionNonce();
        bytes32 hash = account.nextActionHash();
        vm.prank(REVIEWER);
        account.attestSimulation(hash, uint64(block.timestamp + 60));
    }

    function execute() private {
        vm.prank(EXECUTOR);
        account.executeMint(nextNonce);
    }

    function testDefaultHasNoAuthority() public {
        vm.expectRevert(DroidMintAccountLab.StaleAuthority.selector);
        account.nextActionHash();
    }

    function testOwnerGrantAndReviewedMint() public {
        grant(A, 0.9 ether, 0.01 ether, 0.02 ether, 2);
        approveReview(); execute();
        require(mint.ownerOf(1) == address(account), "WRONG_RECIPIENT");
        require(address(account).balance == 0.99 ether, "WRONG_SPEND");
        require(account.actionNonce() == 1, "NO_NONCE");
        require(account.spentPerDay(block.timestamp / 1 days) == 0.01 ether, "NO_ACCOUNTING");
    }

    function testExecutorCannotCreateGrant() public {
        vm.expectRevert(DroidMintAccountLab.Denied.selector);
        grant(EXECUTOR, 0, 1 ether, 1 ether, 2);
    }

    function testMissingSimulationDenied() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector);
        execute();
    }

    function testExecutorCannotAttest() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        bytes32 hash = account.nextActionHash();
        vm.prank(EXECUTOR);
        vm.expectRevert(DroidMintAccountLab.Denied.selector);
        account.attestSimulation(hash, uint64(block.timestamp + 60));
    }

    function testUnknownActionHashDenied() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        vm.prank(REVIEWER);
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector);
        account.attestSimulation(bytes32(uint256(123)), uint64(block.timestamp + 60));
    }

    function testExpiredSimulationDenied() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        approveReview(); vm.warp(block.timestamp + 60);
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector);
        execute();
    }

    function testOldSimulationBlockDenied() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        approveReview(); vm.roll(block.number + 21);
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector);
        execute();
    }

    function testReserveProtected() public {
        grant(A, 1 ether, 0.01 ether, 0.02 ether, 2);
        vm.expectRevert(DroidMintAccountLab.LimitExceeded.selector);
        account.nextActionHash();
    }

    function testPerActionCap() public {
        grant(A, 0, 0.001 ether, 0.02 ether, 2);
        vm.expectRevert(DroidMintAccountLab.LimitExceeded.selector);
        account.nextActionHash();
    }

    function testDailyValueCap() public {
        grant(A, 0, 0.01 ether, 0.01 ether, 10);
        approveReview(); execute();
        vm.expectRevert(DroidMintAccountLab.LimitExceeded.selector);
        account.nextActionHash();
    }

    function testDailyActionCapAndOwnerRenewalDoesNotEraseSpend() public {
        grant(A, 0, 0.01 ether, 0.1 ether, 1);
        approveReview(); execute();
        grant(A, 0, 0.01 ether, 0.1 ether, 1);
        vm.expectRevert(DroidMintAccountLab.LimitExceeded.selector);
        account.nextActionHash();
    }

    function testFreeMintStillNeedsActionCap() public {
        LabMint freeMint = new LabMint(0);
        account = new DroidMintAccountLab(parent, 11, freeMint, EXECUTOR, REVIEWER);
        grant(A, 0, 0, 0, 1);
        approveReview(); execute();
        require(freeMint.ownerOf(1) == address(account), "NO_FREE_MINT");
        vm.expectRevert(DroidMintAccountLab.LimitExceeded.selector);
        account.nextActionHash();
    }

    function testGrantNotYetValid() public {
        vm.prank(A);
        account.setMintGrant(0, 0.01 ether, 0.02 ether, 2, uint64(block.timestamp + 60), uint64(block.timestamp + 120));
        vm.expectRevert(DroidMintAccountLab.GrantInactive.selector);
        account.nextActionHash();
    }

    function testExpiredGrant() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(DroidMintAccountLab.GrantInactive.selector);
        account.nextActionHash();
    }

    function testRevocationInvalidatesReviewedAction() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        approveReview();
        vm.prank(A); account.revokeMintGrant();
        vm.expectRevert(DroidMintAccountLab.GrantInactive.selector);
        execute();
    }

    function testUpdatedPolicyInvalidatesReview() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        approveReview();
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector);
        execute();
    }

    function testReplayDenied() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2);
        approveReview(); execute();
        vm.prank(EXECUTOR);
        vm.expectRevert(DroidMintAccountLab.Denied.selector);
        account.executeMint(0);
        nextNonce = 1;
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector);
        execute();
    }

    function testTransferRevokesOldOwnerAndGrantsButPreservesAssetsAndHistory() public {
        grant(A, 0, 0.01 ether, 0.03 ether, 3);
        approveReview(); execute(); approveReview();
        vm.prank(A); parent.transfer(11, B);
        vm.expectRevert(DroidMintAccountLab.StaleAuthority.selector); execute();
        vm.expectRevert(DroidMintAccountLab.Denied.selector); grant(A, 0, 1 ether, 1 ether, 1);
        vm.prank(A);
        vm.expectRevert(DroidMintAccountLab.Denied.selector);
        account.withdrawNative(payable(A), 0.1 ether);
        require(mint.ownerOf(1) == address(account) && account.actionNonce() == 1, "LOST_HISTORY");
        grant(B, 0.9 ether, 0.01 ether, 0.03 ether, 3);
        approveReview(); execute();
        vm.prank(B); account.withdrawNative(payable(B), 0.01 ether);
        require(B.balance == 0.01 ether && mint.ownerOf(2) == address(account), "NEW_OWNER_FAILED");
    }

    function testRoundTripTransferDoesNotReviveGrant() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2); approveReview();
        vm.prank(A); parent.transfer(11, B);
        vm.prank(B); parent.transfer(11, A);
        require(account.currentOwner() == A, "NOT_RETURNED");
        vm.expectRevert(DroidMintAccountLab.StaleAuthority.selector); execute();
    }

    function testWithdrawalNotAnExecutorCapability() public {
        vm.prank(EXECUTOR);
        vm.expectRevert(DroidMintAccountLab.Denied.selector);
        account.withdrawNative(payable(EXECUTOR), 1 ether);
    }

    function testOwnerWithdrawalInvalidatesReview() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2); approveReview();
        vm.prank(A); account.withdrawNative(payable(A), 0.01 ether);
        vm.expectRevert(DroidMintAccountLab.SimulationRequired.selector); execute();
    }

    function testNoArbitraryCallOrApprovalInterface() public {
        vm.prank(EXECUTOR);
        (bool ok,) = address(account).call(abi.encodeWithSignature("execute(address,uint256,bytes,uint8)", B, 1 ether, bytes(""), 0));
        require(!ok && address(account).balance == 1 ether, "ARBITRARY_CALL");
    }

    function testUnknownTargetRejectedAtConstruction() public {
        vm.expectRevert(bytes("FIXTURE_ONLY"));
        new DroidMintAccountLab(parent, 11, LabMint(B), EXECUTOR, REVIEWER);
    }

    function testChangedTargetCodeDenied() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2); approveReview();
        vm.etch(address(mint), hex"00");
        vm.expectRevert(DroidMintAccountLab.Denied.selector); execute();
    }

    function testUnexpectedRecipientRevertsAllAccounting() public {
        grant(A, 0, 0.01 ether, 0.02 ether, 2); approveReview();
        vm.mockCall(address(mint), abi.encodeWithSignature("ownerOf(uint256)", 1), abi.encode(B));
        vm.expectRevert(DroidMintAccountLab.UnexpectedOutcome.selector); execute();
        require(account.actionNonce() == 0 && address(account).balance == 1 ether, "PARTIAL_EXECUTION");
    }

    function testMainnetConstructorAndExecutionBlocked() public {
        vm.chainId(143);
        vm.expectRevert(bytes("LOCAL_ONLY"));
        new DroidMintAccountLab(parent, 11, mint, EXECUTOR, REVIEWER);
        vm.expectRevert(DroidMintAccountLab.Denied.selector);
        account.currentOwner();
    }

    function testFuzzReserveNeverCrossed(uint96 balance, uint96 reserve) public {
        vm.deal(address(account), balance);
        grant(A, reserve, 0.01 ether, 0.02 ether, 2);
        if (uint256(balance) < 0.01 ether || uint256(balance) - 0.01 ether < reserve) {
            vm.expectRevert(DroidMintAccountLab.LimitExceeded.selector);
            account.nextActionHash();
        } else {
            approveReview(); execute();
            require(address(account).balance >= reserve, "RESERVE_BREACH");
        }
    }
}
