// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DroidMissionAccountLab} from "../src/DroidMissionAccountLab.sol";
import {DroidMissionAccountCoreLab} from "../src/DroidMissionAccountCoreLab.sol";
import {EpochParentLab, MissionMintLab} from "../src/MissionFixtures.sol";

interface Vm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function etch(address, bytes calldata) external;
    function expectRevert() external;
}

contract RoundTripReceiver {
    function returnParent(EpochParentLab parent, address to, uint256 id) external {
        parent.transferFrom(address(this), to, id);
    }
}

contract OwnerCallbackProbe {
    DroidMissionAccountLab private target;
    EpochParentLab private parent;
    RoundTripReceiver private receiver;
    bool private roundTrip;
    bool public nestedSucceeded;

    function configure(DroidMissionAccountLab account, EpochParentLab nft, bool transfer) external {
        target = account;
        parent = nft;
        receiver = new RoundTripReceiver();
        roundTrip = transfer;
    }

    function withdraw() external {
        target.withdrawNative(payable(address(this)), 1);
    }

    receive() external payable {
        (nestedSucceeded,) = address(target).call(abi.encodeCall(target.cancel, ()));
        if (roundTrip) {
            parent.transferFrom(address(this), address(receiver), 12);
            receiver.returnParent(parent, address(this), 12);
        }
    }
}

