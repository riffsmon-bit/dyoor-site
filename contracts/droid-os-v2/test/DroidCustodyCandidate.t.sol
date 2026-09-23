// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidCustodyCandidate} from "../src/DroidCustodyCandidate.sol";
import {DroidOptInRegistryCandidate} from "../src/DroidOptInRegistryCandidate.sol";

interface Vm {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}

interface Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

// Deliberately no ownershipEpoch: mirrors the legacy interface limitation.
contract ParentFixture {
    mapping(uint256 => address) private owners;

    function setOwner(uint256 id, address owner) external {
        owners[id] = owner;
    }

    function ownerOf(uint256 id) external view returns (address) {
        require(owners[id] != address(0), "UNKNOWN_TOKEN");
        return owners[id];
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        require(msg.sender == from && owners[id] == from, "NOT_OWNER");
        owners[id] = to;
        if (to.code.length > 0) {
            require(
                Receiver(to).onERC721Received(msg.sender, from, id, "") == Receiver.onERC721Received.selector,
                "BAD_RECEIVER"
            );
        }
    }
}

contract TokenFixture {
    mapping(address => uint256) public balanceOf;
    uint8 public behavior;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setBehavior(uint8 value) external {
        behavior = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (behavior == 1) return false;
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (behavior == 2) assembly { return(0, 0) }
        if (behavior == 3) assembly { return(0, 1) }
        return true;
    }
}

contract OwnerActor {
    DroidCustodyCandidate public account;
    ParentFixture public parent;
    bool public reenter;
    bool public changeOwner;
    bool public nestedSucceeded;

    function configure(DroidCustodyCandidate wallet, ParentFixture nft, bool attack, bool transfer) external {
        account = wallet;
        parent = nft;
        reenter = attack;
        changeOwner = transfer;
    }

    function withdraw() external {
        account.withdrawNative(payable(address(this)), 1);
    }

    receive() external payable {
        if (reenter) {
            (nestedSucceeded,) =
                address(account).call(abi.encodeCall(account.withdrawNative, (payable(address(this)), 1)));
        }
        if (changeOwner) parent.setOwner(11, address(0xB0B));
    }
}

