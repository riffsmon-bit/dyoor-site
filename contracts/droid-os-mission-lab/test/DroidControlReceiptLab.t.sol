// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@droid-oz/token/ERC721/ERC721.sol";
import {MissionMintLab} from "../src/MissionFixtures.sol";
import {DroidMissionAccountCoreLab} from "../src/DroidMissionAccountCoreLab.sol";
import {DroidControlReceiptLab, IWrappedParentLab} from "../src/wrapper/DroidControlReceiptLab.sol";
import {WrappedMissionAccountLab} from "../src/wrapper/WrappedMissionAccountLab.sol";
import {WrappedAccountFactoryLab} from "../src/wrapper/WrappedAccountFactoryLab.sol";

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
        wrapper = new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter);
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
        new DroidControlReceiptLab(IWrappedParentLab(address(parent)), minter);
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
    }

    function testDustDepositCanBlockSeparateExitDocumentedReleaseBlocker() public {
        wrap();
        vm.deal(B, 1);
        vm.prank(B);
        (bool funded,) = address(account).call{value: 1}("");
        require(funded);
        vm.prank(A);
        vm.expectRevert();
        wrapper.unwrap(11);
        require(parent.ownerOf(11) == address(wrapper));
        // Production needs bounded atomic recovery/exit; repeated third-party dust
        // can grief a separate drain-then-unwrap sequence. No safety claim here.
    }
}
