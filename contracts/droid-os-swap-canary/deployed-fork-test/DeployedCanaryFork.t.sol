// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DroidOwnerSwapCanary, ISwapCanaryParent} from "../src/DroidOwnerSwapCanary.sol";
import {IERC20} from "@droid-oz/token/ERC20/IERC20.sol";

interface DeployedVm {
    function prank(address) external;
    function deal(address, uint256) external;
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
    function expectRevert() external;
}

/// @notice Local VM only: starts from the actual deployed account, never redeploys it.
contract DeployedCanaryForkTest {
    DeployedVm private constant vm = DeployedVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    DroidOwnerSwapCanary private constant account = DroidOwnerSwapCanary(payable(0xac33a73b923ac2b711b5f2fbe175e2B63036F101));
    address private constant V1 = 0x6B7E71B10EE63bbA4c460e80C7569EaF3Fb129Cd;
    address private owner;

    function setUp() public {
        require(block.chainid == 143 && block.number == 102641082, "PINNED_LOCAL_FORK");
        require(address(account).codehash == 0xe5308ebb7ebed94e968c33333844f68d550e0a322b48b48807310546df2b3ec2);
        owner = account.currentOwner();
        require(account.phase() == 0 && account.actionNonce() == 0 && address(account).balance == 0);
    }

    function testActualDeployedAccountFundBuySellRecoverOnlyInFork() public {
        uint256 previousV1Balance = V1.balance;
        vm.deal(owner, owner.balance + 0.0011 ether);
        vm.prank(owner);
        (bool funded,) = address(account).call{value: 0.0011 ether}("");
        require(funded);
        uint256 snapshot = vm.snapshotState();
        vm.prank(owner);
        uint256 buyQuote = account.buy(0.001 ether, 1, 0, uint64(block.timestamp + 60), bytes32(uint256(1)));
        require(vm.revertToState(snapshot));
        vm.prank(owner);
        require(account.buy(0.001 ether, buyQuote, 0, uint64(block.timestamp + 60), bytes32(uint256(2))) == buyQuote);
        snapshot = vm.snapshotState();
        vm.prank(owner);
        uint256 sellQuote = account.sell(1, 1, uint64(block.timestamp + 60), bytes32(uint256(3)));
        require(vm.revertToState(snapshot));
        vm.prank(owner);
        require(account.sell(sellQuote, 1, uint64(block.timestamp + 60), bytes32(uint256(4))) == sellQuote);
        require(IERC20(account.USDC()).allowance(address(account), account.ROUTER()) == 0);
        require(address(account).balance >= account.PROTECTED_RESERVE());
        vm.prank(owner);
        account.recoverNative(2, uint64(block.timestamp + 60));
        vm.prank(owner);
        account.recoverUSDC(3, uint64(block.timestamp + 60));
        require(account.phase() == 3 && account.actionNonce() == 4 && address(account).balance == 0);
        require(IERC20(account.USDC()).balanceOf(address(account)) == 0);
        require(ISwapCanaryParent(account.COLLECTION()).ownerOf(11) == owner && V1.balance == previousV1Balance);
    }

    function testActualDeployedAccountDeniesNonOwnerAndRemainsUnfunded() public {
        vm.expectRevert();
        account.recoverNative(0, uint64(block.timestamp + 60));
        vm.expectRevert();
        account.buy(1, 1, 0, uint64(block.timestamp + 60), bytes32(uint256(1)));
        require(account.phase() == 0 && address(account).balance == 0);
    }
}