contract DroidMissionAccountLabTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    address private constant RUNNER = address(0xA6E17);
    EpochParentLab private parent;
    MissionMintLab private minter;
    DroidMissionAccountLab private account;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10 days);
        parent = new EpochParentLab();
        minter = new MissionMintLab();
        parent.mint(A, 11);
        account = new DroidMissionAccountLab(parent, 11, minter);
        vm.deal(address(account), 50 ether);
    }

    function limits() private view returns (DroidMissionAccountCoreLab.Limits memory) {
        return DroidMissionAccountCoreLab.Limits(
            RUNNER,
            uint64(block.timestamp),
            uint64(block.timestamp + 3 days),
            3,
            2,
            20 ether,
            keccak256("LOCAL explicit free mint mission")
        );
    }

    function launch() private {
        DroidMissionAccountCoreLab.Limits memory l = limits();
        uint256 nonce = account.actionNonce();
        uint256 epoch = parent.ownershipEpoch(11);
        vm.prank(A);
        account.launch(l, nonce, epoch);
    }

    function execute() private returns (uint256) {
        uint256 id = account.missionId();
        uint256 nonce = account.actionNonce();
        vm.prank(RUNNER);
        return
            account.executeFreeMint(
                id, nonce, uint64(block.timestamp + 60), keccak256("LOCAL simulation audit reference")
            );
    }

    function transfer(address from, address to) private {
        vm.prank(from);
        parent.transferFrom(from, to, 11);
    }

    function denyExecute() private {
        uint256 id = account.missionId();
        uint256 nonce = account.actionNonce();
        vm.prank(RUNNER);
        vm.expectRevert();
        account.executeFreeMint(id, nonce, uint64(block.timestamp + 60), keccak256("LOCAL simulation audit reference"));
    }

    function testOwnerLaunchThenRunnerMintsWithoutFurtherOwnerTransactions() public {
        launch();
        uint256 id = execute();
        require(minter.ownerOf(id) == address(account));
        require(address(account).balance == 50 ether);
        require(account.dailyActions(1, block.timestamp / 1 days) == 1);
    }

    function testFundingDoesNotAuthorizeRunner() public {
        denyExecute();
    }

    function testNonOwnerCannotLaunchEvenIfApprovedForNFT() public {
        vm.prank(A);
        parent.approve(RUNNER, 11);
        DroidMissionAccountCoreLab.Limits memory l = limits();
        vm.prank(RUNNER);
        vm.expectRevert();
        account.launch(l, 0, 1);
    }

    function testUnknownRunnerDenied() public {
        launch();
        vm.prank(B);
        vm.expectRevert();
        account.executeFreeMint(1, 1, uint64(block.timestamp + 60), bytes32(uint256(1)));
    }

    function testCancelStopsRunner() public {
        launch();
        vm.prank(A);
        account.cancel();
        denyExecute();
    }

    function testOldActionCannotReplay() public {
        launch();
        execute();
        vm.prank(RUNNER);
        vm.expectRevert();
        account.executeFreeMint(1, 1, uint64(block.timestamp + 60), bytes32(uint256(1)));
    }

    function testOldMissionCannotExecuteAfterReplacement() public {
        launch();
        launch();
        vm.prank(RUNNER);
        vm.expectRevert();
        account.executeFreeMint(1, 2, uint64(block.timestamp + 60), bytes32(uint256(1)));
    }

    function testDailyLimitAndTotalLimitAcrossDays() public {
        launch();
        execute();
        execute();
        denyExecute();
        vm.warp(block.timestamp + 1 days);
        execute();
        denyExecute();
    }

    function testExpiredGrantDenied() public {
        launch();
        vm.warp(block.timestamp + 3 days);
        denyExecute();
    }

    function testNotYetValidDenied() public {
        DroidMissionAccountCoreLab.Limits memory l = limits();
        l.validAfter += 100;
        vm.prank(A);
        account.launch(l, 0, 1);
        denyExecute();
        vm.warp(block.timestamp + 100);
        execute();
    }

    function testBelowReserveDeniedAfterOwnerWithdrawal() public {
        launch();
        vm.prank(A);
        account.withdrawNative(payable(A), 31 ether);
        denyExecute();
    }

    function testFuzzFreeMintCannotSpendReserve(uint96 balance) public {
        vm.deal(address(account), balance);
        DroidMissionAccountCoreLab.Limits memory l = limits();
        l.protectedReserveWei = balance;
        vm.prank(A);
        account.launch(l, 0, 1);
        execute();
        require(address(account).balance == balance);
    }

    function testTransferInvalidatesRunnerAndOldOwnerImmediately() public {
        launch();
        execute();
        transfer(A, B);
        denyExecute();
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
        vm.prank(A);
        vm.expectRevert();
        account.cancel();
        vm.prank(B);
        account.withdrawMint(B, 1);
        require(minter.ownerOf(1) == B);
        vm.prank(B);
        account.withdrawNative(payable(B), 1 ether);
        require(address(account).balance == 49 ether);
    }

    function testSameBlockRoundTripDoesNotReviveGrant() public {
        launch();
        transfer(A, B);
        transfer(B, A);
        require(parent.ownerOf(11) == A);
        require(parent.ownershipEpoch(11) == 3);
        denyExecute();
        launch(); // New owner transaction required, even though owner address is A again.
        execute();
    }

    function testTransferInvalidatesPreviouslyPreparedOwnerLaunch() public {
        DroidMissionAccountCoreLab.Limits memory l = limits();
        transfer(A, B);
        transfer(B, A);
        vm.prank(A);
        vm.expectRevert();
        account.launch(l, 0, 1);
    }

    function testBurnAndRemintSameIdDoesNotReviveGrant() public {
        launch();
        vm.prank(A);
        parent.burn(11);
        denyExecute();
        parent.mint(A, 11);
        denyExecute();
    }

    function testBurnFailsClosedAndCanStrandFunds() public {
        launch();
        vm.prank(A);
        parent.burn(11);
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
        // Explicit unresolved parent-burn recovery limitation, not a production-safe design.
        require(address(account).balance == 50 ether);
    }

    function testRunnerCannotWithdrawAssets() public {
        launch();
        execute();
        vm.prank(RUNNER);
        vm.expectRevert();
        account.withdrawNative(payable(RUNNER), 1);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.withdrawMint(RUNNER, 1);
    }

    function testNoArbitraryCallOrValueEntrypoint() public {
        launch();
        vm.deal(RUNNER, 1 ether);
        vm.prank(RUNNER);
        (bool paid,) = address(account).call{value: 1}(
            abi.encodeCall(account.executeFreeMint, (1, 1, uint64(block.timestamp + 60), bytes32(uint256(1))))
        );
        require(!paid);
        (bool arbitrary,) =
            address(account).call(abi.encodeWithSignature("execute(address,uint256,bytes)", RUNNER, 1 ether, ""));
        require(!arbitrary);
    }

    function testMissingSimulationCommitmentAndExpiredPreparationDenied() public {
        launch();
        vm.prank(RUNNER);
        vm.expectRevert();
        account.executeFreeMint(1, 1, uint64(block.timestamp + 60), bytes32(0));
        vm.prank(RUNNER);
        vm.expectRevert();
        account.executeFreeMint(1, 1, uint64(block.timestamp), bytes32(uint256(1)));
    }

    function testMainnetDeploymentAndExecutionImpossible() public {
        vm.chainId(143);
        vm.expectRevert();
        new DroidMissionAccountLab(parent, 11, minter);
        denyExecute();
    }

    function testChangedTargetCodeDenied() public {
        launch();
        vm.etch(address(minter), hex"00");
        denyExecute();
    }

    function testUnknownParentCodeDenied() public {
        vm.expectRevert();
        new DroidMissionAccountLab(EpochParentLab(address(minter)), 11, minter);
    }

    function testInvalidLimitsDenied() public {
        DroidMissionAccountCoreLab.Limits memory l = limits();
        l.maxActions = 0;
        vm.prank(A);
        vm.expectRevert();
        account.launch(l, 0, 1);
        l = limits();
        l.expiresAt = uint64(block.timestamp + 8 days);
        vm.prank(A);
        vm.expectRevert();
        account.launch(l, 0, 1);
        l = limits();
        l.runner = address(0);
        vm.prank(A);
        vm.expectRevert();
        account.launch(l, 0, 1);
        l = limits();
        l.protectedReserveWei = 51 ether;
        vm.prank(A);
        vm.expectRevert();
        account.launch(l, 0, 1);
    }

    function testOwnerCallbackCannotReenter() public {
        OwnerCallbackProbe actor = new OwnerCallbackProbe();
        parent.mint(address(actor), 12);
        DroidMissionAccountLab other = new DroidMissionAccountLab(parent, 12, minter);
        vm.deal(address(other), 1 ether);
        actor.configure(other, parent, false);
        actor.withdraw();
        require(!actor.nestedSucceeded());
        require(other.actionNonce() == 1);
    }

    function testOwnerRoundTripDuringWithdrawalRollsBackAtomically() public {
        OwnerCallbackProbe actor = new OwnerCallbackProbe();
        parent.mint(address(actor), 12);
        DroidMissionAccountLab other = new DroidMissionAccountLab(parent, 12, minter);
        vm.deal(address(other), 1 ether);
        actor.configure(other, parent, true);
        vm.expectRevert();
        actor.withdraw();
        require(address(other).balance == 1 ether);
        require(parent.ownerOf(12) == address(actor));
        require(parent.ownershipEpoch(12) == 1);
        require(other.actionNonce() == 0);
    }
}
