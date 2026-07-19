// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { DYOORSeason2SeaDrop } from "../contracts/DYOORSeason2SeaDrop.sol";

contract DYOORSeason2SeaDropInvariantTest is StdInvariant, Test {
    DYOORSeason2SeaDrop internal token;

    address internal seaDrop = address(0x5EA0);
    address internal userA = address(0xA11CE);
    address internal userB = address(0xB0B);
    address internal userC = address(0xCAFE);
    uint256 internal batchNonce;

    function setUp() public {
        address[] memory seaDrops = new address[](1);
        seaDrops[0] = seaDrop;
        token = new DYOORSeason2SeaDrop("D.Y.O.O.R", "DYOOR", seaDrops);

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = this.actionSeaDropMint.selector;
        selectors[1] = this.actionAirdrop.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
        targetContract(address(this));
    }

    function actionSeaDropMint(uint16 quantity, uint8 recipientIndex) public {
        quantity = uint16(bound(quantity, 1, 25));
        address recipient = _recipient(recipientIndex);

        uint256 attemptedSeaDrop = token.totalSeaDropMinted() + quantity;
        uint256 attemptedTotal = token.totalMinted() + quantity;

        vm.prank(seaDrop);
        if (attemptedSeaDrop > token.SEADROP_MAX_SUPPLY() || attemptedTotal > token.MAX_SUPPLY()) {
            vm.expectRevert();
            token.mintSeaDrop(recipient, quantity);
        } else {
            token.mintSeaDrop(recipient, quantity);
        }
    }

    function actionAirdrop(uint16 quantity, uint8 recipientIndex) public {
        quantity = uint16(bound(quantity, 1, 25));
        address[] memory recipients = new address[](1);
        recipients[0] = _recipient(recipientIndex);
        uint256[] memory quantities = new uint256[](1);
        quantities[0] = quantity;
        bytes32 batchId = keccak256(abi.encode("invariant-airdrop", batchNonce++));

        uint256 attemptedAirdropped = token.totalAirdropped() + quantity;
        uint256 attemptedTotal = token.totalMinted() + quantity;

        if (attemptedAirdropped > token.AIRDROP_RESERVE() || attemptedTotal > token.MAX_SUPPLY()) {
            vm.expectRevert();
            token.airdrop(recipients, quantities, batchId);
        } else {
            token.airdrop(recipients, quantities, batchId);
        }
    }

    function invariant_totalSupplyNeverExceedsMax() public view {
        assertLe(token.totalSupply(), token.MAX_SUPPLY());
        assertLe(token.totalMinted(), token.MAX_SUPPLY());
    }

    function invariant_seaDropNeverConsumesReserve() public view {
        assertLe(token.totalSeaDropMinted(), token.SEADROP_MAX_SUPPLY());
    }

    function invariant_airdropNeverExceedsReserve() public view {
        assertLe(token.totalAirdropped(), token.AIRDROP_RESERVE());
    }

    function invariant_combinedRoutesNeverExceedMax() public view {
        assertLe(token.totalSeaDropMinted() + token.totalAirdropped(), token.MAX_SUPPLY());
    }

    function _recipient(uint8 index) internal view returns (address) {
        if (index % 3 == 0) return userA;
        if (index % 3 == 1) return userB;
        return userC;
    }
}
