// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidControlReceiptLab, IWrappedParentLab} from "../src/wrapper/DroidControlReceiptLab.sol";
import {WrappedMissionAccountLab} from "../src/wrapper/WrappedMissionAccountLab.sol";
import {DroidMissionAccountCoreLab as Core} from "../src/DroidMissionAccountCoreLab.sol";
import {DroidBoundedSwapCoreLab as SwapCore} from "../src/swap/DroidBoundedSwapCoreLab.sol";
import {KuruMonUsdcAdapterLab as Adapter} from "../src/swap/KuruMonUsdcAdapterLab.sol";
import {MissionMintLab} from "../src/MissionFixtures.sol";
import {LegacyParentLab} from "./DroidControlReceiptLab.t.sol";
import {SwapTokenLab, SwapRouterLab, SwapControlLab, SwapMarketLab, SwapVm} from "./DroidKuruSwapLab.t.sol";

contract CanonicalTokenLab is SwapTokenLab {
    bool public rejectTransfer;
    address public callback;

    function configure(bool reject, address target) external {
        rejectTransfer = reject;
        callback = target;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!rejectTransfer);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        if (callback != address(0)) CanonicalOwnerProbe(payable(callback)).onToken();
        return ok;
    }
}

/// @dev Hostile contract OWNER probe, not merely an unauthorized callback caller.
contract CanonicalOwnerProbe {
    WrappedMissionAccountLab public account;
    DroidControlReceiptLab public wrapper;
    bool public changeEpoch;
    uint256 public denied;

    constructor(WrappedMissionAccountLab a, DroidControlReceiptLab w) {
        account = a;
        wrapper = w;
    }
    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function configure(bool mutate) external {
        changeEpoch = mutate;
        account.configureSwapPolicy(0, account.actionNonce(), wrapper.ownershipEpoch(11));
    }

    function swap(SwapCore.SwapRequest calldata r) external {
        account.swap(r);
    }

    function onToken() external {
        if (changeEpoch) {
            wrapper.transferFrom(address(this), address(this), 11);
        } else {
            bytes[] memory calls = new bytes[](5);
            calls[0] = abi.encodeCall(account.cancel, ());
            calls[1] =
                abi.encodeCall(account.configureSwapPolicy, (0, account.actionNonce(), wrapper.ownershipEpoch(11)));
            calls[2] = abi.encodeCall(account.withdrawNative, (payable(address(0xBAD)), 1));
            calls[3] = abi.encodeCall(account.recoverERC20, (msg.sender, address(0xBAD), 1));
            uint256[] memory ids = new uint256[](0);
            calls[4] = abi.encodeCall(account.exitToOwner, (ids, account.actionNonce(), wrapper.ownershipEpoch(11)));
            for (uint256 i; i < calls.length; ++i) {
                (bool ok, bytes memory result) = address(account).call(calls[i]);
                require(!ok && bytes4(result) == Core.Reentrancy.selector);
                denied++;
            }
        }
    }
}

