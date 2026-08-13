// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORBlockhashCanary } from "../src/HoodYOORBlockhashCanary.sol";

interface BlockhashCanaryVm {
    function roll(uint256 newHeight) external;
    function setBlockhash(uint256 blockNumber, bytes32 blockHash) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 selector) external;
}

contract HoodYOORBlockhashCanaryTest {
    BlockhashCanaryVm private constant VM =
        BlockhashCanaryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testRecordsTheSameDelayedBlockhashUsedByReveal() public {
        HoodYOORBlockhashCanary canary = new HoodYOORBlockhashCanary();
        uint256 target = canary.targetBlock();
        require(target == canary.requestBlock() + 64, "64-block delay");

        VM.expectRevert(
            abi.encodeWithSelector(HoodYOORBlockhashCanary.ObservationTooEarly.selector, target + 1)
        );
        canary.observe();

        bytes32 expected = keccak256("public-chain-canary-target");
        VM.roll(target + 1);
        VM.setBlockhash(target, expected);
        require(canary.observe() == expected, "observed hash");
        require(canary.validated(), "validated");
        require(canary.observedBlockHash() == expected, "stored hash");

        VM.expectRevert(HoodYOORBlockhashCanary.AlreadyObserved.selector);
        canary.observe();
    }

    function testRejectsAnExpiredObservation() public {
        HoodYOORBlockhashCanary canary = new HoodYOORBlockhashCanary();
        uint256 target = canary.targetBlock();
        VM.roll(target + canary.HASH_WINDOW() + 1);
        VM.expectRevert(
            abi.encodeWithSelector(HoodYOORBlockhashCanary.ObservationExpired.selector, target)
        );
        canary.observe();
    }
}
