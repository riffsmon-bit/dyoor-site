// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHoodYOORTraitStore } from "./interfaces/IHoodYOORTraitStore.sol";
import { BytecodeStorage } from "./lib/BytecodeStorage.sol";
import { PixelSVG } from "./lib/PixelSVG.sol";

/// @notice Immutable, bytecode-backed registry for the production 128x128 HoodYØØR layers.
contract HoodYOORPackedTraitStore is IHoodYOORTraitStore {
    uint8 public constant LAYER_COUNT = 9;
    uint256 public constant CHUNK_PAYLOAD_BYTES = 24_000;

    struct TraitRecord {
        uint32 nameOffset;
        uint16 nameLength;
        uint32 artOffset;
        uint32 artLength;
        bool exists;
    }

    struct TraitInput {
        uint8 layer;
        uint16 traitId;
        uint32 nameOffset;
        uint16 nameLength;
        uint32 artOffset;
        uint32 artLength;
    }

    address public owner;
    address public pendingOwner;
    uint16 public immutable expectedTraitCount;
    uint16 public registeredTraitCount;
    uint32 public totalPayloadBytes;
    bool public chunksSealed;
    bool public override frozen;
    bytes32 public catalogHash;

    address[] private _chunks;
    mapping(uint24 key => TraitRecord) private _traits;

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InvalidExpectedTraitCount();
    error InvalidLayer(uint8 layer);
    error InvalidTraitId();
    error InvalidChunkLength(uint256 length);
    error ChunksAlreadySealed();
    error ChunksNotSealed();
    error PayloadTooLarge();
    error InvalidPayloadSpan(uint32 offset, uint32 length);
    error EmptyTraitName();
    error EmptyTraitArt();
    error StoreFrozen();
    error TraitMissing(uint8 layer, uint16 traitId);
    error TraitCountIncomplete(uint16 expected, uint16 actual);
    error EmptyCatalogHash();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ChunkStored(
        uint256 indexed index,
        address indexed pointer,
        uint256 payloadBytes,
        bytes32 payloadHash,
        bool finalChunk
    );
    event TraitRegistered(
        uint8 indexed layer,
        uint16 indexed traitId,
        uint32 nameOffset,
        uint16 nameLength,
        uint32 artOffset,
        uint32 artLength
    );
    event StoreFrozenPermanently(bytes32 indexed catalogHash, uint16 traitCount, uint256 chunks);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenMutable() {
        if (frozen) revert StoreFrozen();
        _;
    }

    constructor(address initialOwner, uint16 expectedTraitCount_) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (expectedTraitCount_ == 0) revert InvalidExpectedTraitCount();
        owner = initialOwner;
        expectedTraitCount = expectedTraitCount_;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function appendChunk(bytes calldata payload) external onlyOwner whenMutable returns (address) {
        if (chunksSealed) revert ChunksAlreadySealed();
        if (payload.length != CHUNK_PAYLOAD_BYTES) revert InvalidChunkLength(payload.length);
        return _storeChunk(payload, false);
    }

    function appendFinalChunk(bytes calldata payload)
        external
        onlyOwner
        whenMutable
        returns (address pointer)
    {
        if (chunksSealed) revert ChunksAlreadySealed();
        if (payload.length == 0 || payload.length > CHUNK_PAYLOAD_BYTES) {
            revert InvalidChunkLength(payload.length);
        }
        pointer = _storeChunk(payload, true);
        chunksSealed = true;
    }

    function setTraitRecords(TraitInput[] calldata inputs) external onlyOwner whenMutable {
        if (!chunksSealed) revert ChunksNotSealed();
        for (uint256 i; i < inputs.length; ++i) {
            TraitInput calldata input = inputs[i];
            if (input.layer >= LAYER_COUNT) revert InvalidLayer(input.layer);
            if (input.traitId == 0) revert InvalidTraitId();
            if (input.nameLength == 0) revert EmptyTraitName();
            if (input.artLength == 0) revert EmptyTraitArt();
            _validateSpan(input.nameOffset, input.nameLength);
            _validateSpan(input.artOffset, input.artLength);

            uint24 key = _traitKey(input.layer, input.traitId);
            if (!_traits[key].exists) registeredTraitCount += 1;
            _traits[key] = TraitRecord({
                nameOffset: input.nameOffset,
                nameLength: input.nameLength,
                artOffset: input.artOffset,
                artLength: input.artLength,
                exists: true
            });
            emit TraitRegistered(
                input.layer,
                input.traitId,
                input.nameOffset,
                input.nameLength,
                input.artOffset,
                input.artLength
            );
        }
    }

    function freeze(bytes32 catalogHash_) external onlyOwner whenMutable {
        if (!chunksSealed) revert ChunksNotSealed();
        if (registeredTraitCount != expectedTraitCount) {
            revert TraitCountIncomplete(expectedTraitCount, registeredTraitCount);
        }
        if (catalogHash_ == bytes32(0)) revert EmptyCatalogHash();
        catalogHash = catalogHash_;
        frozen = true;
        emit StoreFrozenPermanently(catalogHash_, registeredTraitCount, _chunks.length);
    }

    function traitExists(uint8 layer, uint16 traitId) external view override returns (bool) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        return traitId == 0 || _traits[_traitKey(layer, traitId)].exists;
    }

    function traitName(uint8 layer, uint16 traitId) external view override returns (string memory) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        if (traitId == 0) return "None";
        TraitRecord memory record = _traitRecord(layer, traitId);
        return string(_read(record.nameOffset, record.nameLength));
    }

    function traitSVG(uint8 layer, uint16 traitId) external view override returns (string memory) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        if (traitId == 0) return "";
        TraitRecord memory record = _traitRecord(layer, traitId);
        return string(PixelSVG.render(_read(record.artOffset, record.artLength)));
    }

    function traitPackedData(uint8 layer, uint16 traitId) external view returns (bytes memory) {
        TraitRecord memory record = _traitRecord(layer, traitId);
        return _read(record.artOffset, record.artLength);
    }

    function validateTraitData(uint8 layer, uint16 traitId)
        external
        view
        returns (bytes32 packedHash, bytes32 svgHash, uint256 svgBytes)
    {
        TraitRecord memory record = _traitRecord(layer, traitId);
        bytes memory packed = _read(record.artOffset, record.artLength);
        bytes memory svg = PixelSVG.render(packed);
        return (keccak256(packed), keccak256(svg), svg.length);
    }

    function traitRecord(uint8 layer, uint16 traitId) external view returns (TraitRecord memory) {
        return _traitRecord(layer, traitId);
    }

    function chunkCount() external view returns (uint256) {
        return _chunks.length;
    }

    function chunkAt(uint256 index) external view returns (address) {
        return _chunks[index];
    }

    function payloadSlice(uint32 offset, uint32 length) external view returns (bytes memory) {
        _validateSpan(offset, length);
        return _read(offset, length);
    }

    function layerName(uint8 layer) external pure override returns (string memory) {
        if (layer == 0) return "Background";
        if (layer == 1) return "Droid";
        if (layer == 2) return "Conditions";
        if (layer == 3) return "Clothes";
        if (layer == 4) return "Mouth";
        if (layer == 5) return "Eyes";
        if (layer == 6) return "Hat";
        if (layer == 7) return "Accessories";
        if (layer == 8) return "Accessories 2";
        revert InvalidLayer(layer);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function _storeChunk(bytes calldata payload, bool finalChunk)
        private
        returns (address pointer)
    {
        uint256 nextTotal = uint256(totalPayloadBytes) + payload.length;
        if (nextTotal > type(uint32).max) revert PayloadTooLarge();
        pointer = BytecodeStorage.write(payload);
        uint256 index = _chunks.length;
        _chunks.push(pointer);
        totalPayloadBytes = uint32(nextTotal);
        emit ChunkStored(index, pointer, payload.length, keccak256(payload), finalChunk);
    }

    function _read(uint32 offset, uint32 length) private view returns (bytes memory output) {
        _validateSpan(offset, length);
        output = new bytes(length);
        uint256 sourceCursor = offset;
        uint256 destinationCursor;
        uint256 remaining = length;

        while (remaining != 0) {
            uint256 chunkIndex = sourceCursor / CHUNK_PAYLOAD_BYTES;
            uint256 chunkOffset = sourceCursor % CHUNK_PAYLOAD_BYTES;
            uint256 available = CHUNK_PAYLOAD_BYTES - chunkOffset;
            uint256 amount = remaining < available ? remaining : available;
            BytecodeStorage.copy(
                _chunks[chunkIndex], chunkOffset, amount, output, destinationCursor
            );
            sourceCursor += amount;
            destinationCursor += amount;
            remaining -= amount;
        }
    }

    function _validateSpan(uint32 offset, uint32 length) private view {
        if (uint256(offset) + length > totalPayloadBytes) {
            revert InvalidPayloadSpan(offset, length);
        }
    }

    function _traitRecord(uint8 layer, uint16 traitId)
        private
        view
        returns (TraitRecord memory record)
    {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        if (traitId == 0) revert InvalidTraitId();
        record = _traits[_traitKey(layer, traitId)];
        if (!record.exists) revert TraitMissing(layer, traitId);
    }

    function _traitKey(uint8 layer, uint16 traitId) private pure returns (uint24) {
        return (uint24(layer) << 16) | uint24(traitId);
    }
}
