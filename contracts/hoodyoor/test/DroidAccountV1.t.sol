// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DroidAccountV1 } from "../src/droid/DroidAccountV1.sol";
import { DroidAccountRegistry } from "../src/droid/DroidAccountRegistry.sol";
import {
    IDroidAccountBatch,
    IERC1271,
    IERC165,
    IERC6551Account,
    IERC6551Executable,
    IERC721Receiver,
    IERC1155Receiver
} from "../src/droid/interfaces/IDroidAccount.sol";
import { IERC6551Registry } from "../src/droid/interfaces/IERC6551Registry.sol";

interface DroidAccountVm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

/// @dev Exact ERC-6551 reference registry algorithm used to exercise the canonical proxy layout.
contract ERC6551RegistryHarness is IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        assembly {
            pop(chainId)
            calldatacopy(0x8c, 0x24, 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3)
            mstore(0x5d, implementation)
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73)
            mstore(0x35, keccak256(0x55, 0xb7))
            mstore(0x15, salt)
            mstore(0x01, shl(96, address()))
            mstore8(0x00, 0xff)
            let computed := keccak256(0x00, 0x55)

            if iszero(extcodesize(computed)) {
                let deployed := create2(0, 0x55, 0xb7, salt)
                if iszero(deployed) {
                    mstore(0x00, 0x20188a59)
                    revert(0x1c, 0x04)
                }
                mstore(0x6c, deployed)
                log4(
                    0x6c,
                    0x60,
                    0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722,
                    implementation,
                    tokenContract,
                    tokenId
                )
                return(0x6c, 0x20)
            }

            mstore(0x00, shr(96, shl(96, computed)))
            return(0x00, 0x20)
        }
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address) {
        assembly {
            pop(chainId)
            pop(tokenContract)
            pop(tokenId)
            calldatacopy(0x8c, 0x24, 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3)
            mstore(0x5d, implementation)
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73)
            mstore(0x35, keccak256(0x55, 0xb7))
            mstore(0x15, salt)
            mstore(0x01, shl(96, address()))
            mstore8(0x00, 0xff)
            mstore(0x00, shr(96, shl(96, keccak256(0x00, 0x55))))
            return(0x00, 0x20)
        }
    }
}

contract MockDroidNFT {
    mapping(uint256 tokenId => address) private _owners;
    mapping(uint256 tokenId => address) private _approvals;
    mapping(address owner => uint256) public balanceOf;

    error NotAuthorized();
    error IncorrectOwner();
    error InvalidRecipient();

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function mint(address to, uint256 tokenId) external {
        if (to == address(0) || _owners[tokenId] != address(0)) revert InvalidRecipient();
        _owners[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "missing token");
    }

    function approve(address approved, uint256 tokenId) external {
        if (msg.sender != _owners[tokenId]) revert NotAuthorized();
        _approvals[tokenId] = approved;
    }

    function burn(uint256 tokenId) external {
        address tokenOwner = _owners[tokenId];
        if (msg.sender != tokenOwner) revert NotAuthorized();
        delete _approvals[tokenId];
        delete _owners[tokenId];
        balanceOf[tokenOwner] -= 1;
        emit Transfer(tokenOwner, address(0), tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner != from) revert IncorrectOwner();
        if (msg.sender != tokenOwner && msg.sender != _approvals[tokenId]) revert NotAuthorized();
        if (to == address(0)) revert InvalidRecipient();
        delete _approvals[tokenId];
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            bytes4 result = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data);
            require(result == IERC721Receiver.onERC721Received.selector, "unsafe receiver");
        }
    }
}

contract MockERC20Asset {
    mapping(address account => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockERC1155Asset {
    mapping(uint256 id => mapping(address account => uint256)) public balanceOf;

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[id][to] += amount;
        if (to.code.length != 0) {
            bytes4 result =
                IERC1155Receiver(to).onERC1155Received(msg.sender, address(0), id, amount, "");
            require(result == IERC1155Receiver.onERC1155Received.selector, "unsafe receiver");
        }
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount) external {
        require(msg.sender == from, "not owner");
        require(balanceOf[id][from] >= amount, "balance");
        balanceOf[id][from] -= amount;
        balanceOf[id][to] += amount;
        if (to.code.length != 0) {
            bytes4 result = IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, "");
            require(result == IERC1155Receiver.onERC1155Received.selector, "unsafe receiver");
        }
    }
}

