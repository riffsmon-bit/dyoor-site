// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@droid-oz/token/ERC20/ERC20.sol";
import {DroidSwapAccountLab} from "../src/swap/DroidSwapAccountLab.sol";
import {KuruMonUsdcAdapterLab as Adapter, IKuruSwapLab} from "../src/swap/KuruMonUsdcAdapterLab.sol";
import {IWrapperControlLab} from "../src/wrapper/WrappedMissionAccountLab.sol";

interface SwapVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function deal(address, uint256) external;
    function etch(address, bytes calldata) external;
}

contract SwapControlLab {
    address public owner;
    uint256 public epoch = 1;
    bool public wrapped = true;

    constructor(address who) {
        owner = who;
    }

    function setOwner(address who) external {
        owner = who;
        epoch++;
    }

    function roundTrip() external {
        epoch += 2;
    }

    function unwrap() external {
        wrapped = false;
        epoch++;
    }

    function controlOf(uint256) external view returns (address, uint256, bool) {
        return (owner, epoch, wrapped);
    }
}

contract SwapTokenLab is ERC20 {
    bool public failReset;
    constructor() ERC20("LOCAL USDC", "LOCAL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailReset(bool fail) external {
        failReset = fail;
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        if (failReset && amount == 0) return false;
        return super.approve(spender, amount);
    }
}

contract SwapMarketLab {}

contract SwapRouterLab is IKuruSwapLab {
    SwapTokenLab public token;
    SwapControlLab public control;
    address public market;
    uint256 public mode;
    bool public reentryDenied;

    constructor(SwapTokenLab t, SwapControlLab c, address m) {
        token = t;
        control = c;
        market = m;
    }

    function setMode(uint256 value) external {
        mode = value;
    }
    receive() external payable {}

    function anyToAnySwap(
        address[] calldata markets,
        bool[] calldata buys,
        bool[] calldata nativeSends,
        address debit,
        address credit,
        uint256 amount,
        uint256 minimumOut
    ) external payable returns (uint256 output) {
        require(markets.length == 1 && markets[0] == market && buys.length == 1 && nativeSends.length == 1);
        bool buy = buys[0];
        require(nativeSends[0] == !buy);
        require(debit == (buy ? address(token) : address(0)) && credit == (buy ? address(0) : address(token)));
        require(msg.value == (buy ? 0 : amount));
        uint256 spent = mode == 6 ? amount / 2 : amount;
        if (buy) {
            token.transferFrom(msg.sender, address(this), mode == 5 ? amount + 1 : spent);
            output = spent * 4e13;
            if (mode != 2) {
                (bool ok,) = payable(msg.sender).call{value: output}("");
                require(ok);
            }
        } else {
            output = spent / 5e13;
            if (mode != 2) token.mint(mode == 3 ? address(0xBAD) : msg.sender, output);
            if (mode == 6) {
                (bool ok,) = payable(msg.sender).call{value: amount - spent}("");
                require(ok);
            }
        }
        if (mode == 4) control.roundTrip();
        if (mode == 8) {
            DroidSwapAccountLab caller = DroidSwapAccountLab(payable(msg.sender));
            (bool ok,) = msg.sender.call(abi.encodeCall(caller.configurePolicy, (0, caller.nonce(), control.epoch())));
            reentryDenied = !ok;
            require(reentryDenied);
        }
        if (mode == 1) output++;
        if (mode != 7) require(output >= minimumOut);
    }
}

