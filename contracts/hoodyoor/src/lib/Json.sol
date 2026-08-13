// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Escapes arbitrary UTF-8 trait names for safe JSON string values.
library Json {
    bytes16 private constant HEX = "0123456789abcdef";

    function escape(string memory input) internal pure returns (string memory) {
        bytes memory source = bytes(input);
        bytes memory output = new bytes(source.length * 6);
        uint256 cursor;

        for (uint256 i; i < source.length; ++i) {
            uint8 character = uint8(source[i]);
            if (character == 0x22 || character == 0x5c) {
                output[cursor++] = bytes1(uint8(0x5c));
                output[cursor++] = bytes1(character);
            } else if (character == 0x08) {
                output[cursor++] = "\\";
                output[cursor++] = "b";
            } else if (character == 0x09) {
                output[cursor++] = "\\";
                output[cursor++] = "t";
            } else if (character == 0x0a) {
                output[cursor++] = "\\";
                output[cursor++] = "n";
            } else if (character == 0x0c) {
                output[cursor++] = "\\";
                output[cursor++] = "f";
            } else if (character == 0x0d) {
                output[cursor++] = "\\";
                output[cursor++] = "r";
            } else if (character < 0x20) {
                output[cursor++] = "\\";
                output[cursor++] = "u";
                output[cursor++] = "0";
                output[cursor++] = "0";
                output[cursor++] = HEX[character >> 4];
                output[cursor++] = HEX[character & 0x0f];
            } else {
                output[cursor++] = bytes1(character);
            }
        }

        assembly ("memory-safe") {
            mstore(output, cursor)
        }
        return string(output);
    }
}
