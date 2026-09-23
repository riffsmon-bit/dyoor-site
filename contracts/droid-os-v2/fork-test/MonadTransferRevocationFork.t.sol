// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface RevocationVm {
    function prank(address) external;
    function expectRevert() external;
    function record() external;
    function accesses(address) external returns (bytes32[] memory reads, bytes32[] memory writes);
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
    function load(address, bytes32) external view returns (bytes32);
}

interface RevocationParent {
    function ownerOf(uint256) external view returns (address);
    function owner() external view returns (address);
    function transferFrom(address, address, uint256) external;
    function getTransferValidator() external view returns (address);
    function setTransferValidator(address) external;
    function getTransferValidationFunction() external view returns (bytes4, bool);
    function burn(uint256) external;
}

/// @dev DELIBERATELY INSUFFICIENT permission predicate used to reproduce the threat.
/// Test fixture only; not imported by src or exposed to any deployment tool.
contract AddressBoundGrantProbe {
    RevocationParent private immutable parent;
    address private immutable grantOwner;

    constructor(RevocationParent nft) {
        parent = nft;
        grantOwner = nft.ownerOf(11);
    }

    function appearsAuthorized() external view returns (bool) {
        return parent.ownerOf(11) == grantOwner;
    }
}

contract WritableEpochValidatorProbe {
    uint256 public epoch;

    function validateTransfer(address, address, address, uint256) external {
        epoch++;
    }
}

/// @notice Diagnostic regressions against real bytecode, not a claim revocation is solved.
/// All transfers, deployments and admin impersonation exist only in Forge's local fork VM.
contract MonadTransferRevocationForkTest {
    RevocationVm private constant vm = RevocationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    RevocationParent private constant S2 = RevocationParent(0x349D8eb480c92cF75371fbA5C6344A4d11b9103A);
    bytes32 private constant VERIFIED_RUNTIME = 0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd;
    address private constant B = address(0xB0B);
    event log_named_uint(string key, uint256 value);

    function setUp() public view {
        require(block.chainid == 143 && address(S2).codehash == VERIFIED_RUNTIME, "VERIFIED_MAINNET_FORK_REQUIRED");
    }

    function _roundTrip(address owner) private {
        vm.prank(owner);
        S2.transferFrom(owner, B, 11);
        vm.prank(B);
        S2.transferFrom(B, owner, 11);
    }

    function testOwnerAddressBoundPermissionRevivesAfterRealRoundTrip() public {
        address owner = S2.ownerOf(11);
        AddressBoundGrantProbe probe = new AddressBoundGrantProbe(S2);
        require(probe.appearsAuthorized());
        vm.prank(owner);
        S2.transferFrom(owner, B, 11);
        require(!probe.appearsAuthorized(), "OLD_OWNER_STILL_CURRENT");
        vm.prank(B);
        S2.transferFrom(B, owner, 11);
        require(probe.appearsAuthorized(), "EXPECTED_UNSAFE_REVIVAL_NOT_REPRODUCED");
    }

    function testSameTimestampRoundTripCanLeaveAllTouchedCollectionStorageIdentical() public {
        address owner = S2.ownerOf(11);
        // Normalize ERC721A's timestamp, adjacent-slot initialization and token approval.
        // A grant could be created after this legitimate earlier same-block transfer.
        _roundTrip(owner);
        uint256 snapshot = vm.snapshotState();
        vm.record();
        _roundTrip(owner);
        (, bytes32[] memory writtenSlots) = vm.accesses(address(S2));
        (, bytes32[] memory validatorWrites) = vm.accesses(S2.getTransferValidator());
        require(writtenSlots.length > 0 && validatorWrites.length == 0, "UNEXPECTED_TRANSFER_PATH");
        require(vm.revertToState(snapshot), "SNAPSHOT_FAILED");
        bytes32[] memory beforeValues = new bytes32[](writtenSlots.length);
        for (uint256 i; i < writtenSlots.length; i++) {
            beforeValues[i] = vm.load(address(S2), writtenSlots[i]);
        }
        _roundTrip(owner);
        for (uint256 i; i < writtenSlots.length; i++) {
            require(vm.load(address(S2), writtenSlots[i]) == beforeValues[i], "COLLECTION_STATE_CHANGED");
        }
        emit log_named_uint("identical_written_collection_slots_including_duplicates", writtenSlots.length);
        require(S2.ownerOf(11) == owner);
    }

    function testViewValidatorCannotRecordTransferEpoch() public {
        (, bool reportsView) = S2.getTransferValidationFunction();
        require(!reportsView, "EXPECTED_DESCRIPTOR_MISMATCH_CHANGED");
        WritableEpochValidatorProbe validator = new WritableEpochValidatorProbe();
        address owner = S2.ownerOf(11);
        // Local fork only: demonstrate why a new validator cannot just increment a nonce.
        vm.prank(S2.owner());
        S2.setTransferValidator(address(validator));
        vm.prank(owner);
        vm.expectRevert();
        S2.transferFrom{gas: 300_000}(owner, B, 11);
        require(validator.epoch() == 0 && S2.ownerOf(11) == owner, "STATICCALL_WROTE_STATE");
    }

    function testTransferValidatorDoesNotGuardParentBurn() public {
        WritableEpochValidatorProbe validator = new WritableEpochValidatorProbe();
        address owner = S2.ownerOf(11);
        vm.prank(S2.owner());
        S2.setTransferValidator(address(validator));
        vm.prank(owner);
        S2.burn(11);
        require(validator.epoch() == 0, "BURN_CALLED_VALIDATOR");
        vm.expectRevert();
        S2.ownerOf(11);
    }
}