contract DroidKuruSwapLabTest {
    SwapVm private constant vm = SwapVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OWNER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);
    SwapControlLab private control;
    SwapTokenLab private token;
    SwapRouterLab private router;
    SwapMarketLab private market;
    DroidSwapAccountLab private account;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10 days);
        control = new SwapControlLab(OWNER);
        token = new SwapTokenLab();
        market = new SwapMarketLab();
        router = new SwapRouterLab(token, control, address(market));
        account = new DroidSwapAccountLab(
            IWrapperControlLab(address(control)), 11, address(router), address(market), address(token)
        );
        vm.deal(address(account), 1 ether);
        vm.deal(address(router), 10 ether);
        configure(0.99 ether);
    }

    function configure(uint256 reserve) private {
        uint256 n = account.nonce();
        uint256 e = control.epoch();
        vm.prank(control.owner());
        account.configurePolicy(reserve, n, e);
    }

    function request(bool buy, uint256 amount) private view returns (DroidSwapAccountLab.Request memory) {
        return DroidSwapAccountLab.Request(
            buy ? Adapter.Direction.USDC_TO_MON : Adapter.Direction.MON_TO_USDC,
            amount,
            1,
            account.nonce(),
            control.epoch(),
            uint64(block.timestamp + 60),
            keccak256("LOCAL simulation reference")
        );
    }

    function run(DroidSwapAccountLab.Request memory r, bool deny) private returns (uint256, uint256) {
        vm.prank(control.owner());
        if (deny) vm.expectRevert();
        return account.swap(r);
    }

    function testBuyThenSellMeasuresActualAccountDeltasAndClearsAllowance() public {
        (uint256 spent, uint256 output) = run(request(false, 0.001 ether), false);
        require(spent == 0.001 ether && output == 20 && token.balanceOf(address(account)) == 20);
        uint256 beforeBalance = address(account).balance;
        (spent, output) = run(request(true, 20), false);
        require(
            spent == 20 && address(account).balance == beforeBalance + output && token.balanceOf(address(account)) == 0
        );
        require(token.allowance(address(account), address(router)) == 0);
        require(account.dailyActions(block.timestamp / 1 days) == 2);
    }

    function testFuzzReserveCannotBeSpent(uint96 rawReserve) public {
        uint256 reserve = uint256(rawReserve) % 1 ether;
        configure(reserve);
        DroidSwapAccountLab.Request memory r = request(false, 0.001 ether);
        bool deny = 1 ether - reserve < r.amountIn;
        run(r, deny);
        require(address(account).balance >= reserve);
    }

    function testWrongOwnerAndTransferInvalidatePolicyAndPreparation() public {
        DroidSwapAccountLab.Request memory old = request(false, 0.001 ether);
        vm.prank(OTHER);
        vm.expectRevert();
        account.swap(old);
        control.setOwner(OTHER);
        vm.prank(OWNER);
        vm.expectRevert();
        account.swap(old);
        run(request(false, 0.001 ether), true);
        configure(0.99 ether);
        run(request(false, 0.001 ether), false);
        control.setOwner(OWNER);
        run(old, true);
        run(request(false, 0.001 ether), true);
    }

    function testRoundTripAndUnwrapRevokePolicy() public {
        control.roundTrip();
        run(request(false, 0.001 ether), true);
        configure(0.99 ether);
        control.unwrap();
        run(request(false, 0.001 ether), true);
        vm.prank(OWNER);
        account.recover(true, payable(OWNER), 1);
    }

    function testNonceReplayAndOwnerRecoveryInvalidatePreparation() public {
        DroidSwapAccountLab.Request memory r = request(false, 0.001 ether);
        run(r, false);
        run(r, true);
        r = request(false, 0.001 ether);
        vm.prank(OWNER);
        account.recover(true, payable(OWNER), 1);
        run(r, true);
    }

    function testExpiredMissingEvidenceZeroMinimumAndOversizedInputDenied() public {
        DroidSwapAccountLab.Request memory r = request(false, 0.001 ether);
        r.deadline = uint64(block.timestamp);
        run(r, true);
        r.deadline = uint64(block.timestamp + 121);
        run(r, true);
        r = request(false, 0.001 ether);
        r.simulationReference = 0;
        run(r, true);
        r = request(false, 0.001 ether);
        r.minimumOut = 0;
        run(r, true);
        run(request(false, 0.001 ether + 1), true);
        run(request(true, 1001), true);
        run(request(false, 0), true);
    }

    function testDailyCapsPersistAcrossPolicyReplacementAndResetNextDay() public {
        run(request(false, 0.001 ether), false);
        configure(0.99 ether);
        run(request(false, 0.001 ether), false);
        configure(0.99 ether);
        run(request(false, 0.001 ether), false);
        run(request(false, 0.001 ether), true);
        vm.warp(block.timestamp + 1 days);
        run(request(false, 0.001 ether), false);
    }

    function testPartialFillRefundsRemainInAccountAndBudgetUsesRequestedInput() public {
        router.setMode(6);
        (uint256 spent,) = run(request(false, 0.001 ether), false);
        require(spent == 0.0005 ether && account.dailyNativeInput(block.timestamp / 1 days) == 0.001 ether);
        (spent,) = run(request(true, 10), false);
        require(
            spent == 5 && token.balanceOf(address(account)) == 5
                && token.allowance(address(account), address(router)) == 0
        );
    }

    function testFuzzBadRouterEffectsAndEpochCallbackRollBack(uint8 rawMode) public {
        uint256 mode = uint256(rawMode) % 4 + 1;
        router.setMode(mode);
        uint256 n = account.nonce();
        run(request(false, 0.001 ether), true);
        require(address(account).balance == 1 ether && token.balanceOf(address(account)) == 0);
        require(account.nonce() == n && account.dailyActions(block.timestamp / 1 days) == 0 && control.epoch() == 1);
    }

    function testUnexpectedApprovalSpendAndCleanupFailureRollBack() public {
        token.mint(address(account), 100);
        router.setMode(5);
        run(request(true, 20), true);
        router.setMode(0);
        token.setFailReset(true);
        run(request(true, 20), true);
        require(token.balanceOf(address(account)) == 100 && token.allowance(address(account), address(router)) == 0);
    }

    function testSellBadEffectsRestoreTokensAllowanceNonceAndBudgets() public {
        token.mint(address(account), 100);
        uint256[4] memory modes = [uint256(1), 2, 4, 5];
        uint256 n = account.nonce();
        for (uint256 i; i < modes.length; ++i) {
            router.setMode(modes[i]);
            run(request(true, 20), true);
            require(token.balanceOf(address(account)) == 100 && address(account).balance == 1 ether);
            require(token.allowance(address(account), address(router)) == 0 && account.nonce() == n);
            require(account.dailyActions(block.timestamp / 1 days) == 0);
        }
    }

    function testContractOwnerCannotReenterPolicyDuringSwap() public {
        control.setOwner(address(router));
        configure(0.99 ether);
        router.setMode(8);
        run(request(false, 0.001 ether), false);
        require(router.reentryDenied() && account.reserveWei() == 0.99 ether);
    }

    function testAccountStaysWithinStandardCodeAndInitcodeLimits() public view {
        require(address(account).code.length <= 24576);
        require(type(DroidSwapAccountLab).creationCode.length + 160 <= 49152);
    }

    function testInsufficientReserveAndBalanceDenied() public {
        configure(1 ether);
        run(request(false, 0.001 ether), true);
        run(request(true, 20), true);
    }

    function testRouterIgnoringMinimumIsStillDenied() public {
        router.setMode(7);
        DroidSwapAccountLab.Request memory r = request(false, 0.001 ether);
        r.minimumOut = 21;
        run(r, true);
    }

    function testChangedCodeAndWrongChainDenied() public {
        vm.etch(address(router), hex"60006000");
        run(request(false, 0.001 ether), true);
        vm.chainId(143);
        run(request(false, 0.001 ether), true);
        vm.expectRevert();
        new DroidSwapAccountLab(
            IWrapperControlLab(address(control)), 11, address(router), address(market), address(token)
        );
    }

    function testUnknownSelectorAndAttachedValueCannotExecute() public {
        vm.prank(OWNER);
        (bool ok,) =
            address(account).call(abi.encodeWithSignature("execute(address,bytes,uint256)", address(router), hex"", 1));
        require(!ok);
        vm.deal(OWNER, 1 ether);
        DroidSwapAccountLab.Request memory r = request(false, 0.001 ether);
        vm.prank(OWNER);
        (ok,) = address(account).call{value: 1}(abi.encodeCall(account.swap, (r)));
        require(!ok);
    }
}
