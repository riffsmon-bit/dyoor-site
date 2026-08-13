// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DroidAccountV1 } from "../src/droid/DroidAccountV1.sol";
import { DroidAccountRegistry } from "../src/droid/DroidAccountRegistry.sol";

interface DroidForkVm {
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function skip(bool skipTest) external;
}

interface IProductionHoodYOOR {
    function owner() external view returns (address);
    function totalSupply() external view returns (uint256);
    function ownerReserveMinted() external view returns (bool);
    function secondaryTradingEnabled() external view returns (bool);
    function mintOwnerReserve() external;
    function unlockSecondaryTrading() external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function traitsInitialized(uint256 assignmentId) external view returns (bool);
    function provenanceHash() external view returns (bytes32);
    function rerollController() external view returns (address);
    function rerollControllerFrozen() external view returns (bool);
    function energyBank() external view returns (address);
    function renderer() external view returns (address);
}

interface IProductionRerollController {
    function tokenNonces(uint256 tokenId) external view returns (uint256);
    function paymentConfigurationFrozen() external view returns (bool);
    function paused() external view returns (bool);
    function weiPerEnergy() external view returns (uint256);
    function usdgUnitsPerEnergy() external view returns (uint256);
}

contract ForkCallTarget {
    uint256 public number;

    function setNumber(uint256 nextNumber) external {
        number = nextNumber;
    }
}

/// @dev Runs only with a Robinhood Chain mainnet fork (`--fork-url ...`).
contract DroidAccountRobinhoodForkTest {
    DroidForkVm private constant vm =
        DroidForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ROBINHOOD_CHAIN_ID = 4_663;
    uint256 private constant TOKEN_ID = 1;
    address private constant COLLECTION = 0x8277F8126722B11D7b44C5C453bcF62A78AAFa25;
    address private constant CANONICAL_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address private constant EXPECTED_REROLL_CONTROLLER =
        0x6cf24a0119b7286ad88855Baa9CB220DF628FD11;
    address private constant EXPECTED_ENERGY_BANK = 0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3;
    address private constant EXPECTED_RENDERER = 0xb9cB0563013D9741f76a802d2F658EbF3433eE12;

    function testForkDeploymentActivationTransferAndRerollInvariants() external {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            vm.skip(true);
            return;
        }
        require(COLLECTION.code.length != 0, "production collection missing");
        require(CANONICAL_REGISTRY.code.length != 0, "canonical registry missing");

        IProductionHoodYOOR collection = IProductionHoodYOOR(COLLECTION);
        address collectionOwner = collection.owner();

        // The live collection is staged with zero supply. Mint only inside this disposable fork.
        if (!collection.ownerReserveMinted()) {
            vm.prank(collectionOwner);
            collection.mintOwnerReserve();
        }
        if (!collection.secondaryTradingEnabled()) {
            vm.prank(collectionOwner);
            collection.unlockSecondaryTrading();
        }
        require(collection.ownerOf(TOKEN_ID) == collectionOwner, "fork fixture owner mismatch");

        address rerollControllerAddress = collection.rerollController();
        require(
            rerollControllerAddress == EXPECTED_REROLL_CONTROLLER, "unexpected reroll controller"
        );
        require(collection.rerollControllerFrozen(), "reroll controller not frozen");
        require(collection.energyBank() == EXPECTED_ENERGY_BANK, "unexpected Energy Bank");
        require(collection.renderer() == EXPECTED_RENDERER, "unexpected renderer");

        IProductionRerollController reroll = IProductionRerollController(rerollControllerAddress);
        bytes32 metadataBefore = keccak256(bytes(collection.tokenURI(TOKEN_ID)));
        bytes32 provenanceBefore = collection.provenanceHash();
        require(collection.traitsInitialized(TOKEN_ID), "initial trait assignment missing");
        uint256 nonceBefore = reroll.tokenNonces(TOKEN_ID);
        uint256 weiRateBefore = reroll.weiPerEnergy();
        uint256 usdgRateBefore = reroll.usdgUnitsPerEnergy();
        require(reroll.paymentConfigurationFrozen(), "payment configuration not frozen");
        require(!reroll.paused(), "reroll controller paused");

        DroidAccountV1 implementation = new DroidAccountV1();
        DroidAccountRegistry registry = new DroidAccountRegistry(
            CANONICAL_REGISTRY, COLLECTION, address(implementation), ROBINHOOD_CHAIN_ID, bytes32(0)
        );
        address predicted = registry.account(TOKEN_ID);
        require(predicted.code.length == 0, "unexpected pre-existing fork account");

        vm.prank(collectionOwner);
        address accountAddress = registry.createAccount(TOKEN_ID);
        require(accountAddress == predicted, "counterfactual address mismatch");
        require(accountAddress.code.length != 0, "account deployment missing");

        DroidAccountV1 account = DroidAccountV1(payable(accountAddress));
        (uint256 tokenChainId, address tokenContract, uint256 tokenId) = account.token();
        require(tokenChainId == ROBINHOOD_CHAIN_ID, "wrong token chain");
        require(tokenContract == COLLECTION, "wrong token contract");
        require(tokenId == TOKEN_ID, "wrong token id");
        require(account.owner() == collectionOwner, "wrong initial account owner");

        ForkCallTarget target = new ForkCallTarget();
        vm.prank(collectionOwner);
        account.execute(address(target), 0, abi.encodeCall(ForkCallTarget.setNumber, (41)), 0);
        require(target.number() == 41, "owner execution failed");

        address nextOwner = address(0xB0B);
        vm.prank(collectionOwner);
        collection.transferFrom(collectionOwner, nextOwner, TOKEN_ID);
        require(account.owner() == nextOwner, "new owner did not acquire account control");

        vm.expectRevert(
            abi.encodeWithSelector(
                DroidAccountV1.NotAuthorized.selector, collectionOwner, nextOwner
            )
        );
        vm.prank(collectionOwner);
        account.execute(address(target), 0, abi.encodeCall(ForkCallTarget.setNumber, (42)), 0);

        vm.prank(nextOwner);
        account.execute(address(target), 0, abi.encodeCall(ForkCallTarget.setNumber, (43)), 0);
        require(target.number() == 43, "new owner execution failed");

        // Droid activation never touches the collection's trait or reroll configuration.
        require(
            keccak256(bytes(collection.tokenURI(TOKEN_ID))) == metadataBefore, "metadata changed"
        );
        require(collection.provenanceHash() == provenanceBefore, "provenance changed");
        require(collection.traitsInitialized(TOKEN_ID), "trait initialization changed");
        require(collection.rerollController() == rerollControllerAddress, "controller changed");
        require(collection.rerollControllerFrozen(), "controller freeze changed");
        require(collection.energyBank() == EXPECTED_ENERGY_BANK, "Energy changed");
        require(collection.renderer() == EXPECTED_RENDERER, "renderer changed");
        require(reroll.tokenNonces(TOKEN_ID) == nonceBefore, "reroll nonce changed");
        require(reroll.weiPerEnergy() == weiRateBefore, "ETH reroll rate changed");
        require(reroll.usdgUnitsPerEnergy() == usdgRateBefore, "USDG rate changed");
        require(reroll.paymentConfigurationFrozen(), "payment freeze changed");
        require(!reroll.paused(), "reroll pause changed");
    }
}
