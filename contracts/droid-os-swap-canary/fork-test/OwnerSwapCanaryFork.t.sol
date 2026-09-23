// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import { DroidOwnerSwapCanary, ISwapCanaryParent } from "../src/DroidOwnerSwapCanary.sol";
import { IERC20 } from "@droid-oz/token/ERC20/IERC20.sol";

interface CanaryForkVm {
    function prank(address) external;
    function deal(address, uint256) external;
    function expectRevert() external;
    function store(address, bytes32, bytes32) external;
}

contract OwnerSwapCanaryForkTest {
    CanaryForkVm private constant vm =
        CanaryForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant S2 = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    address private constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address private constant ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;
    address private constant V1 = 0x6B7E71B10EE63bbA4c460e80C7569EaF3Fb129Cd;
    address private owner;
    DroidOwnerSwapCanary private account;

    function setUp() public {
        require(block.chainid == 143 && block.number == 102612438, "PINNED_LOCAL_FORK");
        owner = ISwapCanaryParent(S2).ownerOf(11);
        vm.prank(owner);
        account = new DroidOwnerSwapCanary();
        vm.deal(owner, owner.balance + 0.0011 ether);
        vm.prank(owner);
        (bool ok,) = address(account).call{ value: 0.0011 ether }("");
        require(ok);
    }

    function testRealRouteRoundTripAndRecoveryWithoutMovingOriginalOrV1Funds() public {
        uint256 v1Balance = V1.balance;
        vm.prank(owner);
        uint256 bought =
            account.buy(0.001 ether, 27, 0, uint64(block.timestamp + 60), bytes32(uint256(1)));
        require(bought == 27 && IERC20(USDC).balanceOf(address(account)) == 27);
        vm.prank(owner);
        uint256 received =
            account.sell(0.00099 ether, 1, uint64(block.timestamp + 60), bytes32(uint256(2)));
        require(received == 998114600000000 && address(account).balance == 0.0001 ether + received);
        require(IERC20(USDC).allowance(address(account), ROUTER) == 0);
        vm.prank(owner);
        account.recoverNative(2, uint64(block.timestamp + 60));
        require(address(account).balance == 0 && account.phase() == 3);
        require(ISwapCanaryParent(S2).ownerOf(11) == owner && V1.balance == v1Balance);
    }

    function testUSDCImplementationChangeIsDetectedAndNativeRecoveryStillWorks() public {
        vm.store(
            USDC,
            keccak256("org.zeppelinos.proxy.implementation"),
            bytes32(uint256(uint160(ROUTER)))
        );
        vm.prank(owner);
        vm.expectRevert();
        account.buy(0.001 ether, 1, 0, uint64(block.timestamp + 60), bytes32(uint256(1)));
        vm.prank(owner);
        account.recoverNative(0, uint64(block.timestamp + 60));
        require(address(account).balance == 0);
    }

    function testNonOwnerCannotDeployOrTrade() public {
        vm.expectRevert();
        new DroidOwnerSwapCanary();
        vm.expectRevert();
        account.buy(1, 1, 0, uint64(block.timestamp + 60), bytes32(uint256(1)));
    }

    function testKuruProxyUpgradeRaceRemainsAnExplicitLimitation() public {
        vm.store(
            ROUTER,
            0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,
            bytes32(uint256(uint160(USDC)))
        );
        // Constructor cannot inspect Kuru's foreign implementation slot. This is
        // evidence of the limitation, NOT permission to claim upgrade-safe execution.
        vm.prank(owner);
        DroidOwnerSwapCanary other = new DroidOwnerSwapCanary();
        require(address(other).code.length > 0);
    }
}
