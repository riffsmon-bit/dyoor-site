// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Script } from "forge-std/Script.sol";
import { DYOORSeason2SeaDrop } from "../contracts/DYOORSeason2SeaDrop.sol";
import {
    ISeaDropTokenContractMetadata
} from "seadrop/src/interfaces/ISeaDropTokenContractMetadata.sol";

contract DeployDYOORSeason2SeaDrop is Script {
    string internal constant NAME = "D.Y.O.O.R";
    string internal constant SYMBOL = "DYOOR2";
    address internal constant DOCUMENTED_SEADROP_1_0 = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    function run() external returns (DYOORSeason2SeaDrop token) {
        uint256 deployerKey = _deployerKey();
        address seaDrop = vm.envOr("SEADROP_ADDRESS", DOCUMENTED_SEADROP_1_0);

        address[] memory allowedSeaDrop = new address[](1);
        allowedSeaDrop[0] = seaDrop;

        vm.startBroadcast(deployerKey);

        token = new DYOORSeason2SeaDrop(NAME, SYMBOL, allowedSeaDrop);

        address treasury = vm.envOr("DYOOR_TREASURY_ADDRESS", address(0));
        if (treasury != address(0)) {
            token.setTreasury(treasury);
        }

        address royaltyReceiver = vm.envOr("DYOOR_ROYALTY_RECEIVER", address(0));
        uint96 royaltyBps = uint96(vm.envOr("DYOOR_ROYALTY_BPS", uint256(500)));
        if (royaltyReceiver != address(0)) {
            token.setRoyaltyInfo(
                ISeaDropTokenContractMetadata.RoyaltyInfo({
                    royaltyAddress: royaltyReceiver, royaltyBps: royaltyBps
                })
            );
        }

        string memory baseURI = vm.envOr("DYOOR_BASE_URI", string(""));
        if (bytes(baseURI).length != 0) {
            token.setBaseURI(baseURI);
        }

        string memory contractURI = vm.envOr("DYOOR_CONTRACT_URI", string(""));
        if (bytes(contractURI).length != 0) {
            token.setContractURI(contractURI);
        }

        uint64 teamStart = uint64(vm.envOr("DYOOR_TEAM_START", uint256(0)));
        uint64 whitelistStart = uint64(vm.envOr("DYOOR_WL_START", uint256(0)));
        uint64 gtdStart = uint64(vm.envOr("DYOOR_GTD_START", uint256(0)));
        uint64 publicStart = uint64(vm.envOr("DYOOR_PUBLIC_START", uint256(0)));
        if (teamStart != 0 || whitelistStart != 0 || gtdStart != 0 || publicStart != 0) {
            token.setPhaseStartTimes(teamStart, whitelistStart, gtdStart, publicStart);
        }

        bytes32 teamRoot = vm.envOr("DYOOR_TEAM_ROOT", bytes32(0));
        bytes32 whitelistRoot = vm.envOr("DYOOR_WL_ROOT", bytes32(0));
        bytes32 gtdRoot = vm.envOr("DYOOR_GTD_ROOT", bytes32(0));
        if (teamRoot != bytes32(0) || whitelistRoot != bytes32(0) || gtdRoot != bytes32(0)) {
            token.updateMerkleRoots(teamRoot, whitelistRoot, gtdRoot);
        }

        vm.stopBroadcast();
    }

    function _deployerKey() internal view returns (uint256 key) {
        key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (key == 0) {
            key = vm.envUint("PRIVATE_KEY");
        }
    }
}
