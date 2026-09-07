// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidCustodyCandidate, IDroidParent} from "../src/DroidCustodyCandidate.sol";
import {DroidOptInRegistryCandidate} from "../src/DroidOptInRegistryCandidate.sol";

interface ForkVm {
    function prank(address) external;
    function deal(address, uint256) external;
    function expectRevert(bytes4) external;
}

interface LiveParent is IDroidParent {
    function transferFrom(address from, address to, uint256 id) external;
    function tokenURI(uint256 id) external view returns (string memory);
}

/// @dev forge test fork only. No broadcast script, private key or public write RPC.
contract MonadCustodyForkTest {
    event log_named_uint(string key, uint256 value);
    event log_named_address(string key, address value);
    ForkVm private constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    LiveParent private constant S2 = LiveParent(0x349D8eb480c92cF75371fbA5C6344A4d11b9103A);
    address private constant V1 = 0x6B7E71B10EE63bbA4c460e80C7569EaF3Fb129Cd;

    function testRealSeason2OptInTransferCustodyAndV1Isolation() public {
        require(block.chainid == 143 && address(S2).code.length > 0 && V1.code.length > 0, "MAINNET_FORK_REQUIRED");
        address owner = S2.ownerOf(11);
        emit log_named_uint("read_only_mainnet_fork_block", block.number);
        emit log_named_address("canonical_owner_11_at_fork", owner);
        address nextOwner = address(0xB0B);
        uint256 oldBalance = V1.balance;
        bytes32 oldCode = V1.codehash;
        bytes32 metadataHash = keccak256(bytes(S2.tokenURI(11)));
        DroidOptInRegistryCandidate registry = new DroidOptInRegistryCandidate();
        vm.prank(owner);
        DroidCustodyCandidate account = DroidCustodyCandidate(payable(registry.optIn(11)));
        require(address(account) != V1 && account.currentOwner() == owner);
        vm.deal(address(account), 100);
        vm.prank(owner);
        account.withdrawNative(payable(owner), 1);
        vm.prank(owner);
        S2.transferFrom(owner, nextOwner, 11);
        vm.prank(owner);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.withdrawNative(payable(owner), 1);
        vm.prank(nextOwner);
        account.withdrawNative(payable(nextOwner), 1);
        vm.prank(nextOwner);
        S2.transferFrom(nextOwner, owner, 11);
        require(account.currentOwner() == owner && account.actionNonce() == 2);
        require(address(account).balance == 98 && registry.accounts(11) == address(account));
        require(V1.balance == oldBalance && V1.codehash == oldCode, "V1_CHANGED");
        require(keccak256(bytes(S2.tokenURI(11))) == metadataHash, "METADATA_CHANGED");
        (bool grantOk,) = address(account).call(abi.encodeWithSignature("executeMint(uint256)", 0));
        require(!grantOk, "DELEGATION_ENABLED");
    }
}
