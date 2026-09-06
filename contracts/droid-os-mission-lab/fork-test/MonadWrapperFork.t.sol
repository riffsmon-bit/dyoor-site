// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DroidControlReceiptLab, IWrappedParentLab} from "../src/wrapper/DroidControlReceiptLab.sol";
import {WrappedMissionAccountLab} from "../src/wrapper/WrappedMissionAccountLab.sol";
import {DroidMissionAccountCoreLab} from "../src/DroidMissionAccountCoreLab.sol";
import {MissionMintLab} from "../src/MissionFixtures.sol";

interface Vm {
    function chainId(uint256) external;
    function prank(address) external;
    function deal(address, uint256) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}
interface LiveParent is IWrappedParentLab {
    function approve(address, uint256) external;
    function safeTransferFrom(address, address, uint256, bytes calldata) external;
}
interface LegacyAccount { function owner() external view returns (address); }

/// @dev Negative-test-only operator; not a deployable application adapter.
contract UnlistedPullProbe {
    function pull(LiveParent parent, address from) external { parent.safeTransferFrom(from, address(this), 11); }
}

/// @dev Read-only public fork; all writes stay in Forge's local VM. The VM chain
/// ID is explicitly switched to 31337 for lab contracts, NOT a live chain-143 deployment test.
contract MonadWrapperForkTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant S2 = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    address private constant V1 = 0x6B7E71B10EE63bbA4c460e80C7569EaF3Fb129Cd;
    address private constant B = address(0xB0B);
    address private constant RUNNER = address(0xA6E17);
    bytes32 private constant S2_HASH = 0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd;
    event log_named_address(string label, address value);

    function testRealValidatorRejectsApprovedUnlistedPullOperator() public {
        require(block.chainid == 143 && S2.codehash == S2_HASH, "PINNED_MONAD_FORK_REQUIRED");
        LiveParent parent = LiveParent(S2); address owner = parent.ownerOf(11);
        UnlistedPullProbe probe = new UnlistedPullProbe();
        vm.prank(owner); parent.approve(address(probe), 11);
        vm.expectRevert(bytes4(0x1de5204e)); probe.pull(parent, owner);
        require(parent.ownerOf(11) == owner);
    }

    function testRealS2WrapReceiptMissionRoundTripUnwrapAndV1Isolation() public {
        require(block.chainid == 143 && S2.codehash == S2_HASH, "PINNED_MONAD_FORK_REQUIRED");
        LiveParent parent = LiveParent(S2);
        address owner = parent.ownerOf(11);
        bytes32 metadata = keccak256(bytes(parent.tokenURI(11)));
        uint256 v1Balance = V1.balance; bytes32 v1Code = V1.codehash;
        require(LegacyAccount(V1).owner() == owner);
        vm.chainId(31337);
        MissionMintLab minter = new MissionMintLab();
        DroidControlReceiptLab wrapper = new DroidControlReceiptLab(IWrappedParentLab(S2), minter);
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(owner); parent.safeTransferFrom(owner, address(wrapper), 11, intent);
        WrappedMissionAccountLab account = WrappedMissionAccountLab(payable(wrapper.accounts(11)));
        require(parent.ownerOf(11) == address(wrapper) && wrapper.ownerOf(11) == owner);
        require(keccak256(bytes(wrapper.tokenURI(11))) == metadata);
        // Existing V1 resolves the wrapper, NOT receipt owner, on its original chain.
        vm.chainId(143);
        emit log_named_address("legacy_v1_owner_while_wrapped", LegacyAccount(V1).owner());
        require(LegacyAccount(V1).owner() == address(wrapper));
        vm.chainId(31337);
        DroidMissionAccountCoreLab.Limits memory l = DroidMissionAccountCoreLab.Limits(
            RUNNER, uint64(block.timestamp), uint64(block.timestamp + 1 hours), 2, 2, 0, keccak256("LOCAL fork free mint")
        );
        vm.prank(owner); account.launch(l, 0, 1);
        vm.prank(RUNNER); account.executeFreeMint(1, 1, uint64(block.timestamp + 60), bytes32(uint256(1)));
        require(minter.ownerOf(1) == address(account));
        vm.prank(owner); wrapper.transferFrom(owner, B, 11);
        vm.prank(B); wrapper.transferFrom(B, owner, 11);
        vm.prank(RUNNER); vm.expectRevert(); account.executeFreeMint(1, 2, uint64(block.timestamp + 60), bytes32(uint256(1)));
        vm.prank(owner); vm.expectRevert(); wrapper.unwrap(11);
        vm.prank(owner); account.withdrawMint(owner, 1);
        vm.prank(owner); wrapper.unwrap(11);
        require(parent.ownerOf(11) == owner && !wrapper.isWrapped(11));
        vm.prank(owner); parent.safeTransferFrom(owner, address(wrapper), 11, intent);
        address sameAccount = wrapper.accounts(11); require(sameAccount == address(account));
        vm.prank(RUNNER); vm.expectRevert(); account.executeFreeMint(1, 3, uint64(block.timestamp + 60), bytes32(uint256(1)));
        vm.prank(owner); wrapper.unwrap(11);
        vm.chainId(143);
        require(LegacyAccount(V1).owner() == owner && V1.balance == v1Balance && V1.codehash == v1Code);
        require(keccak256(bytes(parent.tokenURI(11))) == metadata);
    }
}
