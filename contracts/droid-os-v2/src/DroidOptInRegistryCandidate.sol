// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DroidCustodyCandidate, IDroidParent} from "./DroidCustodyCandidate.sol";

/// @notice Undeployed, fixed-identity opt-in factory research candidate.
/// No admin, implementation setter, asset migration, central deposits or executor.
contract DroidOptInRegistryCandidate {
    uint256 public constant CHAIN_ID = 143;
    address public constant COLLECTION = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    bytes32 public immutable collectionCodeHash;
    mapping(uint256 => address) public accounts;

    error InvalidChainOrCollection();
    error NotCurrentOwner();
    event OptedIn(uint256 indexed tokenId, address indexed account, address indexed owner);

    constructor() {
        if (block.chainid != CHAIN_ID || COLLECTION.code.length == 0) revert InvalidChainOrCollection();
        collectionCodeHash = COLLECTION.codehash;
    }

    function _checkIdentity() private view {
        if (block.chainid != CHAIN_ID || COLLECTION.codehash != collectionCodeHash) revert InvalidChainOrCollection();
    }

    function _salt(uint256 id) private pure returns (bytes32) {
        return keccak256(abi.encode("DYOOR_V2_CUSTODY_CANDIDATE_1", CHAIN_ID, COLLECTION, id));
    }

    function predictAccount(uint256 id) public view returns (address) {
        _checkIdentity();
        bytes32 initHash =
            keccak256(abi.encodePacked(type(DroidCustodyCandidate).creationCode, abi.encode(CHAIN_ID, COLLECTION, id)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(id), initHash)))));
    }

    /// @notice Explicit transaction from ownerOf; NFT approvals and backend sessions cannot opt in.
    function optIn(uint256 id) external returns (address account) {
        _checkIdentity();
        if (msg.sender != IDroidParent(COLLECTION).ownerOf(id)) revert NotCurrentOwner();
        account = accounts[id];
        if (account == address(0)) {
            account = address(new DroidCustodyCandidate{salt: _salt(id)}(CHAIN_ID, COLLECTION, id));
            accounts[id] = account;
            emit OptedIn(id, account, msg.sender);
        }
    }
}
