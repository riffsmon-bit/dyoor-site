// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHoodYOOREnergyBank } from "./interfaces/IHoodYOOREnergyBank.sol";

/// @notice Non-transferable Energy ledger for HoodYØØR rerolls on Robinhood Chain.
/// @dev Credits are operator-controlled and replay-protected; only approved spenders can debit.
contract HoodYOOREnergyBank is IHoodYOOREnergyBank {
    bytes32 public constant DEFAULT_ADMIN_ROLE = bytes32(0);
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CREDIT_ROLE = keccak256("CREDIT_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    address public owner;
    address public pendingOwner;
    bool public paused;

    mapping(bytes32 role => mapping(address account => bool)) private _roles;
    mapping(address user => uint256) public override energyBalance;
    mapping(address user => uint256) public totalCredited;
    mapping(address user => uint256) public totalSpent;
    mapping(bytes32 creditId => bool) public usedCreditReference;
    mapping(bytes32 campaignId => bool) public usedCreditCampaign;

    error NotOwner();
    error NotPendingOwner();
    error MissingRole(bytes32 role, address account);
    error UnsupportedRole(bytes32 role);
    error ZeroAddress();
    error ZeroAmount();
    error EmptyReference();
    error LengthMismatch();
    error CreditReferenceUsed(bytes32 creditId);
    error CreditCampaignUsed(bytes32 campaignId);
    error InsufficientEnergy(uint256 available, uint256 required);
    error BankPaused();

    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event PauseStateUpdated(bool paused);
    event EnergyCredited(
        address indexed user, uint256 amount, bytes32 indexed creditId, address indexed operator
    );
    event EnergyCampaignCredited(
        bytes32 indexed campaignId, address indexed user, uint256 amount, address indexed operator
    );
    event EnergySpent(
        address indexed user, address indexed spender, uint256 amount, bytes32 indexed reason
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRole(bytes32 role) {
        if (!hasRole(role, msg.sender)) revert MissingRole(role, msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert BankPaused();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        _roles[CREDIT_ROLE][initialOwner] = true;
        _roles[PAUSER_ROLE][initialOwner] = true;
        emit OwnershipTransferred(address(0), initialOwner);
        emit RoleGranted(DEFAULT_ADMIN_ROLE, initialOwner, initialOwner);
        emit RoleGranted(CREDIT_ROLE, initialOwner, initialOwner);
        emit RoleGranted(PAUSER_ROLE, initialOwner, initialOwner);
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        if (role == DEFAULT_ADMIN_ROLE) return account == owner;
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyOwner {
        _setRole(role, account, true);
    }

    function revokeRole(bytes32 role, address account) external onlyOwner {
        _setRole(role, account, false);
    }

    function setPaused(bool nextPaused) external onlyRole(PAUSER_ROLE) {
        paused = nextPaused;
        emit PauseStateUpdated(nextPaused);
    }

    function creditEnergy(address user, uint256 amount, bytes32 creditId)
        external
        override
        onlyRole(CREDIT_ROLE)
        whenNotPaused
    {
        if (creditId == bytes32(0)) revert EmptyReference();
        if (usedCreditReference[creditId]) revert CreditReferenceUsed(creditId);
        usedCreditReference[creditId] = true;
        _credit(user, amount);
        emit EnergyCredited(user, amount, creditId, msg.sender);
    }

    function creditEnergyBatch(
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32 campaignId
    ) external onlyRole(CREDIT_ROLE) whenNotPaused {
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0) revert ZeroAmount();
        if (campaignId == bytes32(0)) revert EmptyReference();
        if (usedCreditCampaign[campaignId]) revert CreditCampaignUsed(campaignId);
        usedCreditCampaign[campaignId] = true;

        for (uint256 i; i < recipients.length; ++i) {
            _credit(recipients[i], amounts[i]);
            emit EnergyCampaignCredited(campaignId, recipients[i], amounts[i], msg.sender);
        }
    }

    function spendEnergy(address user, uint256 amount, bytes32 reason)
        external
        override
        onlyRole(SPENDER_ROLE)
        whenNotPaused
    {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (reason == bytes32(0)) revert EmptyReference();
        uint256 available = energyBalance[user];
        if (available < amount) revert InsufficientEnergy(available, amount);

        unchecked {
            energyBalance[user] = available - amount;
        }
        totalSpent[user] += amount;
        emit EnergySpent(user, msg.sender, amount, reason);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);

        _roles[CREDIT_ROLE][previousOwner] = false;
        _roles[PAUSER_ROLE][previousOwner] = false;
        _roles[CREDIT_ROLE][msg.sender] = true;
        _roles[PAUSER_ROLE][msg.sender] = true;

        emit RoleRevoked(DEFAULT_ADMIN_ROLE, previousOwner, msg.sender);
        emit RoleRevoked(CREDIT_ROLE, previousOwner, msg.sender);
        emit RoleRevoked(PAUSER_ROLE, previousOwner, msg.sender);
        emit RoleGranted(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
        emit RoleGranted(CREDIT_ROLE, msg.sender, msg.sender);
        emit RoleGranted(PAUSER_ROLE, msg.sender, msg.sender);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function _setRole(bytes32 role, address account, bool approved) private {
        if (role != CREDIT_ROLE && role != PAUSER_ROLE && role != SPENDER_ROLE) {
            revert UnsupportedRole(role);
        }
        if (account == address(0)) revert ZeroAddress();
        if (_roles[role][account] == approved) return;
        _roles[role][account] = approved;
        if (approved) emit RoleGranted(role, account, msg.sender);
        else emit RoleRevoked(role, account, msg.sender);
    }

    function _credit(address user, uint256 amount) private {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        energyBalance[user] += amount;
        totalCredited[user] += amount;
    }
}
