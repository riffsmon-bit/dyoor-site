// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Base64 } from "./lib/Base64.sol";
import { Json } from "./lib/Json.sol";
import { Strings } from "./lib/Strings.sol";
import { IHoodYOORTraitStore } from "./interfaces/IHoodYOORTraitStore.sol";
import { IHoodYOORRenderer } from "./interfaces/IHoodYOORRenderer.sol";

/// @notice Composes stored SVG layer fragments and returns fully on-chain metadata.
contract HoodYOORRenderer is IHoodYOORRenderer {
    using Strings for uint256;

    uint8 public constant LAYER_COUNT = 9;
    uint8 public constant TRAIT_BITS = 16;

    IHoodYOORTraitStore public immutable traitStore;

    error ZeroAddress();
    error InvalidLayer(uint8 layer);

    constructor(address traitStore_) {
        if (traitStore_ == address(0)) revert ZeroAddress();
        traitStore = IHoodYOORTraitStore(traitStore_);
    }

    function traitIdAt(uint256 packedTraits, uint8 layer) public pure returns (uint16) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        return uint16(packedTraits >> (uint256(layer) * TRAIT_BITS));
    }

    function validateTraits(uint256 packedTraits) external view override returns (bool) {
        for (uint8 layer; layer < LAYER_COUNT; ++layer) {
            if (!traitStore.traitExists(layer, traitIdAt(packedTraits, layer))) return false;
        }
        return true;
    }

    function isFrozen() external view override returns (bool) {
        return traitStore.frozen();
    }

    function renderSVG(uint256 packedTraits) public view returns (string memory) {
        bytes memory svg = bytes.concat(
            bytes(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="'
            ),
            bytes(unicode"HoodYØØR"),
            bytes('"><title>'),
            bytes(unicode"HoodYØØR"),
            bytes("</title>")
        );

        for (uint8 layer; layer < LAYER_COUNT; ++layer) {
            uint16 traitId = traitIdAt(packedTraits, layer);
            if (traitId != 0) {
                svg = bytes.concat(svg, bytes(traitStore.traitSVG(layer, traitId)));
            }
        }

        return string(bytes.concat(svg, bytes("</svg>")));
    }

    function attributesJSON(uint256 packedTraits) public view returns (string memory) {
        bytes memory attributes = bytes("[");

        for (uint8 layer; layer < LAYER_COUNT; ++layer) {
            if (layer != 0) attributes = bytes.concat(attributes, bytes(","));

            uint16 traitId = traitIdAt(packedTraits, layer);
            string memory layerLabel = traitStore.layerName(layer);
            string memory value = traitId == 0 ? "None" : traitStore.traitName(layer, traitId);

            attributes = bytes.concat(
                attributes,
                bytes('{"trait_type":"'),
                bytes(Json.escape(layerLabel)),
                bytes('","value":"'),
                bytes(Json.escape(value)),
                bytes('"}')
            );
        }

        return string(bytes.concat(attributes, bytes("]")));
    }

    function imageURI(uint256 packedTraits) public view returns (string memory) {
        return string.concat(
            "data:image/svg+xml;base64,", Base64.encode(bytes(renderSVG(packedTraits)))
        );
    }

    function tokenURI(uint256 tokenId, uint256 packedTraits)
        external
        view
        override
        returns (string memory)
    {
        bytes memory metadata = bytes.concat(
            bytes('{"name":"'),
            bytes(unicode"HoodYØØR #"),
            bytes(tokenId.toString()),
            bytes(
                unicode'","description":"HoodYØØR is a fully on-chain collection of 3,333 dynamic droids on Robinhood Chain.","image":"'
            )
        );
        metadata = bytes.concat(metadata, bytes(imageURI(packedTraits)), bytes('","attributes":'));
        metadata = bytes.concat(metadata, bytes(attributesJSON(packedTraits)), bytes("}"));
        return string.concat("data:application/json;base64,", Base64.encode(metadata));
    }
}
