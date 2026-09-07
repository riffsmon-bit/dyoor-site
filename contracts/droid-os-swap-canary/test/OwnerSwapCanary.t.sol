// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@droid-oz/token/ERC20/ERC20.sol";
import {OwnerSwapCanaryCore, IKuruCanaryRouter} from "../src/OwnerSwapCanaryCore.sol";
import {DroidOwnerSwapCanary} from "../src/DroidOwnerSwapCanary.sol";

interface CanaryVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function deal(address, uint256) external;
    function expectRevert() external;
    function etch(address, bytes calldata) external;
}

contract CanaryParentMock {
    address public owner;

    constructor(address o) {
        owner = o;
    }

    function setOwner(address o) external {
        owner = o;
    }
}

contract CanaryTokenMock is ERC20 {
    bool public failReset;
    bool public paused;
    constructor() ERC20("TEST", "TEST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailures(bool reset, bool pause) external {
        failReset = reset;
        paused = pause;
    }

    function approve(address to, uint256 amount) public override returns (bool) {
        if (failReset && amount == 0) return false;
        return super.approve(to, amount);
    }

    function _beforeTokenTransfer(address, address, uint256) internal view override {
        require(!paused);
    }
}

contract CanaryRouterMock is IKuruCanaryRouter {
    CanaryTokenMock public token;
    uint256 public mode;
    address public callback;

    constructor(CanaryTokenMock t) {
        token = t;
    }
    receive() external payable {}

    function configure(uint256 m, address cb) external {
        mode = m;
        callback = cb;
    }

    function anyToAnySwap(
        address[] calldata markets,
        bool[] calldata buys,
        bool[] calldata nativeSends,
        address debit,
        address credit,
        uint256 amount,
        uint256 minimum
    ) external payable returns (uint256 output) {
        require(markets.length == 1 && markets[0] == address(this) && buys.length == 1 && nativeSends.length == 1);
        bool buy = buys[0];
        require(nativeSends[0] == !buy && msg.value == (buy ? 0 : amount));
        require(debit == (buy ? address(token) : address(0)) && credit == (buy ? address(0) : address(token)));
        uint256 spend = mode == 5 ? amount / 2 : amount;
        if (buy) {
            token.transferFrom(msg.sender, address(this), mode == 4 ? amount + 1 : spend);
            output = spend * 4e13;
            if (mode != 3) {
                (bool ok,) = payable(msg.sender).call{value: output}("");
                require(ok);
            }
        } else {
            output = spend / 5e13;
            if (mode != 3) token.mint(mode == 2 ? address(0xBAD) : msg.sender, output);
            if (mode == 5) {
                (bool ok,) = payable(msg.sender).call{value: amount - spend}("");
                require(ok);
            }
        }
        if (callback != address(0)) CanaryCallbackMock(payable(callback)).onSwap();
        if (mode == 1) output++;
        if (mode != 8) require(output >= minimum);
    }
}

contract CanaryHarness is OwnerSwapCanaryCore {
    CanaryParentMock public parent;
    CanaryRouterMock public router;
    CanaryTokenMock public token;
    bytes32 private routerHash;

    constructor(CanaryParentMock p, CanaryRouterMock r, CanaryTokenMock t) {
        parent = p;
        router = r;
        token = t;
        routerHash = address(r).codehash;
    }

    function currentOwner() public view override returns (address) {
        require(block.chainid == 143 && parent.owner() != address(0));
        return parent.owner();
    }

    function venue() public view override returns (address, address, address) {
        return (address(router), address(router), address(token));
    }

    function _checkVenue() internal view override {
        require(address(router).codehash == routerHash);
    }
}

contract CanaryCallbackMock {
    CanaryHarness public account;
    CanaryParentMock public parent;
    bool public mutate;
    bool public rejected;

    constructor(CanaryHarness a, CanaryParentMock p) {
        account = a;
        parent = p;
    }
    receive() external payable {}

    function configure(bool change) external {
        mutate = change;
    }

    function buy() external {
        account.buy(0.001 ether, 1, account.actionNonce(), uint64(block.timestamp + 60), bytes32(uint256(1)));
    }

    function onSwap() external {
        if (mutate) {
            parent.setOwner(address(0xB0B));
        } else {
            (bool ok,) = address(account)
                .call(abi.encodeCall(account.recoverNative, (account.actionNonce(), uint64(block.timestamp + 60))));
            rejected = !ok;
            require(rejected);
        }
    }
}

