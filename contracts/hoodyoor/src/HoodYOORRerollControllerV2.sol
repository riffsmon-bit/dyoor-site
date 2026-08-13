// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHoodYOORCollection } from "./interfaces/IHoodYOORCollection.sol";
import { IHoodYOOREnergyBank } from "./interfaces/IHoodYOOREnergyBank.sol";
import {
    IHoodYOORRerollControllerV2
} from "./interfaces/IHoodYOORRerollControllerV2.sol";
import { IHoodYOORTraitRules } from "./interfaces/IHoodYOORTraitRules.sol";
import { SignatureChecker } from "./lib/SignatureChecker.sol";

/// @notice Replay-safe HoodYØØR rerolls payable with Energy, native ETH, or USDG.
contract HoodYOORRerollControllerV2 is IHoodYOORRerollControllerV2 {
    uint8 public constant ACTION_SINGLE = 1;
    uint8 public constant ACTION_ALL = 2;
    uint8 public constant ALL_LAYERS = type(uint8).max;
    uint8 public constant LAYER_COUNT = 9;
    uint8 public constant FIRST_MUTABLE_LAYER = 2;
    uint256 public constant REROLL_ALL_COST = 1_000;

    uint8 public constant PAYMENT_ENERGY = 1;
    uint8 public constant PAYMENT_ETH = 2;
    uint8 public constant PAYMENT_USDG = 3;
    uint8 public constant USDG_DECIMALS = 6;

    bytes32 public constant REROLL_TYPEHASH = keccak256(
        "RerollAuthorization(uint256 tokenId,address tokenOwner,uint256 expectedTraits,uint256 nextTraits,uint8 action,uint8 layer,uint8 paymentMethod,address paymentToken,uint256 paymentAmount,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("HoodYOORRerollController");
    bytes32 private constant VERSION_HASH = keccak256("2");
    bytes4 private constant TRANSFER_FROM_SELECTOR = 0x23b872dd;
    bytes4 private constant DECIMALS_SELECTOR = 0x313ce567;

    IHoodYOORCollection public immutable collection;
    IHoodYOOREnergyBank public immutable energyBank;
    IHoodYOORTraitRules public immutable traitRules;
    address public immutable usdg;
    address public immutable treasury;
    uint256 private immutable _deploymentChainId;
    bytes32 private immutable _deploymentDomainSeparator;

    address public owner;
    address public pendingOwner;
    address public resultSigner;
    bool public paused;
    bool public paymentConfigurationFrozen;
    uint256 public weiPerEnergy;
    uint256 public usdgUnitsPerEnergy;
    uint256 private _reentrancyStatus = 1;

    mapping(uint256 tokenId => uint256) public tokenNonces;

    error NotOwner();
    error NotPendingOwner();
    error NotTokenOwner();
    error CallerIsNotTokenOwner();
    error ZeroAddress();
    error InvalidContract();
    error InvalidUSDG();
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
    error InvalidPaymentMethod(uint8 paymentMethod);
    error UnexpectedPaymentMethod(uint8 expected, uint8 supplied);
    error UnexpectedPaymentToken(address expected, address supplied);
    error IncorrectPaymentAmount(uint256 expected, uint256 supplied);
    error InvalidPaymentRate();
    error PaymentConfigurationIsFrozen();
    error PaymentConfigurationIsNotFrozen();
    error USDGTransferFailed();
    error TransferFailed();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ResultSignerUpdated(address indexed previousSigner, address indexed nextSigner);
    event PauseStateUpdated(bool paused);
    event PaymentRatesUpdated(uint256 weiPerEnergy, uint256 usdgUnitsPerEnergy);
    event PaymentConfigurationFrozenPermanently(
        address indexed usdg,
        address indexed treasury,
        uint256 weiPerEnergy,
        uint256 usdgUnitsPerEnergy
    );
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
        uint256 energyUnits,
        uint8 paymentMethod,
        address paymentToken,
        uint256 paymentAmount,
        uint256 nonce
    );
    event ETHWithdrawn(address indexed treasury, uint256 amount);

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
        address resultSigner_,
        address usdg_,
        address treasury_
    ) {
        if (
            initialOwner == address(0) || collection_ == address(0) || energyBank_ == address(0)
                || traitRules_ == address(0) || resultSigner_ == address(0) || usdg_ == address(0)
                || treasury_ == address(0)
        ) revert ZeroAddress();
        if (
            collection_.code.length == 0 || energyBank_.code.length == 0
                || traitRules_.code.length == 0 || usdg_.code.length == 0
        ) revert InvalidContract();
        if (!IHoodYOORTraitRules(traitRules_).frozen()) revert TraitRulesNotFrozen();
        if (!_hasSixDecimals(usdg_)) revert InvalidUSDG();

        owner = initialOwner;
        collection = IHoodYOORCollection(collection_);
        energyBank = IHoodYOOREnergyBank(energyBank_);
        traitRules = IHoodYOORTraitRules(traitRules_);
        resultSigner = resultSigner_;
        usdg = usdg_;
        treasury = treasury_;
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

    function quotePayment(uint256 energyUnits, uint8 paymentMethod)
        public
        view
        override
        returns (address paymentToken, uint256 paymentAmount)
    {
        if (energyUnits == 0) revert InvalidPaymentRate();
        if (paymentMethod == PAYMENT_ENERGY) {
            return (address(energyBank), energyUnits);
        }
        if (paymentMethod == PAYMENT_ETH) {
            if (weiPerEnergy == 0) revert InvalidPaymentRate();
            return (address(0), energyUnits * weiPerEnergy);
        }
        if (paymentMethod == PAYMENT_USDG) {
            if (usdgUnitsPerEnergy == 0) revert InvalidPaymentRate();
            return (usdg, energyUnits * usdgUnitsPerEnergy);
        }
        revert InvalidPaymentMethod(paymentMethod);
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
                authorization.paymentMethod,
                authorization.paymentToken,
                authorization.paymentAmount,
                authorization.nonce,
                authorization.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function confirmRerollEnergy(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external override whenNotPaused nonReentrant {
        (uint256 currentTraits, uint256 energyUnits, uint256 nonce) = _validateAndConsume(
            authorization, ownerSignature, resultSignature, PAYMENT_ENERGY
        );

        bytes32 spendReason = keccak256(
            abi.encode(
                "HOODYOOR_REROLL_ENERGY",
                authorization.tokenId,
                authorization.action,
                authorization.layer,
                nonce,
                authorization.nextTraits
            )
        );
        energyBank.spendEnergy(authorization.tokenOwner, energyUnits, spendReason);
        collection.applyReroll(authorization.tokenId, authorization.nextTraits);
        _emitConfirmation(authorization, currentTraits, energyUnits, nonce);
    }

    function confirmRerollETH(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external payable override whenNotPaused nonReentrant {
        if (msg.sender != authorization.tokenOwner) revert CallerIsNotTokenOwner();
        (uint256 currentTraits, uint256 energyUnits, uint256 nonce) = _validateAndConsume(
            authorization, ownerSignature, resultSignature, PAYMENT_ETH
        );
        if (msg.value != authorization.paymentAmount) {
            revert IncorrectPaymentAmount(authorization.paymentAmount, msg.value);
        }

        collection.applyReroll(authorization.tokenId, authorization.nextTraits);
        _emitConfirmation(authorization, currentTraits, energyUnits, nonce);
    }

    function confirmRerollUSDG(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature
    ) external override whenNotPaused nonReentrant {
        if (msg.sender != authorization.tokenOwner) revert CallerIsNotTokenOwner();
        (uint256 currentTraits, uint256 energyUnits, uint256 nonce) = _validateAndConsume(
            authorization, ownerSignature, resultSignature, PAYMENT_USDG
        );

        _safeUSDGTransferFrom(
            authorization.tokenOwner, treasury, authorization.paymentAmount
        );
        collection.applyReroll(authorization.tokenId, authorization.nextTraits);
        _emitConfirmation(authorization, currentTraits, energyUnits, nonce);
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

    function setPaymentRates(uint256 weiPerEnergy_, uint256 usdgUnitsPerEnergy_)
        external
        onlyOwner
    {
        if (paymentConfigurationFrozen) revert PaymentConfigurationIsFrozen();
        if (weiPerEnergy_ == 0 || usdgUnitsPerEnergy_ == 0) revert InvalidPaymentRate();
        weiPerEnergy = weiPerEnergy_;
        usdgUnitsPerEnergy = usdgUnitsPerEnergy_;
        emit PaymentRatesUpdated(weiPerEnergy_, usdgUnitsPerEnergy_);
    }

    function freezePaymentConfiguration() external onlyOwner {
        if (paymentConfigurationFrozen) revert PaymentConfigurationIsFrozen();
        if (weiPerEnergy == 0 || usdgUnitsPerEnergy == 0) revert InvalidPaymentRate();
        paymentConfigurationFrozen = true;
        emit PaymentConfigurationFrozenPermanently(
            usdg, treasury, weiPerEnergy, usdgUnitsPerEnergy
        );
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

    function withdrawETH() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        (bool success,) = treasury.call{ value: amount }("");
        if (!success) revert TransferFailed();
        emit ETHWithdrawn(treasury, amount);
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

    function _validateAndConsume(
        RerollAuthorization calldata authorization,
        bytes calldata ownerSignature,
        bytes calldata resultSignature,
        uint8 expectedPaymentMethod
    ) private returns (uint256 currentTraits, uint256 energyUnits, uint256 nonce) {
        if (!paymentConfigurationFrozen) revert PaymentConfigurationIsNotFrozen();
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired();

        nonce = tokenNonces[authorization.tokenId];
        if (authorization.nonce != nonce) revert InvalidNonce(nonce, authorization.nonce);
        if (collection.ownerOf(authorization.tokenId) != authorization.tokenOwner) {
            revert TokenOwnerChanged();
        }
        currentTraits = collection.tokenTraits(authorization.tokenId);
        if (currentTraits != authorization.expectedTraits) revert StaleTraitState();

        if (authorization.action == ACTION_SINGLE) {
            energyUnits =
                _validateSingle(currentTraits, authorization.nextTraits, authorization.layer);
        } else if (authorization.action == ACTION_ALL) {
            if (authorization.layer != ALL_LAYERS) revert InvalidLayer(authorization.layer);
            _validateRerollAll(currentTraits, authorization.nextTraits);
            energyUnits = REROLL_ALL_COST;
        } else {
            revert InvalidAction(authorization.action);
        }

        if (authorization.paymentMethod != expectedPaymentMethod) {
            revert UnexpectedPaymentMethod(expectedPaymentMethod, authorization.paymentMethod);
        }
        (address expectedToken, uint256 expectedAmount) =
            quotePayment(energyUnits, expectedPaymentMethod);
        if (authorization.paymentToken != expectedToken) {
            revert UnexpectedPaymentToken(expectedToken, authorization.paymentToken);
        }
        if (authorization.paymentAmount != expectedAmount) {
            revert IncorrectPaymentAmount(expectedAmount, authorization.paymentAmount);
        }

        bytes32 digest = rerollDigest(authorization);
        if (!SignatureChecker.isValidSignatureNow(authorization.tokenOwner, digest, ownerSignature))
        {
            revert InvalidOwnerSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(resultSigner, digest, resultSignature)) {
            revert InvalidResultSignature();
        }

        tokenNonces[authorization.tokenId] = nonce + 1;
    }

    function _emitConfirmation(
        RerollAuthorization calldata authorization,
        uint256 currentTraits,
        uint256 energyUnits,
        uint256 nonce
    ) private {
        emit RerollConfirmed(
            authorization.tokenId,
            authorization.tokenOwner,
            authorization.action,
            authorization.layer,
            currentTraits,
            authorization.nextTraits,
            energyUnits,
            authorization.paymentMethod,
            authorization.paymentToken,
            authorization.paymentAmount,
            nonce
        );
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

    function _safeUSDGTransferFrom(address from, address to, uint256 amount) private {
        (bool success, bytes memory result) = usdg.call(
            abi.encodeWithSelector(TRANSFER_FROM_SELECTOR, from, to, amount)
        );
        if (!success) revert USDGTransferFailed();
        if (result.length != 0) {
            if (result.length != 32 || !abi.decode(result, (bool))) revert USDGTransferFailed();
        }
    }

    function _hasSixDecimals(address token) private view returns (bool) {
        (bool success, bytes memory result) = token.staticcall(
            abi.encodeWithSelector(DECIMALS_SELECTOR)
        );
        return success && result.length == 32 && abi.decode(result, (uint256)) == USDG_DECIMALS;
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }
}
