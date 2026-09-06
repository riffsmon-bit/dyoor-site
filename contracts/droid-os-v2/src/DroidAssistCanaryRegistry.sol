// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDroidParent} from "./DroidCustodyCandidate.sol";
import {DroidAssistAccountCandidate} from "./DroidAssistAccountCandidate.sol";
import {DroidAssistBadge} from "./DroidAssistBadge.sol";

/// @notice Isolated owner-approved Droid #11 canary. Not a collection-wide V2 rollout.
/// Constructor creates the fixed test badge; owner opt-in creates a separate Droid account.
contract DroidAssistCanaryRegistry {
    uint256 public constant CHAIN_ID = 143;
    uint256 public constant TOKEN_ID = 11;
    address public constant COLLECTION = 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A;
    bytes32 public constant COLLECTION_CODE_HASH = 0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd;
    bytes32 private constant SALT = keccak256("DYOOR_OWNER_APPROVED_CANARY_11_V1");
    DroidAssistBadge public immutable badge;
    address public account;

    error InvalidIdentity();
    error NotOwner();
    event AssistCanaryOptedIn(address indexed account, address indexed owner, address indexed badge);

    constructor() {
        _identity();
        badge = new DroidAssistBadge();
    }

    function _identity() private view {
        if (block.chainid != CHAIN_ID || COLLECTION.codehash != COLLECTION_CODE_HASH) revert InvalidIdentity();
    }

    function predictAccount() public view returns (address) {
        _identity();
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(DroidAssistAccountCandidate).creationCode, abi.encode(CHAIN_ID, COLLECTION, TOKEN_ID, badge)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), SALT, initHash)))));
    }

    function optIn() external returns (address) {
        _identity();
        if (msg.sender != IDroidParent(COLLECTION).ownerOf(TOKEN_ID)) revert NotOwner();
        if (account == address(0)) {
            account = address(new DroidAssistAccountCandidate{salt: SALT}(CHAIN_ID, COLLECTION, TOKEN_ID, badge));
            emit AssistCanaryOptedIn(account, msg.sender, address(badge));
        }
        return account;
    }
}
