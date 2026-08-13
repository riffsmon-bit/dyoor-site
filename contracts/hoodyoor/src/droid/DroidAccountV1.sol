// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SignatureChecker } from "../lib/SignatureChecker.sol";
import {
    IDroidAccountBatch,
    IERC1271,
    IERC165,
    IERC6551Account,
    IERC6551Executable,
    IERC721Owner,
    IERC721Receiver,
    IERC1155Receiver
} from "./interfaces/IDroidAccount.sol";

/// @title DroidAccountV1
/// @notice Immutable owner-controlled smart-account body for a dYØØR/HoodYØØR NFT.
/// @dev Intended for ERC-6551 minimal proxies. V1 deliberately exposes no agent or admin path.
contract DroidAccountV1 is
    IERC165,
    IERC1271,
    IERC6551Account,
    IERC6551Executable,
    IDroidAccountBatch,
    IERC721Receiver,
    IERC1155Receiver
{
    uint8 public constant CALL_OPERATION = 0;
    uint256 public constant MAX_BATCH_CALLS = 32;
    uint256 public constant MAX_OWNER_RESOLUTION_DEPTH = 8;

    bytes4 private constant ERC1271_MAGIC_VALUE = IERC1271.isValidSignature.selector;
    bytes4 private constant TRANSFER_FROM_SELECTOR =
        bytes4(keccak256("transferFrom(address,address,uint256)"));
    bytes4 private constant SAFE_TRANSFER_FROM_SELECTOR =
        bytes4(keccak256("safeTransferFrom(address,address,uint256)"));
    bytes4 private constant SAFE_TRANSFER_FROM_DATA_SELECTOR =
        bytes4(keccak256("safeTransferFrom(address,address,uint256,bytes)"));

    address private immutable _implementation;
    uint256 private immutable _deploymentChainId;

    uint256 public override state;
    uint256 private _executionStatus;

    error DirectImplementationCall();
    error NotAuthorized(address caller, address currentOwner);
    error UnsupportedOperation(uint8 operation);
    error InvalidTarget();
    error EmptyBatch();
    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error ReentrantExecution();
    error ControllingCollectionNesting(address collection, uint256 tokenId);
    error ControllingTokenSelfTransfer(uint256 tokenId);

    event NativeReceived(address indexed sender, uint256 amount, uint256 indexed state);
    event Executed(
        address indexed executor,
        address indexed target,
        uint256 value,
        bytes4 indexed selector,
        uint256 state
    );
    event BatchExecuted(address indexed executor, uint256 callCount, uint256 indexed state);
    event ERC721Received(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed from,
        address operator,
        uint256 state
    );
    event ERC1155Received(
        address indexed collection,
        uint256 indexed tokenId,
        uint256 amount,
        address indexed from,
        address operator,
        uint256 state
    );
    event ERC1155BatchReceived(
        address indexed collection,
        address indexed from,
        address indexed operator,
        uint256 itemCount,
        uint256 state
    );

    modifier onlyAccount() {
        if (address(this) == _implementation) revert DirectImplementationCall();
        _;
    }

    modifier onlyTokenOwner() {
        if (address(this) == _implementation) revert DirectImplementationCall();
        address currentOwner = owner();
        if (currentOwner == address(0) || msg.sender != currentOwner) {
            revert NotAuthorized(msg.sender, currentOwner);
        }
        _;
    }

    modifier nonReentrantExecution() {
        if (_executionStatus == 2) revert ReentrantExecution();
        _executionStatus = 2;
        _;
        _executionStatus = 1;
    }

    constructor() {
        _implementation = address(this);
        _deploymentChainId = block.chainid;
    }

    receive() external payable override onlyAccount {
        uint256 nextState = _incrementState();
        emit NativeReceived(msg.sender, msg.value, nextState);
    }

    /// @notice Returns the NFT binding embedded by the canonical ERC-6551 registry.
    function token()
        public
        view
        override
        onlyAccount
        returns (uint256 chainId, address tokenContract, uint256 tokenId)
    {
        bytes memory footer = new bytes(0x60);
        assembly ("memory-safe") {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @notice Resolves authority from the controlling NFT's current owner.
    function owner() public view returns (address currentOwner) {
        if (address(this) == _implementation) return address(0);
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != _deploymentChainId || chainId != block.chainid) return address(0);
        try IERC721Owner(tokenContract).ownerOf(tokenId) returns (address tokenOwner) {
            if (!_ownershipCycleOrExcessiveDepth(tokenOwner)) currentOwner = tokenOwner;
        } catch {
            currentOwner = address(0);
        }
    }

    /// @notice Executes one ordinary CALL as the Droid Account.
    /// @dev Delegatecall, CREATE, and CREATE2 are intentionally unsupported.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        override
        onlyTokenOwner
        nonReentrantExecution
        returns (bytes memory result)
    {
        if (operation != CALL_OPERATION) {
            revert UnsupportedOperation(operation);
        }
        if (to == address(0) || to == address(this)) revert InvalidTarget();
        _preventSelfControl(to, data);

        uint256 nextState = _incrementState();
        result = _call(to, value, data);
        emit Executed(msg.sender, to, value, _selector(data), nextState);
    }

    /// @notice Executes an atomic, owner-authorized batch of ordinary CALL operations.
    function executeBatch(Call[] calldata calls)
        external
        payable
        override
        onlyTokenOwner
        nonReentrantExecution
        returns (bytes[] memory results)
    {
        uint256 length = calls.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert BatchTooLarge(length, MAX_BATCH_CALLS);

        uint256 nextState = _incrementState();
        results = new bytes[](length);
        for (uint256 index; index < length; ++index) {
            Call calldata accountCall = calls[index];
            if (accountCall.to == address(0) || accountCall.to == address(this)) {
                revert InvalidTarget();
            }
            _preventSelfControl(accountCall.to, accountCall.data);
            results[index] = _call(accountCall.to, accountCall.value, accountCall.data);
            emit Executed(
                msg.sender,
                accountCall.to,
                accountCall.value,
                _selector(accountCall.data),
                nextState
            );
        }
        emit BatchExecuted(msg.sender, length, nextState);
    }

    /// @notice ERC-6551 signer discovery using only the current NFT owner.
    function isValidSigner(address signer, bytes calldata)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        address currentOwner = owner();
        if (currentOwner != address(0) && signer == currentOwner) {
            return IERC6551Account.isValidSigner.selector;
        }
        return bytes4(0);
    }

    /// @notice ERC-1271 validation against the current NFT owner.
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        address currentOwner = owner();
        if (
            currentOwner != address(0)
                && SignatureChecker.isValidSignatureNow(currentOwner, hash, signature)
        ) return ERC1271_MAGIC_VALUE;
        return bytes4(0);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata)
        external
        override
        onlyAccount
        returns (bytes4)
    {
        (, address controllingCollection,) = token();
        if (msg.sender == controllingCollection) {
            revert ControllingCollectionNesting(msg.sender, tokenId);
        }
        uint256 nextState = _incrementState();
        emit ERC721Received(msg.sender, tokenId, from, operator, nextState);
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata
    ) external override onlyAccount returns (bytes4) {
        uint256 nextState = _incrementState();
        emit ERC1155Received(msg.sender, id, value, from, operator, nextState);
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata,
        bytes calldata
    ) external override onlyAccount returns (bytes4) {
        uint256 nextState = _incrementState();
        emit ERC1155BatchReceived(msg.sender, from, operator, ids.length, nextState);
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId
            || interfaceId == type(IDroidAccountBatch).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function _call(address to, uint256 value, bytes calldata data)
        private
        returns (bytes memory result)
    {
        bool success;
        (success, result) = to.call{ value: value }(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    function _preventSelfControl(address target, bytes calldata data) private view {
        (, address controllingCollection, uint256 controllingTokenId) = token();
        if (target != controllingCollection || data.length < 100) return;

        bytes4 selector = _selector(data);
        if (
            selector != TRANSFER_FROM_SELECTOR && selector != SAFE_TRANSFER_FROM_SELECTOR
                && selector != SAFE_TRANSFER_FROM_DATA_SELECTOR
        ) return;

        address recipient;
        uint256 transferredTokenId;
        assembly ("memory-safe") {
            recipient := calldataload(add(data.offset, 0x24))
            transferredTokenId := calldataload(add(data.offset, 0x44))
        }
        if (recipient == address(this) && transferredTokenId == controllingTokenId) {
            revert ControllingTokenSelfTransfer(controllingTokenId);
        }
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
    }

    /// @dev Resolves nested ERC-6551 bindings to reject self/circular authority without recursion.
    function _ownershipCycleOrExcessiveDepth(address candidate) private view returns (bool) {
        address cursor = candidate;
        for (uint256 depth; depth < MAX_OWNER_RESOLUTION_DEPTH; ++depth) {
            if (cursor == address(this)) return true;
            if (cursor.code.length == 0) return false;

            (bool success, bytes memory result) =
                cursor.staticcall(abi.encodeCall(IERC6551Account.token, ()));
            if (!success || result.length < 96) return false;

            (uint256 chainId, address nestedCollection, uint256 nestedTokenId) =
                abi.decode(result, (uint256, address, uint256));
            if (chainId != block.chainid || nestedCollection.code.length == 0) return false;

            try IERC721Owner(nestedCollection).ownerOf(nestedTokenId) returns (
                address nestedOwner
            ) {
                cursor = nestedOwner;
            } catch {
                return false;
            }
        }

        // Deep account graphs are not required by V1 and fail closed rather than risk a hidden cycle.
        return true;
    }

    function _incrementState() private returns (uint256 nextState) {
        unchecked {
            nextState = ++state;
        }
    }
}
