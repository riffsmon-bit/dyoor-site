// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@droid-oz/token/ERC721/ERC721.sol";
import {MissionMintLab} from "../MissionFixtures.sol";
import {WrappedMissionAccountLab, IWrapperControlLab} from "./WrappedMissionAccountLab.sol";
import {WrappedAccountFactoryLab} from "./WrappedAccountFactoryLab.sol";

interface IWrappedParentLab {
    function ownerOf(uint256 id) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 id) external;
    function tokenURI(uint256 id) external view returns (string memory);
}

/// @notice Local custody/receipt experiment. No admin, upgrade, emergency seizure,
/// parent burn/approval, external executor or autonomous mainnet activation.
contract DroidControlReceiptLab is ERC721, IWrapperControlLab {
    IWrappedParentLab public immutable parent;
    bytes32 public immutable parentCodeHash;
    MissionMintLab public immutable minter;
    address public immutable accountFactory;
    mapping(uint256 => uint256) public ownershipEpoch;
    mapping(uint256 => bool) public isWrapped;
    mapping(uint256 => address) public accounts;
    mapping(address => bool) public isDroidAccount;
    bytes32 public constant WRAP_INTENT = keccak256("DYOOR_LOCAL_WRAP_V1");
    bool private entered;

    error LocalOnly();
    error Denied();
    event Wrapped(uint256 indexed tokenId, address indexed owner, address indexed account, uint256 epoch);
    event Unwrapped(uint256 indexed tokenId, address indexed owner, uint256 epoch);
    event AuthorityChanged(uint256 indexed tokenId, address indexed from, address indexed to, uint256 epoch);

    constructor(IWrappedParentLab parent_, MissionMintLab minter_)
        ERC721("LOCAL Droid Control Receipt", "DCTRL-LOCAL")
    {
        if (block.chainid != 31337) revert LocalOnly();
        if (
            address(parent_).code.length == 0
                || address(minter_).codehash != keccak256(type(MissionMintLab).runtimeCode)
        ) revert Denied();
        parent = parent_;
        parentCodeHash = address(parent_).codehash;
        minter = minter_;
        accountFactory = address(new WrappedAccountFactoryLab());
    }
    modifier locked() {
        if (entered) revert Denied();
        entered = true;
        _;
        entered = false;
    }

    function _identity() private view {
        if (block.chainid != 31337) revert LocalOnly();
        if (
            address(parent).codehash != parentCodeHash
                || address(minter).codehash != keccak256(type(MissionMintLab).runtimeCode)
        ) revert Denied();
    }

    /// @dev Called only after an authenticated owner-initiated safe deposit. Never pull
    /// with NFT approvals: the real S2 validator blocks an unlisted wrapper operator.
    function _issueReceipt(uint256 id, address owner) private {
        address account = accounts[id];
        if (account == address(0)) {
            account = WrappedAccountFactoryLab(accountFactory).create(id, minter);
            accounts[id] = account;
            isDroidAccount[account] = true;
        }
        isWrapped[id] = true;
        _safeMint(owner, id);
        if (ownerOf(id) != owner || parent.ownerOf(id) != address(this)) revert Denied();
        emit Wrapped(id, owner, account, ownershipEpoch[id]);
    }

    /// @notice Only receipt owner, never an approved operator. Drain supported lab
    /// assets first. Unknown ERC20/unsafe NFT deposits are NOT proved absent.
    function unwrap(uint256 id) external locked {
        _identity();
        _returnOriginal(id, msg.sender);
    }

    /// @dev Only this Droid's fixed account may complete its owner-authenticated
    /// atomic exit. No operator/runner/admin recipient selection is accepted.
    function completeAccountExit(uint256 id, address owner, uint256 expectedEpoch) external locked {
        _identity();
        if (msg.sender != accounts[id] || expectedEpoch != ownershipEpoch[id]) revert Denied();
        _returnOriginal(id, owner);
    }

    function _returnOriginal(uint256 id, address owner) private {
        if (
            !isWrapped[id] || ownerOf(id) != owner || parent.ownerOf(id) != address(this)
                || !WrappedMissionAccountLab(payable(accounts[id])).knownAssetsEmpty()
        ) revert Denied();
        isWrapped[id] = false;
        _burn(id);
        parent.safeTransferFrom(address(this), owner, id);
        if (parent.ownerOf(id) != owner) revert Denied();
        emit Unwrapped(id, owner, ownershipEpoch[id]);
    }

    function controlOf(uint256 id) external view returns (address owner, uint256 epoch, bool wrapped) {
        _identity();
        // No authority during a custody transition/callback, even if getters show intermediate state.
        if (entered || accounts[id] == address(0)) revert Denied();
        wrapped = isWrapped[id];
        epoch = ownershipEpoch[id];
        address rawOwner = parent.ownerOf(id);
        if (wrapped) {
            if (rawOwner != address(this)) {
                revert Denied();
            }
            owner = ownerOf(id);
        } else {
            if (_exists(id) || rawOwner == address(this)) {
                revert Denied();
            }
            owner = rawOwner;
        }
        if (owner == address(0) || owner == address(this) || isDroidAccount[owner]) revert Denied();
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireMinted(id);
        _identity();
        return parent.tokenURI(id);
    }

    /// @notice Opt in through parent.safeTransferFrom(owner,this,id,abi.encode(WRAP_INTENT)).
    /// Parent authenticates from/operator; only owner-as-operator and exact intent are accepted.
    function onERC721Received(address operator, address from, uint256 id, bytes calldata data)
        external
        locked
        returns (bytes4)
    {
        _identity();
        if (
            msg.sender != address(parent) || operator != from || from == address(0) || from == address(this)
                || isDroidAccount[from] || _exists(id) || isWrapped[id] || parent.ownerOf(id) != address(this)
                || keccak256(data) != keccak256(abi.encode(WRAP_INTENT))
        ) revert Denied();
        _issueReceipt(id, from);
        return this.onERC721Received.selector;
    }

    function _beforeTokenTransfer(address from, address to, uint256 id) internal override {
        _identity();
        if (to == address(this) || isDroidAccount[to]) revert Denied();
        if (from != address(0) && to != address(0)) {
            if (entered || !isWrapped[id] || parent.ownerOf(id) != address(this)) revert Denied();
        } else if (!entered) {
            revert Denied();
        }
        super._beforeTokenTransfer(from, to, id);
        uint256 epoch = ++ownershipEpoch[id];
        emit AuthorityChanged(id, from, to, epoch);
    }
}
