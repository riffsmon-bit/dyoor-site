// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Strings {
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";

        uint256 digits;
        uint256 remaining = value;
        while (remaining != 0) {
            unchecked {
                ++digits;
                remaining /= 10;
            }
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked {
                digits -= 1;
                buffer[digits] = bytes1(uint8(48 + (value % 10)));
                value /= 10;
            }
        }
        return string(buffer);
    }
}