contract OwnerSwapCanaryTest {
    CanaryVm private constant vm = CanaryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    bytes32 private constant EVIDENCE = keccak256("LOCAL ONLY simulation reference");
    CanaryParentMock private parent;
    CanaryTokenMock private token;
    CanaryRouterMock private router;
    CanaryHarness private account;

    function setUp() public {
        vm.chainId(143);
        vm.warp(10 days);
        parent = new CanaryParentMock(A);
        token = new CanaryTokenMock();
        router = new CanaryRouterMock(token);
        account = new CanaryHarness(parent, router, token);
        vm.deal(address(account), 0.0011 ether);
        vm.deal(address(router), 1 ether);
        vm.deal(A, 1 ether);
    }

    function _buy() private returns (uint256) {
        uint256 n = account.actionNonce();
        vm.prank(parent.owner());
        return account.buy(0.001 ether, 1, n, uint64(block.timestamp + 60), EVIDENCE);
    }

    function _sell() private returns (uint256) {
        uint256 n = account.actionNonce();
        vm.prank(parent.owner());
        return account.sell(1, n, uint64(block.timestamp + 60), EVIDENCE);
    }

    function _denyBuy() private {
        uint256 n = account.actionNonce();
        address owner = parent.owner();
        vm.prank(owner);
        vm.expectRevert();
        account.buy(0.001 ether, 1, n, uint64(block.timestamp + 60), EVIDENCE);
    }

    function _denySell() private {
        uint256 n = account.actionNonce();
        address owner = parent.owner();
        vm.prank(owner);
        vm.expectRevert();
        account.sell(1, n, uint64(block.timestamp + 60), EVIDENCE);
    }

    function testSingleRoundTripThenRecoverBothAssetsAndClose() public {
        require(_buy() == 20 && account.phase() == 1);
        require(_sell() == 0.0008 ether && account.phase() == 2);
        require(token.allowance(address(account), address(router)) == 0 && address(account).balance >= 0.0001 ether);
        _denyBuy();
        _denySell();
        token.mint(address(account), 1);
        vm.prank(A);
        account.recoverUSDC(2, uint64(block.timestamp + 60));
        vm.prank(A);
        account.recoverNative(3, uint64(block.timestamp + 60));
        require(
            account.phase() == 3 && account.actionNonce() == 4 && address(account).balance == 0
                && token.balanceOf(A) == 1
        );
    }

    function testFuzzInputCapAndReserve(uint96 extra) public {
        uint256 amount = 0.001 ether + 1 + uint256(extra);
        vm.prank(A);
        vm.expectRevert();
        account.buy(amount, 1, 0, uint64(block.timestamp + 60), EVIDENCE);
        vm.deal(address(account), 0.001 ether);
        _denyBuy();
        require(account.phase() == 0 && account.actionNonce() == 0);
    }

    function testOwnerTransferPreservesAccountAndRevokesOldOwnerActions() public {
        _buy();
        parent.setOwner(B);
        vm.prank(A);
        vm.expectRevert();
        account.sell(1, 1, uint64(block.timestamp + 60), EVIDENCE);
        vm.prank(A);
        vm.expectRevert();
        account.recoverNative(1, uint64(block.timestamp + 60));
        vm.prank(A);
        vm.expectRevert();
        account.recoverUSDC(1, uint64(block.timestamp + 60));
        require(_sell() == 0.0008 ether);
        vm.prank(B);
        account.recoverNative(2, uint64(block.timestamp + 60));
        require(B.balance > 0 && account.phase() == 3);
    }

    function testNoGrantExistsToReviveOnOwnershipRoundTrip() public {
        _buy();
        parent.setOwner(B);
        parent.setOwner(A);
        _denyBuy(); // A fresh owner transaction cannot reset the one-buy cap.
        _sell();
    }

    function testExpiryStopsTradingButNotRecovery() public {
        _buy();
        vm.warp(block.timestamp + 1 days);
        _denySell();
        vm.prank(A);
        account.recoverUSDC(1, uint64(block.timestamp + 60));
        vm.prank(A);
        account.recoverNative(2, uint64(block.timestamp + 60));
        require(token.balanceOf(A) == 20 && address(account).balance == 0);
    }

    function testFreshWalletExpiryAndClosedWalletCannotTradeOrRefill() public {
        vm.warp(block.timestamp + 1 days);
        _denyBuy();
        vm.prank(A);
        account.recoverNative(0, uint64(block.timestamp + 60));
        vm.prank(A);
        (bool ok,) = address(account).call{value: 0.0011 ether}("");
        require(!ok);
        _denyBuy();
    }

    function testInvalidNonceDeadlineEvidenceAndZeroMinimum() public {
        vm.prank(A);
        vm.expectRevert();
        account.buy(1, 1, 1, uint64(block.timestamp + 60), EVIDENCE);
        vm.prank(A);
        vm.expectRevert();
        account.buy(1, 1, 0, uint64(block.timestamp), EVIDENCE);
        vm.prank(A);
        vm.expectRevert();
        account.buy(1, 1, 0, uint64(block.timestamp + 121), EVIDENCE);
        vm.prank(A);
        vm.expectRevert();
        account.buy(1, 1, 0, uint64(block.timestamp + 60), bytes32(0));
        vm.prank(A);
        vm.expectRevert();
        account.buy(1, 0, 0, uint64(block.timestamp + 60), EVIDENCE);
        vm.prank(A);
        vm.expectRevert();
        account.buy(0, 1, 0, uint64(block.timestamp + 60), EVIDENCE);
        vm.prank(A);
        vm.expectRevert();
        account.sell(1, 0, uint64(block.timestamp + 60), EVIDENCE);
    }

    function testFuzzIncorrectVenueEffectsAreAtomic(uint8 mode) public {
        router.configure(1 + uint256(mode) % 3, address(0));
        _denyBuy();
        require(account.phase() == 0 && account.actionNonce() == 0 && token.balanceOf(address(account)) == 0);
        require(address(account).balance == 0.0011 ether);
    }

    function testMinimumRemainsEnforcedIfRouterIgnoresIt() public {
        router.configure(8, address(0));
        vm.prank(A);
        vm.expectRevert();
        account.buy(0.001 ether, 21, 0, uint64(block.timestamp + 60), EVIDENCE);
    }

    function testPartialFillConsumesOneShotBudgetAndLeavesRefundInAccount() public {
        router.configure(5, address(0));
        _buy();
        require(address(account).balance == 0.0006 ether && account.purchasedUnits() == 10);
        _denyBuy();
        _sell();
        require(token.allowance(address(account), address(router)) == 0 && token.balanceOf(address(account)) == 5);
        vm.prank(A);
        account.recoverUSDC(2, uint64(block.timestamp + 60));
        require(token.balanceOf(A) == 5);
    }

    function testTokenOverdebitAndApprovalResetFailureRollback() public {
        _buy();
        router.configure(4, address(0));
        _denySell();
        router.configure(0, address(0));
        token.setFailures(true, false);
        _denySell();
        require(account.actionNonce() == 1 && account.phase() == 1 && token.balanceOf(address(account)) == 20);
        require(token.allowance(address(account), address(router)) == 0);
    }

    function testPausedTokenAndChangedRouterCannotTrapNativeRecovery() public {
        _buy();
        token.setFailures(false, true);
        vm.etch(address(router), hex"00");
        vm.prank(A);
        vm.expectRevert();
        account.recoverUSDC(1, uint64(block.timestamp + 60));
        vm.prank(A);
        account.recoverNative(1, uint64(block.timestamp + 60));
        require(address(account).balance == 0 && account.phase() == 3 && token.balanceOf(address(account)) == 20);
    }

    function testHostileContractOwnerCannotReenterRecoveryFromVenue() public {
        CanaryCallbackMock probe = new CanaryCallbackMock(account, parent);
        parent.setOwner(address(probe));
        router.configure(0, address(probe));
        probe.buy();
        require(probe.rejected() && account.actionNonce() == 1);
    }

    function testOwnershipChangeInCallbackRevertsEntireSwap() public {
        CanaryCallbackMock probe = new CanaryCallbackMock(account, parent);
        parent.setOwner(address(probe));
        router.configure(0, address(probe));
        probe.configure(true);
        vm.expectRevert();
        probe.buy();
        require(parent.owner() == address(probe) && account.phase() == 0 && token.balanceOf(address(account)) == 0);
    }

    function testFundingCannotAuthorizeOrExceedDisplayedCapitalCap() public {
        vm.deal(address(account), 0);
        vm.prank(B);
        (bool ok,) = address(account).call{value: 0}("");
        require(!ok);
        vm.prank(A);
        (ok,) = address(account).call{value: 0.0011 ether + 1}("");
        require(!ok);
        vm.prank(A);
        (ok,) = address(account).call{value: 0.0011 ether}("");
        require(ok);
        vm.prank(B);
        vm.expectRevert();
        account.buy(0.001 ether, 1, 0, uint64(block.timestamp + 60), EVIDENCE);
    }

    function testUnknownSelectorAttachedValueAndNFTReceiverAreAbsent() public {
        vm.prank(A);
        (bool ok,) = address(account).call(abi.encodeWithSignature("execute(address,bytes)", B, hex""));
        require(!ok);
        vm.prank(A);
        (ok,) = address(account)
            .call(abi.encodeWithSignature("onERC721Received(address,address,uint256,bytes)", A, A, 11, hex""));
        require(!ok);
        vm.prank(A);
        vm.expectRevert();
        account.recoverNative(1, uint64(block.timestamp + 60));
        vm.prank(A);
        (ok,) = address(account).call{value: 1}(
            abi.encodeCall(account.buy, (1, 1, 0, uint64(block.timestamp + 60), EVIDENCE))
        );
        require(!ok);
        vm.chainId(1);
        _denyBuy();
    }

    function testConcreteCanaryCannotDeployOnWrongChainOrWithoutVerifiedCollection() public {
        vm.chainId(31337);
        vm.expectRevert();
        new DroidOwnerSwapCanary();
        vm.chainId(143);
        vm.expectRevert();
        new DroidOwnerSwapCanary();
        require(
            type(DroidOwnerSwapCanary).runtimeCode.length <= 24576
                && type(DroidOwnerSwapCanary).creationCode.length <= 49152
        );
    }
}
