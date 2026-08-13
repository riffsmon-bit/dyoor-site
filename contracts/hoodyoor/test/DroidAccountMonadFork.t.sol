// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DroidAccountV1 } from "../src/droid/DroidAccountV1.sol";
import { DroidAccountRegistry } from "../src/droid/DroidAccountRegistry.sol";
import { IERC6551Registry } from "../src/droid/interfaces/IERC6551Registry.sol";

interface MonadDroidVm {
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function skip(bool skipTest) external;
}

interface IMonadDYOOR {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function totalMinted() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function metadataFrozen() external view returns (bool);
}

interface IMonadEnergyBank {
    function energyBalance(address account) external view returns (uint256);
}

/// @dev Reference registry algorithm used only inside the disposable fork.
contract MonadERC6551RegistryHarness is IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
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
            let computed := keccak256(0x00, 0x55)
            if iszero(extcodesize(computed)) {
                let deployed := create2(0, 0x55, 0xb7, salt)
                if iszero(deployed) { revert(0, 0) }
                mstore(0x6c, deployed)
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

contract MonadForkCallTarget {
    uint256 public value;

    function setValue(uint256 nextValue) external {
        value = nextValue;
    }
}

/// @dev Optional: run with `forge test --fork-url $MONAD_RPC_URL --match-contract DroidAccountMonadForkTest`.
contract DroidAccountMonadForkTest {
    MonadDroidVm private constant vm =
        MonadDroidVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant MONAD_CHAIN_ID = 143;
    uint256 private constant TOKEN_ID = 1;
    address private constant COLLECTION = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    address private constant S1_COLLECTION = 0x2C79c9E233fEa4b4DcFE6561D9209dc292cD932f;
    address private constant ASCENSION = 0xf9611226c1CcCcCa37951938d6f358D3d5106549;
    address private constant ENERGY_BANK = 0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767;
    address private constant CANONICAL_REGISTRY =
        0x000000006551c19487814612e58FE06813775758;
    bytes32 private constant CANONICAL_REGISTRY_RUNTIME_HASH =
        0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735;

    function testForkCollectionControllerTransferAndStakingBoundary() external {
        if (block.chainid != MONAD_CHAIN_ID) {
            vm.skip(true);
            return;
        }

        require(COLLECTION.code.length != 0, "Season 2 collection missing");
        require(S1_COLLECTION.code.length != 0, "Season 1 collection missing");
        require(ASCENSION.code.length != 0, "Ascension missing");
        require(ENERGY_BANK.code.length != 0, "Energy Bank missing");
        if (CANONICAL_REGISTRY.code.length != 0) {
            require(
                CANONICAL_REGISTRY.codehash == CANONICAL_REGISTRY_RUNTIME_HASH,
                "unexpected canonical registry code"
            );
        }

        IMonadDYOOR collection = IMonadDYOOR(COLLECTION);
        require(keccak256(bytes(collection.name())) == keccak256("D.Y.O.O.R"), "name");
        require(keccak256(bytes(collection.symbol())) == keccak256("DYOOR"), "symbol");
        require(collection.supportsInterface(0x80ac58cd), "not ERC721");
        require(collection.supportsInterface(0x5b5e139f), "no metadata");
        require(collection.maxSupply() == 3_333, "max supply");
        require(collection.totalMinted() >= collection.totalSupply(), "mint accounting");

        // Ascension custody is intentionally collection-specific. S2 is not staked there.
        require(collection.balanceOf(ASCENSION) == 0, "S2 unexpectedly held by Ascension");
        require(IMonadDYOOR(S1_COLLECTION).balanceOf(ASCENSION) > 0, "S1 custody absent");

        address originalOwner = collection.ownerOf(TOKEN_ID);
        bytes32 metadataBefore = keccak256(bytes(collection.tokenURI(TOKEN_ID)));
        uint256 energyBefore = IMonadEnergyBank(ENERGY_BANK).energyBalance(originalOwner);
        bool frozenBefore = collection.metadataFrozen();

        MonadERC6551RegistryHarness canonical = new MonadERC6551RegistryHarness();
        DroidAccountV1 implementation = new DroidAccountV1();
        DroidAccountRegistry registry = new DroidAccountRegistry(
            address(canonical), COLLECTION, address(implementation), MONAD_CHAIN_ID, bytes32(0)
        );

        vm.prank(originalOwner);
        DroidAccountV1 account = DroidAccountV1(payable(registry.createAccount(TOKEN_ID)));
        require(account.owner() == originalOwner, "S2 owner did not control account");
        (uint256 tokenChain, address tokenContract, uint256 tokenId) = account.token();
        require(tokenChain == MONAD_CHAIN_ID, "wrong chain binding");
        require(tokenContract == COLLECTION, "wrong collection binding");
        require(tokenId == TOKEN_ID, "wrong token binding");

        MonadForkCallTarget target = new MonadForkCallTarget();
        vm.prank(originalOwner);
        account.execute(address(target), 0, abi.encodeCall(target.setValue, (41)), 0);

        address nextOwner = address(0xB0B);
        vm.prank(originalOwner);
        collection.transferFrom(originalOwner, nextOwner, TOKEN_ID);
        require(account.owner() == nextOwner, "new S2 owner lacks control");

        vm.expectRevert(
            abi.encodeWithSelector(
                DroidAccountV1.NotAuthorized.selector, originalOwner, nextOwner
            )
        );
        vm.prank(originalOwner);
        account.execute(address(target), 0, abi.encodeCall(target.setValue, (42)), 0);

        vm.prank(nextOwner);
        account.execute(address(target), 0, abi.encodeCall(target.setValue, (43)), 0);
        require(target.value() == 43, "new owner execution failed");

        // Account deployment and activation do not touch metadata, supply, or Energy mechanics.
        require(keccak256(bytes(collection.tokenURI(TOKEN_ID))) == metadataBefore, "metadata");
        require(collection.metadataFrozen() == frozenBefore, "metadata freeze");
        require(
            IMonadEnergyBank(ENERGY_BANK).energyBalance(originalOwner) == energyBefore,
            "Energy changed"
        );
    }
}
