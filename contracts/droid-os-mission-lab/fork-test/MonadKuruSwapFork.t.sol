// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import { DroidBoundedSwapCoreLab } from "../src/swap/DroidBoundedSwapCoreLab.sol";
import { KuruMonUsdcAdapterLab as Adapter } from "../src/swap/KuruMonUsdcAdapterLab.sol";
import {
    DroidControlReceiptLab,
    IWrappedParentLab
} from "../src/wrapper/DroidControlReceiptLab.sol";
import { WrappedMissionAccountLab } from "../src/wrapper/WrappedMissionAccountLab.sol";
import { DroidMissionAccountCoreLab } from "../src/DroidMissionAccountCoreLab.sol";
import { MissionMintLab } from "../src/MissionFixtures.sol";
import { IERC20 } from "@droid-oz/token/ERC20/IERC20.sol";

interface SwapForkVm {
    function chainId(uint256) external;
    function prank(address) external;
    function deal(address, uint256) external;
    function expectRevert() external;
    function load(address, bytes32) external view returns (bytes32);
    function store(address, bytes32, bytes32) external;
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
}

interface SwapParent is IWrappedParentLab {
    function safeTransferFrom(address, address, uint256, bytes calldata) external;
}

/// @notice Explicit public reads; every swap/custody write is in a disposable fork.
/// VM chain changed to 31337; not a public deployment or a production-ready wallet.
contract MonadKuruSwapForkTest {
    SwapForkVm private constant vm =
        SwapForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant S2 = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    address private constant ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;
    address private constant MARKET = 0x065C9d28E428A0db40191a54d33d5b7c71a9C394;
    address private constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    bytes32 private constant SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant PROXY_HASH =
        0xb3fcfca704395c210e969b841f35fff7483f99721de8d65b219615dd5e03f43b;
    address private owner;
    DroidControlReceiptLab private wrapper;
    WrappedMissionAccountLab private account;
    MissionMintLab private minter;
    event log_named_uint(string label, uint256 value);

    function checkPinnedVenue() public view {
        require(ROUTER.codehash == PROXY_HASH && MARKET.codehash == PROXY_HASH);
        address routerImpl = address(uint160(uint256(vm.load(ROUTER, SLOT))));
        address marketImpl = address(uint160(uint256(vm.load(MARKET, SLOT))));
        require(routerImpl == address(0xf1635175914acF4Db170395D524323225e1F1a04));
        require(marketImpl == address(0x5e3446c600524Be453bbCEFD46a9E4C9bE8899a0));
        require(
            routerImpl.codehash
                == 0xee2c47d70994c70feea9e7ae98ce9810e0f1893f377b7d949f2b6ec6f0cc53dc
        );
        require(
            marketImpl.codehash
                == 0x6576ced90ca537c9aa058ea4a54ab5edd802ab78b834168b21fcc6d9ac392c0c
        );
        require(USDC.codehash == 0xbb3557cf62a26950fb58073e6ce8e130af371e5aa13e5584856a1ce2ca47dc89);
    }

    function setUp() public {
        require(block.chainid == 143 && block.number == 102612438, "PINNED_FORK_ONLY");
        checkPinnedVenue();
        require(S2.codehash == 0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd);
        owner = SwapParent(S2).ownerOf(11);
        vm.chainId(31337);
        minter = new MissionMintLab();
        wrapper = new DroidControlReceiptLab(
            IWrappedParentLab(S2),
            minter,
            Adapter.Venue(ROUTER, MARKET, USDC, ROUTER.codehash, MARKET.codehash, USDC.codehash)
        );
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(owner);
        SwapParent(S2).safeTransferFrom(owner, address(wrapper), 11, intent);
        account = WrappedMissionAccountLab(payable(wrapper.accounts(11)));
        vm.deal(address(account), 0.01 ether);
        vm.prank(owner);
        account.configureSwapPolicy(0.009 ether, 0, 1);
    }

    function request(bool buy, uint256 amount, uint256 minimum)
        private
        view
        returns (DroidBoundedSwapCoreLab.SwapRequest memory)
    {
        return DroidBoundedSwapCoreLab.SwapRequest(
            buy ? Adapter.Direction.USDC_TO_MON : Adapter.Direction.MON_TO_USDC,
            amount,
            minimum,
            account.actionNonce(),
            wrapper.ownershipEpoch(11),
            uint64(block.timestamp + 60),
            keccak256("LOCAL full account fork simulation")
        );
    }

    function testRealRouteBuySellFromAccountClearsApprovalsAndPreservesReserve() public {
        uint256 snapshot = vm.snapshotState();
        DroidBoundedSwapCoreLab.SwapRequest memory quoteRequest = request(false, 0.001 ether, 1);
        vm.prank(owner);
        (, uint256 quoted) = account.swap(quoteRequest);
        require(vm.revertToState(snapshot));
        uint256 minimum = (quoted * 99 + 99) / 100;
        DroidBoundedSwapCoreLab.SwapRequest memory buy = request(false, 0.001 ether, minimum);
        vm.prank(owner);
        (uint256 nativeSpent, uint256 received) = account.swap(buy);
        require(
            IERC20(USDC).balanceOf(address(account)) == received
                && address(account).balance >= 0.009 ether
        );
        emit log_named_uint("native_spent_wei", nativeSpent);
        emit log_named_uint("usdc_received_atomic", received);
        vm.prank(owner);
        vm.expectRevert();
        account.swap(buy);
        snapshot = vm.snapshotState();
        DroidBoundedSwapCoreLab.SwapRequest memory sell = request(true, received, 1);
        vm.prank(owner);
        (, quoted) = account.swap(sell);
        require(vm.revertToState(snapshot));
        minimum = (quoted * 99 + 99) / 100;
        sell = request(true, received, minimum);
        uint256 nativeBefore = address(account).balance;
        vm.prank(owner);
        (uint256 tokenSpent, uint256 nativeReceived) = account.swap(sell);
        require(address(account).balance == nativeBefore + nativeReceived);
        require(IERC20(USDC).balanceOf(address(account)) == received - tokenSpent);
        require(IERC20(USDC).allowance(address(account), ROUTER) == 0);
        emit log_named_uint("usdc_sold_atomic", tokenSpent);
        emit log_named_uint("native_received_wei", nativeReceived);
    }

    function testRealSwapBadMinimumRevertsBalancesNonceAndCaps() public {
        DroidBoundedSwapCoreLab.SwapRequest memory r =
            request(false, 0.001 ether, type(uint256).max);
        vm.prank(owner);
        vm.expectRevert();
        account.swap(r);
        require(
            address(account).balance == 0.01 ether && account.actionNonce() == 1
                && account.dailySwapActions(block.timestamp / 1 days) == 0
        );
        require(IERC20(USDC).allowance(address(account), ROUTER) == 0);
    }

    function testRealReceiptRoundTripInvalidatesSwapPolicy() public {
        DroidBoundedSwapCoreLab.SwapRequest memory r = request(false, 0.001 ether, 1);
        vm.prank(owner);
        wrapper.transferFrom(owner, address(0xB0B), 11);
        vm.prank(address(0xB0B));
        wrapper.transferFrom(address(0xB0B), owner, 11);
        vm.prank(owner);
        vm.expectRevert();
        account.swap(r);
        r = request(false, 0.001 ether, 1);
        vm.prank(owner);
        vm.expectRevert();
        account.swap(r);
    }

    function testProxyRuntimeAloneDoesNotDetectUpgrade() public {
        vm.store(ROUTER, SLOT, bytes32(uint256(uint160(MARKET))));
        require(ROUTER.codehash == PROXY_HASH); // Explicit unsolved on-chain inspection boundary.
        vm.expectRevert();
        this.checkPinnedVenue();
    }

    function testCanonicalAccountTradesMintsAndExitsAllSupportedAssets() public {
        require(wrapper.accounts(11) == address(account));
        DroidBoundedSwapCoreLab.SwapRequest memory buy = request(false, 0.001 ether, 27);
        vm.prank(owner);
        account.swap(buy);
        DroidMissionAccountCoreLab.Limits memory limits = DroidMissionAccountCoreLab.Limits(
            address(0xA6E17),
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            1,
            1,
            0.009 ether,
            keccak256("CANONICAL local mission")
        );
        vm.prank(owner);
        account.launch(limits, 2, 1);
        vm.prank(address(0xA6E17));
        uint256 mintedId =
            account.executeFreeMint(1, 3, uint64(block.timestamp + 60), bytes32(uint256(1)));
        require(minter.ownerOf(mintedId) == address(account));
        uint256 ownerNative = owner.balance;
        uint256 ownerToken = IERC20(USDC).balanceOf(owner);
        uint256 accountNative = address(account).balance;
        uint256 accountToken = IERC20(USDC).balanceOf(address(account));
        uint256[] memory ids = new uint256[](1);
        ids[0] = mintedId;
        vm.prank(owner);
        account.exitToOwner(ids, 4, 1);
        require(SwapParent(S2).ownerOf(11) == owner && !wrapper.isWrapped(11));
        require(owner.balance == ownerNative + accountNative);
        require(IERC20(USDC).balanceOf(owner) == ownerToken + accountToken);
        require(minter.ownerOf(mintedId) == owner && account.knownAssetsEmpty());
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(owner);
        SwapParent(S2).safeTransferFrom(owner, address(wrapper), 11, intent);
        require(wrapper.accounts(11) == address(account) && wrapper.ownershipEpoch(11) == 3);
        require(account.dailySwapActions(block.timestamp / 1 days) == 1);
        require(account.swapPolicyOwner() == address(0) && account.actionNonce() == 5);
    }
}
