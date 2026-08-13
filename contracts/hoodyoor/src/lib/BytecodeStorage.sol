// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deploys immutable byte payloads as contract runtime code and reads them with EXTCODECOPY.
library BytecodeStorage {
    uint256 internal constant DATA_OFFSET = 1;
    uint256 internal constant MAX_DATA_LENGTH = 24_575;

    error EmptyBytecodePayload();
    error BytecodePayloadTooLarge(uint256 length);
    error BytecodeDeploymentFailed();
    error BytecodeReadOutOfBounds();

    function write(bytes memory payload) internal returns (address pointer) {
        uint256 length = payload.length;
        if (length == 0) revert EmptyBytecodePayload();
        if (length > MAX_DATA_LENGTH) revert BytecodePayloadTooLarge(length);

        // The returned runtime starts with STOP so the data contract cannot execute its payload.
        bytes memory creationCode = abi.encodePacked(
            hex"61", uint16(length + DATA_OFFSET), hex"80600a3d393df3", hex"00", payload
        );

        assembly ("memory-safe") {
            pointer := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        if (pointer == address(0)) revert BytecodeDeploymentFailed();
    }

    function read(address pointer, uint256 start, uint256 length)
        internal
        view
        returns (bytes memory output)
    {
        output = new bytes(length);
        copy(pointer, start, length, output, 0);
    }

    function copy(
        address pointer,
        uint256 start,
        uint256 length,
        bytes memory destination,
        uint256 destinationOffset
    ) internal view {
        if (
            destinationOffset + length > destination.length
                || start + length + DATA_OFFSET > pointer.code.length
        ) revert BytecodeReadOutOfBounds();

        assembly ("memory-safe") {
            extcodecopy(
                pointer,
                add(add(destination, 0x20), destinationOffset),
                add(start, DATA_OFFSET),
                length
            )
        }
    }
}
