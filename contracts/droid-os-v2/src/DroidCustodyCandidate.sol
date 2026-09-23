// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDroidParent {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IDroidERC721 is IDroidParent {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @notice Undeployed V2 custody research candidate, NOT the final autonomous account.
/// No grants, relayed signatures, arbitrary execution, approvals or upgrade hooks.
/// This custom factory design does NOT claim ERC-6551 compliance.
contract DroidCustodyCandidate {
    uint256 public immutable tokenChainId;
    address public immutable collection;
    uint256 public immutable tokenId;
    bytes32 public immutable collectionCodeHash;
    uint256 public actionNonce;
    bool private entered;

    error InvalidIdentity();
    error Unauthorized();
    error InvalidRecipient();
    error TransferFailed();
    error Reentrancy();
    error ParentCustodyForbidden();

    event Funded(address indexed sender, uint256 valueWei);
    event Withdrawn(
        uint256 indexed nonce,
        address indexed owner,
        address indexed asset,
        address recipient,
        uint256 amountOrTokenId,
        uint8 assetKind
    );

    constructor(uint256 chainId_, address collection_, uint256 tokenId_) {
        if (chainId_ != block.chainid || collection_.code.length == 0) revert InvalidIdentity();
        tokenChainId = chainId_;
        collection = collection_;
        tokenId = tokenId_;
        collectionCodeHash = collection_.codehash;
        currentOwner();
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function currentOwner() public view returns (address owner) {
        if (block.chainid != tokenChainId || collection.codehash != collectionCodeHash) revert InvalidIdentity();
        // Missing/burned token or an unavailable canonical owner reverts; no cache fallback.
        owner = IDroidParent(collection).ownerOf(tokenId);
        if (owner == address(0) || owner == address(this)) revert InvalidIdentity();
    }

    modifier onlyCurrentOwner() {
        if (entered) revert Reentrancy();
        address owner = currentOwner();
        if (msg.sender != owner) revert Unauthorized();
        entered = true;
        _;
        // Reject callbacks that leave control with someone else during a custody action.
        if (currentOwner() != owner) revert Unauthorized();
        entered = false;
    }

    function _recipient(address recipient) private view {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
    }

    /// @dev Gas is paid by the owner transaction, not a project prefunding wallet.
    function withdrawNative(address payable recipient, uint256 valueWei) external onlyCurrentOwner {
        _recipient(recipient);
        uint256 nonce = actionNonce++;
        (bool ok,) = recipient.call{value: valueWei}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(nonce, msg.sender, address(0), recipient, valueWei, 0);
    }

    /// @dev Typed owner-only ERC20 transfer; no allowance, Permit or operator interface.
    /// Fee/rebasing/malicious token economics are not certified by this method.
    function withdrawERC20(address asset, address recipient, uint256 amount) external onlyCurrentOwner {
        _recipient(recipient);
        if (asset.code.length == 0 || asset == address(this) || asset == collection) revert TransferFailed();
        uint256 nonce = actionNonce++;
        (bool ok, bytes memory result) = asset.call(abi.encodeWithSelector(bytes4(0xa9059cbb), recipient, amount));
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) {
            revert TransferFailed();
        }
        emit Withdrawn(nonce, msg.sender, asset, recipient, amount, 1);
    }

    function withdrawERC721(address asset, address recipient, uint256 id) external onlyCurrentOwner {
        _recipient(recipient);
        if (asset == collection && id == tokenId) revert ParentCustodyForbidden();
        if (asset.code.length == 0 || IDroidParent(asset).ownerOf(id) != address(this)) revert TransferFailed();
        uint256 nonce = actionNonce++;
        IDroidERC721(asset).safeTransferFrom(address(this), recipient, id);
        if (IDroidParent(asset).ownerOf(id) != recipient) revert TransferFailed();
        emit Withdrawn(nonce, msg.sender, asset, recipient, id, 2);
    }

    function onERC721Received(address, address, uint256 id, bytes calldata) external view returns (bytes4) {
        if (msg.sender == collection && id == tokenId) revert ParentCustodyForbidden();
        return this.onERC721Received.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x150b7a02;
    }
}