contract DroidCustodyCandidateTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant S2 = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    address private constant A = address(0xA11CE);
    address private constant B = address(0xB0B);
    ParentFixture private parent;
    DroidOptInRegistryCandidate private registry;
    DroidCustodyCandidate private account;

    function setUp() public {
        vm.chainId(143);
        ParentFixture template = new ParentFixture();
        vm.etch(S2, address(template).code);
        parent = ParentFixture(S2);
        parent.setOwner(11, A);
        parent.setOwner(16, A);
        registry = new DroidOptInRegistryCandidate();
        vm.prank(A);
        account = DroidCustodyCandidate(payable(registry.optIn(11)));
        vm.deal(address(account), 1 ether);
    }

    function testDeterministicOptInAndIdempotence() public {
        require(registry.predictAccount(11) == address(account));
        vm.prank(A);
        require(registry.optIn(11) == address(account));
        require(account.currentOwner() == A && account.tokenChainId() == 143);
        require(account.collection() == S2 && account.tokenId() == 11);
    }

    function testDistinctDroidsAndFactoryAddresses() public {
        require(registry.predictAccount(11) != registry.predictAccount(16));
        DroidOptInRegistryCandidate other = new DroidOptInRegistryCandidate();
        require(other.predictAccount(11) != address(account));
        require(registry.accounts(16) == address(0));
    }

    function testNonOwnerCannotOptInEvenAfterCreation() public {
        vm.prank(B);
        vm.expectRevert(DroidOptInRegistryCandidate.NotCurrentOwner.selector);
        registry.optIn(11);
    }

    function testUnknownTokenDenied() public {
        vm.expectRevert();
        registry.optIn(123456);
    }

    function testDirectFundingNoRegistryCustody() public {
        vm.deal(A, 10);
        vm.prank(A);
        (bool ok,) = address(account).call{value: 10}("");
        require(ok && address(account).balance == 1 ether + 10);
        require(address(registry).balance == 0);
    }

    function testNonOwnerWithdrawalDenied() public {
        vm.prank(B);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.withdrawNative(payable(B), 1);
    }

    function testTransferGivesNewOwnerControlAndKeepsWallet() public {
        vm.prank(A);
        account.withdrawNative(payable(A), 1);
        parent.setOwner(11, B);
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.withdrawNative(payable(A), 1);
        vm.prank(B);
        require(registry.optIn(11) == address(account));
        vm.prank(B);
        account.withdrawNative(payable(B), 2);
        require(account.actionNonce() == 2 && address(account).balance == 1 ether - 3);
    }

    function testRoundTripDoesNotCreateStoredExecutorAuthority() public {
        parent.setOwner(11, B);
        parent.setOwner(11, A);
        // A is legitimately the owner again; there are no stored signatures or grants to revive.
        vm.prank(A);
        account.withdrawNative(payable(A), 1);
        (bool ok,) = address(account).call(abi.encodeWithSignature("executeMint(uint256)", 0));
        require(!ok);
    }

    function testArbitraryExecutionAndSignaturesAbsent() public {
        vm.prank(A);
        (bool execOk,) = address(account).call(abi.encodeWithSignature("execute(address,uint256,bytes)", B, 1, hex""));
        (bool signatureOk,) =
            address(account).staticcall(abi.encodeWithSignature("isValidSignature(bytes32,bytes)", bytes32(0), hex""));
        (bool grantOk,) = address(account).call(abi.encodeWithSignature("setExecutor(address)", B));
        require(!execOk && !signatureOk && !grantOk);
    }

    function testWrongChainFailsClosed() public {
        vm.chainId(1);
        vm.expectRevert(DroidCustodyCandidate.InvalidIdentity.selector);
        account.currentOwner();
        vm.expectRevert(DroidOptInRegistryCandidate.InvalidChainOrCollection.selector);
        registry.optIn(11);
        vm.expectRevert(DroidOptInRegistryCandidate.InvalidChainOrCollection.selector);
        new DroidOptInRegistryCandidate();
    }

    function testChangedCollectionCodeFailsClosed() public {
        vm.etch(S2, hex"60006000fd");
        vm.expectRevert(DroidCustodyCandidate.InvalidIdentity.selector);
        account.currentOwner();
        vm.expectRevert(DroidOptInRegistryCandidate.InvalidChainOrCollection.selector);
        registry.optIn(11);
    }

    function testBurnFailsClosed() public {
        parent.setOwner(11, address(0));
        vm.prank(A);
        vm.expectRevert();
        account.withdrawNative(payable(A), 1);
        require(address(account).balance == 1 ether);
    }

    function testInvalidRecipientsAndInsufficientFunds() public {
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.InvalidRecipient.selector);
        account.withdrawNative(payable(address(0)), 1);
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.InvalidRecipient.selector);
        account.withdrawNative(payable(address(account)), 1);
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.TransferFailed.selector);
        account.withdrawNative(payable(A), 2 ether);
        require(account.actionNonce() == 0);
    }

    function testERC20WithdrawalAndNonReturningToken() public {
        TokenFixture asset = new TokenFixture();
        asset.mint(address(account), 100);
        vm.prank(A);
        account.withdrawERC20(address(asset), B, 10);
        asset.setBehavior(2);
        vm.prank(A);
        account.withdrawERC20(address(asset), B, 20);
        require(asset.balanceOf(B) == 30 && account.actionNonce() == 2);
    }

    function testFalseAndMalformedTokenResponsesRevert() public {
        TokenFixture asset = new TokenFixture();
        asset.mint(address(account), 100);
        asset.setBehavior(1);
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.TransferFailed.selector);
        account.withdrawERC20(address(asset), B, 10);
        asset.setBehavior(3);
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.TransferFailed.selector);
        account.withdrawERC20(address(asset), B, 10);
        require(asset.balanceOf(address(account)) == 100 && account.actionNonce() == 0);
    }

    function testNFTCustodyFollowsParentOwner() public {
        ParentFixture asset = new ParentFixture();
        asset.setOwner(9, address(account));
        parent.setOwner(11, B);
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        account.withdrawERC721(address(asset), A, 9);
        vm.prank(B);
        account.withdrawERC721(address(asset), B, 9);
        require(asset.ownerOf(9) == B);
    }

    function testSafeParentDepositRejected() public {
        vm.prank(A);
        vm.expectRevert(DroidCustodyCandidate.ParentCustodyForbidden.selector);
        parent.safeTransferFrom(A, address(account), 11);
        require(parent.ownerOf(11) == A);
    }

    function testUnsafeSelfOwnershipFailsClosed() public {
        parent.setOwner(11, address(account));
        vm.expectRevert(DroidCustodyCandidate.InvalidIdentity.selector);
        account.currentOwner();
    }

    function testContractOwnerAndReentrancy() public {
        OwnerActor actor = new OwnerActor();
        parent.setOwner(11, address(actor));
        actor.configure(account, parent, true, false);
        actor.withdraw();
        require(!actor.nestedSucceeded() && account.actionNonce() == 1);
    }

    function testTransferDuringWithdrawalRevertsAtomically() public {
        OwnerActor actor = new OwnerActor();
        parent.setOwner(11, address(actor));
        actor.configure(account, parent, false, true);
        vm.expectRevert(DroidCustodyCandidate.Unauthorized.selector);
        actor.withdraw();
        require(parent.ownerOf(11) == address(actor) && account.actionNonce() == 0);
    }

    function testFuzzOwnerWithdrawalAccounting(uint96 amount) public {
        vm.deal(address(account), uint256(amount));
        uint256 beforeBalance = B.balance;
        vm.prank(A);
        account.withdrawNative(payable(B), amount);
        require(address(account).balance == 0 && B.balance == beforeBalance + amount);
    }
}
