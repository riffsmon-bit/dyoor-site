// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { ERC721ContractMetadata } from "seadrop/src/ERC721ContractMetadata.sol";
import { ERC721SeaDrop } from "seadrop/src/ERC721SeaDrop.sol";
import {
    ISeaDropTokenContractMetadata
} from "seadrop/src/interfaces/ISeaDropTokenContractMetadata.sol";

/**
 * @title DYOORSeason2SeaDrop
 * @notice D.Y.O.O.R Season 2 custom SeaDrop-compatible NFT contract.
 * @dev Paid mint schedules, presales, allowlists, wallet limits, and primary
 *      sale configuration are intended to live in OpenSea/SeaDrop. This
 *      contract keeps D.Y.O.O.R-specific reserve, airdrop, mutable metadata,
 *      ERC-4906, royalty, treasury, and ownership controls.
 */
contract DYOORSeason2SeaDrop is ERC721SeaDrop {
    uint256 public constant MAX_SUPPLY = 3_333;
    uint256 public constant AIRDROP_RESERVE = 610;
    uint256 public constant SEADROP_MAX_SUPPLY = MAX_SUPPLY - AIRDROP_RESERVE;
    uint96 public constant DEFAULT_ROYALTY_BPS = 500;
    string public constant FREEZE_METADATA_CONFIRMATION =
        "I_UNDERSTAND_METADATA_FREEZE_IS_IRREVERSIBLE";
    string public constant COLLECTION_MEANING = "Directive: Yield Opportunity Optimization Robots";

    address public treasury;
    address public metadataManager;
    bool public mintPaused;
    bool public airdropPaused;
    bool public metadataFrozen;
    uint256 public totalSeaDropMinted;
    uint256 public totalAirdropped;

    mapping(bytes32 => address) public externalSystems;
    mapping(bytes32 => bool) public airdropBatchExecuted;

    error InvalidSeaDropAddress();
    error InvalidTreasury();
    error MintPaused();
    error ZeroQuantity();
    error InvalidQuantity();
    error MaxSupplyExceeded(uint256 attempted, uint256 maxSupply);
    error SeaDropMintCapExceeded(uint256 attempted, uint256 maxSupply);
    error AirdropReserveExceeded(uint256 attempted, uint256 reserve);
    error MaxSupplyLocked(uint256 attempted, uint256 locked);
    error MetadataIsFrozen();
    error MetadataAlreadyFrozen();
    error InvalidMetadataFreezeConfirmation();
    error WithdrawFailed();
    error NoTreasuryBalance();
    error UnauthorizedSeaDrop();
    error InvalidRecipient();
    error InvalidArrayLength();
    error EmptyAirdropBatch();
    error AirdropPaused();
    error AirdropBatchAlreadyExecuted(bytes32 batchId);
    error InvalidBatchId();
    error InvalidMetadataRange();
    error RenounceOwnershipDisabled();

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event MetadataManagerUpdated(address indexed previousManager, address indexed newManager);
    event MintPausedUpdated(bool paused);
    event AirdropPausedUpdated(bool paused);
    event MetadataFrozen();
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event ExternalSystemUpdated(bytes32 indexed systemId, address indexed systemAddress);
    event AirdropBatchExecuted(
        bytes32 indexed batchId,
        uint256 indexed batchIndex,
        uint256 recipientCount,
        uint256 quantityMinted,
        uint256 firstTokenId,
        uint256 lastTokenId
    );
    event MetadataUpdate(uint256 _tokenId);

    constructor(string memory name_, string memory symbol_, address[] memory allowedSeaDrop_)
        ERC721SeaDrop(name_, symbol_, allowedSeaDrop_)
    {
        _validateSeaDrops(allowedSeaDrop_, true);

        treasury = msg.sender;

        _maxSupply = MAX_SUPPLY;
        emit MaxSupplyUpdated(MAX_SUPPLY);

        _royaltyInfo = ISeaDropTokenContractMetadata.RoyaltyInfo({
            royaltyAddress: msg.sender, royaltyBps: DEFAULT_ROYALTY_BPS
        });
        emit RoyaltyInfoUpdated(msg.sender, DEFAULT_ROYALTY_BPS);
    }

    receive() external payable { }

    /**
     * @notice SeaDrop mint entrypoint.
     * @dev This intentionally keeps the official SeaDrop entrypoint, with the
     *      minimum local checks D.Y.O.O.R needs for pause and reserve safety.
     *      SeaDrop still manages presale/public schedules, prices, proofs,
     *      fee recipients, and wallet limits.
     */
    function mintSeaDrop(address minter, uint256 quantity) external override nonReentrant {
        if (mintPaused) revert MintPaused();
        if (_allowedSeaDrop[msg.sender] != true) revert UnauthorizedSeaDrop();
        if (minter == address(0)) revert InvalidRecipient();
        if (quantity == 0) revert InvalidQuantity();

        uint256 newSeaDropTotal = totalSeaDropMinted + quantity;
        if (newSeaDropTotal > SEADROP_MAX_SUPPLY) {
            revert SeaDropMintCapExceeded(newSeaDropTotal, SEADROP_MAX_SUPPLY);
        }

        uint256 newTotal = _totalMinted() + quantity;
        if (newTotal > MAX_SUPPLY) {
            revert MintQuantityExceedsMaxSupply(newTotal, MAX_SUPPLY);
        }

        totalSeaDropMinted = newSeaDropTotal;
        _safeMint(minter, quantity);
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function numberMinted(address wallet) external view returns (uint256) {
        return _numberMinted(wallet);
    }

    function paused() external view returns (bool) {
        return mintPaused;
    }

    function remainingSeaDropSupply() external view returns (uint256) {
        return SEADROP_MAX_SUPPLY - totalSeaDropMinted;
    }

    function remainingAirdropReserve() external view returns (uint256) {
        return AIRDROP_RESERVE - totalAirdropped;
    }

    function setMintPaused(bool isPaused) external onlyOwner {
        mintPaused = isPaused;
        emit MintPausedUpdated(isPaused);
    }

    function pause() external onlyOwner {
        mintPaused = true;
        emit MintPausedUpdated(true);
    }

    function unpause() external onlyOwner {
        mintPaused = false;
        emit MintPausedUpdated(false);
    }

    function pauseMint() external onlyOwner {
        mintPaused = true;
        emit MintPausedUpdated(true);
    }

    function unpauseMint() external onlyOwner {
        mintPaused = false;
        emit MintPausedUpdated(false);
    }

    function setAirdropPaused(bool isPaused) external onlyOwner {
        airdropPaused = isPaused;
        emit AirdropPausedUpdated(isPaused);
    }

    function pendingOwner() external view returns (address) {
        return potentialOwner;
    }

    function allowedSeaDrop(address seaDrop) external view returns (bool) {
        return _allowedSeaDrop[seaDrop];
    }

    function allowedSeaDrops() external view returns (address[] memory) {
        return _enumeratedAllowedSeaDrop;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasury();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setMetadataManager(address newManager) external onlyOwner {
        address oldManager = metadataManager;
        metadataManager = newManager;
        emit MetadataManagerUpdated(oldManager, newManager);
    }

    function setBaseURI(string calldata newBaseURI)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        if (metadataFrozen) revert MetadataIsFrozen();
        _onlyOwnerOrSelf();

        _tokenBaseURI = newBaseURI;

        if (totalSupply() != 0) {
            emit BatchMetadataUpdate(1, _nextTokenId() - 1);
        }
    }

    function setContractURI(string calldata newContractURI)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        if (metadataFrozen) revert MetadataIsFrozen();
        _onlyOwnerOrSelf();

        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function emitBatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId)
        external
        override(ERC721ContractMetadata)
    {
        _onlyOwnerOrMetadataManager();
        if (!_isValidMetadataRange(fromTokenId, toTokenId)) revert InvalidMetadataRange();
        emit BatchMetadataUpdate(fromTokenId, toTokenId);
    }

    function emitMetadataUpdate(uint256 tokenId) external {
        _onlyOwnerOrMetadataManager();
        if (!_isMintedToken(tokenId)) revert InvalidMetadataRange();
        emit MetadataUpdate(tokenId);
    }

    function setMaxSupply(uint256 newMaxSupply)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        _onlyOwnerOrSelf();
        if (newMaxSupply != MAX_SUPPLY) {
            revert MaxSupplyLocked(newMaxSupply, MAX_SUPPLY);
        }
        _maxSupply = MAX_SUPPLY;
        emit MaxSupplyUpdated(MAX_SUPPLY);
    }

    function setProvenanceHash(bytes32 newProvenanceHash)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        if (metadataFrozen) revert MetadataIsFrozen();
        _onlyOwnerOrSelf();
        if (_totalMinted() > 0) {
            revert ProvenanceHashCannotBeSetAfterMintStarted();
        }

        bytes32 oldProvenanceHash = _provenanceHash;
        _provenanceHash = newProvenanceHash;
        emit ProvenanceHashUpdated(oldProvenanceHash, newProvenanceHash);
    }

    function setRoyaltyInfo(ISeaDropTokenContractMetadata.RoyaltyInfo calldata newInfo)
        external
        override(ERC721ContractMetadata, ISeaDropTokenContractMetadata)
    {
        _setRoyaltyInfo(newInfo.royaltyAddress, newInfo.royaltyBps);
    }

    function updateRoyaltyReceiver(address receiver) external onlyOwner {
        _setRoyaltyInfo(receiver, _royaltyInfo.royaltyBps);
    }

    function updateRoyaltyPercentage(uint96 basisPoints) external onlyOwner {
        _setRoyaltyInfo(_royaltyInfo.royaltyAddress, basisPoints);
    }

    function freezeMetadata() external onlyOwner {
        revert InvalidMetadataFreezeConfirmation();
    }

    function freezeMetadata(string calldata confirmation) external onlyOwner {
        if (metadataFrozen) revert MetadataAlreadyFrozen();
        if (keccak256(bytes(confirmation)) != keccak256(bytes(FREEZE_METADATA_CONFIRMATION))) {
            revert InvalidMetadataFreezeConfirmation();
        }

        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function withdrawTreasury() external onlyOwner nonReentrant returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert NoTreasuryBalance();

        address payable target = payable(treasury);
        (bool success,) = target.call{ value: amount }("");
        if (!success) revert WithdrawFailed();

        emit TreasuryWithdrawn(target, amount);
    }

    function setExternalSystem(bytes32 systemId, address systemAddress) external onlyOwner {
        externalSystems[systemId] = systemAddress;
        emit ExternalSystemUpdated(systemId, systemAddress);
    }

    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop_) external override onlyOwner {
        _validateSeaDrops(allowedSeaDrop_, false);
        _updateAllowedSeaDrop(allowedSeaDrop_);
    }

    function airdrop(address[] calldata recipients, uint256[] calldata quantities, bytes32 batchId)
        external
        onlyOwner
        nonReentrant
    {
        _airdrop(batchId, 0, recipients, quantities);
    }

    function airdropBatch(
        bytes32 batchId,
        uint256 batchIndex,
        address[] calldata recipients,
        uint256[] calldata quantities
    ) external onlyOwner nonReentrant {
        _airdrop(batchId, batchIndex, recipients, quantities);
    }

    function renounceOwnership() public override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    function _airdrop(
        bytes32 batchId,
        uint256 batchIndex,
        address[] calldata recipients,
        uint256[] calldata quantities
    ) private {
        if (mintPaused || airdropPaused) revert AirdropPaused();
        if (batchId == bytes32(0)) revert InvalidBatchId();
        if (airdropBatchExecuted[batchId]) revert AirdropBatchAlreadyExecuted(batchId);

        uint256 length = recipients.length;
        if (length == 0) revert EmptyAirdropBatch();
        if (length != quantities.length) revert InvalidArrayLength();

        uint256 totalQuantity;
        for (uint256 i = 0; i < length;) {
            if (recipients[i] == address(0)) revert InvalidRecipient();
            uint256 quantity = quantities[i];
            if (quantity == 0) revert InvalidQuantity();
            totalQuantity += quantity;
            unchecked {
                ++i;
            }
        }

        uint256 newAirdroppedTotal = totalAirdropped + totalQuantity;
        if (newAirdroppedTotal > AIRDROP_RESERVE) {
            revert AirdropReserveExceeded(newAirdroppedTotal, AIRDROP_RESERVE);
        }

        uint256 firstTokenId = _nextTokenId();
        uint256 newTotal = _totalMinted() + totalQuantity;
        if (newTotal > MAX_SUPPLY) revert MaxSupplyExceeded(newTotal, MAX_SUPPLY);

        airdropBatchExecuted[batchId] = true;
        totalAirdropped = newAirdroppedTotal;

        for (uint256 i = 0; i < length;) {
            _safeMint(recipients[i], quantities[i]);
            unchecked {
                ++i;
            }
        }

        emit AirdropBatchExecuted(
            batchId,
            batchIndex,
            length,
            totalQuantity,
            firstTokenId,
            firstTokenId + totalQuantity - 1
        );
    }

    function _validateSeaDrops(address[] memory seaDrops, bool requireNonEmpty) private pure {
        uint256 seaDropCount = seaDrops.length;
        if (requireNonEmpty && seaDropCount == 0) revert InvalidSeaDropAddress();
        for (uint256 i = 0; i < seaDropCount;) {
            if (seaDrops[i] == address(0)) revert InvalidSeaDropAddress();
            unchecked {
                ++i;
            }
        }
    }

    function _setRoyaltyInfo(address receiver, uint96 basisPoints) private {
        _onlyOwnerOrSelf();
        if (receiver == address(0)) revert RoyaltyAddressCannotBeZeroAddress();
        if (basisPoints > 10_000) revert InvalidRoyaltyBasisPoints(basisPoints);

        _royaltyInfo = ISeaDropTokenContractMetadata.RoyaltyInfo({
            royaltyAddress: receiver, royaltyBps: basisPoints
        });

        emit RoyaltyInfoUpdated(receiver, basisPoints);
    }

    function _onlyOwnerOrMetadataManager() private view {
        if (msg.sender != owner() && msg.sender != metadataManager) revert OnlyOwner();
    }

    function _isMintedToken(uint256 tokenId) private view returns (bool) {
        return tokenId >= _startTokenId() && tokenId < _nextTokenId();
    }

    function _isValidMetadataRange(uint256 fromTokenId, uint256 toTokenId)
        private
        view
        returns (bool)
    {
        return fromTokenId <= toTokenId && _isMintedToken(fromTokenId) && _isMintedToken(toTokenId);
    }
}
