// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHoodYOORTraitStore } from "./interfaces/IHoodYOORTraitStore.sol";

/// @notice Stores SVG fragments and trait display names directly in contract storage.
/// The production asset pass may swap this implementation for bytecode-backed chunks
/// without changing the renderer or NFT interfaces.
contract HoodYOORTraitStore is IHoodYOORTraitStore {
    uint8 public constant LAYER_COUNT = 9;

    struct Trait {
        string name;
        string svg;
        bool exists;
    }

    address public owner;
    address public pendingOwner;
    bool public override frozen;

    mapping(uint8 layer => mapping(uint16 traitId => Trait)) private _traits;

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InvalidLayer(uint8 layer);
    error InvalidTraitId();
    error EmptyTraitName();
    error EmptySVG();
    error StoreFrozen();
    error TraitMissing(uint8 layer, uint16 traitId);
    error LengthMismatch();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TraitStored(
        uint8 indexed layer,
        uint16 indexed traitId,
        bytes32 indexed nameHash,
        bytes32 svgHash,
        uint256 svgBytes
    );
    event StoreFrozenPermanently();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenMutable() {
        if (frozen) revert StoreFrozen();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function setTrait(uint8 layer, uint16 traitId, string calldata name_, string calldata svg_)
        external
        onlyOwner
        whenMutable
    {
        _setTrait(layer, traitId, name_, svg_);
    }

    function setTraits(
        uint8[] calldata layers,
        uint16[] calldata traitIds,
        string[] calldata names,
        string[] calldata svgs
    ) external onlyOwner whenMutable {
        uint256 length = layers.length;
        if (length != traitIds.length || length != names.length || length != svgs.length) {
            revert LengthMismatch();
        }

        for (uint256 i; i < length; ++i) {
            _setTrait(layers[i], traitIds[i], names[i], svgs[i]);
        }
    }

    function traitExists(uint8 layer, uint16 traitId) external view override returns (bool) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        return traitId == 0 || _traits[layer][traitId].exists;
    }

    function traitName(uint8 layer, uint16 traitId) external view override returns (string memory) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        if (traitId == 0) return "None";
        Trait storage storedTrait = _traits[layer][traitId];
        if (!storedTrait.exists) revert TraitMissing(layer, traitId);
        return storedTrait.name;
    }

    function traitSVG(uint8 layer, uint16 traitId) external view override returns (string memory) {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        if (traitId == 0) return "";
        Trait storage storedTrait = _traits[layer][traitId];
        if (!storedTrait.exists) revert TraitMissing(layer, traitId);
        return storedTrait.svg;
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

    function freeze() external onlyOwner whenMutable {
        frozen = true;
        emit StoreFrozenPermanently();
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

    function _setTrait(uint8 layer, uint16 traitId, string calldata name_, string calldata svg_)
        private
    {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        if (traitId == 0) revert InvalidTraitId();
        if (bytes(name_).length == 0) revert EmptyTraitName();
        if (bytes(svg_).length == 0) revert EmptySVG();

        _traits[layer][traitId] = Trait({ name: name_, svg: svg_, exists: true });
        emit TraitStored(
            layer, traitId, keccak256(bytes(name_)), keccak256(bytes(svg_)), bytes(svg_).length
        );
    }
}