contract CallTarget {
    error TargetFailure(uint256 code);

    uint256 public number;

    function add(uint256 amount) external returns (uint256) {
        number += amount;
        return number;
    }

    function fail(uint256 code) external pure {
        revert TargetFailure(code);
    }
}

contract ReentrantTarget {
    DroidAccountV1 public immutable account;
    bool public reentryBlocked;

    constructor(DroidAccountV1 account_) {
        account = account_;
    }

    function attack() external {
        (bool success,) = address(account)
            .call(
                abi.encodeCall(
                    account.execute, (address(this), 0, abi.encodeCall(this.noop, ()), 0)
                )
            );
        reentryBlocked = !success;
    }

    function noop() external { }
}

contract MockERC1271Owner {
    bytes32 public acceptedDigest;
    bytes32 public acceptedSignatureHash;

    function configure(bytes32 digest, bytes calldata signature) external {
        acceptedDigest = digest;
        acceptedSignatureHash = keccak256(signature);
    }

    function isValidSignature(bytes32 digest, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (digest == acceptedDigest && keccak256(signature) == acceptedSignatureHash) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }
}

contract DroidAccountV1Test {
    DroidAccountVm private constant VM =
        DroidAccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ALICE_KEY = 0xA11CE;
    uint256 private constant BOB_KEY = 0xB0B;
    uint256 private constant TOKEN_ID = 420;
    bytes32 private constant ACCOUNT_SALT = bytes32(0);

    address private alice;
    address private bob;
    address private recipient = address(0xCAFE);

    ERC6551RegistryHarness private canonicalRegistry;
    MockDroidNFT private collection;
    DroidAccountV1 private implementation;
    DroidAccountRegistry private activationRegistry;

    function setUp() public {
        alice = VM.addr(ALICE_KEY);
        bob = VM.addr(BOB_KEY);
        canonicalRegistry = new ERC6551RegistryHarness();
        collection = new MockDroidNFT();
        implementation = new DroidAccountV1();
        activationRegistry = new DroidAccountRegistry(
            address(canonicalRegistry),
            address(collection),
            address(implementation),
            block.chainid,
            ACCOUNT_SALT
        );
        collection.mint(alice, TOKEN_ID);
    }

    function testCounterfactualAddressDeploymentAndBinding() public {
        address predicted = activationRegistry.account(TOKEN_ID);
        require(predicted.code.length == 0, "account deployed too early");
        VM.deal(predicted, 0.75 ether);

        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        require(address(account) == predicted, "wrong deterministic account");
        require(predicted.code.length != 0, "account not deployed");
        require(predicted.balance == 0.75 ether, "counterfactual funds lost");

        (uint256 chainId, address tokenContract, uint256 tokenId) = account.token();
        require(chainId == block.chainid, "wrong chain binding");
        require(tokenContract == address(collection), "wrong collection binding");
        require(tokenId == TOKEN_ID, "wrong token binding");
        require(account.owner() == alice, "wrong owner");
    }

    function testDuplicateActivationIsIdempotent() public {
        DroidAccountV1 first = _activate(TOKEN_ID, alice);
        bytes32 runtimeHash = address(first).codehash;
        VM.prank(alice);
        address second = activationRegistry.createAccount(TOKEN_ID);
        require(second == address(first), "duplicate address");
        require(second.codehash == runtimeHash, "duplicate changed code");
    }

    function testCanonicalRegistryCanHarmlesslyPredeploy() public {
        address predicted = activationRegistry.account(TOKEN_ID);
        VM.prank(bob);
        address deployed = canonicalRegistry.createAccount(
            address(implementation), ACCOUNT_SALT, block.chainid, address(collection), TOKEN_ID
        );
        require(deployed == predicted, "predeployment mismatch");
        require(DroidAccountV1(payable(deployed)).owner() == alice, "predeployer gained control");
        VM.prank(alice);
        require(activationRegistry.createAccount(TOKEN_ID) == predicted, "facade mismatch");
    }

    function testActivationRejectsNonOwnerMissingTokenAndWrongConfiguration() public {
        VM.expectRevert(
            abi.encodeWithSelector(DroidAccountRegistry.NotTokenOwner.selector, bob, alice)
        );
        VM.prank(bob);
        activationRegistry.createAccount(TOKEN_ID);

        VM.expectRevert(
            abi.encodeWithSelector(DroidAccountRegistry.TokenDoesNotExist.selector, 999)
        );
        VM.prank(alice);
        activationRegistry.createAccount(999);

        VM.expectRevert(DroidAccountRegistry.InvalidConfiguration.selector);
        activationRegistry.account(
            address(implementation),
            bytes32(uint256(1)),
            block.chainid,
            address(collection),
            TOKEN_ID
        );
    }

    function testImplementationRejectsDirectUse() public {
        VM.expectRevert(DroidAccountV1.DirectImplementationCall.selector);
        implementation.token();

        VM.expectRevert(DroidAccountV1.DirectImplementationCall.selector);
        implementation.execute(recipient, 0, "", 0);

        require(
            implementation.isValidSignature(keccak256("direct"), "") == bytes4(0),
            "implementation signature valid"
        );
    }

    function testReceivesAndOwnerWithdrawsETH() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        VM.deal(alice, 2 ether);
        VM.prank(alice);
        (bool funded,) = address(account).call{ value: 1 ether }("");
        require(funded, "ETH deposit failed");
        require(address(account).balance == 1 ether, "ETH not received");
        require(account.state() == 1, "receive state");

        uint256 beforeBalance = recipient.balance;
        VM.prank(alice);
        account.execute(recipient, 0.4 ether, "", 0);
        require(recipient.balance == beforeBalance + 0.4 ether, "ETH withdrawal failed");
        require(address(account).balance == 0.6 ether, "wrong account balance");
        require(account.state() == 2, "execute state");
    }

    function testReceivesAndOwnerWithdrawsERC20() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        MockERC20Asset token = new MockERC20Asset();
        token.mint(address(account), 1_000);

        VM.prank(alice);
        account.execute(address(token), 0, abi.encodeCall(token.transfer, (recipient, 375)), 0);
        require(token.balanceOf(recipient) == 375, "ERC20 recipient balance");
        require(token.balanceOf(address(account)) == 625, "ERC20 account balance");
    }

    function testReceivesAndOwnerWithdrawsERC721() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        MockDroidNFT equipment = new MockDroidNFT();
        equipment.mint(alice, 7);
        VM.prank(alice);
        equipment.safeTransferFrom(alice, address(account), 7);
        require(equipment.ownerOf(7) == address(account), "ERC721 not received");

        VM.prank(alice);
        account.execute(
            address(equipment),
            0,
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256)", address(account), recipient, 7
            ),
            0
        );
        require(equipment.ownerOf(7) == recipient, "ERC721 not withdrawn");
    }

    function testReceivesAndOwnerWithdrawsERC1155() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        MockERC1155Asset equipment = new MockERC1155Asset();
        equipment.mint(address(account), 9, 4);
        require(equipment.balanceOf(9, address(account)) == 4, "ERC1155 not received");

        VM.prank(alice);
        account.execute(
            address(equipment),
            0,
            abi.encodeCall(equipment.safeTransferFrom, (address(account), recipient, 9, 3)),
            0
        );
        require(equipment.balanceOf(9, recipient) == 3, "ERC1155 not withdrawn");
        require(equipment.balanceOf(9, address(account)) == 1, "ERC1155 remainder");
    }

    function testUnauthorizedExecutionFails() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        VM.expectRevert(abi.encodeWithSelector(DroidAccountV1.NotAuthorized.selector, bob, alice));
        VM.prank(bob);
        account.execute(recipient, 0, "", 0);
    }

    function testOwnershipTransferImmediatelyChangesExecutionAuthority() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        CallTarget target = new CallTarget();
        VM.prank(alice);
        account.execute(address(target), 0, abi.encodeCall(target.add, (1)), 0);

        VM.prank(alice);
        collection.transferFrom(alice, bob, TOKEN_ID);
        require(account.owner() == bob, "Bob not current owner");

        VM.expectRevert(abi.encodeWithSelector(DroidAccountV1.NotAuthorized.selector, alice, bob));
        VM.prank(alice);
        account.execute(address(target), 0, abi.encodeCall(target.add, (10)), 0);

        VM.prank(bob);
        account.execute(address(target), 0, abi.encodeCall(target.add, (2)), 0);
        require(target.number() == 3, "Bob execution failed");
    }

    function testOwnershipTransferImmediatelyInvalidatesOldSignature() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        bytes32 digest = keccak256("DROID ACCOUNT AUTHORIZATION");
        bytes memory aliceSignature = _signature(ALICE_KEY, digest);
        require(
            account.isValidSignature(digest, aliceSignature) == IERC1271.isValidSignature.selector,
            "Alice signature invalid before transfer"
        );
        require(
            account.isValidSigner(alice, "") == IERC6551Account.isValidSigner.selector,
            "Alice signer invalid before transfer"
        );

        VM.prank(alice);
        collection.transferFrom(alice, bob, TOKEN_ID);
        require(
            account.isValidSignature(digest, aliceSignature) == bytes4(0), "old signature valid"
        );
        require(account.isValidSigner(alice, "") == bytes4(0), "old signer valid");
        require(
            account.isValidSignature(digest, _signature(BOB_KEY, digest))
                == IERC1271.isValidSignature.selector,
            "Bob signature invalid"
        );
    }

    function testParentBurnFailsClosedAndLeavesNoStaleAuthority() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        VM.deal(address(account), 0.5 ether);

        VM.prank(alice);
        collection.burn(TOKEN_ID);

        require(account.owner() == address(0), "burned parent exposed owner");
        require(account.isValidSigner(alice, "") == bytes4(0), "burned signer valid");
        require(
            account.isValidSignature(keccak256("burned"), _signature(ALICE_KEY, keccak256("burned")))
                == bytes4(0),
            "burned signature valid"
        );

        VM.expectRevert(
            abi.encodeWithSelector(DroidAccountV1.NotAuthorized.selector, alice, address(0))
        );
        VM.prank(alice);
        account.execute(recipient, 0.5 ether, "", 0);
        require(address(account).balance == 0.5 ether, "burned account funds moved");

        VM.expectRevert(
            abi.encodeWithSelector(DroidAccountRegistry.TokenDoesNotExist.selector, TOKEN_ID)
        );
        VM.prank(alice);
        activationRegistry.createAccount(TOKEN_ID);
    }

    function testERC1271SmartContractOwnerSignature() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        MockERC1271Owner smartOwner = new MockERC1271Owner();
        bytes32 digest = keccak256("SMART OWNER");
        bytes memory signature = hex"123456";
        smartOwner.configure(digest, signature);
        VM.prank(alice);
        collection.transferFrom(alice, address(smartOwner), TOKEN_ID);
        require(account.owner() == address(smartOwner), "smart owner missing");
        require(
            account.isValidSignature(digest, signature) == IERC1271.isValidSignature.selector,
            "ERC1271 signature invalid"
        );
        require(account.isValidSignature(digest, hex"00") == bytes4(0), "bad signature valid");
    }

    function testBatchExecutionIsAtomicAndBounded() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        CallTarget target = new CallTarget();
        IDroidAccountBatch.Call[] memory calls = new IDroidAccountBatch.Call[](2);
        calls[0] = IDroidAccountBatch.Call({
            to: address(target), value: 0, data: abi.encodeCall(target.add, (2))
        });
        calls[1] = IDroidAccountBatch.Call({
            to: address(target), value: 0, data: abi.encodeCall(target.add, (3))
        });
        VM.prank(alice);
        account.executeBatch(calls);
        require(target.number() == 5, "batch result");
        require(account.state() == 1, "batch state");

        IDroidAccountBatch.Call[] memory failing = new IDroidAccountBatch.Call[](2);
        failing[0] = IDroidAccountBatch.Call({
            to: address(target), value: 0, data: abi.encodeCall(target.add, (10))
        });
        failing[1] = IDroidAccountBatch.Call({
            to: address(target), value: 0, data: abi.encodeCall(target.fail, (7))
        });
        VM.expectRevert(abi.encodeWithSelector(CallTarget.TargetFailure.selector, 7));
        VM.prank(alice);
        account.executeBatch(failing);
        require(target.number() == 5, "failed batch was not atomic");
        require(account.state() == 1, "failed batch changed state");

        VM.expectRevert(DroidAccountV1.EmptyBatch.selector);
        VM.prank(alice);
        account.executeBatch(new IDroidAccountBatch.Call[](0));

        IDroidAccountBatch.Call[] memory oversized = new IDroidAccountBatch.Call[](33);
        VM.expectRevert(abi.encodeWithSelector(DroidAccountV1.BatchTooLarge.selector, 33, 32));
        VM.prank(alice);
        account.executeBatch(oversized);
    }

    function testTargetFailureBubblesAndUnsupportedOperationsRevert() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        CallTarget target = new CallTarget();
        VM.expectRevert(abi.encodeWithSelector(CallTarget.TargetFailure.selector, 99));
        VM.prank(alice);
        account.execute(address(target), 0, abi.encodeCall(target.fail, (99)), 0);

        VM.expectRevert(
            abi.encodeWithSelector(DroidAccountV1.UnsupportedOperation.selector, uint8(1))
        );
        VM.prank(alice);
        account.execute(address(target), 0, "", 1);
    }

    function testMaliciousReentryCannotAcquireOwnerAuthority() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        ReentrantTarget target = new ReentrantTarget(account);
        VM.prank(alice);
        account.execute(address(target), 0, abi.encodeCall(target.attack, ()), 0);
        require(target.reentryBlocked(), "reentry unexpectedly authorized");
    }

    function testSafeDroidNestingAndAccountSelfTransferAreRejected() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        collection.mint(alice, 421);

        VM.expectRevert(
            abi.encodeWithSelector(
                DroidAccountV1.ControllingCollectionNesting.selector, address(collection), 421
            )
        );
        VM.prank(alice);
        collection.safeTransferFrom(alice, address(account), 421);
        require(collection.ownerOf(421) == alice, "safe nesting changed owner");

        VM.prank(alice);
        collection.approve(address(account), TOKEN_ID);
        bytes memory selfTransfer =
            abi.encodeCall(collection.transferFrom, (alice, address(account), TOKEN_ID));
        VM.expectRevert(
            abi.encodeWithSelector(DroidAccountV1.ControllingTokenSelfTransfer.selector, TOKEN_ID)
        );
        VM.prank(alice);
        account.execute(address(collection), 0, selfTransfer, 0);
        require(collection.ownerOf(TOKEN_ID) == alice, "self transfer changed owner");
    }

    function testRawERC721TransferBypassesReceiverButFailsClosed() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        // Existing ERC-721 transferFrom has no receiver hook. The account can only fail closed after
        // a user deliberately bypasses safeTransferFrom; the production UI never offers this path.
        VM.prank(alice);
        collection.transferFrom(alice, address(account), TOKEN_ID);
        require(collection.ownerOf(TOKEN_ID) == address(account), "raw transfer did not occur");
        require(account.owner() == address(0), "self-owned account exposed authority");
        require(account.isValidSigner(address(account), "") == bytes4(0), "cycle signer valid");
    }

    function testTwoAccountOwnershipCycleFailsClosedWithoutRecursion() public {
        collection.mint(alice, 421);
        DroidAccountV1 account420 = _activate(TOKEN_ID, alice);
        DroidAccountV1 account421 = _activate(421, alice);

        VM.prank(alice);
        collection.transferFrom(alice, address(account421), TOKEN_ID);
        require(account420.owner() == address(account421), "nested owner missing");

        VM.prank(alice);
        collection.transferFrom(alice, address(account420), 421);
        require(account420.owner() == address(0), "cycle A did not fail closed");
        require(account421.owner() == address(0), "cycle B did not fail closed");
    }

    function testAdvertisesRequiredInterfaces() public {
        DroidAccountV1 account = _activate(TOKEN_ID, alice);
        require(account.supportsInterface(type(IERC165).interfaceId), "ERC165");
        require(account.supportsInterface(type(IERC1271).interfaceId), "ERC1271");
        require(account.supportsInterface(type(IERC6551Account).interfaceId), "ERC6551 account");
        require(account.supportsInterface(type(IERC6551Executable).interfaceId), "ERC6551 execute");
        require(account.supportsInterface(type(IDroidAccountBatch).interfaceId), "batch");
        require(account.supportsInterface(type(IERC721Receiver).interfaceId), "ERC721 receiver");
        require(account.supportsInterface(type(IERC1155Receiver).interfaceId), "ERC1155 receiver");
        require(!account.supportsInterface(0xffffffff), "invalid interface");
    }

    function _activate(uint256 tokenId, address tokenOwner)
        private
        returns (DroidAccountV1 account)
    {
        VM.prank(tokenOwner);
        account = DroidAccountV1(payable(activationRegistry.createAccount(tokenId)));
    }

    function _signature(uint256 privateKey, bytes32 digest)
        private
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
