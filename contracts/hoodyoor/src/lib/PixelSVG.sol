// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Decodes HoodYØØR palette-grouped rectangles into deterministic SVG paths.
/// @dev Format: uint8 colorCount; repeated [RGB, uint16 rectCount, uint32 rectangles].
/// Rectangle bits are x:7, y:7, widthMinusOne:7, heightMinusOne:7, reserved:4.
library PixelSVG {
    bytes16 private constant HEX = "0123456789abcdef";
    uint256 private constant GRID_SIZE = 128;
    uint256 private constant PATH_OVERHEAD = 27;

    error MalformedPackedPixels(uint256 cursor);

    function render(bytes memory packed) internal pure returns (bytes memory svg) {
        uint256 outputLength = _renderedLength(packed);
        svg = new bytes(outputLength);

        uint256 inputCursor = 1;
        uint256 outputCursor;
        uint256 colorCount = uint8(packed[0]);

        for (uint256 colorIndex; colorIndex < colorCount; ++colorIndex) {
            (inputCursor, outputCursor) = _renderColorGroup(packed, svg, inputCursor, outputCursor);
        }

        if (inputCursor != packed.length || outputCursor != outputLength) {
            revert MalformedPackedPixels(inputCursor);
        }
    }

    function _renderColorGroup(
        bytes memory packed,
        bytes memory svg,
        uint256 inputCursor,
        uint256 outputCursor
    ) private pure returns (uint256, uint256) {
        outputCursor = _copy(svg, outputCursor, bytes('<path fill="#'));
        outputCursor = _writeHexByte(svg, outputCursor, uint8(packed[inputCursor++]));
        outputCursor = _writeHexByte(svg, outputCursor, uint8(packed[inputCursor++]));
        outputCursor = _writeHexByte(svg, outputCursor, uint8(packed[inputCursor++]));
        outputCursor = _copy(svg, outputCursor, bytes('" d="'));

        uint256 rectangleCount = _readUint16(packed, inputCursor);
        inputCursor += 2;
        for (uint256 rectangleIndex; rectangleIndex < rectangleCount; ++rectangleIndex) {
            (inputCursor, outputCursor) = _renderRectangle(packed, svg, inputCursor, outputCursor);
        }
        outputCursor = _copy(svg, outputCursor, bytes('"/>'));
        return (inputCursor, outputCursor);
    }

    function _renderRectangle(
        bytes memory packed,
        bytes memory svg,
        uint256 inputCursor,
        uint256 outputCursor
    ) private pure returns (uint256, uint256) {
        (uint256 x, uint256 y, uint256 width, uint256 height) =
            _rectangle(_readUint32(packed, inputCursor));

        svg[outputCursor++] = "M";
        outputCursor = _writeUint(svg, outputCursor, x);
        svg[outputCursor++] = " ";
        outputCursor = _writeUint(svg, outputCursor, y);
        svg[outputCursor++] = "h";
        outputCursor = _writeUint(svg, outputCursor, width);
        svg[outputCursor++] = "v";
        outputCursor = _writeUint(svg, outputCursor, height);
        svg[outputCursor++] = "h";
        svg[outputCursor++] = "-";
        outputCursor = _writeUint(svg, outputCursor, width);
        svg[outputCursor++] = "z";
        return (inputCursor + 4, outputCursor);
    }

    function validate(bytes memory packed) internal pure returns (bool) {
        _renderedLength(packed);
        return true;
    }

    function _renderedLength(bytes memory packed) private pure returns (uint256 length) {
        if (packed.length == 0) revert MalformedPackedPixels(0);
        uint256 colorCount = uint8(packed[0]);
        if (colorCount == 0 || colorCount > 32) revert MalformedPackedPixels(0);

        uint256 cursor = 1;
        for (uint256 colorIndex; colorIndex < colorCount; ++colorIndex) {
            if (cursor + 5 > packed.length) revert MalformedPackedPixels(cursor);
            cursor += 3;
            uint256 rectangleCount = _readUint16(packed, cursor);
            cursor += 2;
            if (rectangleCount == 0 || cursor + (rectangleCount * 4) > packed.length) {
                revert MalformedPackedPixels(cursor);
            }

            length += PATH_OVERHEAD;
            for (uint256 rectangleIndex; rectangleIndex < rectangleCount; ++rectangleIndex) {
                uint32 rectangle = _readUint32(packed, cursor);
                cursor += 4;
                (uint256 x, uint256 y, uint256 width, uint256 height) = _rectangle(rectangle);
                length += 7 + _digits(x) + _digits(y) + (_digits(width) * 2) + _digits(height);
            }
        }

        if (cursor != packed.length) revert MalformedPackedPixels(cursor);
    }

    function _rectangle(uint32 packed)
        private
        pure
        returns (uint256 x, uint256 y, uint256 width, uint256 height)
    {
        if (packed >> 28 != 0) revert MalformedPackedPixels(0);
        x = packed & 0x7f;
        y = (packed >> 7) & 0x7f;
        width = ((packed >> 14) & 0x7f) + 1;
        height = ((packed >> 21) & 0x7f) + 1;
        if (x + width > GRID_SIZE || y + height > GRID_SIZE) {
            revert MalformedPackedPixels(0);
        }
    }

    function _readUint16(bytes memory data, uint256 cursor) private pure returns (uint16 value) {
        value = (uint16(uint8(data[cursor])) << 8) | uint16(uint8(data[cursor + 1]));
    }

    function _readUint32(bytes memory data, uint256 cursor) private pure returns (uint32 value) {
        value = (uint32(uint8(data[cursor])) << 24) | (uint32(uint8(data[cursor + 1])) << 16)
            | (uint32(uint8(data[cursor + 2])) << 8) | uint32(uint8(data[cursor + 3]));
    }

    function _writeHexByte(bytes memory output, uint256 cursor, uint8 value)
        private
        pure
        returns (uint256)
    {
        output[cursor] = HEX[value >> 4];
        output[cursor + 1] = HEX[value & 0x0f];
        return cursor + 2;
    }

    function _writeUint(bytes memory output, uint256 cursor, uint256 value)
        private
        pure
        returns (uint256)
    {
        if (value >= 100) {
            output[cursor++] = bytes1(uint8(48 + (value / 100)));
            value %= 100;
            output[cursor++] = bytes1(uint8(48 + (value / 10)));
        } else if (value >= 10) {
            output[cursor++] = bytes1(uint8(48 + (value / 10)));
        }
        output[cursor++] = bytes1(uint8(48 + (value % 10)));
        return cursor;
    }

    function _digits(uint256 value) private pure returns (uint256) {
        if (value >= 100) return 3;
        if (value >= 10) return 2;
        return 1;
    }

    function _copy(bytes memory output, uint256 cursor, bytes memory value)
        private
        pure
        returns (uint256)
    {
        for (uint256 i; i < value.length; ++i) {
            output[cursor + i] = value[i];
        }
        return cursor + value.length;
    }
}
