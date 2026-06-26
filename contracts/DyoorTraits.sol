// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

/// @title DyoorTraits
/// @notice ERC1155 trait item contract for D.Y.O.O.R burn-on-equip traits.
contract DyoorTraits is ERC1155, ERC1155Burnable, ERC1155Supply, Ownable {
    enum TraitSlot {
        Condition,
        Eyes,
        Clothes,
        Mouth,
        Hat,
        Accessories
    }

    struct TraitInfo {
        uint8 slot;
        uint8 rarity;
        bool exists;
        uint256 maxSupply;
        uint256 mintedSupply;
    }

    mapping(uint256 => TraitInfo) private _traitInfo;
    address public traitManager;
    string private _contractMetadataURI;

    event TraitCreated(uint256 indexed traitId, uint8 indexed slot, uint8 rarity, uint256 maxSupply);
    event TraitMinted(address indexed to, uint256 indexed traitId, uint256 amount);
    event TraitManagerUpdated(address indexed manager);
    event ContractURIUpdated(string contractURI);

    error ZeroAddress();
    error UndefinedTrait();
    error TraitAlreadyExists();
    error InvalidSlot();
    error MaxSupplyExceeded();
    error ArrayLengthMismatch();
    error NotTraitManager();

    modifier onlyTraitManager() {
        if (msg.sender != traitManager) revert NotTraitManager();
        _;
    }

    constructor(address initialOwner, string memory initialURI) ERC1155(initialURI) Ownable(initialOwner) {}

    function createTrait(uint256 traitId, uint8 slot, uint8 rarity, uint256 maxSupply) external onlyOwner {
        if (_traitInfo[traitId].exists) revert TraitAlreadyExists();
        if (slot > uint8(TraitSlot.Accessories)) revert InvalidSlot();

        _traitInfo[traitId] = TraitInfo({
            slot: slot,
            rarity: rarity,
            exists: true,
            maxSupply: maxSupply,
            mintedSupply: 0
        });

        emit TraitCreated(traitId, slot, rarity, maxSupply);
    }

    function mintTrait(address to, uint256 traitId, uint256 amount) public onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        TraitInfo storage info = _traitInfo[traitId];
        if (!info.exists) revert UndefinedTrait();
        _reserveSupply(info, amount);

        _mint(to, traitId, amount, "");
        emit TraitMinted(to, traitId, amount);
    }

    function batchMintTraits(address to, uint256[] calldata traitIds, uint256[] calldata amounts) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (traitIds.length != amounts.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < traitIds.length; ) {
            TraitInfo storage info = _traitInfo[traitIds[i]];
            if (!info.exists) revert UndefinedTrait();
            _reserveSupply(info, amounts[i]);

            unchecked {
                ++i;
            }
        }

        _mintBatch(to, traitIds, amounts, "");

        for (uint256 i = 0; i < traitIds.length; ) {
            emit TraitMinted(to, traitIds[i], amounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    function getTraitInfo(uint256 traitId) external view returns (TraitInfo memory) {
        return _traitInfo[traitId];
    }

    function burnFromManager(address from, uint256 traitId, uint256 amount) external onlyTraitManager {
        _burn(from, traitId, amount);
    }

    function setTraitManager(address manager) external onlyOwner {
        if (manager == address(0)) revert ZeroAddress();
        traitManager = manager;

        emit TraitManagerUpdated(manager);
    }

    function setURI(string calldata newURI) external onlyOwner {
        _setURI(newURI);
    }

    function contractURI() external view returns (string memory) {
        return _contractMetadataURI;
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractMetadataURI = newContractURI;

        emit ContractURIUpdated(newContractURI);
    }

    function exists(uint256 traitId) public view override returns (bool) {
        return _traitInfo[traitId].exists;
    }

    function _reserveSupply(TraitInfo storage info, uint256 amount) internal {
        uint256 maxSupply = info.maxSupply;
        uint256 newMintedSupply = info.mintedSupply + amount;

        if (maxSupply != 0 && newMintedSupply > maxSupply) revert MaxSupplyExceeded();
        info.mintedSupply = newMintedSupply;
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}
