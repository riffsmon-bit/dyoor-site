// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice One-shot public-chain proof for the HoodYØØR future-block reveal assumptions.
/// @dev This contract holds no funds and grants no privileges. Anyone can record the target hash.
contract HoodYOORBlockhashCanary {
    uint16 public constant DELAY_BLOCKS = 64;
    uint16 public constant HASH_WINDOW = 256;

    uint256 public immutable requestBlock;
    uint256 public immutable targetBlock;
    bytes32 public observedBlockHash;
    address public observer;

    error ObservationTooEarly(uint256 requiredBlock);
    error ObservationExpired(uint256 targetBlock);
    error BlockhashUnavailable(uint256 targetBlock);
    error AlreadyObserved();

    event BlockhashRequested(uint256 indexed requestBlock, uint256 indexed targetBlock);
    event BlockhashObserved(
        uint256 indexed targetBlock, bytes32 indexed blockHash, address indexed observer
    );

    constructor() {
        requestBlock = block.number;
        targetBlock = block.number + DELAY_BLOCKS;
        emit BlockhashRequested(requestBlock, targetBlock);
    }

    function validated() external view returns (bool) {
        return observedBlockHash != bytes32(0);
    }

    function observe() external returns (bytes32 blockHash) {
        if (observedBlockHash != bytes32(0)) revert AlreadyObserved();
        uint256 target = targetBlock;
        if (block.number <= target) revert ObservationTooEarly(target + 1);
        if (block.number > target + HASH_WINDOW) revert ObservationExpired(target);
        blockHash = blockhash(target);
        if (blockHash == bytes32(0)) revert BlockhashUnavailable(target);
        observedBlockHash = blockHash;
        observer = msg.sender;
        emit BlockhashObserved(target, blockHash, msg.sender);
    }
}
