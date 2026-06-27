// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title DyoorDroids
/// @notice ERC721 mint contract for D.Y.O.O.R Season 2 Droids.
contract DyoorDroids is ERC721, Ownable, Pausable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 3_333;

    bool public publicMintOpen;
    bool public metadataLocked;
    uint256 public mintPrice;
    uint256 public maxPerWallet;
    uint256 public totalMinted;
    address public treasury;
    address public traitManager;

    string private _baseTokenURI;
    string private _contractMetadataURI;
    uint256 private _nextTokenId = 1;

    struct DroidTraits {
        uint256 background;
        uint256 droid;
        uint256 condition;
        uint256 eyes;
        uint256 clothes;
        uint256 mouth;
        uint256 hat;
        uint256 accessories;
    }

    mapping(uint256 => DroidTraits) private _traits;
    mapping(uint256 => bool) private _lockedTraitsSet;
    mapping(address => uint256) public mintedCount;

    event MintSettingsUpdated(bool publicMintOpen, uint256 mintPrice, uint256 maxPerWallet);
    event TreasuryUpdated(address indexed treasury);
    event TraitManagerUpdated(address indexed manager);
    event BaseURIUpdated(string baseURI);
    event ContractURIUpdated(string contractURI);
    event MetadataLockedForever();
    event LockedTraitsSet(uint256 indexed tokenId, uint256 background, uint256 droid);
    event DynamicTraitUpdated(uint256 indexed tokenId, uint8 indexed slot, uint256 traitId);

    error ZeroAddress();
    error ZeroQuantity();
    error PublicMintClosed();
    error MaxSupplyExceeded();
    error MaxPerWalletExceeded();
    error IncorrectPayment();
    error WithdrawFailed();
    error NotTraitManager();
    error InvalidSlot();
    error LockedTraitsAlreadySet();
    error MetadataIsLocked();

    modifier onlyTraitManager() {
        if (msg.sender != traitManager) revert NotTraitManager();
        _;
    }

    constructor(address initialOwner, address initialTreasury) ERC721("D.Y.O.O.R", "DYOOR") Ownable(initialOwner) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        treasury = initialTreasury;
    }

    function ownerMint(address to, uint256 quantity) external onlyOwner whenNotPaused {
        if (to == address(0)) revert ZeroAddress();
        _mintDroids(to, quantity);
    }

    function publicMint(uint256 quantity) external payable whenNotPaused nonReentrant {
        if (!publicMintOpen) revert PublicMintClosed();
        if (quantity == 0) revert ZeroQuantity();
        if (mintedCount[msg.sender] + quantity > maxPerWallet) revert MaxPerWalletExceeded();
        if (msg.value != mintPrice * quantity) revert IncorrectPayment();

        mintedCount[msg.sender] += quantity;
        _mintDroids(msg.sender, quantity);
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        (bool success, ) = treasury.call{ value: balance }("");
        if (!success) revert WithdrawFailed();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory base = _baseTokenURI;
        if (bytes(base).length == 0) return "";

        return string.concat(base, tokenId.toString());
    }

    function contractURI() external view returns (string memory) {
        return _contractMetadataURI;
    }

    function getTraits(uint256 tokenId) external view returns (DroidTraits memory) {
        _requireOwned(tokenId);
        return _traits[tokenId];
    }

    function setInitialLockedTraits(uint256 tokenId, uint256 background, uint256 droid) public onlyOwner {
        _requireOwned(tokenId);
        if (_lockedTraitsSet[tokenId]) revert LockedTraitsAlreadySet();

        _lockedTraitsSet[tokenId] = true;
        _traits[tokenId].background = background;
        _traits[tokenId].droid = droid;

        emit LockedTraitsSet(tokenId, background, droid);
    }

    function batchSetInitialLockedTraits(
        uint256[] calldata tokenIds,
        uint256[] calldata backgrounds,
        uint256[] calldata droids
    ) external onlyOwner {
        uint256 length = tokenIds.length;
        if (backgrounds.length != length || droids.length != length) revert InvalidSlot();

        for (uint256 i = 0; i < length; ) {
            setInitialLockedTraits(tokenIds[i], backgrounds[i], droids[i]);
            unchecked {
                ++i;
            }
        }
    }

    function updateDynamicTrait(uint256 tokenId, uint8 slot, uint256 traitId) external onlyTraitManager {
        _requireOwned(tokenId);

        if (slot == 0) {
            _traits[tokenId].condition = traitId;
        } else if (slot == 1) {
            _traits[tokenId].eyes = traitId;
        } else if (slot == 2) {
            _traits[tokenId].clothes = traitId;
        } else if (slot == 3) {
            _traits[tokenId].mouth = traitId;
        } else if (slot == 4) {
            _traits[tokenId].hat = traitId;
        } else if (slot == 5) {
            _traits[tokenId].accessories = traitId;
        } else {
            revert InvalidSlot();
        }

        emit DynamicTraitUpdated(tokenId, slot, traitId);
    }

    function setMintSettings(bool isOpen, uint256 price, uint256 walletLimit) external onlyOwner {
        publicMintOpen = isOpen;
        mintPrice = price;
        maxPerWallet = walletLimit;

        emit MintSettingsUpdated(isOpen, price, walletLimit);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;

        emit TreasuryUpdated(newTreasury);
    }

    function setTraitManager(address manager) external onlyOwner {
        if (manager == address(0)) revert ZeroAddress();
        traitManager = manager;

        emit TraitManagerUpdated(manager);
    }

    function lockMetadataForever() external onlyOwner {
        metadataLocked = true;
        emit MetadataLockedForever();
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        if (metadataLocked) revert MetadataIsLocked();
        _baseTokenURI = newBaseURI;

        emit BaseURIUpdated(newBaseURI);
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractMetadataURI = newContractURI;

        emit ContractURIUpdated(newContractURI);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _mintDroids(address to, uint256 quantity) internal {
        if (quantity == 0) revert ZeroQuantity();
        if (totalMinted + quantity > MAX_SUPPLY) revert MaxSupplyExceeded();

        totalMinted += quantity;

        for (uint256 i = 0; i < quantity; ) {
            _safeMint(to, _nextTokenId);
            unchecked {
                ++_nextTokenId;
                ++i;
            }
        }
    }
}
