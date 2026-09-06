// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MissionMintLab} from "./MissionFixtures.sol";

/// @notice LOCAL-ONLY permission/account experiment, not a deployable V2 design.
/// Constructor and every authority path require 31337 and exact fixture code.
/// Only FREE_FIXTURE_MINT is implemented. No swap, paid mint, arbitrary call,
/// token approvals, session signer, upgrade authority or AI execution interface.
abstract contract DroidMissionAccountCoreLab {
    struct Limits {
        address runner;
        uint64 validAfter;
        uint64 expiresAt;
        uint32 maxActions;
        uint32 maxActionsPerDay;
        uint256 protectedReserveWei;
        bytes32 missionHash;
    }

    struct Grant {
        address authorizer;
        uint256 ownershipEpoch;
        Limits limits;
        uint32 executed;
        bool cancelled;
    }
    MissionMintLab public immutable minter;
    uint256 public immutable tokenId;
    uint256 public missionId;
    uint256 public actionNonce;
    Grant public grant;
    mapping(uint256 => mapping(uint256 => uint32)) public dailyActions;
    bool private entered;

    error LocalOnly();
    error InvalidIdentity();
    error Unauthorized();
    error InvalidLimits();
    error Denied();
    error Reentrancy();

    event Funded(address indexed from, uint256 amount);
    event MissionLaunched(
        uint256 indexed missionId, address indexed authorizer, address indexed runner, uint256 epoch, Limits limits
    );
    event MissionCancelled(uint256 indexed missionId, address indexed owner);
    event MissionAction(
        uint256 indexed missionId,
        uint256 indexed nonce,
        address indexed runner,
        address authorizer,
        bytes32 missionHash,
        bytes32 simulationCommitment,
        uint256 mintedId
    );
    event Withdrawn(address indexed owner, address indexed recipient, address asset, uint256 amountOrId);

    constructor(uint256 tokenId_, MissionMintLab minter_) {
        if (block.chainid != 31337) revert LocalOnly();
        tokenId = tokenId_;
        minter = minter_;
        _checkLocalTarget();
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function _checkLocalTarget() internal view {
        if (block.chainid != 31337) revert LocalOnly();
        if (address(minter).codehash != keccak256(type(MissionMintLab).runtimeCode)) revert InvalidIdentity();
    }
    function _identity() internal view virtual returns (address owner, uint256 epoch);
    function _requireMissionAuthority() internal view virtual {}
    modifier locked() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }
    modifier currentOwner() {
        (address owner, uint256 epoch) = _identity();
        if (msg.sender != owner) revert Unauthorized();
        _;
        (address afterOwner, uint256 afterEpoch) = _identity();
        if (owner != afterOwner || epoch != afterEpoch) revert Unauthorized();
    }

    /// @notice The owner's transaction is the authorization, never chat or a hash alone.
    /// expectedNonce/epoch bind an owner-reviewed plan against replacement/transfer races.
    function launch(Limits calldata limits, uint256 expectedNonce, uint256 expectedEpoch)
        external
        locked
        currentOwner
        returns (uint256 id)
    {
        _requireMissionAuthority();
        (, uint256 epoch) = _identity();
        if (expectedNonce != actionNonce || expectedEpoch != epoch) {
            revert Denied();
        }
        if (
            limits.runner == address(0) || limits.runner == address(this) || limits.missionHash == bytes32(0)
                || limits.expiresAt <= block.timestamp || limits.expiresAt <= limits.validAfter
                || limits.expiresAt > block.timestamp + 7 days || limits.maxActions == 0 || limits.maxActions > 20
                || limits.maxActionsPerDay == 0 || limits.maxActionsPerDay > limits.maxActions
                || address(this).balance < limits.protectedReserveWei
        ) revert InvalidLimits();
        id = ++missionId;
        actionNonce++;
        grant = Grant(msg.sender, expectedEpoch, limits, 0, false);
        emit MissionLaunched(id, msg.sender, limits.runner, expectedEpoch, limits);
    }

    function cancel() external locked currentOwner {
        grant.cancelled = true;
        actionNonce++;
        emit MissionCancelled(missionId, msg.sender);
    }

    /// @dev Fixed target + selector + zero value + recipient=this. The runner cannot
    /// supply calldata or redirect proceeds. It pays transaction gas externally.
    /// simulationCommitment is an audit reference, NOT proof that simulation ran.
    function executeFreeMint(
        uint256 expectedMission,
        uint256 expectedNonce,
        uint64 deadline,
        bytes32 simulationCommitment
    ) external locked returns (uint256 mintedId) {
        _requireMissionAuthority();
        (address owner, uint256 epoch) = _identity();
        Grant storage g = grant;
        uint256 day = block.timestamp / 1 days;
        if (
            expectedMission != missionId || expectedNonce != actionNonce || missionId == 0 || g.cancelled
                || msg.sender != g.limits.runner || owner != g.authorizer || epoch != g.ownershipEpoch
                || block.timestamp < g.limits.validAfter || block.timestamp >= g.limits.expiresAt
                || deadline <= block.timestamp || deadline > block.timestamp + 2 minutes
                || simulationCommitment == bytes32(0) || g.executed >= g.limits.maxActions
                || dailyActions[missionId][day] >= g.limits.maxActionsPerDay
                || address(this).balance < g.limits.protectedReserveWei
        ) revert Denied();
        uint256 balanceBefore = address(this).balance;
        uint256 countBefore = minter.balanceOf(address(this));
        actionNonce++;
        g.executed++;
        dailyActions[missionId][day]++;
        mintedId = minter.mint();
        (address afterOwner, uint256 afterEpoch) = _identity();
        if (
            afterOwner != owner || afterEpoch != epoch || address(this).balance != balanceBefore
                || minter.ownerOf(mintedId) != address(this) || minter.balanceOf(address(this)) != countBefore + 1
        ) revert Denied();
        emit MissionAction(
            missionId, expectedNonce, msg.sender, owner, g.limits.missionHash, simulationCommitment, mintedId
        );
    }

    function withdrawNative(address payable recipient, uint256 amount) external locked currentOwner {
        if (recipient == address(0) || recipient == address(this)) revert Denied();
        actionNonce++;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert Denied();
        emit Withdrawn(msg.sender, recipient, address(0), amount);
    }

    function withdrawMint(address recipient, uint256 id) external locked currentOwner {
        if (recipient == address(0) || recipient == address(this)) revert Denied();
        actionNonce++;
        minter.safeTransferFrom(address(this), recipient, id);
        if (minter.ownerOf(id) != recipient) revert Denied();
        emit Withdrawn(msg.sender, recipient, address(minter), id);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(minter)) revert Denied();
        return this.onERC721Received.selector;
    }

    /// @dev Only proves the two supported lab assets empty, NOT arbitrary asset absence.
    function knownAssetsEmpty() external view returns (bool) {
        _checkLocalTarget();
        return address(this).balance == 0 && minter.balanceOf(address(this)) == 0;
    }
}
