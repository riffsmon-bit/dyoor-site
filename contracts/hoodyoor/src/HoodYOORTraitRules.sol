// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHoodYOORTraitRules } from "./interfaces/IHoodYOORTraitRules.sol";

/// @notice Frozen pairwise incompatibility registry for HoodYØØR trait combinations.
contract HoodYOORTraitRules is IHoodYOORTraitRules {
    uint8 public constant LAYER_COUNT = 9;
    uint256 public constant PACKED_TRAIT_MASK = (uint256(1) << (LAYER_COUNT * 16)) - 1;

    struct PairInput {
        uint8 layerA;
        uint16 traitA;
        uint8 layerB;
        uint16 traitB;
    }

    address public owner;
    address public pendingOwner;
    uint16 public immutable expectedPairCount;
    uint16 public pairCount;
    bool public override frozen;
    bytes32 public rulesHash;

    mapping(uint64 pair => bool) private _incompatible;

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InvalidExpectedPairCount();
    error InvalidLayer(uint8 layer);
    error InvalidTraitId();
    error SameLayerPair();
    error RulesFrozen();
    error PairCountIncomplete(uint16 expected, uint16 actual);
    error EmptyRulesHash();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event IncompatibilityStored(
        uint8 indexed layerA,
        uint16 indexed traitA,
        uint8 indexed layerB,
        uint16 traitB,
        uint64 pairKey
    );
    event RulesFrozenPermanently(bytes32 indexed rulesHash, uint16 pairCount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenMutable() {
        if (frozen) revert RulesFrozen();
        _;
    }

    constructor(address initialOwner, uint16 expectedPairCount_) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (expectedPairCount_ == 0) revert InvalidExpectedPairCount();
        owner = initialOwner;
        expectedPairCount = expectedPairCount_;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function setIncompatibilities(PairInput[] calldata pairs) external onlyOwner whenMutable {
        for (uint256 i; i < pairs.length; ++i) {
            PairInput calldata pair = pairs[i];
            uint64 key = pairKey(pair.layerA, pair.traitA, pair.layerB, pair.traitB);
            if (!_incompatible[key]) {
                _incompatible[key] = true;
                pairCount += 1;
                emit IncompatibilityStored(pair.layerA, pair.traitA, pair.layerB, pair.traitB, key);
            }
        }
    }

    function freeze(bytes32 rulesHash_) external onlyOwner whenMutable {
        if (pairCount != expectedPairCount) {
            revert PairCountIncomplete(expectedPairCount, pairCount);
        }
        if (rulesHash_ == bytes32(0)) revert EmptyRulesHash();
        rulesHash = rulesHash_;
        frozen = true;
        emit RulesFrozenPermanently(rulesHash_, pairCount);
    }

    function incompatible(uint8 layerA, uint16 traitA, uint8 layerB, uint16 traitB)
        external
        view
        returns (bool)
    {
        return _incompatible[pairKey(layerA, traitA, layerB, traitB)];
    }

    function isCompatible(uint256 packedTraits) external view override returns (bool) {
        if ((packedTraits & ~PACKED_TRAIT_MASK) != 0) return false;

        uint24[9] memory endpoints;
        for (uint8 layer; layer < LAYER_COUNT; ++layer) {
            uint16 traitId = uint16(packedTraits >> (uint256(layer) * 16));
            if (traitId != 0) endpoints[layer] = _endpoint(layer, traitId);
        }

        for (uint8 left; left < LAYER_COUNT; ++left) {
            if (endpoints[left] == 0) continue;
            for (uint8 right = left + 1; right < LAYER_COUNT; ++right) {
                if (
                    endpoints[right] != 0
                        && _incompatible[_orderedPair(endpoints[left], endpoints[right])]
                ) return false;
            }
        }
        return true;
    }

    function pairKey(uint8 layerA, uint16 traitA, uint8 layerB, uint16 traitB)
        public
        pure
        returns (uint64)
    {
        if (layerA >= LAYER_COUNT) revert InvalidLayer(layerA);
        if (layerB >= LAYER_COUNT) revert InvalidLayer(layerB);
        if (traitA == 0 || traitB == 0) revert InvalidTraitId();
        if (layerA == layerB) revert SameLayerPair();
        return _orderedPair(_endpoint(layerA, traitA), _endpoint(layerB, traitB));
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

    function _endpoint(uint8 layer, uint16 traitId) private pure returns (uint24) {
        return (uint24(layer) << 16) | uint24(traitId);
    }

    function _orderedPair(uint24 endpointA, uint24 endpointB) private pure returns (uint64) {
        (uint24 lower, uint24 upper) =
            endpointA < endpointB ? (endpointA, endpointB) : (endpointB, endpointA);
        return (uint64(lower) << 24) | uint64(upper);
    }
}
