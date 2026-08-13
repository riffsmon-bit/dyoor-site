// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ECDSA } from "./ECDSA.sol";

/// @notice Validates EOA signatures and ERC-1271 smart-wallet signatures.
library SignatureChecker {
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    function isValidSignatureNow(address signer, bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        if (signer.code.length == 0) return ECDSA.tryRecover(digest, signature) == signer;

        (bool success, bytes memory result) =
            signer.staticcall(abi.encodeWithSelector(ERC1271_MAGIC_VALUE, digest, signature));
        if (!success || result.length < 32) return false;

        bytes4 returnedValue;
        assembly ("memory-safe") {
            returnedValue := mload(add(result, 0x20))
        }
        return returnedValue == ERC1271_MAGIC_VALUE;
    }
}