contract CanonicalSwapAccountLabTest {
    SwapVm private constant vm = SwapVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    address private constant RUNNER = address(0xA6E17);
    LegacyParentLab private parent;
    MissionMintLab private minter;
    DroidControlReceiptLab private wrapper;
    WrappedMissionAccountLab private account;
    CanonicalTokenLab private token;
    SwapRouterLab private router;
    Adapter.Venue private venue;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10 days);
        parent = new LegacyParentLab();
        minter = new MissionMintLab();
        token = new CanonicalTokenLab();
        SwapMarketLab market = new SwapMarketLab();
        router = new SwapRouterLab(token, new SwapControlLab(A), address(market));
        venue = Adapter.Venue(
            address(router),
            address(market),
            address(token),
            address(router).codehash,
            address(market).codehash,
            address(token).codehash
        );
        wrapper = new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter, venue);
        parent.mint(A, 11);
        _wrap();
        vm.deal(address(account), 0.02 ether);
        vm.deal(address(router), 1 ether);
        _configure(A, 0.019 ether);
    }

    function _wrap() private {
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(A);
        parent.safeTransferFrom(A, address(wrapper), 11, intent);
        account = WrappedMissionAccountLab(payable(wrapper.accounts(11)));
    }

    function _configure(address owner, uint256 reserve) private {
        uint256 nonce = account.actionNonce();
        uint256 epoch = wrapper.ownershipEpoch(11);
        vm.prank(owner);
        account.configureSwapPolicy(reserve, nonce, epoch);
    }

    function _request(bool buy, uint256 amount) private view returns (SwapCore.SwapRequest memory) {
        return SwapCore.SwapRequest(
            buy ? Adapter.Direction.USDC_TO_MON : Adapter.Direction.MON_TO_USDC,
            amount,
            1,
            account.actionNonce(),
            wrapper.ownershipEpoch(11),
            uint64(block.timestamp + 60),
            bytes32(uint256(1))
        );
    }

    function _swap(address owner, bool buy, uint256 amount) private returns (uint256 received) {
        SwapCore.SwapRequest memory r = _request(buy, amount);
        vm.prank(owner);
        (, received) = account.swap(r);
    }

    function _launch(uint256 reserve) private {
        Core.Limits memory l = Core.Limits(
            RUNNER,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            3,
            3,
            reserve,
            keccak256("CANONICAL mint")
        );
        uint256 nonce = account.actionNonce();
        uint256 epoch = wrapper.ownershipEpoch(11);
        vm.prank(A);
        account.launch(l, nonce, epoch);
    }

    function testSameCanonicalWalletBuysSellsAndMintsWithOneNonce() public {
        require(wrapper.accounts(11) == address(account));
        uint256 received = _swap(A, false, 0.001 ether);
        require(token.balanceOf(address(account)) == received && account.actionNonce() == 2);
        _launch(0.019 ether);
        vm.prank(RUNNER);
        uint256 id = account.executeFreeMint(1, 3, uint64(block.timestamp + 60), bytes32(uint256(1)));
        require(minter.ownerOf(id) == address(account) && account.actionNonce() == 4);
        _swap(A, true, received);
        require(token.balanceOf(address(account)) == 0 && token.allowance(address(account), address(router)) == 0);
        require(account.actionNonce() == 5 && address(account).balance >= 0.019 ether);
    }

    function testRunnerNeverGetsSwapOrPolicyOrWithdrawalAuthority() public {
        _launch(0);
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.swap(r);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.configureSwapPolicy(0, r.expectedNonce, r.expectedEpoch);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.withdrawNative(payable(RUNNER), 1);
    }

    function testFuzzSwapCannotUndercutLiveMissionReserve(uint96 extra) public {
        uint256 reserve = 0.019 ether + 1 + uint256(extra) % 0.001 ether;
        _launch(reserve);
        _configure(A, 0);
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        require(address(account).balance == 0.02 ether && account.actionNonce() == r.expectedNonce);
        require(account.dailySwapActions(block.timestamp / 1 days) == 0);
    }

    function testCancelledOrExpiredMissionDoesNotLeaveHiddenReserve() public {
        _launch(0.02 ether);
        vm.prank(A);
        account.cancel();
        _swap(A, false, 0.001 ether);
        vm.warp(block.timestamp + 2 days);
        vm.deal(address(account), 0.02 ether);
        _launch(0.02 ether);
        vm.warp(block.timestamp + 1 days);
        _swap(A, false, 0.001 ether);
    }

    function testAllStateChangingPathsInvalidatePreparedSwapNonce() public {
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        account.cancel();
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether);
        vm.prank(A);
        account.recoverERC20(address(token), B, 0);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether);
        vm.prank(A);
        account.withdrawNative(payable(B), 0);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether);
        _launch(0);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether);
        vm.prank(RUNNER);
        account.executeFreeMint(1, r.expectedNonce, uint64(block.timestamp + 60), bytes32(uint256(1)));
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
    }

    function testSwapInvalidatesPreparedMintExecutionNonce() public {
        _launch(0);
        uint256 nonce = account.actionNonce();
        _swap(A, false, 0.001 ether);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.executeFreeMint(1, nonce, uint64(block.timestamp + 60), bytes32(uint256(1)));
    }

    function testTransferRevokesOldOwnerAndKeepsAssetsHistoryAndDailyCounters() public {
        uint256 received = _swap(A, false, 0.001 ether);
        vm.prank(A);
        wrapper.transferFrom(A, B, 11);
        SwapCore.SwapRequest memory r = _request(true, received);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        vm.prank(A);
        vm.expectRevert();
        account.configureSwapPolicy(0, r.expectedNonce, r.expectedEpoch);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC20(address(token), A, received);
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
        vm.prank(B); // New owner must set their own policy.
        vm.expectRevert();
        account.swap(r);
        _configure(B, 0);
        _swap(B, true, received);
        require(wrapper.accounts(11) == address(account) && account.dailySwapActions(block.timestamp / 1 days) == 2);
        require(account.dailyNativeInput(block.timestamp / 1 days) == 0.001 ether);
    }

    function testRoundTripAndSelfTransferNeverRevivePolicy() public {
        vm.prank(A);
        wrapper.transferFrom(A, B, 11);
        vm.prank(B);
        wrapper.transferFrom(B, A, 11);
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        _configure(A, 0);
        vm.prank(A);
        wrapper.transferFrom(A, A, 11);
        r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
    }

    function testExitSweepsUsdcAndMonThenRewrapReusesWalletWithoutResettingCaps() public {
        uint256 received = _swap(A, false, 0.001 ether);
        uint256 beforeBalance = A.balance;
        uint256[] memory ids = new uint256[](0);
        vm.prank(A);
        account.exitToOwner(ids, 2, 1);
        require(token.balanceOf(A) == received && A.balance == beforeBalance + 0.019 ether);
        require(account.knownAssetsEmpty() && parent.ownerOf(11) == A && account.swapPolicyOwner() == address(0));
        address originalAccount = address(account);
        _wrap();
        require(address(account) == originalAccount && wrapper.ownershipEpoch(11) == 3);
        vm.deal(address(account), 0.02 ether);
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        _configure(A, 0);
        _swap(A, false, 0.001 ether);
        _swap(A, false, 0.001 ether);
        r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
    }

    function testUsdcOnlyBalanceBlocksDirectUnwrapAndFailedExitIsAtomic() public {
        token.mint(address(account), 10);
        vm.deal(address(account), 0);
        require(!account.knownAssetsEmpty());
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
        token.configure(true, address(0));
        uint256[] memory ids = new uint256[](0);
        vm.prank(A);
        vm.expectRevert();
        account.exitToOwner(ids, 1, 1);
        require(account.actionNonce() == 1 && account.swapPolicyOwner() == A && wrapper.ownerOf(11) == A);
        require(token.balanceOf(address(account)) == 10);
    }

    function testFuzzInvalidRouterEffectsRollbackCanonicalNonceAndCounters(uint8 scenario) public {
        uint256[3] memory modes = [uint256(1), uint256(2), uint256(3)];
        router.setMode(modes[scenario % 3]);
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        require(account.actionNonce() == 1 && account.dailySwapActions(block.timestamp / 1 days) == 0);
        require(address(account).balance == 0.02 ether && token.balanceOf(address(account)) == 0);
    }

    function testContractOwnerCannotReenterOtherCapabilitiesDuringSwap() public {
        CanonicalOwnerProbe probe = new CanonicalOwnerProbe(account, wrapper);
        vm.prank(A);
        wrapper.transferFrom(A, address(probe), 11);
        probe.configure(false);
        token.mint(address(account), 10);
        token.configure(false, address(probe));
        probe.swap(_request(true, 10));
        require(probe.denied() == 5 && token.allowance(address(account), address(router)) == 0);
    }

    function testReceiptEpochChangeDuringVenueCallRevertsEntireSwap() public {
        CanonicalOwnerProbe probe = new CanonicalOwnerProbe(account, wrapper);
        vm.prank(A);
        wrapper.transferFrom(A, address(probe), 11);
        probe.configure(true);
        token.mint(address(account), 10);
        token.configure(false, address(probe));
        SwapCore.SwapRequest memory r = _request(true, 10);
        vm.expectRevert();
        probe.swap(r);
        require(wrapper.ownershipEpoch(11) == r.expectedEpoch && account.actionNonce() == r.expectedNonce);
        require(token.balanceOf(address(account)) == 10 && token.allowance(address(account), address(router)) == 0);
    }

    function testUnknownVenueHashMissingCodeOrWrongChainDeniesSwap() public {
        vm.etch(address(router), hex"00");
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        vm.chainId(143);
        vm.prank(A);
        vm.expectRevert();
        account.configureSwapPolicy(0, 1, 1);
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
    }

    function testCanonicalSwapRejectsExpiredEvidenceZeroMinimumAndInputCaps() public {
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        r.deadline = uint64(block.timestamp);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r.deadline = uint64(block.timestamp + 121);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether);
        r.simulationReference = bytes32(0);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether);
        r.minimumOut = 0;
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0.001 ether + 1);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(true, 1001);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        r = _request(false, 0);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        require(account.actionNonce() == 1);
    }

    function testPartialRefundStillChargesFullBudgetAndDoesNotResetOnConfigure() public {
        _configure(A, 0);
        router.setMode(6);
        for (uint256 i; i < 3; ++i) {
            _swap(A, false, 0.001 ether);
            _configure(A, 0);
        }
        require(account.dailyNativeInput(block.timestamp / 1 days) == 0.003 ether);
        require(address(account).balance == 0.0185 ether);
        SwapCore.SwapRequest memory r = _request(false, 0.001 ether);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        vm.warp(block.timestamp + 1 days);
        _swap(A, false, 0.001 ether);
    }

    function testCanonicalSellAllowanceCleanupFailureRollsBackAllState() public {
        token.mint(address(account), 10);
        token.setFailReset(true);
        SwapCore.SwapRequest memory r = _request(true, 10);
        vm.prank(A);
        vm.expectRevert();
        account.swap(r);
        require(token.balanceOf(address(account)) == 10 && address(account).balance == 0.02 ether);
        require(token.allowance(address(account), address(router)) == 0 && account.actionNonce() == 1);
        require(account.dailyTokenInput(block.timestamp / 1 days) == 0);
    }

    function testDisabledPartialOrUnapprovedVenueCannotEnableTrading() public {
        DroidControlReceiptLab mintOnly =
            new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter, Adapter.disabledVenue());
        parent.mint(A, 12);
        bytes memory intent = abi.encode(mintOnly.WRAP_INTENT());
        vm.prank(A);
        parent.safeTransferFrom(A, address(mintOnly), 12, intent);
        WrappedMissionAccountLab mintAccount = WrappedMissionAccountLab(payable(mintOnly.accounts(12)));
        vm.prank(A);
        vm.expectRevert();
        mintAccount.configureSwapPolicy(0, 0, 1);
        Adapter.Venue memory invalid = venue;
        invalid.router = address(0);
        vm.expectRevert();
        new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter, invalid);
        invalid = venue;
        invalid.routerHash = bytes32(0);
        vm.expectRevert();
        new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter, invalid);
    }
}
