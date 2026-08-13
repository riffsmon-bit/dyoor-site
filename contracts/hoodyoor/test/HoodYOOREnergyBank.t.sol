// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOOREnergyBank } from "../src/HoodYOOREnergyBank.sol";

interface EnergyVm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract HoodYOOREnergyBankTest {
    EnergyVm private constant VM =
        EnergyVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant SPENDER = address(0x5EED);

    HoodYOOREnergyBank private bank;

    function setUp() public {
        bank = new HoodYOOREnergyBank(address(this));
    }

    function testCreditsAndApprovedAtomicSpending() public {
        bytes32 creditId = keccak256("migration-credit-1");
        bank.creditEnergy(ALICE, 500, creditId);
        require(bank.energyBalance(ALICE) == 500, "credited balance");
        require(bank.totalCredited(ALICE) == 500, "lifetime credited");

        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOOREnergyBank.MissingRole.selector, bank.SPENDER_ROLE(), SPENDER
            )
        );
        VM.prank(SPENDER);
        bank.spendEnergy(ALICE, 100, keccak256("reroll"));

        bank.grantRole(bank.SPENDER_ROLE(), SPENDER);
        VM.prank(SPENDER);
        bank.spendEnergy(ALICE, 100, keccak256("reroll"));
        require(bank.energyBalance(ALICE) == 400, "spent balance");
        require(bank.totalSpent(ALICE) == 100, "lifetime spent");

        VM.expectRevert(
            abi.encodeWithSelector(HoodYOOREnergyBank.InsufficientEnergy.selector, 400, 401)
        );
        VM.prank(SPENDER);
        bank.spendEnergy(ALICE, 401, keccak256("too-much"));
    }

    function testCreditReferencesAndCampaignsCannotReplay() public {
        bytes32 creditId = keccak256("migration-credit-2");
        bank.creditEnergy(ALICE, 100, creditId);
        VM.expectRevert(
            abi.encodeWithSelector(HoodYOOREnergyBank.CreditReferenceUsed.selector, creditId)
        );
        bank.creditEnergy(ALICE, 100, creditId);

        address[] memory recipients = new address[](2);
        recipients[0] = ALICE;
        recipients[1] = BOB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 200;
        amounts[1] = 300;
        bytes32 campaign = keccak256("launch-energy-airdrop");
        bank.creditEnergyBatch(recipients, amounts, campaign);
        require(bank.energyBalance(ALICE) == 300, "alice campaign balance");
        require(bank.energyBalance(BOB) == 300, "bob campaign balance");

        VM.expectRevert(
            abi.encodeWithSelector(HoodYOOREnergyBank.CreditCampaignUsed.selector, campaign)
        );
        bank.creditEnergyBatch(recipients, amounts, campaign);
    }

    function testPauseStopsCreditsAndSpending() public {
        bank.creditEnergy(ALICE, 500, keccak256("pause-test-credit"));
        bank.grantRole(bank.SPENDER_ROLE(), SPENDER);
        bank.setPaused(true);

        VM.expectRevert(HoodYOOREnergyBank.BankPaused.selector);
        bank.creditEnergy(ALICE, 1, keccak256("paused-credit"));
        VM.expectRevert(HoodYOOREnergyBank.BankPaused.selector);
        VM.prank(SPENDER);
        bank.spendEnergy(ALICE, 1, keccak256("paused-spend"));

        bank.setPaused(false);
        VM.prank(SPENDER);
        bank.spendEnergy(ALICE, 1, keccak256("resumed-spend"));
        require(bank.energyBalance(ALICE) == 499, "resumed balance");
    }

    function testTwoStepOwnershipMovesAdminCreditAndPauseAuthority() public {
        bank.transferOwnership(BOB);
        VM.prank(BOB);
        bank.acceptOwnership();
        require(bank.owner() == BOB, "new owner");
        require(!bank.hasRole(bank.CREDIT_ROLE(), address(this)), "old credit revoked");
        require(bank.hasRole(bank.CREDIT_ROLE(), BOB), "new credit granted");

        VM.expectRevert(
            abi.encodeWithSelector(
                HoodYOOREnergyBank.MissingRole.selector, bank.CREDIT_ROLE(), address(this)
            )
        );
        bank.creditEnergy(ALICE, 1, keccak256("old-owner-credit"));

        VM.prank(BOB);
        bank.creditEnergy(ALICE, 50, keccak256("new-owner-credit"));
        require(bank.energyBalance(ALICE) == 50, "new owner credit");
    }
}
