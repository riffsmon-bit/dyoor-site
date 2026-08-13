// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORPackedTraitStore } from "../src/HoodYOORPackedTraitStore.sol";
import { HoodYOORPixelRenderer } from "../src/HoodYOORPixelRenderer.sol";

interface GeneratedArtVm {
    function readFileBinary(string calldata path) external view returns (bytes memory data);
}

contract HoodYOORGeneratedArtTest {
    GeneratedArtVm private constant VM =
        GeneratedArtVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant CATALOG_HASH =
        0x50e0424b927b0da11b01947b6839070d81b6aa982b214c63f78f4adb8cb756d3;

    function testDeploysAndRendersGenerated201TraitCatalog() public {
        bytes memory payload =
            VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-onchain-art.bin");
        bytes memory recordTable =
            VM.readFileBinary("../../data/robinhood/onchain-128/hoodyoor-trait-records.bin");
        require(payload.length == 586_295, "payload bytes");
        require(recordTable.length == 201 * 17, "record table bytes");

        HoodYOORPackedTraitStore store = new HoodYOORPackedTraitStore(address(this), 201);
        uint256 chunkBytes = store.CHUNK_PAYLOAD_BYTES();
        for (uint256 offset; offset < payload.length; offset += chunkBytes) {
            uint256 remaining = payload.length - offset;
            uint256 length = remaining < chunkBytes ? remaining : chunkBytes;
            bytes memory chunk = _slice(payload, offset, length);
            if (offset + length == payload.length) store.appendFinalChunk(chunk);
            else store.appendChunk(chunk);
        }

        HoodYOORPackedTraitStore.TraitInput[] memory records =
            new HoodYOORPackedTraitStore.TraitInput[](201);
        for (uint256 i; i < records.length; ++i) {
            uint256 cursor = i * 17;
            records[i] = HoodYOORPackedTraitStore.TraitInput({
                layer: uint8(recordTable[cursor]),
                traitId: _uint16(recordTable, cursor + 1),
                nameOffset: _uint32(recordTable, cursor + 3),
                nameLength: _uint16(recordTable, cursor + 7),
                artOffset: _uint32(recordTable, cursor + 9),
                artLength: _uint32(recordTable, cursor + 13)
            });
        }
        store.setTraitRecords(records);
        store.freeze(CATALOG_HASH);

        require(store.chunkCount() == 25, "chunk count");
        require(store.totalPayloadBytes() == payload.length, "stored payload bytes");
        require(store.registeredTraitCount() == 201, "registered trait count");
        require(_equal(store.traitName(0, 122), "INDAHOOD"), "INDAHOOD name");
        require(_equal(store.traitName(4, 4008), "Deep Thought"), "thin mouth name");

        (bytes32 packedHash, bytes32 svgHash, uint256 deepThoughtSvgBytes) =
            store.validateTraitData(4, 4008);
        require(packedHash != bytes32(0) && svgHash != bytes32(0), "thin mouth hashes");
        require(deepThoughtSvgBytes != 0, "thin mouth survives");

        HoodYOORPixelRenderer renderer = new HoodYOORPixelRenderer(address(store));
        uint256 packedTraits = uint256(122) | (uint256(205) << 16) | (uint256(3057) << 48)
            | (uint256(4017) << 64) | (uint256(5032) << 80) | (uint256(6042) << 96);
        require(renderer.validateTraits(packedTraits), "signature traits validate");

        string memory svg = renderer.renderSVG(packedTraits);
        require(bytes(svg).length > 30_000, "full SVG bytes");
        _assertContains(svg, 'viewBox="0 0 128 128"', "128 viewBox");
        _assertContains(svg, "#ccff00", "Robinhood palette");
        _assertContains(renderer.attributesJSON(packedTraits), "Gold Grill", "mouth metadata");
    }

    function _slice(bytes memory source, uint256 start, uint256 length)
        private
        pure
        returns (bytes memory output)
    {
        output = new bytes(length);
        assembly ("memory-safe") {
            let sourceCursor := add(add(source, 0x20), start)
            let outputCursor := add(output, 0x20)
            let end := add(sourceCursor, length)
            for { } lt(sourceCursor, end) {
                sourceCursor := add(sourceCursor, 0x20)
                outputCursor := add(outputCursor, 0x20)
            } { mstore(outputCursor, mload(sourceCursor)) }
        }
    }

    function _uint16(bytes memory data, uint256 cursor) private pure returns (uint16) {
        return (uint16(uint8(data[cursor])) << 8) | uint16(uint8(data[cursor + 1]));
    }

    function _uint32(bytes memory data, uint256 cursor) private pure returns (uint32) {
        return (uint32(uint8(data[cursor])) << 24) | (uint32(uint8(data[cursor + 1])) << 16)
            | (uint32(uint8(data[cursor + 2])) << 8) | uint32(uint8(data[cursor + 3]));
    }

    function _equal(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }

    function _assertContains(string memory value, string memory needle, string memory reason)
        private
        pure
    {
        bytes memory haystack = bytes(value);
        bytes memory sought = bytes(needle);
        require(sought.length != 0 && haystack.length >= sought.length, reason);
        for (uint256 i; i <= haystack.length - sought.length; ++i) {
            bool found = true;
            for (uint256 j; j < sought.length; ++j) {
                if (haystack[i + j] != sought[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return;
        }
        revert(reason);
    }
}
