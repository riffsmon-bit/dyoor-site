// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORTraitRules } from "../src/HoodYOORTraitRules.sol";

interface GeneratedRulesVm {
    function readFileBinary(string calldata path) external view returns (bytes memory data);
}

contract HoodYOORGeneratedRulesTest {
    GeneratedRulesVm private constant VM =
        GeneratedRulesVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant RULES_HASH =
        0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f;
    uint16 private constant PAIR_COUNT = 329;

    function testDeploysAndFreezesGeneratedCompatibilityRules() public {
        bytes memory encoded =
            VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-reroll-rules.bin");
        require(encoded.length == uint256(PAIR_COUNT) * 6, "rule bytes");

        HoodYOORTraitRules rules = new HoodYOORTraitRules(address(this), PAIR_COUNT);
        HoodYOORTraitRules.PairInput[] memory pairs = new HoodYOORTraitRules.PairInput[](PAIR_COUNT);
        for (uint256 i; i < PAIR_COUNT; ++i) {
            uint256 cursor = i * 6;
            pairs[i] = HoodYOORTraitRules.PairInput({
                layerA: uint8(encoded[cursor]),
                traitA: _uint16(encoded, cursor + 1),
                layerB: uint8(encoded[cursor + 3]),
                traitB: _uint16(encoded, cursor + 4)
            });
        }

        rules.setIncompatibilities(pairs);
        rules.freeze(RULES_HASH);

        require(rules.frozen(), "rules frozen");
        require(rules.pairCount() == PAIR_COUNT, "pair count");
        require(rules.rulesHash() == RULES_HASH, "rules hash");
        for (uint256 i; i < pairs.length; ++i) {
            HoodYOORTraitRules.PairInput memory pair = pairs[i];
            require(
                rules.incompatible(pair.layerA, pair.traitA, pair.layerB, pair.traitB),
                "stored pair"
            );
        }

        require(rules.incompatible(6, 6008, 4, 4001), "Black Shystie / mouth");
        require(rules.incompatible(7, 7001, 8, 8001), "duplicate accessory");

        uint256 blocked = _pack([uint16(122), 201, 3001, 3057, 4001, 5032, 6008, 0, 0]);
        require(!rules.isCompatible(blocked), "blocked combination");

        uint256 approved = _pack([uint16(122), 201, 3001, 3057, 4017, 5032, 6042, 0, 0]);
        require(rules.isCompatible(approved), "approved combination");
        require(!rules.isCompatible(approved | (uint256(1) << 200)), "reserved packed bits");
    }

    function _pack(uint16[9] memory traits) private pure returns (uint256 packed) {
        for (uint8 layer; layer < traits.length; ++layer) {
            packed |= uint256(traits[layer]) << (uint256(layer) * 16);
        }
    }

    function _uint16(bytes memory data, uint256 cursor) private pure returns (uint16) {
        return (uint16(uint8(data[cursor])) << 8) | uint16(uint8(data[cursor + 1]));
    }
}
