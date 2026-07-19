// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Script, console2 } from "forge-std/Script.sol";
import { DYOORSeason2SeaDrop } from "../contracts/DYOORSeason2SeaDrop.sol";
import {
    ISeaDropTokenContractMetadata
} from "seadrop/src/interfaces/ISeaDropTokenContractMetadata.sol";

contract DeployDYOORSeason2SeaDropMainnet is Script {
    string internal constant NAME = "D.Y.O.O.R";
    string internal constant SYMBOL = "DYOOR";
    string internal constant MAINNET_CONFIRMATION = "DEPLOY_DYOOR_MAINNET_OPENSEA_EXPERIMENT";
    uint256 internal constant MONAD_MAINNET_CHAIN_ID = 143;

    function run() external returns (DYOORSeason2SeaDrop token) {
        _validateMainnetOnly();

        uint256 deployerKey = _deployerKey();
        address deployer = vm.addr(deployerKey);
        address seaDrop = vm.envAddress("SEADROP_ADDRESS");
        _validateSeaDrop(seaDrop);

        address[] memory allowedSeaDrop = new address[](1);
        allowedSeaDrop[0] = seaDrop;

        address treasury = vm.envAddress("DYOOR_TREASURY_ADDRESS");
        address royaltyReceiver = vm.envAddress("DYOOR_ROYALTY_RECEIVER");
        uint96 royaltyBps = uint96(vm.envUint("DYOOR_ROYALTY_BPS"));
        address metadataManager = vm.envOr("DYOOR_METADATA_MANAGER", address(0));
        string memory baseURI = vm.envString("DYOOR_BASE_URI");
        string memory contractURI = vm.envOr("DYOOR_CONTRACT_URI", string(""));

        _validateAddress(treasury, "DYOOR_TREASURY_ADDRESS cannot be zero.");
        _validateAddress(royaltyReceiver, "DYOOR_ROYALTY_RECEIVER cannot be zero.");
        if (bytes(baseURI).length == 0) revert("DYOOR_BASE_URI is required for mainnet deploy.");
        if (royaltyBps > 10_000) revert("DYOOR_ROYALTY_BPS cannot exceed 10000.");

        console2.log("Deploying DYOORSeason2SeaDrop to Monad mainnet");
        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("Name:", NAME);
        console2.log("Symbol:", SYMBOL);
        console2.log("Authorized SeaDrop:", seaDrop);
        console2.log("Treasury:", treasury);
        console2.log("Royalty receiver:", royaltyReceiver);
        console2.log("Royalty bps:", royaltyBps);
        console2.log("Metadata manager:", metadataManager);
        console2.log("Base URI:", baseURI);
        console2.log("Contract URI:", contractURI);
        console2.log("Max supply:", uint256(3333));
        console2.log("Airdrop reserve:", uint256(610));
        console2.log("SeaDrop cap:", uint256(2723));

        vm.startBroadcast(deployerKey);

        token = new DYOORSeason2SeaDrop(NAME, SYMBOL, allowedSeaDrop);
        token.setTreasury(treasury);
        token.setRoyaltyInfo(
            ISeaDropTokenContractMetadata.RoyaltyInfo({
                royaltyAddress: royaltyReceiver, royaltyBps: royaltyBps
            })
        );
        if (metadataManager != address(0)) {
            token.setMetadataManager(metadataManager);
        }
        token.setBaseURI(baseURI);
        if (bytes(contractURI).length != 0) {
            token.setContractURI(contractURI);
        }

        vm.stopBroadcast();

        if (vm.envOr("DYOOR_WRITE_DEPLOYMENT_ARTIFACT", false)) {
            _writeDeploymentConfig(
                address(token),
                deployer,
                seaDrop,
                treasury,
                royaltyReceiver,
                royaltyBps,
                metadataManager,
                baseURI,
                contractURI
            );
        } else {
            console2.log("Deployment artifact not written. Set DYOOR_WRITE_DEPLOYMENT_ARTIFACT=true for broadcast.");
        }
    }

    function _validateMainnetOnly() private view {
        if (block.chainid != MONAD_MAINNET_CHAIN_ID) {
            revert("Unsupported chain. Mainnet deploy requires Monad chain ID 143.");
        }

        string memory confirmation = vm.envOr("MONAD_MAINNET_DEPLOY_CONFIRMATION", string(""));
        if (keccak256(bytes(confirmation)) != keccak256(bytes(MAINNET_CONFIRMATION))) {
            revert(
                "MONAD_MAINNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_MAINNET_OPENSEA_EXPERIMENT is required."
            );
        }
    }

    function _validateSeaDrop(address seaDrop) private view {
        _validateAddress(seaDrop, "SEADROP_ADDRESS cannot be zero.");
        if (seaDrop.code.length == 0) {
            revert("SEADROP_ADDRESS has no deployed bytecode on Monad mainnet.");
        }
    }

    function _validateAddress(address value, string memory message) private pure {
        if (value == address(0)) revert(message);
    }

    function _writeDeploymentConfig(
        address token,
        address deployer,
        address seaDrop,
        address treasury,
        address royaltyReceiver,
        uint96 royaltyBps,
        address metadataManager,
        string memory baseURI,
        string memory contractURI
    ) private {
        string memory root = "dyoorS2MainnetDeployment";
        string memory json = vm.serializeString(root, "contractName", "DYOORSeason2SeaDrop");
        json = vm.serializeString(root, "name", NAME);
        json = vm.serializeString(root, "symbol", SYMBOL);
        json = vm.serializeAddress(root, "contractAddress", token);
        json = vm.serializeAddress(root, "deployer", deployer);
        json = vm.serializeUint(root, "chainId", block.chainid);
        json = vm.serializeAddress(root, "constructorSeaDrop", seaDrop);
        json = vm.serializeAddress(root, "treasury", treasury);
        json = vm.serializeAddress(root, "royaltyReceiver", royaltyReceiver);
        json = vm.serializeUint(root, "royaltyBps", royaltyBps);
        json = vm.serializeAddress(root, "metadataManager", metadataManager);
        json = vm.serializeString(root, "baseURI", baseURI);
        json = vm.serializeString(root, "contractURI", contractURI);
        json = vm.serializeUint(root, "maxSupply", 3333);
        json = vm.serializeUint(root, "airdropReserve", 610);
        json = vm.serializeUint(root, "seaDropMaxSupply", 2723);
        json = vm.serializeUint(root, "timestamp", block.timestamp);
        json = vm.serializeString(root, "compiler", "solc 0.8.17");
        json = vm.serializeBool(root, "optimizer", true);
        json = vm.serializeUint(root, "optimizerRuns", 1);
        json = vm.serializeString(root, "constructorArgs", "D.Y.O.O.R,DYOOR,[SEADROP_ADDRESS]");
        vm.writeJson(json, "deployments/dyoor-s2-seadrop-mainnet.latest.json");
    }

    function _deployerKey() internal view returns (uint256 key) {
        key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (key == 0) {
            key = vm.envUint("PRIVATE_KEY");
        }
    }
}
