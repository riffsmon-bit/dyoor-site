// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MerkleProof } from "./lib/MerkleProof.sol";
import { Base64 } from "./lib/Base64.sol";
import { Strings } from "./lib/Strings.sol";
import { IHoodYOOREnergyBank } from "./interfaces/IHoodYOOREnergyBank.sol";
import { IHoodYOORRenderer } from "./interfaces/IHoodYOORRenderer.sol";
import {
    IERC165,
    IERC721,
    IERC721Metadata,
    IERC721Receiver,
    IERC2981
} from "./interfaces/TokenInterfaces.sol";

/// @notice HoodYØØR Phase-1 collection contract.
/// @dev Initial token assignments must be loaded and frozen before minting can start.
contract HoodYOOR is IERC721Metadata, IERC2981 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 3_333;
    uint256 public constant OWNER_RESERVE_ALLOCATION = 150;
    uint256 public constant PAID_ALLOCATION = MAX_SUPPLY - OWNER_RESERVE_ALLOCATION;
    uint256 public constant SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY = 1_667;
    uint256 public constant MINT_PRICE = 0.0025 ether;
    uint256 public constant DEFAULT_MINT_ENERGY_REWARD = 1_000;
    uint96 public constant ROYALTY_BPS = 300;
    uint96 public constant BPS_DENOMINATOR = 10_000;

    uint8 public constant LAYER_COUNT = 9;
    uint8 public constant TRAIT_BITS = 16;
    uint16 public constant ONE_OF_ONE_BACKGROUND_COUNT = 10;
    uint16 public constant INDAHOOD_BACKGROUND_ID = 122;
    uint16 public constant INDAHOOD_BACKGROUND_SUPPLY = 3_323;
    uint16 public constant REVEAL_DELAY_BLOCKS = 64;
    uint16 public constant REVEAL_HASH_WINDOW = 256;
    uint8 public constant SHUFFLE_ROUNDS = 16;

    uint256 private constant LOCKED_LAYER_MASK = type(uint32).max;
    uint256 private constant PACKED_TRAIT_MASK = (uint256(1) << 144) - 1;

    address public owner;
    address public pendingOwner;
    address public immutable treasury;
    address public immutable royaltyReceiver;

    IHoodYOORRenderer public renderer;
    IHoodYOOREnergyBank public energyBank;
    address public rerollController;
    bool public rendererFrozen;
    bool public energyConfigurationFrozen;
    bool public rerollControllerFrozen;
    bool public initialTraitsFrozen;
    bool public gtdSaleActive;
    bool public publicSaleActive;
    bool public mintingFinalized;
    bool public revealed;
    bool public secondaryTradingUnlocked;
    bool public ownerReserveMinted;

    bytes32 public gtdMerkleRoot;
    bytes32 public provenanceHash;
    bytes32 public revealCommitment;
    bytes32 public revealSeed;
    uint16 public publicWalletLimit = 3;
    uint256 public mintEnergyReward = DEFAULT_MINT_ENERGY_REWARD;
    uint256 public revealBlock;

    uint256 public totalSupply;
    uint256 public paidMinted;
    uint256 public initialTraitsAssigned;
    uint256 public indahoodBackgroundsAssigned;
    uint256 private _nextTokenId = 1;
    uint256 private _reentrancyStatus = 1;
    bytes32 private _pendingRevealSecret;

    mapping(uint256 tokenId => address) private _owners;
    mapping(address account => uint256) private _balances;
    mapping(uint256 tokenId => address) private _tokenApprovals;
    mapping(address account => mapping(address operator => bool)) private _operatorApprovals;

    mapping(uint256 tokenId => uint256) private _packedTraits;
    mapping(uint256 tokenId => bool) public traitsInitialized;
    mapping(uint16 backgroundId => bool) public oneOfOneBackgroundAssigned;

    mapping(address account => uint256) public gtdMintedBy;
    mapping(address account => uint256) public publicMintedBy;

    error NotOwner();
    error NotPendingOwner();
    error NotRerollController();
    error ZeroAddress();
    error ZeroQuantity();
    error LengthMismatch();
    error InvalidTokenId(uint256 tokenId);
    error TokenDoesNotExist(uint256 tokenId);
    error UnsafeRecipient();
    error NotAuthorized();
    error IncorrectOwner();
    error ApprovalToCurrentOwner();
    error ApproveToCaller();
    error AllocationExceeded();
    error IncorrectPayment(uint256 expected, uint256 received);
    error SaleInactive();
    error SalePhasesOverlap();
    error InvalidGTDProof();
    error WalletLimitExceeded();
    error InitialTraitsFrozen();
    error InitialTraitsNotFrozen();
    error TraitsNotRevealed();
    error InvalidPackedTraits();
    error InvalidBackground(uint16 backgroundId);
    error DuplicateOneOfOneBackground(uint16 backgroundId);
    error TooManyINDAHOODBackgrounds();
    error BackgroundCountsIncomplete();
    error LockedLayerChange();
    error InvalidRenderer();
    error InvalidEnergyBank();
    error InvalidEnergyReward();
    error EnergyConfigurationFrozen();
    error EnergyConfigurationNotFrozen();
    error RendererFrozen();
    error TraitStoreNotFrozen();
    error InvalidRerollController();
    error RerollControllerFrozen();
    error RerollControllerNotFrozen();
    error EmptyProvenanceHash();
    error EmptyRevealCommitment();
    error InvalidRevealSecret();
    error MintingAlreadyFinalized();
    error MintingNotFinalized();
    error NoTokensMinted();
    error AlreadyRevealed();
    error RevealNotReady(uint256 revealBlock);
    error RevealBlockExpired(uint256 revealBlock);
    error MissingGTDMerkleRoot();
    error OwnerReserveNotMinted();
    error SecondaryTradingLocked();
    error SecondaryTradingAlreadyUnlocked();
    error ReentrantCall();
    error TransferFailed();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RendererUpdated(address indexed renderer);
    event RendererFrozenPermanently(address indexed renderer);
    event EnergyConfigurationUpdated(address indexed energyBank, uint256 mintEnergyReward);
    event EnergyConfigurationFrozenPermanently(
        address indexed energyBank, uint256 mintEnergyReward
    );
    event RerollControllerUpdated(address indexed controller);
    event RerollControllerFrozenPermanently(address indexed controller);
    event InitialTraitsSet(uint256 indexed tokenId, uint256 packedTraits);
    event InitialTraitsFrozenPermanently(
        bytes32 indexed provenanceHash, bytes32 indexed revealCommitment
    );
    event MintingFinalized(uint256 indexed mintedSupply);
    event RevealRequested(uint256 indexed revealBlock, uint256 indexed mintedSupply);
    event RevealBlockRefreshed(uint256 indexed previousBlock, uint256 indexed nextBlock);
    event CollectionRevealed(bytes32 indexed revealSeed);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event SaleStateUpdated(bool gtdActive, bool publicActive);
    event GTDMerkleRootUpdated(bytes32 indexed root);
    event PublicWalletLimitUpdated(uint16 limit);
    event PaidMint(address indexed account, uint256 quantity, uint256 paid);
    event MintEnergyCredited(
        address indexed account,
        uint256 indexed firstTokenId,
        uint256 quantity,
        uint256 energy,
        bytes32 creditId
    );
    event OwnerReserveMinted(address indexed recipient, uint256 quantity);
    event SecondaryTradingUnlocked(
        address indexed operator, uint256 indexed mintedSupply, bool automatic
    );
    event RerollApplied(uint256 indexed tokenId, uint256 previousTraits, uint256 nextTraits);
    event Withdrawal(address indexed treasury, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus != 1) revert ReentrantCall();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    constructor(address initialOwner, address treasury_, address renderer_) {
        if (initialOwner == address(0) || treasury_ == address(0) || renderer_ == address(0)) {
            revert ZeroAddress();
        }
        if (renderer_.code.length == 0) revert InvalidRenderer();
        owner = initialOwner;
        treasury = treasury_;
        royaltyReceiver = treasury_;
        renderer = IHoodYOORRenderer(renderer_);
        emit OwnershipTransferred(address(0), initialOwner);
        emit RendererUpdated(renderer_);
    }

    receive() external payable { }

    function name() external pure override returns (string memory) {
        return unicode"HoodYØØR";
    }

    function symbol() external pure override returns (string memory) {
        return "HOOD";
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC721).interfaceId
            || interfaceId == type(IERC721Metadata).interfaceId
            || interfaceId == type(IERC2981).interfaceId || interfaceId == 0x49064906;
    }

    function balanceOf(address account) external view override returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view override returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert TokenDoesNotExist(tokenId);
    }

    function tokenURI(uint256 tokenId) external view override returns (string memory) {
        ownerOf(tokenId);
        if (!revealed) return _unrevealedTokenURI(tokenId);
        return renderer.tokenURI(tokenId, _packedTraits[_assignmentIdForToken(tokenId)]);
    }

    function tokenTraits(uint256 tokenId) external view returns (uint256) {
        ownerOf(tokenId);
        if (!revealed) revert TraitsNotRevealed();
        return _packedTraits[_assignmentIdForToken(tokenId)];
    }

    function assignmentIdForToken(uint256 tokenId) external view returns (uint256) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert InvalidTokenId(tokenId);
        if (!revealed) revert TraitsNotRevealed();
        return _assignmentIdForToken(tokenId);
    }

    function traitIdAt(uint256 packedTraits, uint8 layer) public pure returns (uint16) {
        if (layer >= LAYER_COUNT) revert InvalidPackedTraits();
        return uint16(packedTraits >> (uint256(layer) * TRAIT_BITS));
    }

    function gtdLeaf(address account, uint256 maxMint) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, maxMint))));
    }

    function mintGTD(uint256 quantity, uint256 maxMint, bytes32[] calldata proof)
        external
        payable
        nonReentrant
    {
        if (!gtdSaleActive) revert SaleInactive();
        if (quantity == 0) revert ZeroQuantity();
        if (!MerkleProof.verifyCalldata(proof, gtdMerkleRoot, gtdLeaf(msg.sender, maxMint))) {
            revert InvalidGTDProof();
        }
        if (gtdMintedBy[msg.sender] + quantity > maxMint) revert WalletLimitExceeded();
        _collectPaidMint(quantity);
        gtdMintedBy[msg.sender] += quantity;
        uint256 firstTokenId = _nextTokenId;
        _mintQuantity(msg.sender, quantity);
        _creditPaidMintEnergy(msg.sender, firstTokenId, quantity);
    }

    function mintPublic(uint256 quantity) external payable nonReentrant {
        if (!publicSaleActive) revert SaleInactive();
        if (quantity == 0) revert ZeroQuantity();
        if (publicMintedBy[msg.sender] + quantity > publicWalletLimit) {
            revert WalletLimitExceeded();
        }
        _collectPaidMint(quantity);
        publicMintedBy[msg.sender] += quantity;
        uint256 firstTokenId = _nextTokenId;
        _mintQuantity(msg.sender, quantity);
        _creditPaidMintEnergy(msg.sender, firstTokenId, quantity);
    }

    function setInitialTraits(uint256 tokenId, uint256 packedTraits) external onlyOwner {
        _setInitialTraits(tokenId, packedTraits);
    }

    function setInitialTraitsBatch(uint256[] calldata tokenIds, uint256[] calldata packedTraits)
        external
        onlyOwner
    {
        if (tokenIds.length != packedTraits.length) revert LengthMismatch();
        for (uint256 i; i < tokenIds.length; ++i) {
            _setInitialTraits(tokenIds[i], packedTraits[i]);
        }
    }

    function freezeInitialTraits(bytes32 provenanceHash_, bytes32 revealCommitment_)
        external
        onlyOwner
    {
        if (initialTraitsFrozen) revert InitialTraitsFrozen();
        if (provenanceHash_ == bytes32(0)) revert EmptyProvenanceHash();
        if (revealCommitment_ == bytes32(0)) revert EmptyRevealCommitment();
        if (
            initialTraitsAssigned != MAX_SUPPLY
                || indahoodBackgroundsAssigned != INDAHOOD_BACKGROUND_SUPPLY
        ) revert BackgroundCountsIncomplete();
        for (uint8 index; index < ONE_OF_ONE_BACKGROUND_COUNT;) {
            uint16 backgroundId = oneOfOneBackgroundIdAt(index);
            if (!oneOfOneBackgroundAssigned[backgroundId]) revert BackgroundCountsIncomplete();
            unchecked {
                ++index;
            }
        }
        initialTraitsFrozen = true;
        provenanceHash = provenanceHash_;
        revealCommitment = revealCommitment_;
        emit InitialTraitsFrozenPermanently(provenanceHash_, revealCommitment_);
    }

    function finalizeMintingAndRequestReveal(bytes32 revealSecret) external onlyOwner {
        if (mintingFinalized) revert MintingAlreadyFinalized();
        _requireLaunchReady();
        if (totalSupply == 0) revert NoTokensMinted();
        if (keccak256(abi.encodePacked(revealSecret)) != revealCommitment) {
            revert InvalidRevealSecret();
        }

        gtdSaleActive = false;
        publicSaleActive = false;
        mintingFinalized = true;
        _pendingRevealSecret = revealSecret;
        revealBlock = block.number + REVEAL_DELAY_BLOCKS;

        emit SaleStateUpdated(false, false);
        emit MintingFinalized(totalSupply);
        emit RevealRequested(revealBlock, totalSupply);
    }

    function refreshRevealBlock() external {
        if (!mintingFinalized) revert MintingNotFinalized();
        if (revealed) revert AlreadyRevealed();
        uint256 previousBlock = revealBlock;
        if (block.number <= previousBlock + REVEAL_HASH_WINDOW) {
            revert RevealNotReady(previousBlock + REVEAL_HASH_WINDOW + 1);
        }
        revealBlock = block.number + REVEAL_DELAY_BLOCKS;
        emit RevealBlockRefreshed(previousBlock, revealBlock);
    }

    function completeReveal() external {
        if (!mintingFinalized) revert MintingNotFinalized();
        if (revealed) revert AlreadyRevealed();
        uint256 targetBlock = revealBlock;
        if (block.number <= targetBlock) revert RevealNotReady(targetBlock + 1);
        bytes32 targetBlockHash = blockhash(targetBlock);
        if (targetBlockHash == bytes32(0)) revert RevealBlockExpired(targetBlock);

        bytes32 seed = keccak256(
            abi.encode(
                _pendingRevealSecret,
                targetBlockHash,
                provenanceHash,
                address(this),
                block.chainid,
                totalSupply
            )
        );
        delete _pendingRevealSecret;
        revealSeed = seed;
        revealed = true;

        emit CollectionRevealed(seed);
        emit BatchMetadataUpdate(1, totalSupply);
    }

    function applyReroll(uint256 tokenId, uint256 nextTraits) external {
        if (msg.sender != rerollController) revert NotRerollController();
        ownerOf(tokenId);
        if (!revealed) revert TraitsNotRevealed();
        if ((nextTraits & ~PACKED_TRAIT_MASK) != 0) revert InvalidPackedTraits();
        if (!renderer.validateTraits(nextTraits)) revert InvalidPackedTraits();

        uint256 assignmentId = _assignmentIdForToken(tokenId);
        uint256 previousTraits = _packedTraits[assignmentId];
        if ((previousTraits & LOCKED_LAYER_MASK) != (nextTraits & LOCKED_LAYER_MASK)) {
            revert LockedLayerChange();
        }

        _packedTraits[assignmentId] = nextTraits;
        emit RerollApplied(tokenId, previousTraits, nextTraits);
        emit MetadataUpdate(tokenId);
    }

    function setGTDMerkleRoot(bytes32 root) external onlyOwner {
        if (gtdSaleActive) revert SaleInactive();
        gtdMerkleRoot = root;
        emit GTDMerkleRootUpdated(root);
    }

    function setPublicWalletLimit(uint16 limit) external onlyOwner {
        if (publicSaleActive) revert SaleInactive();
        if (limit == 0) revert ZeroQuantity();
        publicWalletLimit = limit;
        emit PublicWalletLimitUpdated(limit);
    }

    function setEnergyConfiguration(address energyBank_, uint256 mintEnergyReward_)
        external
        onlyOwner
    {
        if (energyConfigurationFrozen) revert EnergyConfigurationFrozen();
        if (energyBank_ == address(0) || energyBank_.code.length == 0) {
            revert InvalidEnergyBank();
        }
        if (mintEnergyReward_ == 0) revert InvalidEnergyReward();
        energyBank = IHoodYOOREnergyBank(energyBank_);
        mintEnergyReward = mintEnergyReward_;
        emit EnergyConfigurationUpdated(energyBank_, mintEnergyReward_);
    }

    function freezeEnergyConfiguration() external onlyOwner {
        if (energyConfigurationFrozen) revert EnergyConfigurationFrozen();
        address configuredBank = address(energyBank);
        if (configuredBank == address(0) || configuredBank.code.length == 0) {
            revert InvalidEnergyBank();
        }
        if (mintEnergyReward == 0) revert InvalidEnergyReward();
        energyConfigurationFrozen = true;
        emit EnergyConfigurationFrozenPermanently(configuredBank, mintEnergyReward);
    }

    function secondaryTradingEnabled() public view returns (bool) {
        return secondaryTradingUnlocked || totalSupply >= SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY;
    }

    function unlockSecondaryTrading() external onlyOwner {
        if (secondaryTradingEnabled()) revert SecondaryTradingAlreadyUnlocked();
        secondaryTradingUnlocked = true;
        emit SecondaryTradingUnlocked(msg.sender, totalSupply, false);
    }

    function setSaleState(bool gtdActive, bool publicActive) external onlyOwner nonReentrant {
        if (gtdActive && publicActive) revert SalePhasesOverlap();
        if (mintingFinalized && (gtdActive || publicActive)) revert MintingAlreadyFinalized();
        if (gtdActive || publicActive) _requireLaunchReady();
        if (gtdActive && gtdMerkleRoot == bytes32(0)) revert MissingGTDMerkleRoot();
        if (gtdActive && !ownerReserveMinted) _mintOwnerReserve();
        if (publicActive && !ownerReserveMinted) revert OwnerReserveNotMinted();
        gtdSaleActive = gtdActive;
        publicSaleActive = publicActive;
        emit SaleStateUpdated(gtdActive, publicActive);
    }

    function setRenderer(address renderer_) external onlyOwner {
        if (rendererFrozen) revert RendererFrozen();
        if (renderer_ == address(0)) revert ZeroAddress();
        if (renderer_.code.length == 0) revert InvalidRenderer();
        renderer = IHoodYOORRenderer(renderer_);
        emit RendererUpdated(renderer_);
        if (totalSupply != 0) emit BatchMetadataUpdate(1, totalSupply);
    }

    function freezeRenderer() external onlyOwner {
        if (rendererFrozen) revert RendererFrozen();
        if (!renderer.isFrozen()) revert TraitStoreNotFrozen();
        rendererFrozen = true;
        emit RendererFrozenPermanently(address(renderer));
    }

    function setRerollController(address controller) external onlyOwner {
        if (rerollControllerFrozen) revert RerollControllerFrozen();
        rerollController = controller;
        emit RerollControllerUpdated(controller);
    }

    function freezeRerollController() external onlyOwner {
        if (rerollControllerFrozen) revert RerollControllerFrozen();
        if (rerollController == address(0)) revert ZeroAddress();
        if (rerollController.code.length == 0) revert InvalidRerollController();
        rerollControllerFrozen = true;
        emit RerollControllerFrozenPermanently(rerollController);
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        receiver = royaltyReceiver;
        royaltyAmount = salePrice * ROYALTY_BPS / BPS_DENOMINATOR;
    }

    function oneOfOneBackgroundIdAt(uint8 index) public pure returns (uint16) {
        if (index == 0) return 101;
        if (index == 1) return 102;
        if (index == 2) return 103;
        if (index == 3) return 105;
        if (index == 4) return 112;
        if (index == 5) return 115;
        if (index == 6) return 116;
        if (index == 7) return 117;
        if (index == 8) return 119;
        if (index == 9) return 120;
        revert InvalidBackground(index);
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        (bool success,) = treasury.call{ value: amount }("");
        if (!success) revert TransferFailed();
        emit Withdrawal(treasury, amount);
    }

    function approve(address approved, uint256 tokenId) external override {
        address tokenOwner = ownerOf(tokenId);
        if (approved == tokenOwner) revert ApprovalToCurrentOwner();
        if (approved != address(0) && !secondaryTradingEnabled()) {
            revert SecondaryTradingLocked();
        }
        if (msg.sender != tokenOwner && !_operatorApprovals[tokenOwner][msg.sender]) {
            revert NotAuthorized();
        }
        _tokenApprovals[tokenId] = approved;
        emit Approval(tokenOwner, approved, tokenId);
    }

    function getApproved(uint256 tokenId) external view override returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external override {
        if (operator == msg.sender) revert ApproveToCaller();
        if (approved && !secondaryTradingEnabled()) revert SecondaryTradingLocked();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator)
        external
        view
        override
        returns (bool)
    {
        return _operatorApprovals[account][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        address tokenOwner = ownerOf(tokenId);
        if (tokenOwner != from) revert IncorrectOwner();
        if (to == address(0)) revert ZeroAddress();
        if (!secondaryTradingEnabled()) revert SecondaryTradingLocked();
        if (!_isApprovedOrOwner(msg.sender, tokenId, tokenOwner)) revert NotAuthorized();

        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external override {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data)
        public
        override
    {
        transferFrom(from, to, tokenId);
        if (!_checkOnERC721Received(msg.sender, from, to, tokenId, data)) {
            revert UnsafeRecipient();
        }
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

    function _setInitialTraits(uint256 tokenId, uint256 packedTraits) private {
        if (initialTraitsFrozen) revert InitialTraitsFrozen();
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert InvalidTokenId(tokenId);
        if ((packedTraits & ~PACKED_TRAIT_MASK) != 0) revert InvalidPackedTraits();
        if (!renderer.validateTraits(packedTraits)) revert InvalidPackedTraits();

        uint16 backgroundId = traitIdAt(packedTraits, 0);
        uint16 droidId = traitIdAt(packedTraits, 1);
        if (droidId == 0) revert InvalidPackedTraits();

        if (traitsInitialized[tokenId]) {
            _unregisterBackground(traitIdAt(_packedTraits[tokenId], 0));
        } else {
            traitsInitialized[tokenId] = true;
            initialTraitsAssigned += 1;
        }

        _registerBackground(backgroundId);
        _packedTraits[tokenId] = packedTraits;
        emit InitialTraitsSet(tokenId, packedTraits);
        if (_owners[tokenId] != address(0)) emit MetadataUpdate(tokenId);
    }

    function _registerBackground(uint16 backgroundId) private {
        if (_isOneOfOneBackground(backgroundId)) {
            if (oneOfOneBackgroundAssigned[backgroundId]) {
                revert DuplicateOneOfOneBackground(backgroundId);
            }
            oneOfOneBackgroundAssigned[backgroundId] = true;
            return;
        }
        if (backgroundId != INDAHOOD_BACKGROUND_ID) revert InvalidBackground(backgroundId);
        if (indahoodBackgroundsAssigned >= INDAHOOD_BACKGROUND_SUPPLY) {
            revert TooManyINDAHOODBackgrounds();
        }
        indahoodBackgroundsAssigned += 1;
    }

    function _unregisterBackground(uint16 backgroundId) private {
        if (_isOneOfOneBackground(backgroundId)) {
            oneOfOneBackgroundAssigned[backgroundId] = false;
        } else if (backgroundId == INDAHOOD_BACKGROUND_ID) {
            indahoodBackgroundsAssigned -= 1;
        }
    }

    function _isOneOfOneBackground(uint16 backgroundId) private pure returns (bool) {
        return backgroundId == 101 || backgroundId == 102 || backgroundId == 103
            || backgroundId == 105 || backgroundId == 112 || backgroundId == 115
            || backgroundId == 116 || backgroundId == 117 || backgroundId == 119
            || backgroundId == 120;
    }

    function _collectPaidMint(uint256 quantity) private {
        if (paidMinted + quantity > PAID_ALLOCATION) revert AllocationExceeded();
        uint256 expected = MINT_PRICE * quantity;
        if (msg.value != expected) revert IncorrectPayment(expected, msg.value);
        paidMinted += quantity;
        emit PaidMint(msg.sender, quantity, msg.value);
    }

    function _mintOwnerReserve() private {
        ownerReserveMinted = true;
        _mintQuantity(owner, OWNER_RESERVE_ALLOCATION);
        emit OwnerReserveMinted(owner, OWNER_RESERVE_ALLOCATION);
    }

    function _mintQuantity(address to, uint256 quantity) private {
        if (mintingFinalized) revert MintingAlreadyFinalized();
        if (to == address(0)) revert ZeroAddress();
        if (totalSupply + quantity > MAX_SUPPLY) revert AllocationExceeded();

        for (uint256 i; i < quantity; ++i) {
            uint256 tokenId = _nextTokenId;
            if (!traitsInitialized[tokenId]) revert InvalidTokenId(tokenId);
            unchecked {
                _nextTokenId = tokenId + 1;
            }
            _safeMint(to, tokenId);
        }
    }

    function _creditPaidMintEnergy(address account, uint256 firstTokenId, uint256 quantity)
        private
    {
        uint256 reward = mintEnergyReward * quantity;
        bytes32 creditId = keccak256(
            abi.encode(
                "HOODYOOR_PAID_MINT_ENERGY",
                block.chainid,
                address(this),
                account,
                firstTokenId,
                quantity
            )
        );
        energyBank.creditEnergy(account, reward, creditId);
        emit MintEnergyCredited(account, firstTokenId, quantity, reward, creditId);
    }

    function _assignmentIdForToken(uint256 tokenId) private view returns (uint256) {
        uint256 index = tokenId - 1;
        bytes32 seed = revealSeed;

        // Each swap-or-not round is a bijection over the exact 3,333-item domain.
        // Their composition is therefore a fixed, gas-bounded permutation.
        for (uint256 round; round < SHUFFLE_ROUNDS; ++round) {
            uint256 pivot = uint256(keccak256(abi.encode(seed, round, uint8(0)))) % MAX_SUPPLY;
            uint256 partner = (pivot + MAX_SUPPLY - index) % MAX_SUPPLY;
            uint256 pairKey = index > partner ? index : partner;
            if ((uint256(keccak256(abi.encode(seed, round, pairKey, uint8(1)))) & 1) == 1) {
                index = partner;
            }
        }
        return index + 1;
    }

    function _unrevealedTokenURI(uint256 tokenId) private pure returns (string memory) {
        bytes memory svg = bytes(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" '
            'shape-rendering="crispEdges"><rect width="128" height="128" fill="#07110c"/>'
            '<rect x="8" y="8" width="112" height="112" fill="none" stroke="#00c805" '
            'stroke-width="4"/><rect x="40" y="32" width="48" height="64" fill="#00c805"/>'
            '<rect x="48" y="20" width="32" height="12" fill="#00c805"/>'
            '<rect x="60" y="12" width="8" height="8" fill="#00c805"/>'
            '<rect x="48" y="48" width="12" height="12" fill="#f3fff7"/>'
            '<rect x="68" y="48" width="12" height="12" fill="#f3fff7"/>'
            '<rect x="52" y="52" width="8" height="8" fill="#07110c"/>'
            '<rect x="68" y="52" width="8" height="8" fill="#07110c"/>'
            '<rect x="52" y="76" width="24" height="4" fill="#07110c"/>'
            '<text x="64" y="112" fill="#f3fff7" font-family="monospace" font-size="8" '
            'text-anchor="middle">REVEAL PENDING</text></svg>'
        );
        string memory json = string.concat(
            unicode'{"name":"HoodYØØR #',
            tokenId.toString(),
            '","description":"Fully onchain artwork reveals after minting is permanently closed.",'
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(svg),
            '","attributes":[{"trait_type":"Status","value":"Unrevealed"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _safeMint(address to, uint256 tokenId) private {
        _owners[tokenId] = to;
        _balances[to] += 1;
        totalSupply += 1;
        emit Transfer(address(0), to, tokenId);

        if (!_checkOnERC721Received(msg.sender, address(0), to, tokenId, "")) {
            revert UnsafeRecipient();
        }
        if (!secondaryTradingUnlocked && totalSupply == SECONDARY_TRADING_AUTO_UNLOCK_SUPPLY) {
            secondaryTradingUnlocked = true;
            emit SecondaryTradingUnlocked(msg.sender, totalSupply, true);
        }
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId, address tokenOwner)
        private
        view
        returns (bool)
    {
        return spender == tokenOwner || _tokenApprovals[tokenId] == spender
            || _operatorApprovals[tokenOwner][spender];
    }

    function _checkOnERC721Received(
        address operator,
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) private returns (bool) {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(operator, from, tokenId, data) returns (
            bytes4 retval
        ) {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch {
            return false;
        }
    }

    function _requireLaunchReady() private view {
        if (!initialTraitsFrozen || !rendererFrozen) revert InitialTraitsNotFrozen();
        if (!energyConfigurationFrozen) revert EnergyConfigurationNotFrozen();
        if (!rerollControllerFrozen) revert RerollControllerNotFrozen();
    }
}
