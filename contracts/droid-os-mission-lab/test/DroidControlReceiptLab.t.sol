// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@droid-oz/token/ERC721/ERC721.sol";
import {MissionMintLab} from "../src/MissionFixtures.sol";
import {DroidMissionAccountCoreLab} from "../src/DroidMissionAccountCoreLab.sol";
import {DroidControlReceiptLab, IWrappedParentLab} from "../src/wrapper/DroidControlReceiptLab.sol";
import {WrappedMissionAccountLab} from "../src/wrapper/WrappedMissionAccountLab.sol";
import {WrappedAccountFactoryLab} from "../src/wrapper/WrappedAccountFactoryLab.sol";
import {KuruMonUsdcAdapterLab as Adapter} from "../src/swap/KuruMonUsdcAdapterLab.sol";

interface WrapperVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function deal(address, uint256) external;
    function etch(address, bytes calldata) external;
}

/// @dev Legacy-shaped NFT: deliberately NO ownershipEpoch getter.
contract LegacyParentLab is ERC721 {
    string public liveURI = "https://example.invalid/metadata/11-v1";
    constructor() ERC721("LOCAL Legacy Parent", "LOCAL") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function burn(uint256 id) external {
        require(ownerOf(id) == msg.sender);
        _burn(id);
    }

    function setURI(string calldata uri) external {
        liveURI = uri;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireMinted(id);
        return liveURI;
    }
}

contract WrapperCallbackProbe {
    LegacyParentLab public parent;
    DroidControlReceiptLab public wrapper;
    bool public nestedWrap;
    bool public nestedUnwrap;
    bool public readAuthority;
    bool public rejectReceipt;
    bool public rejectParent;

    constructor(LegacyParentLab p, DroidControlReceiptLab w) {
        parent = p;
        wrapper = w;
    }

    function configure(bool receipt, bool original) external {
        rejectReceipt = receipt;
        rejectParent = original;
    }

    function wrap() external {
        parent.safeTransferFrom(address(this), address(wrapper), 11, abi.encode(wrapper.WRAP_INTENT()));
    }

    function unwrap() external {
        wrapper.unwrap(11);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if ((msg.sender == address(wrapper) && rejectReceipt) || (msg.sender == address(parent) && rejectParent)) {
            revert();
        }
        (nestedWrap,) = address(wrapper)
            .call(
                abi.encodeCall(
                    wrapper.onERC721Received, (address(this), address(this), 11, abi.encode(wrapper.WRAP_INTENT()))
                )
            );
        (nestedUnwrap,) = address(wrapper).call(abi.encodeCall(wrapper.unwrap, (11)));
        (readAuthority,) = address(wrapper).staticcall(abi.encodeCall(wrapper.controlOf, (11)));
        return this.onERC721Received.selector;
    }
}

