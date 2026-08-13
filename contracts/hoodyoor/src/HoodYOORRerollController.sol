// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHoodYOORCollection } from "./interfaces/IHoodYOORCollection.sol";
import { IHoodYOOREnergyBank } from "./interfaces/IHoodYOOREnergyBank.sol";
import { IHoodYOORRerollController } from "./interfaces/IHoodYOORRerollController.sol";
import { IHoodYOORTraitRules } from "./interfaces/IHoodYOORTraitRules.sol";
import { SignatureChecker } from "./lib/SignatureChecker.sol";

/// @notice Replay-safe, relayer-compatible Energy rerolls for HoodYØØR.
contract HoodYOORRerollController is IHoodYOORRerollController {
    uint8 public constant ACTION_SINGLE = 1;
    uint8 public constant ACTION_ALL = 2;
    uint8 public constant ALL_LAYERS = type(uint8).max;
    uint8 public constant LAYER_COUNT = 9;
    uint8 public constant FIRST_MUTABLE_LAYER = 2;
    uint256 public constant REROLL_ALL_COST = 1_000;

    bytes32 public constant REROLL_TYPEHASH = keccak256(
        "RerollAuthorization(uint256 tokenId,address tokenOwner,uint256 expectedTraits,uint256 nextTraits,uint8 action,uint8 layer,uint256 energyCost,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("HoodYOORRerollController");
    bytes32 private constant VERSION_HASH = keccak256("1");

    IHoodYOORCollection public immutable collection;
    IHoodYOOREnergyBank public immutable energyBank;
    IHoodYOORTraitRules public immutable traitRules;
    uint256 private immutable _deploymentChainId;
    bytes32 private immutable _deploymentDomainSeparator;

    address public owner;
    address public pendingOwner;
    address public resultSigner;
    bool public paused;
    uint256 private _reentrancyStatus = 1;

    mapping(uint256 tokenId => uint256) public tokenNonces;

    error NotOwner();
    error NotPendingOwner();
    error NotTokenOwner();
    error ZeroAddress();
    error InvalidContract();
    error TraitRulesNotFrozen();
    error ControllerPaused();
    error ReentrantCall();
    error AuthorizationExpired();
    error InvalidNonce(uint256 expected, uint256 supplied);
    error TokenOwnerChanged();
    error StaleTraitState();
    error InvalidOwnerSignature();
    error InvalidResultSignature();
    error InvalidAction(uint8 action);
    error InvalidLayer(uint8 layer);
    error EmptyLayer(uint8 layer);
    error EmptyNextTrait(uint8 layer);
    error TraitUnchanged(uint8 layer);
    error UnexpectedTraitChanges();
    error InvalidRerollAll();
    error IncompatibleTraits();
    error IncorrectEnergyCost(uint256 expected, uint256 supplied);

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ResultSignerUpdated(address indexed previousSigner, address indexed nextSigner);
    event PauseStateUpdated(bool paused);
    event RerollNonceInvalidated(
        uint256 indexed tokenId, address indexed tokenOwner, uint256 nonce
    );
    event RerollConfirmed(
        uint256 indexed tokenId,
        address indexed tokenOwner,
        uint8 indexed action,
        uint8 layer,
        uint256 previousTraits,
        uint256 nextTraits,
        uint256 energyCost,
        uint256 nonce
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ControllerPaused();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus != 1) revert ReentrantCall();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    constructor(
        address initialOwner,
        address collection_,
        address energyBank_,
        address traitRules_,
        address resultSigner_
    ) {
        if (
            initialOwner == address(0) || collection_ == address(0) || energyBank_ == address(0)
                || traitRules_ == address(0) || resultSigner_ == address(0)
        ) revert ZeroAddress();
        if (collection_.code.length == 0 || energyBank_.code.length == 0) {
            revert InvalidContract();
        }
        if (traitRules_.code.length == 0) revert InvalidContract();
        if (!IHoodYOORTraitRules(traitRules_).frozen()) revert TraitRulesNotFrozen();

        owner = initialOwner;
        collection = IHoodYOORCollection(collection_);
        energyBank = IHoodYOOREnergyBank(energyBank_);
        traitRules = IHoodYOORTraitRules(traitRules_);
        resultSigner = resultSigner_;
        _deploymentChainId = block.chainid;
        _deploymentDomainSeparator = _buildDomainSeparator();

        emit OwnershipTransferred(address(0), initialOwner);
        emit ResultSignerUpdated(address(0), resultSigner_);
    }

    function quoteEnergy(uint256 tokenId, uint8 layer, uint16 nextTraitId)
        external
        view
        override
        returns (uint256)
    {
        uint256 currentTraits = collection.tokenTraits(tokenId);
        uint256 nextTraits = _replaceTrait(currentTraits, layer, nextTraitId);
        return _validateSingle(currentTraits, nextTraits, layer);
    }

    function quoteRerollAll(uint256 tokenId, uint256 nextTraits)
        external
        view
        override
        returns (uint256)
    {
        _validateRerollAll(collection.tokenTraits(tokenId), nextTraits);
        return REROLL_ALL_COST;
    }

    function rerollDigest(RerollAuthorization calldata authorization)
        public
        view
        override
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                REROLL_TYPEHASH,
                authorization.tokenId,
                authorization.tokenOwner,
                authorization.expectedTraits,
                authorization.nextTraits,
                authorization.action,
                authorization.layer,
                authorization.energyCost,
                authorization.nonce,
                authorization.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function confirmReroll(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external override whenNotPaused nonReentrant {
        if (block.timestamp > authorization.deadline) {
            revert AuthorizationExpired();
        }

        uint256 expectedNonce = tokenNonces[authorization.tokenId];
        if (authorization.nonce != expectedNonce) {
            revert InvalidNonce(expectedNonce, authorization.nonce);
        }
        if (collection.ownerOf(authorization.tokenId) != authorization.tokenOwner) {
            revert TokenOwnerChanged();
        }
        uint256 currentTraits = collection.tokenTraits(authorization.tokenId);
        if (currentTraits != authorization.expectedTraits) revert StaleTraitState();

        uint256 expectedCost;
        if (authorization.action == ACTION_SINGLE) {
            expectedCost =
                _validateSingle(currentTraits, authorization.nextTraits, authorization.layer);
        } else if (authorization.action == ACTION_ALL) {
            if (authorization.layer != ALL_LAYERS) revert InvalidLayer(authorization.layer);
            _validateRerollAll(currentTraits, authorization.nextTraits);
            expectedCost = REROLL_ALL_COST;
        } else {
            revert InvalidAction(authorization.action);
        }
        if (authorization.energyCost != expectedCost) {
            revert IncorrectEnergyCost(expectedCost, authorization.energyCost);
        }

        bytes32 digest = rerollDigest(authorization);
        if (!SignatureChecker.isValidSignatureNow(authorization.tokenOwner, digest, ownerSignature))
        {
            revert InvalidOwnerSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(resultSigner, digest, resultSignature)) {
            revert InvalidResultSignature();
        }

        tokenNonces[authorization.tokenId] = expectedNonce + 1;
        bytes32 spendReason = keccak256(
            abi.encode(
                "HOODYOOR_REROLL",
                authorization.tokenId,
                authorization.action,
                authorization.layer,
                expectedNonce,
                authorization.nextTraits
            )
        );
        energyBank.spendEnergy(authorization.tokenOwner, expectedCost, spendReason);
        collection.applyReroll(authorization.tokenId, authorization.nextTraits);

        emit RerollConfirmed(
            authorization.tokenId,
            authorization.tokenOwner,
            authorization.action,
            authorization.layer,
            currentTraits,
            authorization.nextTraits,
            expectedCost,
            expectedNonce
        );
    }

    function invalidateNonce(uint256 tokenId) external {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        uint256 nextNonce = tokenNonces[tokenId] + 1;
        tokenNonces[tokenId] = nextNonce;
        emit RerollNonceInvalidated(tokenId, msg.sender, nextNonce);
    }

    function domainSeparator() public view returns (bytes32) {
        return
            block.chainid == _deploymentChainId
                ? _deploymentDomainSeparator
                : _buildDomainSeparator();
    }

    function energyCostForLayer(uint8 layer) public pure returns (uint256) {
        if (layer == 4 || layer == 5) return 100;
        if (layer == 2 || layer == 3 || layer == 6) return 200;
        if (layer == 7 || layer == 8) return 300;
        revert InvalidLayer(layer);
    }

    function setResultSigner(address nextSigner) external onlyOwner {
        if (nextSigner == address(0)) revert ZeroAddress();
        address previousSigner = resultSigner;
        resultSigner = nextSigner;
        emit ResultSignerUpdated(previousSigner, nextSigner);
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PauseStateUpdated(nextPaused);
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

    function _validateSingle(uint256 currentTraits, uint256 nextTraits, uint8 layer)
        private
        view
        returns (uint256)
    {
        if (layer < FIRST_MUTABLE_LAYER || layer >= LAYER_COUNT) revert InvalidLayer(layer);
        uint256 shift = uint256(layer) * 16;
        uint256 mask = uint256(0xffff) << shift;
        uint16 currentTraitId = uint16(currentTraits >> shift);
        uint16 nextTraitId = uint16(nextTraits >> shift);
        if (currentTraitId == 0) revert EmptyLayer(layer);
        if (nextTraitId == 0) revert EmptyNextTrait(layer);
        if (currentTraitId == nextTraitId) revert TraitUnchanged(layer);
        if ((currentTraits & ~mask) != (nextTraits & ~mask)) revert UnexpectedTraitChanges();
        if (!traitRules.isCompatible(nextTraits)) revert IncompatibleTraits();
        return energyCostForLayer(layer);
    }

    function _validateRerollAll(uint256 currentTraits, uint256 nextTraits) private view {
        if (uint32(currentTraits) != uint32(nextTraits)) revert UnexpectedTraitChanges();

        bool changed;
        for (uint8 layer = FIRST_MUTABLE_LAYER; layer < LAYER_COUNT; ++layer) {
            uint256 shift = uint256(layer) * 16;
            uint16 currentTraitId = uint16(currentTraits >> shift);
            uint16 nextTraitId = uint16(nextTraits >> shift);
            if (currentTraitId == 0) {
                if (nextTraitId != 0) revert InvalidRerollAll();
            } else {
                if (nextTraitId == 0 || nextTraitId == currentTraitId) revert InvalidRerollAll();
                changed = true;
            }
        }
        if (!changed) revert InvalidRerollAll();
        if (!traitRules.isCompatible(nextTraits)) revert IncompatibleTraits();
    }

    function _replaceTrait(uint256 packedTraits, uint8 layer, uint16 nextTraitId)
        private
        pure
        returns (uint256)
    {
        if (layer >= LAYER_COUNT) revert InvalidLayer(layer);
        uint256 shift = uint256(layer) * 16;
        uint256 mask = uint256(0xffff) << shift;
        return (packedTraits & ~mask) | (uint256(nextTraitId) << shift);
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }
}
