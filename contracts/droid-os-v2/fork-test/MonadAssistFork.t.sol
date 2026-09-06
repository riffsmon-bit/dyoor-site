// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidAssistCanaryRegistry} from "../src/DroidAssistCanaryRegistry.sol";
import {DroidAssistAccountCandidate} from "../src/DroidAssistAccountCandidate.sol";
import {DroidAssistBadge} from "../src/DroidAssistBadge.sol";
import {DroidCustodyCandidate} from "../src/DroidCustodyCandidate.sol";
import {LiveParent, ForkVm} from "./MonadCustodyFork.t.sol";

contract MonadAssistForkTest {
    ForkVm private constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    LiveParent private constant S2 = LiveParent(0x349D8eb480c92cF75371fbA5C6344A4d11b9103A);
    address private constant V1 = 0x6B7E71B10EE63bbA4c460e80C7569EaF3Fb129Cd;

    function testAssistOptInMintTransferAndWithdrawRealDroid() public {
        require(block.chainid == 143, "MAINNET_FORK_REQUIRED");
        address owner = S2.ownerOf(11);
        address nextOwner = address(0xB0B);
        uint256 legacyBalance = V1.balance;
        bytes32 metadata = keccak256(bytes(S2.tokenURI(11)));
        DroidAssistCanaryRegistry registry = new DroidAssistCanaryRegistry();
        vm.prank(nextOwner);
        vm.expectRevert(DroidAssistCanaryRegistry.NotOwner.selector);
        registry.optIn();
        vm.prank(owner);
        DroidAssistAccountCandidate account = DroidAssistAccountCandidate(payable(registry.optIn()));
        require(address(account) == registry.predictAccount() && address(account) != V1);
        vm.prank(owner);
        require(registry.optIn() == address(account));
        DroidAssistBadge badge = registry.badge();
        vm.prank(nextOwner);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.mintCanary(0, uint64(block.timestamp + 120), bytes32(uint256(1)));
        // No account prefunding is necessary: mint value is zero, owner pays transaction gas.
        vm.prank(owner);
        uint256 id = account.mintCanary(0, uint64(block.timestamp + 120), bytes32(uint256(1)));
        require(badge.ownerOf(id) == address(account) && address(account).balance == 0);
        vm.prank(owner);
        S2.transferFrom(owner, nextOwner, 11);
        vm.prank(owner);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.withdrawERC721(address(badge), owner, id);
        vm.prank(nextOwner);
        account.withdrawERC721(address(badge), nextOwner, id);
        require(badge.ownerOf(id) == nextOwner && account.actionNonce() == 2);
        require(V1.balance == legacyBalance && keccak256(bytes(S2.tokenURI(11))) == metadata);
    }
}