contract RecoveryTokenLab {
    mapping(address => uint256) public balanceOf;
    bool public fail;
    DroidControlReceiptLab public callbackWrapper;

    function setCallback(DroidControlReceiptLab w) external {
        callbackWrapper = w;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        if (address(callbackWrapper) != address(0)) {
            address owner = callbackWrapper.ownerOf(11);
            callbackWrapper.transferFrom(owner, owner, 11);
        }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ExitReceiverLab {
    DroidControlReceiptLab public wrapper;
    address public parent;
    uint256 public mode;
    bool public reentered;

    constructor(DroidControlReceiptLab w, address p) {
        wrapper = w;
        parent = p;
    }

    function configure(uint256 m) external {
        mode = m;
    }

    receive() external payable {
        if (mode == 1) revert();
        if (mode == 2) wrapper.transferFrom(address(this), address(this), 11);
        if (mode == 4) {
            (bool ok,) = payable(msg.sender).call{value: 1}("");
            require(ok);
        }
        (reentered,) = msg.sender.call(abi.encodeCall(WrappedMissionAccountLab.exitToOwner, (new uint256[](0), 0, 0)));
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (mode == 3 && msg.sender == parent) revert();
        if (mode == 5 && msg.sender == address(wrapper.minter())) revert();
        return this.onERC721Received.selector;
    }
}

contract DroidControlReceiptLabTest {
    WrapperVm private constant vm = WrapperVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    address private constant RUNNER = address(0xA6E17);
    LegacyParentLab private parent;
    MissionMintLab private minter;
    DroidControlReceiptLab private wrapper;
    WrappedMissionAccountLab private account;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(10 days);
        parent = new LegacyParentLab();
        minter = new MissionMintLab();
        parent.mint(A, 11);
        wrapper = new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter, Adapter.disabledVenue());
    }

    function wrap() private {
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(A);
        parent.safeTransferFrom(A, address(wrapper), 11, intent);
        account = WrappedMissionAccountLab(payable(wrapper.accounts(11)));
    }

    function limits() private view returns (DroidMissionAccountCoreLab.Limits memory) {
        return DroidMissionAccountCoreLab.Limits(
            RUNNER,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            3,
            2,
            0,
            keccak256("LOCAL wrapped free mint")
        );
    }

    function launch(address owner) private {
        DroidMissionAccountCoreLab.Limits memory l = limits();
        uint256 nonce = account.actionNonce();
        uint256 epoch = wrapper.ownershipEpoch(11);
        vm.prank(owner);
        account.launch(l, nonce, epoch);
    }

    function execute(bool deny) private {
        uint256 id = account.missionId();
        uint256 nonce = account.actionNonce();
        vm.prank(RUNNER);
        if (deny) vm.expectRevert();
        account.executeFreeMint(id, nonce, uint64(block.timestamp + 60), keccak256("LOCAL simulation reference"));
    }

    function transfer(address from, address to) private {
        vm.prank(from);
        wrapper.transferFrom(from, to, 11);
    }

    function testWrapRequiresOwnerAndExplicitDepositIntentNotOperatorApproval() public {
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(B);
        vm.expectRevert();
        parent.safeTransferFrom(A, address(wrapper), 11, intent);
        vm.prank(A);
        vm.expectRevert();
        parent.safeTransferFrom(A, address(wrapper), 11, "wrong intent");
        vm.prank(A);
        parent.approve(B, 11);
        vm.prank(B);
        vm.expectRevert();
        parent.safeTransferFrom(A, address(wrapper), 11, intent);
        require(parent.ownerOf(11) == A);
        wrap();
        require(parent.ownerOf(11) == address(wrapper));
        require(wrapper.ownerOf(11) == A);
        (address owner, uint256 epoch, bool wrapped) = wrapper.controlOf(11);
        require(owner == A && epoch == 1 && wrapped);
    }

    function testFreeMintHeldByPersistentDroidAccount() public {
        wrap();
        launch(A);
        execute(false);
        require(minter.ownerOf(1) == address(account));
        require(address(wrapper).balance == 0);
    }

    function testMetadataReadThroughPreservesMutableURI() public {
        wrap();
        require(keccak256(bytes(wrapper.tokenURI(11))) == keccak256(bytes(parent.tokenURI(11))));
        parent.setURI("https://example.invalid/metadata/11-v8");
        require(keccak256(bytes(wrapper.tokenURI(11))) == keccak256(bytes(parent.tokenURI(11))));
    }

    function testReceiptTransferRevokesOldOwnerAndRunner() public {
        wrap();
        launch(A);
        execute(false);
        vm.deal(address(account), 5 ether);
        transfer(A, B);
        execute(true);
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
        vm.prank(A);
        vm.expectRevert();
        account.cancel();
        vm.prank(B);
        account.withdrawMint(B, 1);
        vm.prank(B);
        account.withdrawNative(payable(B), 1 ether);
        require(address(account).balance == 4 ether);
        require(minter.ownerOf(1) == B);
        launch(B);
        execute(false);
    }

    function testSameBlockRoundTripDoesNotReviveGrant() public {
        wrap();
        launch(A);
        transfer(A, B);
        transfer(B, A);
        execute(true);
        require(wrapper.ownershipEpoch(11) == 3);
        launch(A);
        execute(false);
    }

    function testFuzzRoundTripsNeverRevive(uint8 rounds) public {
        wrap();
        launch(A);
        uint256 count = uint256(rounds) % 12 + 1;
        for (uint256 i; i < count; ++i) {
            transfer(A, B);
            transfer(B, A);
        }
        require(wrapper.ownershipEpoch(11) == 1 + count * 2);
        execute(true);
    }

    function testSameOwnerTransferAlsoRevokes() public {
        wrap();
        launch(A);
        transfer(A, A);
        execute(true);
    }

    function testApprovedReceiptOperatorCannotWithdrawUnwrapOrLaunch() public {
        wrap();
        vm.prank(A);
        wrapper.approve(B, 11);
        vm.prank(B);
        vm.expectRevert();
        wrapper.unwrap(11);
        vm.prank(B);
        vm.expectRevert();
        account.withdrawNative(payable(B), 1);
        DroidMissionAccountCoreLab.Limits memory l = limits();
        vm.prank(B);
        vm.expectRevert();
        account.launch(l, 0, 1);
        vm.prank(B);
        wrapper.transferFrom(A, B, 11);
        launch(B);
        execute(false);
    }

    function testUnwrapReturnsOriginalDisablesMissionAndRewrapKeepsAccount() public {
        wrap();
        launch(A);
        address originalAccount = address(account);
        vm.prank(A);
        wrapper.unwrap(11);
        require(parent.ownerOf(11) == A);
        require(!wrapper.isWrapped(11));
        require(wrapper.ownershipEpoch(11) == 2);
        execute(true);
        DroidMissionAccountCoreLab.Limits memory l = limits();
        uint256 nonce = account.actionNonce();
        vm.prank(A);
        vm.expectRevert();
        account.launch(l, nonce, 2);
        wrap();
        require(address(account) == originalAccount);
        require(wrapper.ownershipEpoch(11) == 3);
        execute(true);
        launch(A);
        execute(false);
    }

    function testUnwrappedRawTransfersGiveFreshOwnerWithdrawalButNeverAutonomy() public {
        wrap();
        launch(A);
        vm.prank(A);
        wrapper.unwrap(11);
        vm.deal(address(account), 1 ether);
        vm.prank(A);
        parent.transferFrom(A, B, 11);
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
        vm.prank(B);
        account.withdrawNative(payable(B), 1 ether);
        execute(true);
        vm.prank(B);
        parent.transferFrom(B, A, 11);
        wrap();
        execute(true);
    }

    function testFundedUnwrapDeniedUntilSupportedAssetsWithdrawn() public {
        wrap();
        launch(A);
        execute(false);
        vm.deal(address(account), 1 ether);
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
        vm.prank(A);
        account.withdrawNative(payable(A), 1 ether);
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
        vm.prank(A);
        account.withdrawMint(A, 1);
        vm.prank(A);
        wrapper.unwrap(11);
        require(parent.ownerOf(11) == A);
    }

    function testParentCannotBurnWhileWrapped() public {
        wrap();
        vm.prank(A);
        vm.expectRevert();
        parent.burn(11);
        require(parent.ownerOf(11) == address(wrapper));
    }

    function testUnsupportedUnsafeDepositCannotBeClaimedByStranger() public {
        vm.prank(A);
        parent.transferFrom(A, address(wrapper), 11);
        vm.prank(B);
        vm.expectRevert();
        parent.safeTransferFrom(address(wrapper), B, 11);
        vm.prank(B);
        vm.expectRevert();
        wrapper.unwrap(11);
        require(wrapper.accounts(11) == address(0)); // Known unsafe-transfer recovery limitation.
    }

    function testUnsolicitedSafeDepositRejectedAtomically() public {
        vm.prank(A);
        vm.expectRevert();
        parent.safeTransferFrom(A, address(wrapper), 11);
        require(parent.ownerOf(11) == A);
        vm.expectRevert();
        wrapper.onERC721Received(address(wrapper), A, 11, "");
    }

    function testReceiptCannotBeSentToWrapperOrAnyKnownDroidAccount() public {
        wrap();
        vm.prank(A);
        vm.expectRevert();
        wrapper.transferFrom(A, address(wrapper), 11);
        vm.prank(A);
        vm.expectRevert();
        wrapper.transferFrom(A, address(account), 11);
        parent.mint(A, 12);
        bytes memory intent = abi.encode(wrapper.WRAP_INTENT());
        vm.prank(A);
        parent.safeTransferFrom(A, address(wrapper), 12, intent);
        address other = wrapper.accounts(12);
        vm.prank(A);
        vm.expectRevert();
        wrapper.transferFrom(A, other, 11);
    }

    function testReceiptBurnAndAdminSeizureHaveNoEntrypoint() public {
        wrap();
        vm.prank(A);
        (bool burned,) = address(wrapper).call(abi.encodeWithSignature("burn(uint256)", 11));
        require(!burned);
        (bool seized,) = address(wrapper).call(abi.encodeWithSignature("adminWithdraw(uint256,address)", 11, B));
        require(!seized);
    }

    function testFactoryCannotBeCalledByHolderOrRunner() public {
        address factory = wrapper.accountFactory();
        vm.prank(A);
        vm.expectRevert();
        WrappedAccountFactoryLab(factory).create(11, minter);
    }

    function testMissingCustodyOrChangedCodeFailsClosed() public {
        wrap();
        launch(A);
        vm.etch(address(parent), hex"00");
        execute(true);
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
    }

    function testNoMainnetDeploymentOrUse() public {
        wrap();
        vm.chainId(143);
        vm.expectRevert();
        new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter, Adapter.disabledVenue());
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
        execute(true);
    }

    function testMintAndUnwrapCallbacksCannotReenterOrReadTransitionalAuthority() public {
        WrapperCallbackProbe actor = new WrapperCallbackProbe(parent, wrapper);
        vm.prank(A);
        parent.transferFrom(A, address(actor), 11);
        actor.wrap();
        require(!actor.nestedWrap() && !actor.nestedUnwrap() && !actor.readAuthority());
        actor.unwrap();
        require(parent.ownerOf(11) == address(actor));
        require(!actor.nestedWrap() && !actor.nestedUnwrap() && !actor.readAuthority());
    }

    function testRejectedReceiptRollsBackParentDepositAndAccountCreation() public {
        WrapperCallbackProbe actor = new WrapperCallbackProbe(parent, wrapper);
        vm.prank(A);
        parent.transferFrom(A, address(actor), 11);
        actor.configure(true, false);
        vm.expectRevert();
        actor.wrap();
        require(parent.ownerOf(11) == address(actor));
        require(wrapper.accounts(11) == address(0));
        require(wrapper.ownershipEpoch(11) == 0);
    }

    function testRejectedOriginalReturnRollsBackReceiptBurn() public {
        WrapperCallbackProbe actor = new WrapperCallbackProbe(parent, wrapper);
        vm.prank(A);
        parent.transferFrom(A, address(actor), 11);
        actor.wrap();
        actor.configure(false, true);
        vm.expectRevert();
        actor.unwrap();
        require(parent.ownerOf(11) == address(wrapper));
        require(wrapper.ownerOf(11) == address(actor));
        require(wrapper.ownershipEpoch(11) == 1 && wrapper.isWrapped(11));
    }

    function testContractsStayWithinStandardCodeSize() public {
        wrap();
        require(address(wrapper).code.length <= 24576);
        require(wrapper.accountFactory().code.length <= 24576);
        require(address(account).code.length <= 24576);
        require(type(DroidControlReceiptLab).creationCode.length + 256 <= 49152);
        require(type(WrappedAccountFactoryLab).creationCode.length <= 49152);
        require(type(WrappedMissionAccountLab).creationCode.length + 96 <= 49152);
    }

    function testAtomicExitSweepsFrontRunDustAndReturnsOriginal() public {
        wrap();
        vm.deal(B, 1);
        vm.prank(B);
        (bool funded,) = address(account).call{value: 1}("");
        require(funded);
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
        require(parent.ownerOf(11) == address(wrapper));
        uint256 beforeBalance = A.balance;
        vm.prank(A);
        account.exitToOwner(new uint256[](0), 0, 1);
        require(parent.ownerOf(11) == A && !wrapper.isWrapped(11));
        require(A.balance == beforeBalance + 1 && address(account).balance == 0);
        require(wrapper.ownershipEpoch(11) == 2 && account.actionNonce() == 1);
    }

    function testAtomicExitRecoversMintsCancelsAndPreservesAccountOnRewrap() public {
        wrap();
        launch(A);
        execute(false);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.deal(address(account), 5 ether);
        uint256 nonce = account.actionNonce();
        vm.prank(A);
        account.exitToOwner(ids, nonce, 1);
        require(minter.ownerOf(1) == A && parent.ownerOf(11) == A);
        require(address(account).balance == 0);
        execute(true);
        address previous = address(account);
        wrap();
        require(address(account) == previous && wrapper.ownershipEpoch(11) == 3);
        execute(true);
        vm.prank(A);
        vm.expectRevert();
        account.exitToOwner(new uint256[](0), nonce, 1);
    }

    function testAtomicExitRejectsStaleNonceEpochRunnerAndOperator() public {
        wrap();
        launch(A);
        vm.prank(A);
        wrapper.approve(B, 11);
        vm.prank(B);
        vm.expectRevert();
        account.exitToOwner(new uint256[](0), 1, 1);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.exitToOwner(new uint256[](0), 1, 1);
        vm.prank(A);
        vm.expectRevert();
        account.exitToOwner(new uint256[](0), 0, 1);
        transfer(A, B);
        transfer(B, A);
        vm.prank(A);
        vm.expectRevert();
        account.exitToOwner(new uint256[](0), 1, 1);
        vm.prank(A);
        vm.expectRevert();
        wrapper.completeAccountExit(11, A, 3);
        vm.prank(RUNNER);
        vm.expectRevert();
        wrapper.completeAccountExit(11, RUNNER, 3);
        vm.prank(A);
        account.exitToOwner(new uint256[](0), 1, 3);
    }

    function testAtomicExitMissingOrDuplicateMintRevertsAllRecovery() public {
        wrap();
        launch(A);
        execute(false);
        execute(false);
        vm.deal(address(account), 1 ether);
        uint256 nonce = account.actionNonce();
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(A);
        vm.expectRevert();
        account.exitToOwner(ids, nonce, 1);
        require(minter.ownerOf(1) == address(account) && address(account).balance == 1 ether);
        ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;
        vm.prank(A);
        vm.expectRevert();
        account.exitToOwner(ids, nonce, 1);
        require(account.actionNonce() == nonce && wrapper.ownershipEpoch(11) == 1);
    }

    function testAtomicExitNativeReentrancyBlocked() public {
        ExitReceiverLab receiver = new ExitReceiverLab(wrapper, address(parent));
        wrap();
        transfer(A, address(receiver));
        vm.deal(address(account), 1 ether);
        vm.prank(address(receiver));
        account.exitToOwner(new uint256[](0), 0, 2);
        require(!receiver.reentered() && parent.ownerOf(11) == address(receiver));
    }

    function testFuzzAtomicExitCallbackFailureRollsBackEverything(uint8 rawMode) public {
        uint256 mode = uint256(rawMode) % 5 + 1;
        ExitReceiverLab receiver = new ExitReceiverLab(wrapper, address(parent));
        wrap();
        transfer(A, address(receiver));
        launch(address(receiver));
        execute(false);
        receiver.configure(mode);
        vm.deal(address(account), 1 ether);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(address(receiver));
        vm.expectRevert();
        account.exitToOwner(ids, 2, 2);
        require(parent.ownerOf(11) == address(wrapper) && wrapper.ownerOf(11) == address(receiver));
        require(wrapper.ownershipEpoch(11) == 2 && account.actionNonce() == 2);
        require(minter.ownerOf(1) == address(account) && address(account).balance == 1 ether);
        execute(false); // Failed exit did not silently cancel the live grant.
    }

    function testExplicitERC20RecoveryOnlyCurrentOwnerAndFalseReturnDenied() public {
        wrap();
        RecoveryTokenLab token = new RecoveryTokenLab();
        token.mint(address(account), 100);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.recoverERC20(address(token), RUNNER, 100);
        transfer(A, B);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC20(address(token), A, 100);
        token.setFail(true);
        vm.prank(B);
        vm.expectRevert();
        account.recoverERC20(address(token), B, 100);
        require(account.actionNonce() == 0);
        token.setFail(false);
        vm.prank(B);
        account.recoverERC20(address(token), B, 100);
        require(token.balanceOf(B) == 100 && token.balanceOf(address(account)) == 0);
    }

    function testUnsafeNFTRecoveryAndPostUnwrapRecoveryFollowCurrentOwner() public {
        wrap();
        LegacyParentLab other = new LegacyParentLab();
        other.mint(address(account), 99);
        vm.prank(RUNNER);
        vm.expectRevert();
        account.recoverERC721(address(other), RUNNER, 99);
        vm.prank(A);
        account.exitToOwner(new uint256[](0), 0, 1);
        // Unknown assets are NOT claimed absent on exit. The same account remains
        // recoverable by the fresh raw owner, provided the original still exists.
        vm.prank(A);
        parent.transferFrom(A, B, 11);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC721(address(other), A, 99);
        vm.prank(B);
        account.recoverERC721(address(other), B, 99);
        require(other.ownerOf(99) == B);
    }

    function testMaliciousRecoveryTokenCannotChangeAuthorityDuringWithdrawal() public {
        wrap();
        RecoveryTokenLab token = new RecoveryTokenLab();
        token.mint(address(account), 100);
        token.setCallback(wrapper);
        vm.prank(A);
        wrapper.approve(address(token), 11);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC20(address(token), A, 100);
        require(token.balanceOf(address(account)) == 100 && token.balanceOf(A) == 0);
        require(wrapper.ownershipEpoch(11) == 1 && account.actionNonce() == 0);
    }

    function testRecoveryRejectsNonContractsAndInvalidRecipients() public {
        wrap();
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC20(B, A, 1);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC721(address(wrapper), A, 11);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC20(address(minter), address(account), 1);
        vm.prank(A);
        vm.expectRevert();
        account.recoverERC721(address(minter), address(0), 1);
    }
}
