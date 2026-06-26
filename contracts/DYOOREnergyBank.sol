// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title DYOOREnergyBank
/// @notice Non-transferable Energy point bank for D.Y.O.O.R.
/// @dev Energy is NOT an ERC20. It is an internal spendable points balance.
///      Designed to pair with the existing Ascension staking contract without replacing it.
contract DYOOREnergyBank is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CREDIT_ROLE = keccak256("CREDIT_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");
    bytes32 public constant CREDIT_SIGNER_ROLE = keccak256("CREDIT_SIGNER_ROLE");

    bytes32 private constant CREDIT_TYPEHASH =
        keccak256(
            "CreditAuthorization(address user,uint256 amount,bytes32 claimTxHash,uint256 nonce,uint256 deadline)"
        );

    address public immutable ascensionStaking;

    mapping(address => uint256) public energyBalance;
    mapping(address => uint256) public totalCredited;
    mapping(address => uint256) public totalSpent;
    mapping(address => uint256) public nonces;

    mapping(bytes32 => bool) public usedClaimTxHash;
    mapping(bytes32 => bool) public usedAirdropCampaign;

    event EnergyCredited(
        address indexed user,
        uint256 amount,
        bytes32 indexed claimTxHash,
        address indexed operator
    );

    event EnergySpent(
        address indexed user,
        address indexed spender,
        uint256 amount,
        bytes32 indexed reason
    );

    event EnergyCorrected(
        address indexed user,
        int256 delta,
        address indexed operator,
        bytes32 indexed reason
    );

    event EnergyAirdropped(bytes32 indexed campaignId, address indexed recipient, uint256 amount);

    event SpenderSet(address indexed spender, bool approved);
    event CreditSignerSet(address indexed signer, bool approved);

    error ZeroAddress();
    error ZeroAmount();
    error ExpiredAuthorization();
    error InvalidNonce();
    error InvalidSignature();
    error ClaimAlreadyUsed();
    error CampaignAlreadyUsed();
    error InsufficientEnergy();

    constructor(
        address admin,
        address _ascensionStaking
    ) EIP712("DYOOREnergyBank", "1") {
        if (admin == address(0)) revert ZeroAddress();
        if (_ascensionStaking == address(0)) revert ZeroAddress();

        ascensionStaking = _ascensionStaking;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(CREDIT_ROLE, admin);
        _grantRole(CREDIT_SIGNER_ROLE, admin);
    }

    // ------------------------------------------------------------
    // View helpers
    // ------------------------------------------------------------

    function spendableEnergy(address user) external view returns (uint256) {
        return energyBalance[user];
    }

    function lifetimeEnergy(address user) external view returns (uint256) {
        return totalCredited[user];
    }

    // ------------------------------------------------------------
    // Admin role helpers
    // ------------------------------------------------------------

    function setSpender(address spender, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (spender == address(0)) revert ZeroAddress();

        if (approved) {
            _grantRole(SPENDER_ROLE, spender);
        } else {
            _revokeRole(SPENDER_ROLE, spender);
        }

        emit SpenderSet(spender, approved);
    }

    function setCreditSigner(address signer, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer == address(0)) revert ZeroAddress();

        if (approved) {
            _grantRole(CREDIT_SIGNER_ROLE, signer);
        } else {
            _revokeRole(CREDIT_SIGNER_ROLE, signer);
        }

        emit CreditSignerSet(signer, approved);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------
    // Credit Energy
    // ------------------------------------------------------------

    /// @notice Directly credits Energy. Use this for trusted backend/indexer/operator flow.
    /// @dev claimTxHash should be the staking claim transaction hash, converted to bytes32.
    function creditEnergy(
        address user,
        uint256 amount,
        bytes32 claimTxHash
    ) external onlyRole(CREDIT_ROLE) whenNotPaused nonReentrant {
        _credit(user, amount, claimTxHash, msg.sender);
    }

    /// @notice User can credit Energy using a signed authorization from an approved signer.
    /// @dev This lets the website verify the harvest tx off-chain, sign the amount, then user claims it on-chain.
    function creditWithAuthorization(
        address user,
        uint256 amount,
        bytes32 claimTxHash,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > deadline) revert ExpiredAuthorization();
        if (nonce != nonces[user]) revert InvalidNonce();

        bytes32 structHash = keccak256(
            abi.encode(
                CREDIT_TYPEHASH,
                user,
                amount,
                claimTxHash,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);

        if (!hasRole(CREDIT_SIGNER_ROLE, recovered)) revert InvalidSignature();

        unchecked {
            nonces[user] += 1;
        }

        _credit(user, amount, claimTxHash, recovered);
    }

    function _credit(
        address user,
        uint256 amount,
        bytes32 claimTxHash,
        address operator
    ) internal {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (claimTxHash == bytes32(0)) revert ZeroAmount();
        if (usedClaimTxHash[claimTxHash]) revert ClaimAlreadyUsed();

        usedClaimTxHash[claimTxHash] = true;

        energyBalance[user] += amount;
        totalCredited[user] += amount;

        emit EnergyCredited(user, amount, claimTxHash, operator);
    }

    /// @notice Admin campaign airdrop for internal Energy points.
    /// @dev Credits spendable and lifetime Energy only. Does not touch staking or pending harvest state.
    function airdropEnergy(
        address[] calldata recipients,
        uint256 amount,
        bytes32 campaignId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (recipients.length == 0) revert ZeroAmount();
        if (campaignId == bytes32(0)) revert ZeroAmount();
        if (usedAirdropCampaign[campaignId]) revert CampaignAlreadyUsed();

        usedAirdropCampaign[campaignId] = true;

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];
            if (recipient == address(0)) revert ZeroAddress();

            energyBalance[recipient] += amount;
            totalCredited[recipient] += amount;

            emit EnergyAirdropped(campaignId, recipient, amount);
        }
    }

    // ------------------------------------------------------------
    // Spend Energy
    // ------------------------------------------------------------

    /// @notice Called by approved game contracts: CapsuleManager, RerollManager, TraitUpgradeManager.
    function spendEnergy(
        address user,
        uint256 amount,
        bytes32 reason
    ) external onlyRole(SPENDER_ROLE) whenNotPaused nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 bal = energyBalance[user];
        if (bal < amount) revert InsufficientEnergy();

        unchecked {
            energyBalance[user] = bal - amount;
        }

        totalSpent[user] += amount;

        emit EnergySpent(user, msg.sender, amount, reason);
    }

    // ------------------------------------------------------------
    // Emergency correction
    // ------------------------------------------------------------

    /// @notice Admin correction tool for migration mistakes, ledger errors, or exploit response.
    /// @dev Positive delta adds Energy. Negative delta removes Energy.
    function correctEnergy(
        address user,
        int256 delta,
        bytes32 reason
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (delta == 0) revert ZeroAmount();

        if (delta > 0) {
            uint256 addAmount = uint256(delta);
            energyBalance[user] += addAmount;
            totalCredited[user] += addAmount;
        } else {
            uint256 removeAmount = uint256(-delta);
            uint256 bal = energyBalance[user];
            if (bal < removeAmount) revert InsufficientEnergy();

            unchecked {
                energyBalance[user] = bal - removeAmount;
            }

            totalSpent[user] += removeAmount;
        }

        emit EnergyCorrected(user, delta, msg.sender, reason);
    }
}
