// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LabCollection} from "./LabCollection.sol";
import {LabMint} from "./LabMint.sol";

/// @notice LOCAL-ONLY permission/execution experiment, not an upgrade to Account V1.
/// One typed NFT_MINT capability. No arbitrary calldata, approvals, delegatecall or AI signer.
/// The simulation reviewer attests evidence; this is NOT trustless proof of simulation.
contract DroidMintAccountLab {
    struct MintGrant {
        address owner;
        uint256 epoch;
        uint256 reserveWei;
        uint256 maxValuePerActionWei;
        uint256 dailyLimitWei;
        uint256 maxActionsPerDay;
        uint64 validAfter;
        uint64 expiresAt;
        bool enabled;
    }

    LabCollection public immutable collection;
    LabMint public immutable mintTarget;
    uint256 public immutable tokenId;
    address public immutable executor;
    address public immutable reviewer;
    bytes32 public immutable mintCodeHash;
    bytes32 public immutable collectionCodeHash;
    MintGrant public grant;
    uint256 public revision;
    uint256 public actionNonce;
    mapping(uint256 => uint256) public spentPerDay;
    mapping(uint256 => uint256) public actionsPerDay;
    bytes32 public reviewedAction;
    uint64 public reviewExpiresAt;
    uint256 public reviewBlock;
    bool private entered;

    error Denied();
    error StaleAuthority();
    error GrantInactive();
    error LimitExceeded();
    error SimulationRequired();
    error UnexpectedOutcome();

    event GrantChanged(address indexed owner, uint256 indexed epoch, uint256 revision, bool enabled);
    event SimulationAttested(bytes32 indexed actionHash, address indexed reviewer, uint64 expiresAt);
    event MintExecuted(bytes32 indexed actionHash, uint256 indexed nonce, uint256 mintedTokenId, uint256 valueWei);
    event OwnerWithdrawal(address indexed owner, address indexed recipient, uint256 valueWei);

    modifier guarded() {
        if (entered) revert Denied();
        entered = true;
        _;
        entered = false;
    }

    constructor(LabCollection parent, uint256 id, LabMint target, address executor_, address reviewer_) {
        require(block.chainid == 31337, "LOCAL_ONLY");
        require(address(parent).codehash == keccak256(type(LabCollection).runtimeCode), "FIXTURE_ONLY");
        require(address(target).codehash == keccak256(type(LabMint).runtimeCode), "FIXTURE_ONLY");
        require(parent.ownerOf(id) != address(0), "UNKNOWN_DROID");
        require(executor_ != address(0) && reviewer_ != address(0) && executor_ != reviewer_, "INVALID_ROLES");
        collection = parent;
        tokenId = id;
        mintTarget = target;
        executor = executor_;
        reviewer = reviewer_;
        mintCodeHash = address(target).codehash;
        collectionCodeHash = address(parent).codehash;
    }

    receive() external payable {}

    function currentOwner() public view returns (address owner) {
        if (block.chainid != 31337 || address(collection).codehash != collectionCodeHash) revert Denied();
        owner = collection.ownerOf(tokenId);
        if (owner == address(0)) revert StaleAuthority();
    }

    function setMintGrant(
        uint256 reserveWei,
        uint256 maxValuePerActionWei,
        uint256 dailyLimitWei,
        uint256 maxActionsPerDay,
        uint64 validAfter,
        uint64 expiresAt
    ) external guarded {
        address owner = currentOwner();
        if (msg.sender != owner) revert Denied();
        if (maxActionsPerDay == 0 || maxValuePerActionWei > dailyLimitWei ||
            expiresAt <= block.timestamp || expiresAt <= validAfter ||
            expiresAt > block.timestamp + 7 days) revert GrantInactive();
        grant = MintGrant(owner, collection.ownershipEpoch(tokenId), reserveWei,
            maxValuePerActionWei, dailyLimitWei, maxActionsPerDay, validAfter, expiresAt, true);
        revision++;
        delete reviewedAction;
        emit GrantChanged(owner, grant.epoch, revision, true);
    }

    function revokeMintGrant() external guarded {
        if (msg.sender != currentOwner()) revert Denied();
        grant.enabled = false;
        revision++;
        delete reviewedAction;
        emit GrantChanged(msg.sender, collection.ownershipEpoch(tokenId), revision, false);
    }

    function _checkGrant() private view returns (uint256 valueWei) {
        address owner = currentOwner();
        if (owner != grant.owner || collection.ownershipEpoch(tokenId) != grant.epoch) revert StaleAuthority();
        if (!grant.enabled || block.timestamp < grant.validAfter || block.timestamp >= grant.expiresAt) revert GrantInactive();
        if (address(mintTarget).codehash != mintCodeHash) revert Denied();
        valueWei = mintTarget.price();
        uint256 day = block.timestamp / 1 days;
        if (valueWei > grant.maxValuePerActionWei || spentPerDay[day] + valueWei > grant.dailyLimitWei ||
            actionsPerDay[day] >= grant.maxActionsPerDay ||
            address(this).balance < valueWei || address(this).balance - valueWei < grant.reserveWei) revert LimitExceeded();
    }

    /// @notice No action fields come from the executor/AI. Target, recipient, selector and price are fixed.
    function nextActionHash() public view returns (bytes32) {
        uint256 valueWei = _checkGrant();
        return keccak256(abi.encode(block.chainid, address(this), address(collection), tokenId,
            grant.owner, grant.epoch, revision, actionNonce, address(mintTarget), mintCodeHash,
            LabMint.mint.selector, address(this), valueWei));
    }

    function attestSimulation(bytes32 actionHash, uint64 expiresAt) external guarded {
        if (msg.sender != reviewer) revert Denied();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 2 minutes ||
            actionHash != nextActionHash()) revert SimulationRequired();
        reviewedAction = actionHash;
        reviewExpiresAt = expiresAt;
        reviewBlock = block.number;
        emit SimulationAttested(actionHash, msg.sender, expiresAt);
    }

    function executeMint(uint256 expectedNonce) external guarded returns (uint256 mintedTokenId) {
        if (msg.sender != executor || expectedNonce != actionNonce) revert Denied();
        bytes32 actionHash = nextActionHash();
        if (reviewedAction != actionHash || block.timestamp >= reviewExpiresAt ||
            block.number > reviewBlock + 20) revert SimulationRequired();
        uint256 valueWei = mintTarget.price();
        uint256 beforeBalance = address(this).balance;
        uint256 beforeCount = mintTarget.balanceOf(address(this));
        uint256 day = block.timestamp / 1 days;
        delete reviewedAction;
        actionNonce++;
        spentPerDay[day] += valueWei;
        actionsPerDay[day]++;
        mintedTokenId = mintTarget.mint{value: valueWei}(address(this));
        if (mintTarget.ownerOf(mintedTokenId) != address(this) ||
            mintTarget.balanceOf(address(this)) != beforeCount + 1 ||
            address(this).balance != beforeBalance - valueWei ||
            address(this).balance < grant.reserveWei) revert UnexpectedOutcome();
        emit MintExecuted(actionHash, expectedNonce, mintedTokenId, valueWei);
    }

    /// @notice Explicit current-owner custody operation, never part of an executor grant.
    /// Owner may withdraw their reserve; the reserve restricts delegated spending only.
    function withdrawNative(address payable recipient, uint256 valueWei) external guarded {
        if (msg.sender != currentOwner() || recipient == address(0) || recipient == address(this)) revert Denied();
        delete reviewedAction;
        (bool success,) = recipient.call{value: valueWei}("");
        if (!success) revert UnexpectedOutcome();
        emit OwnerWithdrawal(msg.sender, recipient, valueWei);
    }
}
