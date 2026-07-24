// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @title DYOORWorldNames
/// @notice Soulbound, holder-gated names for D.Y.O.O.R World on Monad.
/// @dev Names are Monad-native identities. They are not DNS names or Ethereum ENS names.
contract DYOORWorldNames is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    IERC721 public immutable S2_COLLECTION;
    bytes32 public immutable ROOT_NODE;

    bool public claimsOpen;
    bool public metadataLocked;
    uint256 public totalNames;
    string private _metadataBaseURI;

    mapping(address wallet => uint256 tokenId) private _tokenByWallet;
    mapping(address wallet => string label) private _labelByWallet;
    mapping(uint256 tokenId => string label) private _labelByToken;
    mapping(bytes32 labelHash => bool reserved) public reservedLabels;
    mapping(bytes32 node => address wallet) private _addressByNode;

    event ClaimsOpenUpdated(bool claimsOpen);
    event LabelReserved(bytes32 indexed labelHash, string label, bool reserved);
    event MetadataBaseURIUpdated(string metadataBaseURI);
    event MetadataLockedForever();
    event WorldNameClaimed(
        address indexed wallet,
        uint256 indexed tokenId,
        bytes32 indexed node,
        string label,
        string displayName
    );

    error ClaimsClosed();
    error HolderRequired();
    error InvalidLabel();
    error LabelReservedForProtocol();
    error NameAlreadyClaimed();
    error MetadataIsLocked();
    error WalletAlreadyNamed();
    error SoulboundName();
    error ZeroAddress();

    constructor(
        address initialOwner,
        address s2Collection,
        string memory metadataBaseURI
    ) ERC721("D.Y.O.O.R World Names", "DYOORNAME") Ownable(initialOwner) {
        if (s2Collection == address(0)) revert ZeroAddress();
        S2_COLLECTION = IERC721(s2Collection);
        ROOT_NODE = keccak256(abi.encodePacked(bytes32(0), keccak256(bytes("dyoor"))));
        _metadataBaseURI = metadataBaseURI;
    }

    function claim(string calldata label) external nonReentrant returns (uint256 tokenId) {
        if (!claimsOpen) revert ClaimsClosed();
        if (!_isHolder(msg.sender)) revert HolderRequired();
        if (_tokenByWallet[msg.sender] != 0) revert WalletAlreadyNamed();

        bytes32 labelHash = _validatedLabelHash(label);
        if (reservedLabels[labelHash]) revert LabelReservedForProtocol();

        tokenId = uint256(labelHash);
        if (_ownerOf(tokenId) != address(0)) revert NameAlreadyClaimed();

        bytes32 node = nodeForLabelHash(labelHash);
        _tokenByWallet[msg.sender] = tokenId;
        _labelByWallet[msg.sender] = label;
        _labelByToken[tokenId] = label;
        _addressByNode[node] = msg.sender;
        unchecked {
            totalNames += 1;
        }
        _safeMint(msg.sender, tokenId);

        emit WorldNameClaimed(
            msg.sender,
            tokenId,
            node,
            label,
            string.concat(label, ".dYOOR")
        );
    }

    function isHolder(address wallet) external view returns (bool) {
        return _isHolder(wallet);
    }

    function nameOf(address wallet) external view returns (string memory) {
        string memory label = _labelByWallet[wallet];
        return bytes(label).length == 0 ? "" : string.concat(label, ".dYOOR");
    }

    function labelOf(address wallet) external view returns (string memory) {
        return _labelByWallet[wallet];
    }

    function tokenOf(address wallet) external view returns (uint256) {
        return _tokenByWallet[wallet];
    }

    function labelOfToken(uint256 tokenId) external view returns (string memory) {
        _requireOwned(tokenId);
        return _labelByToken[tokenId];
    }

    function ownerOfName(string calldata label) external view returns (address) {
        return _ownerOf(uint256(_validatedLabelHash(label)));
    }

    function isAvailable(string calldata label) external view returns (bool) {
        bytes32 labelHash = _validatedLabelHash(label);
        return
            !reservedLabels[labelHash]
                && _ownerOf(uint256(labelHash)) == address(0);
    }

    function recordOf(
        address wallet
    )
        external
        view
        returns (
            uint256 tokenId,
            bytes32 node,
            string memory label,
            string memory displayName
        )
    {
        tokenId = _tokenByWallet[wallet];
        label = _labelByWallet[wallet];
        if (tokenId == 0 || bytes(label).length == 0) {
            return (0, bytes32(0), "", "");
        }
        node = nodeForLabelHash(bytes32(tokenId));
        displayName = string.concat(label, ".dYOOR");
    }

    function resolve(bytes32 node) external view returns (address) {
        return _addressByNode[node];
    }

    function nodeForLabel(string calldata label) external view returns (bytes32) {
        return nodeForLabelHash(_validatedLabelHash(label));
    }

    function nodeForLabelHash(bytes32 labelHash) public view returns (bytes32) {
        return keccak256(abi.encodePacked(ROOT_NODE, labelHash));
    }

    function setClaimsOpen(bool open) external onlyOwner {
        claimsOpen = open;
        emit ClaimsOpenUpdated(open);
    }

    function setReservedLabel(string calldata label, bool reserved) external onlyOwner {
        _setReservedLabel(label, reserved);
    }

    function setReservedLabels(
        string[] calldata labels,
        bool reserved
    ) external onlyOwner {
        uint256 length = labels.length;
        if (length == 0 || length > 100) revert InvalidLabel();
        for (uint256 index = 0; index < length; ) {
            _setReservedLabel(labels[index], reserved);
            unchecked {
                ++index;
            }
        }
    }

    function _setReservedLabel(string memory label, bool reserved) private {
        bytes32 labelHash = _validatedLabelHash(label);
        if (_ownerOf(uint256(labelHash)) != address(0)) revert NameAlreadyClaimed();
        reservedLabels[labelHash] = reserved;
        emit LabelReserved(labelHash, label, reserved);
    }

    function setMetadataBaseURI(string calldata metadataBaseURI) external onlyOwner {
        if (metadataLocked) revert MetadataIsLocked();
        _metadataBaseURI = metadataBaseURI;
        emit MetadataBaseURIUpdated(metadataBaseURI);
    }

    function lockMetadataForever() external onlyOwner {
        metadataLocked = true;
        emit MetadataLockedForever();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return bytes(_metadataBaseURI).length == 0
            ? ""
            : string.concat(_metadataBaseURI, tokenId.toString());
    }

    function _isHolder(address wallet) private view returns (bool) {
        try S2_COLLECTION.balanceOf(wallet) returns (uint256 balance) {
            return balance > 0;
        } catch {
            return false;
        }
    }

    function _validatedLabelHash(string memory label) private pure returns (bytes32) {
        bytes memory value = bytes(label);
        uint256 length = value.length;
        if (length < 3 || length > 24) revert InvalidLabel();
        if (value[0] == "-" || value[length - 1] == "-") revert InvalidLabel();

        bool previousHyphen;
        for (uint256 index = 0; index < length; ) {
            bytes1 character = value[index];
            bool isLowercaseLetter = character >= "a" && character <= "z";
            bool isNumber = character >= "0" && character <= "9";
            bool isHyphen = character == "-";
            if (!isLowercaseLetter && !isNumber && !isHyphen) revert InvalidLabel();
            if (isHyphen && previousHyphen) revert InvalidLabel();
            previousHyphen = isHyphen;
            unchecked {
                ++index;
            }
        }

        return keccak256(value);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert SoulboundName();
        return super._update(to, tokenId, auth);
    }
}
