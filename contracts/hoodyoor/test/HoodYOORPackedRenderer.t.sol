// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HoodYOORPackedTraitStore } from "../src/HoodYOORPackedTraitStore.sol";
import { HoodYOORPixelRenderer } from "../src/HoodYOORPixelRenderer.sol";

contract HoodYOORPackedRendererTest {
    HoodYOORPackedTraitStore private store;
    HoodYOORPixelRenderer private renderer;

    function setUp() public {
        store = new HoodYOORPackedTraitStore(address(this), 1);

        bytes memory name = bytes("INDAHOOD");
        bytes memory packedArt = abi.encodePacked(
            bytes1(uint8(1)),
            bytes3(0xc8ff00),
            bytes2(uint16(1)),
            bytes4(_rectangle(0, 0, 128, 128))
        );

        bytes memory fullChunk = new bytes(store.CHUNK_PAYLOAD_BYTES());
        uint32 nameOffset = 23_980;
        uint32 artOffset = 23_998;
        for (uint256 i; i < name.length; ++i) {
            fullChunk[uint256(nameOffset) + i] = name[i];
        }
        fullChunk[artOffset] = packedArt[0];
        fullChunk[uint256(artOffset) + 1] = packedArt[1];
        store.appendChunk(fullChunk);

        bytes memory finalChunk = new bytes(packedArt.length - 2);
        for (uint256 i = 2; i < packedArt.length; ++i) {
            finalChunk[i - 2] = packedArt[i];
        }
        store.appendFinalChunk(finalChunk);

        HoodYOORPackedTraitStore.TraitInput[] memory inputs =
            new HoodYOORPackedTraitStore.TraitInput[](1);
        inputs[0] = HoodYOORPackedTraitStore.TraitInput({
            layer: 0,
            traitId: 122,
            nameOffset: nameOffset,
            nameLength: uint16(name.length),
            artOffset: artOffset,
            artLength: uint32(packedArt.length)
        });
        store.setTraitRecords(inputs);
        store.freeze(keccak256("hoodyoor-packed-store-test"));
        renderer = new HoodYOORPixelRenderer(address(store));
    }

    function testReadsTraitAcrossBytecodeChunkBoundary() public view {
        _assertEq(store.chunkCount(), 2, "chunk count");
        _assertEq(store.chunkAt(0).code.length, 24_001, "full runtime bytes");
        _assertEq(store.traitName(0, 122), "INDAHOOD", "trait name");

        bytes memory expected = abi.encodePacked(
            bytes1(uint8(1)),
            bytes3(0xc8ff00),
            bytes2(uint16(1)),
            bytes4(_rectangle(0, 0, 128, 128))
        );
        _assertEq(store.traitPackedData(0, 122), expected, "cross-chunk packed art");
    }

    function testRendersCrisp128SVGAndMetadata() public view {
        uint256 packedTraits = 122;
        string memory svg = renderer.renderSVG(packedTraits);

        _assertContains(svg, 'viewBox="0 0 128 128"', "128 viewBox");
        _assertContains(svg, '<path fill="#c8ff00" d="M0 0h128v128h-128z"/>', "decoded rectangle");
        _assertContains(renderer.attributesJSON(packedTraits), "INDAHOOD", "attribute name");
        _assertStartsWith(
            renderer.tokenURI(7, packedTraits), "data:application/json;base64,", "token URI"
        );
        require(renderer.validateTraits(packedTraits), "registered traits validate");
        require(!renderer.validateTraits(123), "missing traits fail validation");
        require(renderer.isFrozen(), "renderer reports frozen store");
    }

    function testPackedAndRenderedHashesAreAvailableForDeploymentVerification() public view {
        (bytes32 packedHash, bytes32 svgHash, uint256 svgBytes) = store.validateTraitData(0, 122);
        require(packedHash != bytes32(0), "packed hash");
        require(svgHash != bytes32(0), "svg hash");
        _assertEq(svgBytes, 45, "fragment bytes");
    }

    function _rectangle(uint8 x, uint8 y, uint8 width, uint8 height) private pure returns (uint32) {
        return uint32(x) | (uint32(y) << 7) | (uint32(width - 1) << 14) | (uint32(height - 1) << 21);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory reason) private pure {
        require(actual == expected, reason);
    }

    function _assertEq(string memory actual, string memory expected, string memory reason)
        private
        pure
    {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), reason);
    }

    function _assertEq(bytes memory actual, bytes memory expected, string memory reason)
        private
        pure
    {
        require(keccak256(actual) == keccak256(expected), reason);
    }

    function _assertStartsWith(string memory value, string memory prefix, string memory reason)
        private
        pure
    {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        require(valueBytes.length >= prefixBytes.length, reason);
        for (uint256 i; i < prefixBytes.length; ++i) {
            require(valueBytes[i] == prefixBytes[i], reason);
        }
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
